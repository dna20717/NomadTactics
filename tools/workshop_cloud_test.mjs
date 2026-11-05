#!/usr/bin/env node
// Browser test of the web workshop with the real worker code against a fake GitHub and a fake Cloudflare Access.
//   node tools/workshop_cloud_test.mjs [--images]   (builds dist/ first, images → output/cloud_*.png)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { handle } from '../worker/index.js';
import { fakeGitHub, fakeAccess, cloudFetch, testEnv } from '../test/fake_cloud.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const images = process.argv.includes('--images');
execSync('node tools/build_web.mjs', { cwd: repo, stdio: 'ignore' });
const dist = path.join(repo, 'dist');

// fake repository = the real game data
const files = {};
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.json')) files[path.relative(repo, p)] = fs.readFileSync(p, 'utf8'); } };
walk(path.join(repo, 'projects/nomadtactics'));
const g = fakeGitHub(files), access = await fakeAccess();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const assets = { fetch: async req => {
  let p = decodeURIComponent(new URL(req.url).pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f)) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(f), { headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' } });
} };
const env = testEnv(assets), fetchFn = cloudFetch(g, access);
const token = await access.token('daniel@example.com');

const server = http.createServer(async (q, res) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const headers = { ...q.headers, 'cf-access-jwt-assertion': token };   // what Cloudflare Access adds after the login
  const r = await handle(new Request('http://localhost' + q.url, { method: q.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env, fetchFn);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(ok => server.listen(0, ok));
const base = `http://localhost:${server.address().port}`;

let failed = 0;
const check = (ok, text) => { console.log(`  ${ok ? 'ok  ' : 'FEHLER'} ${text}`); if (!ok) failed++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && !/fonts\.googleapis|ERR_TUNNEL|net::ERR|status of 409/.test(m.text()) && errors.push(m.text()));
await page.goto(base + '/?autosave=2');
await page.waitForSelector('.tk-user', { timeout: 20000 });
check((await page.textContent('.tk-user')).includes('Daniel'), 'angemeldet als Daniel (Name aus der E-Mail)');
check(await page.evaluate(() => window.workshop.store.kind === 'cloud'), 'Werkstatt nutzt den Cloudflare-Speicher');

// Profile: change the name
await page.click('.tk-user');
await page.waitForSelector('.ed-dialogue input');
await page.fill('.ed-dialogue input.ed-field', 'Daniel K.');
await page.waitForTimeout(400);
if (images) await page.screenshot({ path: path.join(repo, 'output/cloud_profile.png') });
await page.click('.ed-dialogue button.main');
await page.waitForFunction(() => document.querySelector('.tk-user')?.textContent.includes('Daniel K.'), null, { timeout: 10000 });
check(true, 'Profil: Name geändert');

const usaFile = 'projects/nomadtactics/' + await page.evaluate(() => window.workshop.p.factionPaths.get('usa'));
const startRef = g.refs.main;
await page.evaluate(() => { const w = window.workshop; w.change(w.p.factionPaths.get('usa'), () => { w.p.factions.get('usa').playstyle = 'Test aus der Web-Werkstatt'; }); });
check((await page.textContent('.ed-status')).includes('Ungespeichert'), 'Status zeigt „Ungespeichert“');
if (images) await page.screenshot({ path: path.join(repo, 'output/cloud_unsaved.png') });
await page.waitForFunction(() => document.querySelector('.ed-status')?.textContent.includes('Gespeichert'), null, { timeout: 15000 });
check(g.refs.main !== startRef, 'nach 2 s Ruhe automatisch ein Commit');
check(/Test aus der Web-Werkstatt/.test(g.fileAt(usaFile)), 'Änderung steht im Repository');
check(g.commits.get(g.refs.main).author.name === 'Daniel K.' && !g.commits.get(g.refs.main).author.email.includes('example.com'), 'Autor ist die angemeldete Person, Login-E-Mail bleibt privat');
const title = await page.getAttribute('.ed-status', 'title');
check(/Commit [0-9a-f]{7}/.test(title), 'Status nennt den Commit: ' + title);
if (images) await page.screenshot({ path: path.join(repo, 'output/cloud_saved.png') });

// Ctrl+S saves immediately; a second change without a conflict
const before2 = g.refs.main;
await page.evaluate(() => { const w = window.workshop; w.change(w.p.factionPaths.get('usa'), () => { w.p.factions.get('usa').playstyle = 'Zweiter Stand'; }); });
await page.keyboard.press('Control+s');
await page.waitForFunction(r => !document.querySelector('.ed-status')?.textContent.includes('Ungespeichert'), null, { timeout: 15000 });
await page.waitForTimeout(300);
check(g.refs.main !== before2 && /Zweiter Stand/.test(g.fileAt(usaFile)), 'Strg+S speichert sofort');

// Someone else changes the same file → conflict dialog → overwrite
await g.pushOther(usaFile, g.fileAt(usaFile).replace('Zweiter Stand', 'Ava war hier'));
await page.evaluate(() => { const w = window.workshop; w.change(w.p.factionPaths.get('usa'), () => { w.p.factions.get('usa').playstyle = 'Dritter Stand'; }); });
await page.keyboard.press('Control+s');
await page.waitForSelector('.ed-dialogue', { timeout: 15000 });
check((await page.textContent('.ed-dialogue')).includes('Jemand war schneller'), 'Konflikt wird gemeldet');
if (images) await page.screenshot({ path: path.join(repo, 'output/cloud_conflict.png') });
check(/Ava war hier/.test(g.fileAt(usaFile)), 'ohne Bestätigung wird nichts überschrieben');
await page.click('.ed-dialogue button.red');
await page.waitForFunction(() => document.querySelector('.ed-status')?.textContent.includes('Gespeichert'), null, { timeout: 15000 });
check(/Dritter Stand/.test(g.fileAt(usaFile)), '„Überschreiben“ speichert den eigenen Stand');

// Reload shows the state from the repository
await page.reload(); await page.waitForSelector('.tk-user', { timeout: 20000 });
check((await page.textContent('.tk-user')).includes('Daniel K.'), 'Profil bleibt nach Neuladen erhalten');
check(await page.evaluate(() => window.workshop.p.factions.get('usa').playstyle) === 'Dritter Stand', 'nach Neuladen kommt der Stand aus dem Repository');
check(!errors.length, 'keine Fehler in der Browser-Konsole' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close(); server.close();
console.log(failed ? `\n${failed} Fehler.` : '\nAlles grün.');
process.exit(failed ? 1 : 0);
