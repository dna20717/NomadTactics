#!/usr/bin/env node
// Builds the web version of the workshop into dist/ (served by Cloudflare as static assets).
//   node tools/build_web.mjs
// dist/index.html = the launcher (diorama + menu), dist/workshop.html = tactics.html (address /workshop), dist/party.html = the online battle, plus game/, engine/, the game data in
// projects/nomadtactics/ and the voxel models (.vox) the data points to.
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(repo, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(repo, 'launcher.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(repo, 'tactics.html'), path.join(out, 'workshop.html'));
fs.copyFileSync(path.join(repo, 'party.html'), path.join(out, 'party.html'));
for (const dir of ['game', 'engine', 'projects/nomadtactics', 'prototypes/nomadtactics/models']) fs.cpSync(path.join(repo, dir), path.join(out, dir), { recursive: true });
let count = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : count++; };
walk(out);
console.log(`dist/ gebaut: ${count} Dateien`);
