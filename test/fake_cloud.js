// Test helpers for the web workshop: a fake GitHub (git data API in memory) and a fake Cloudflare Access
// (own RSA key, signed JWTs, certificate endpoint). Used by test/cloud.test.js and tools/workshop_cloud_test.mjs.
import { blobSha } from '../worker/index.js';

export const TEAM = 'https://nomad-test.cloudflareaccess.com';
export const AUD = 'aud-test-123';

let counter = 0;
const id = () => (++counter).toString(16).padStart(40, 'c');
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

// files: { 'projects/nomadtactics/x.json': 'text' }
export function fakeGitHub(files, repo = 'dna20717/NomadTactics') {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const g = { refs: { main: null }, commits, calls: [], raceOnce: false };
  const putTree = async entries => { const sha = id(); trees.set(sha, entries); return sha; };
  const init = async () => {
    const entries = new Map();
    for (const [path, text] of Object.entries(files)) { const sha = await blobSha(text); blobs.set(sha, text); entries.set(path, sha); }
    const tree = await putTree(entries), c = id();
    commits.set(c, { tree, parents: [], message: 'Start', author: { name: 'Start' } });
    g.refs.main = c;
  };
  g.ready = init();
  g.fileAt = (path, ref = g.refs.main) => { const sha = trees.get(commits.get(ref).tree).get(path); return sha ? blobs.get(sha) : undefined; };
  g.pushOther = async (path, text) => {   // someone else commits directly (Ava, Daniel)
    const entries = new Map(trees.get(commits.get(g.refs.main).tree));
    const sha = await blobSha(text); blobs.set(sha, text); entries.set(path, sha);
    const c = id(); commits.set(c, { tree: await putTree(entries), parents: [g.refs.main], message: 'anders', author: { name: 'Ava' } }); g.refs.main = c;
  };
  g.fetch = async (url, opt = {}) => {
    await g.ready;
    const u = new URL(url), method = opt.method || 'GET';
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const prefix = `/repos/${repo}/`;
    if (!u.pathname.startsWith(prefix)) return ok({ message: 'Not Found' }, 404);
    if (opt.headers?.authorization !== 'Bearer test-token') return ok({ message: 'Bad credentials' }, 401);
    const p = u.pathname.slice(prefix.length), body = opt.body ? JSON.parse(opt.body) : null;
    g.calls.push(`${method} ${p}`);
    let m;
    if (method === 'GET' && (m = p.match(/^git\/ref\/heads\/(.+)$/))) return g.refs[m[1]] ? ok({ object: { sha: g.refs[m[1]] } }) : ok({ message: 'Not Found' }, 404);
    if (method === 'GET' && (m = p.match(/^git\/commits\/(\w+)$/))) return ok({ sha: m[1], tree: { sha: commits.get(m[1]).tree } });
    if (method === 'GET' && (m = p.match(/^git\/trees\/(\w+)$/))) return ok({ tree: [...trees.get(m[1])].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) });
    if (method === 'GET' && (m = p.match(/^git\/blobs\/(\w+)$/))) return ok({ content: b64(blobs.get(m[1])), encoding: 'base64' });
    if (method === 'POST' && p === 'git/trees') {
      const entries = new Map(trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) entries.delete(e.path);
        else { const sha = await blobSha(e.content); blobs.set(sha, e.content); entries.set(e.path, sha); }
      }
      return ok({ sha: await putTree(entries) }, 201);
    }
    if (method === 'POST' && p === 'git/commits') { const c = id(); commits.set(c, { tree: body.tree, parents: body.parents, message: body.message, author: body.author, committer: body.committer }); return ok({ sha: c }, 201); }
    if (method === 'PATCH' && (m = p.match(/^git\/refs\/heads\/(.+)$/))) {
      if (g.raceOnce) { g.raceOnce = false; await g.pushOther('projects/nomadtactics/race.json', '{}\n'); }
      if (!commits.get(body.sha).parents.includes(g.refs[m[1]]) && !body.force) return ok({ message: 'Update is not a fast forward' }, 422);
      g.refs[m[1]] = body.sha; return ok({ object: { sha: body.sha } });
    }
    return ok({ message: 'unexpected ' + method + ' ' + p }, 500);
  };
  return g;
}

export async function fakeAccess() {
  const kid = 'k' + Math.random().toString(36).slice(2);   // new key per test, the worker caches certificates
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const enc = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
  return {
    certs: { keys: [jwk] },
    async token(email, { aud = AUD, iss = TEAM, exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
      const unsigned = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + enc({ email, aud: [aud], iss, exp, iat: exp - 3600 });
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
      return unsigned + '.' + Buffer.from(sig).toString('base64url');
    },
  };
}

// fetch for the worker: GitHub + Access certificates
export function cloudFetch(g, access) {
  return async (url, opt) => String(url).startsWith(TEAM) ? new Response(JSON.stringify(access.certs), { headers: { 'content-type': 'application/json' } }) : g.fetch(url, opt);
}

export function fakeKV() { const m = new Map(); return { m, async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } }; }

export const testEnv = (assets = { fetch: async () => new Response('asset') }) => ({ PROFILES: fakeKV(), GITHUB_REPO: 'dna20717/NomadTactics', BRANCH: 'main', DATA_DIR: 'projects/nomadtactics', TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, GITHUB_TOKEN: 'test-token', ASSETS: assets });
