// Cloudflare Worker for the web workshop.
// - Everything outside /api/ is served from dist/ (static assets).
// - /api/ needs a valid Cloudflare Access login (JWT in the header Cf-Access-Jwt-Assertion).
// - The repository on GitHub is the only source of truth: the workshop reads the game data from the
//   current main branch and every save becomes one commit (author = the logged-in person).
//
// Configuration (wrangler.jsonc › vars, secrets in the Cloudflare dashboard):
//   GITHUB_REPO   "owner/name"                     BRANCH   "main"
//   DATA_DIR      "projects/nomadtactics"          TEAM_DOMAIN  "https://<team>.cloudflareaccess.com"
//   POLICY_AUD    Access application audience tag  GITHUB_TOKEN (secret) fine-grained token, contents read/write
import { pretty } from '../tools/json.js';

const GITHUB = 'https://api.github.com';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const failure = (status, message, extra = {}) => json({ error: message, ...extra }, status);

export default {
  async fetch(request, env, ctx) { return handle(request, env, globalThis.fetch.bind(globalThis)); },
};

// fetchFn is injectable for tests (fake GitHub, fake Access certificates).
export async function handle(request, env, fetchFn) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  try {
    // Setup help: shows the (unverified) team domain and audience of the own Access login, nothing else
    if (url.pathname === '/api/access-info') return json(accessInfo(request));
    if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return failure(503, 'Login ist noch nicht eingerichtet (TEAM_DOMAIN / POLICY_AUD fehlen).');
    const user = await accessUser(request, env, fetchFn);
    if (!user) return failure(401, 'Nicht angemeldet.');
    const prof = await readProfile(env, user);
    if (url.pathname === '/api/session') return json({ user: { ...user, name: prof.name }, profile: prof, repo: env.GITHUB_REPO, branch: branch(env) });
    if (url.pathname === '/api/profile' && request.method === 'GET') return json(prof);
    if (url.pathname === '/api/profile' && request.method === 'PUT') return await writeProfile(env, user, await request.json());
    if (!env.GITHUB_TOKEN) return failure(503, 'GitHub-Schlüssel fehlt (GITHUB_TOKEN).');
    const gh = github(env, fetchFn);
    if (url.pathname === '/api/files' && request.method === 'GET') return json(await readFiles(gh, env));
    if (url.pathname === '/api/commit' && request.method === 'POST') return await commit(gh, env, { name: prof.name, email: commitEmail(prof) }, await request.json());
    return failure(404, 'Unbekannter Weg.');
  } catch (e) {
    return failure(e.status || 500, e.message || String(e));
  }
}

const branch = env => env.BRANCH || 'main';
const dataDir = env => (env.DATA_DIR || 'projects/nomadtactics').replace(/\/+$/, '');

// ---------- Cloudflare Access ----------
export function accessInfo(request) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { login: false, hint: 'Kein Access-Login: Cloudflare Access ist für diese Adresse noch nicht eingeschaltet.' };
  try {
    const body = JSON.parse(text(b64url(token.split('.')[1])));
    return { login: true, email: body.email, TEAM_DOMAIN: body.iss, POLICY_AUD: Array.isArray(body.aud) ? body.aud[0] : body.aud };
  } catch { return { login: false, hint: 'Access-Kopfzeile nicht lesbar.' }; }
}

const certCache = new Map();   // team domain -> { keys, time }

export async function accessUser(request, env, fetchFn) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head, body;
  try { head = JSON.parse(text(b64url(parts[0]))); body = JSON.parse(text(b64url(parts[1]))); } catch { return null; }
  if (head.alg !== 'RS256') return null;
  const team = env.TEAM_DOMAIN.replace(/\/+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (body.iss !== team || !aud.includes(env.POLICY_AUD) || !(body.exp > now) || (body.nbf && body.nbf > now + 60)) return null;
  const keys = await certificates(team, fetchFn);
  let jwk = keys.find(k => k.kid === head.kid);
  if (!jwk) { certCache.delete(team); jwk = (await certificates(team, fetchFn)).find(k => k.kid === head.kid); }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok || !body.email) return null;
  return { email: body.email, name: nameFromEmail(body.email) };
}

