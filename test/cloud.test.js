// Web workshop on Cloudflare: login check and saving as commits (worker/index.js against a fake GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, nameFromEmail, validFile, blobSha } from '../worker/index.js';
import { fakeGitHub, fakeAccess, cloudFetch, testEnv, TEAM } from './fake_cloud.js';

import { pretty } from '../tools/json.js';
const START = { 'projects/nomadtactics/project.json': pretty({ name: 'NT' }) + '\n', 'projects/nomadtactics/factions/usa.json': pretty({ id: 'usa', cost: 1 }) + '\n', 'README.md': '# x\n' };

async function setup() {
  const g = fakeGitHub({ ...START }), access = await fakeAccess();
  const fetchFn = cloudFetch(g, access), env = testEnv();
  const call = async (path, { email = 'daniel.nomad@example.com', method = 'GET', body, token } = {}) => {
    const headers = {};
    const t = token !== undefined ? token : email ? await access.token(email) : null;
    if (t) headers['cf-access-jwt-assertion'] = t;
    const r = await handle(new Request('https://nt.example.workers.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, fetchFn);
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  return { g, access, env, call, fetchFn };
}

test('Ohne gültige Anmeldung kein Zugriff, statische Seiten gehen immer', async () => {
  const { call, access, env, fetchFn } = await setup();
  assert.equal((await call('/api/files', { email: null })).status, 401);
  assert.equal((await call('/api/files', { token: 'a.b.c' })).status, 401);
  assert.equal((await call('/api/files', { token: await access.token('x@y.de', { aud: 'falsch' }) })).status, 401);
  assert.equal((await call('/api/files', { token: await access.token('x@y.de', { iss: 'https://boese.cloudflareaccess.com' }) })).status, 401);
  assert.equal((await call('/api/files', { token: await access.token('x@y.de', { exp: 1000 }) })).status, 401);
  const forged = (await access.token('daniel@x.de')).split('.'); forged[1] = Buffer.from(JSON.stringify({ email: 'evil@x.de', aud: ['aud-test-123'], iss: TEAM, exp: 9e9 })).toString('base64url');
  assert.equal((await call('/api/files', { token: forged.join('.') })).status, 401);
  const page = await handle(new Request('https://nt.example.workers.dev/index.html'), env, fetchFn);
  assert.equal(await page.text(), 'asset');
  const noLogin = await handle(new Request('https://nt.example.workers.dev/api/files'), { ...env, POLICY_AUD: '' }, fetchFn);
  assert.equal(noLogin.status, 503);
});

test('Sitzung und Dateien aus dem Repository', async () => {
  const { call } = await setup();
  const s = await call('/api/session');
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.user, { email: 'daniel.nomad@example.com', name: 'Daniel Nomad' });
  const f = await call('/api/files');
  assert.deepEqual(Object.keys(f.data.files).sort(), ['factions/usa.json', 'project.json']);
  assert.equal(f.data.files['factions/usa.json'].content.cost, 1);
  assert.equal(f.data.files['factions/usa.json'].sha, await blobSha(START['projects/nomadtactics/factions/usa.json']));
});

test('Speichern wird ein Commit mit Autor, Konflikte werden erkannt', async () => {
  const { g, call } = await setup();
  const f = await call('/api/files');
  const base = { 'factions/usa.json': f.data.files['factions/usa.json'].sha, 'factions/neu.json': null };
  const r = await call('/api/commit', { method: 'POST', body: { base, changes: [{ file: 'factions/usa.json', content: { id: 'usa', cost: 2 } }, { file: 'factions/neu.json', content: { id: 'neu' } }] } });
  assert.equal(r.status, 200);
  assert.equal(g.refs.main, r.data.commit);
  assert.match(g.fileAt('projects/nomadtactics/factions/usa.json'), /"cost": 2/);
  assert.equal(g.fileAt('README.md'), '# x\n');   // everything else stays untouched
  const c = g.commits.get(r.data.commit);
  assert.equal(c.author.name, 'Daniel Nomad'); assert.equal(c.author.email, 'daniel-nomad@werkstatt.nomadtactics.invalid');   // the login e-mail stays private
  assert.match(c.message, /^Werkstatt: usa, neu \(Daniel Nomad\)/);
  assert.equal(r.data.files['factions/usa.json'], await blobSha(g.fileAt('projects/nomadtactics/factions/usa.json')));

  // Saving with the old version → conflict, nothing written
  const old = await call('/api/commit', { method: 'POST', body: { base, changes: [{ file: 'factions/usa.json', content: { id: 'usa', cost: 9 } }] } });
  assert.equal(old.status, 409); assert.deepEqual(old.data.conflicts, ['factions/usa.json']);
  assert.match(g.fileAt('projects/nomadtactics/factions/usa.json'), /"cost": 2/);
  // … unless forced
  const forced = await call('/api/commit', { method: 'POST', body: { base, force: true, changes: [{ file: 'factions/usa.json', content: { id: 'usa', cost: 9 } }] } });
  assert.equal(forced.status, 200); assert.match(g.fileAt('projects/nomadtactics/factions/usa.json'), /"cost": 9/);

  // Deleting a file
  const del = await call('/api/commit', { method: 'POST', body: { base: { 'factions/neu.json': r.data.files['factions/neu.json'] }, changes: [{ file: 'factions/neu.json', content: null }] } });
  assert.equal(del.status, 200); assert.equal(g.fileAt('projects/nomadtactics/factions/neu.json'), undefined);
});

test('Gleichzeitiger fremder Commit auf anderer Datei: Werkstatt baut neu auf und gewinnt', async () => {
  const { g, call } = await setup();
  const f = await call('/api/files');
  g.raceOnce = true;
  const r = await call('/api/commit', { method: 'POST', body: { base: { 'project.json': f.data.files['project.json'].sha }, changes: [{ file: 'project.json', content: { name: 'NT 2' } }] } });
  assert.equal(r.status, 200);
  assert.equal(g.fileAt('projects/nomadtactics/race.json'), '{}\n');   // the other commit stays
  assert.match(g.fileAt('projects/nomadtactics/project.json'), /NT 2/);
});

test('Gleicher Inhalt erzeugt keinen leeren Commit, ungültige Pfade werden abgelehnt', async () => {
  const { g, call } = await setup();
  const f = await call('/api/files'), before = g.refs.main;
  const same = await call('/api/commit', { method: 'POST', body: { base: { 'factions/usa.json': f.data.files['factions/usa.json'].sha }, changes: [{ file: 'factions/usa.json', content: { id: 'usa', cost: 1 } }] } });
  assert.equal(same.status, 200); assert.equal(same.data.unchanged, true); assert.equal(g.refs.main, before);
  for (const bad of ['../README.md', '/etc/x.json', 'a/../b.json', 'x.js', '']) assert.equal(validFile(bad), false, bad);
  assert.equal((await call('/api/commit', { method: 'POST', body: { changes: [{ file: '../README.md', content: {} }] } })).status, 400);
  assert.equal(nameFromEmail('anna-lena+nt@web.de'), 'Anna Lena');
  const info = await call('/api/access-info');
  assert.equal(info.data.POLICY_AUD, 'aud-test-123'); assert.equal(info.data.login, true);
  assert.equal((await call('/api/access-info', { email: null })).data.login, false);
});

test('Profil: Name, Commit-E-Mail, Farbe, Autospeichern, Darstellung', async () => {
  const { g, call } = await setup();
  const p = await call('/api/profile');
  assert.equal(p.data.name, 'Daniel Nomad'); assert.equal(p.data.autosave, 60); assert.equal(p.data.email, 'daniel.nomad@example.com');
  assert.equal((await call('/api/profile', { method: 'PUT', body: { name: '' } })).status, 400);
  assert.equal((await call('/api/profile', { method: 'PUT', body: { name: 'Daniel', commitEmail: 'kaputt' } })).status, 400);
  const w = await call('/api/profile', { method: 'PUT', body: { name: 'Daniel', commitEmail: '123+dna@users.noreply.github.com', color: '#ff8800', autosave: 300, theme: 'violet', extra: 'weg' } });
  assert.equal(w.status, 200); assert.equal(w.data.extra, undefined);
  const s = await call('/api/session');
  assert.equal(s.data.user.name, 'Daniel'); assert.equal(s.data.profile.theme, 'violet'); assert.equal(s.data.profile.autosave, 300);
  assert.equal((await call('/api/session', { email: 'freund@example.com' })).data.user.name, 'Freund');   // profiles are per person
  const f = await call('/api/files');
  const r = await call('/api/commit', { method: 'POST', body: { base: { 'project.json': f.data.files['project.json'].sha }, changes: [{ file: 'project.json', content: { name: 'NT 3' } }] } });
  const c = g.commits.get(r.data.commit);
  assert.equal(c.author.name, 'Daniel'); assert.equal(c.author.email, '123+dna@users.noreply.github.com');
  assert.deepEqual(c.committer, c.author);   // no token owner e-mail as committer
  assert.match(c.message, /\(Daniel\)/);
});

test('Party online: /net nur mit Anmeldung, dann in den festen Raum „main“', async () => {
  const { access, env, fetchFn } = await setup();
  const seen = [];
  const PARTY = { idFromName: (n) => { seen.push(n); return 'id-' + n; }, get: (id) => ({ fetch: async () => new Response('raum ' + id) }) };
  const ws = async (token, e = { ...env, PARTY }) => handle(new Request('https://nt.example.workers.dev/net', { headers: { Upgrade: 'websocket', ...(token ? { 'cf-access-jwt-assertion': token } : {}) } }), e, fetchFn);
  assert.equal((await ws(null)).status, 401);
  assert.equal((await ws(await access.token('x@y.de', { aud: 'falsch' }))).status, 401);
  assert.equal(await (await ws(await access.token('daniel@x.de'))).text(), 'raum id-main');
  assert.deepEqual(seen, ['main']);
  assert.equal((await ws(await access.token('daniel@x.de'), env)).status, 503);
  // the local test door only opens on localhost
  const far = await handle(new Request('https://nt.example.workers.dev/net', { headers: { Upgrade: 'websocket' } }), { ...env, PARTY, LOCAL_TEST: '1' }, fetchFn);
  assert.equal(far.status, 401);
});