async function certificates(team, fetchFn) {
  const hit = certCache.get(team);
  if (hit && Date.now() - hit.time < 3600_000) return hit.keys;
  const r = await fetchFn(`${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw Object.assign(new Error('Access-Zertifikate nicht erreichbar.'), { status: 502 });
  const keys = (await r.json()).keys || [];
  certCache.set(team, { keys, time: Date.now() });
  return keys;
}

export function nameFromEmail(email) {
  const local = String(email).split('@')[0].split('+')[0];
  return local.split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || email;
}

function b64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const text = bytes => new TextDecoder().decode(bytes);

// ---------- Profile (KV binding PROFILES, key "profile:<login e-mail>") ----------
// The login e-mail never goes into the repository: commits use the profile's commit e-mail or an anonymous address.
export const THEMES = ['gray', 'violet', 'brightness'];
export const AUTOSAVE = [0, 30, 60, 300];
const slug = t => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'werkstatt';
export function standardProfile(user) { return { name: user.name, commitEmail: '', color: '#4a90d9', autosave: 60, theme: 'gray' }; }
export function commitEmail(prof) { return prof.commitEmail || `${slug(prof.name)}@werkstatt.nomadtactics.invalid`; }

async function readProfile(env, user) {
  const saved = env.PROFILES ? await env.PROFILES.get('profile:' + user.email.toLowerCase(), 'json').catch(() => null) : null;
  return { ...standardProfile(user), ...(saved || {}), email: user.email };
}

export function checkProfile(p) {
  const out = {};
  const name = String(p?.name ?? '').trim();
  if (!name || name.length > 40) return { error: 'Der Name braucht 1 bis 40 Zeichen.' };
  out.name = name;
  const mail = String(p?.commitEmail ?? '').trim();
  if (mail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail)) return { error: 'Die Commit-E-Mail sieht nicht wie eine E-Mail-Adresse aus.' };
  out.commitEmail = mail;
  out.color = /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#4a90d9';
  out.autosave = AUTOSAVE.includes(Number(p?.autosave)) ? Number(p.autosave) : 60;
  out.theme = THEMES.includes(p?.theme) ? p.theme : 'gray';
  return { profile: out };
}

async function writeProfile(env, user, body) {
  if (!env.PROFILES) return failure(503, 'Profilspeicher fehlt (KV-Bindung PROFILES).');
  const r = checkProfile(body);
  if (r.error) return failure(400, r.error);
  await env.PROFILES.put('profile:' + user.email.toLowerCase(), JSON.stringify(r.profile));
  return json({ ...r.profile, email: user.email });
}

// ---------- GitHub ----------
function github(env, fetchFn) {
  const repo = env.GITHUB_REPO;
  return async (method, path, body) => {
    const r = await fetchFn(`${GITHUB}/repos/${repo}/${path}`, {
      method,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'nomadtactics-workshop', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(`GitHub ${method} ${path}: ${r.status} ${data?.message || ''}`.trim()), { status: r.status === 409 || r.status === 422 ? r.status : 502, github: r.status });
    return data;
  };
}

const blobCache = new Map();   // blob sha -> parsed content (blobs never change)

async function head(gh, env) {
  const ref = await gh('GET', `git/ref/heads/${branch(env)}`);
  const commit = await gh('GET', `git/commits/${ref.object.sha}`);
  const tree = await gh('GET', `git/trees/${commit.tree.sha}?recursive=1`);
  const prefix = dataDir(env) + '/';
  const files = new Map();
  for (const t of tree.tree) if (t.type === 'blob' && t.path.startsWith(prefix) && t.path.endsWith('.json')) files.set(t.path.slice(prefix.length), t.sha);
  return { commit: ref.object.sha, tree: commit.tree.sha, files };
}

async function readFiles(gh, env) {
  const h = await head(gh, env);
  const out = {};
  await Promise.all([...h.files].map(async ([file, sha]) => {
    if (!blobCache.has(sha)) {
      const b = await gh('GET', `git/blobs/${sha}`);
      blobCache.set(sha, JSON.parse(text(b64(b.content))));
    }
    out[file] = { sha, content: blobCache.get(sha) };
  }));
  return { commit: h.commit, files: out };
}
const b64 = s => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));

export function validFile(file) {
  return typeof file === 'string' && /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\.json$/.test(file);
}

// Git blob hash (sha1 of "blob <bytes>\0<content>") – so the client knows the new versions without asking GitHub again.
export async function blobSha(content) {
  const body = new TextEncoder().encode(content);
  const headBytes = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(headBytes.length + body.length); all.set(headBytes); all.set(body, headBytes.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// body: { base: { file: sha|null }, changes: [{ file, content|null }], force?: bool }
async function commit(gh, env, user, body) {
  const changes = Array.isArray(body?.changes) ? body.changes : [];
  if (!changes.length) return failure(400, 'Keine Änderungen.');
  for (const c of changes) if (!validFile(c.file)) return failure(400, `Ungültiger Dateiname: ${c.file}`);
  const base = body.base || {};
  const written = changes.map(c => ({ file: c.file, text: c.content == null ? null : pretty(c.content) + '\n' }));
  for (let attempt = 0; attempt < 3; attempt++) {
    const h = await head(gh, env);
    if (!body.force) {
      const conflicts = changes.filter(c => (h.files.get(c.file) ?? null) !== (base[c.file] ?? null)).map(c => c.file);
      if (conflicts.length) return failure(409, 'Jemand hat diese Dateien inzwischen geändert.', { conflicts, commit: h.commit });
    }
    const effective = written.filter(w => !(w.text === null && !h.files.has(w.file)));
    const shas = {};
    for (const w of effective) shas[w.file] = w.text === null ? null : await blobSha(w.text);
    if (effective.every(w => (h.files.get(w.file) ?? null) === shas[w.file])) return json({ commit: h.commit, files: shas, unchanged: true });
    const dir = dataDir(env);
    const tree = await gh('POST', 'git/trees', {
      base_tree: h.tree,
      tree: effective.map(w => w.text === null ? { path: `${dir}/${w.file}`, mode: '100644', type: 'blob', sha: null } : { path: `${dir}/${w.file}`, mode: '100644', type: 'blob', content: w.text }),
    });
    const names = effective.map(w => w.file.replace(/\.json$/, '').split('/').pop());
    const message = `Werkstatt: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` und ${names.length - 4} weitere` : ''} (${user.name})\n\nGespeichert in der Web-Werkstatt von ${user.name}.`;
    const who = { name: user.name, email: user.email, date: new Date().toISOString() };
    const c = await gh('POST', 'git/commits', { message, tree: tree.sha, parents: [h.commit], author: who, committer: who });   // committer too, otherwise GitHub puts in the token owner's e-mail
    try {
      await gh('PATCH', `git/refs/heads/${branch(env)}`, { sha: c.sha, force: false });
    } catch (e) {
      if (e.github === 422 || e.github === 409) continue;   // someone was faster: read again and retry
      throw e;
    }
    return json({ commit: c.sha, files: shas });
  }
  return failure(409, 'Das Repository ändert sich gerade zu oft. Bitte gleich noch einmal speichern.', { conflicts: [] });
}
