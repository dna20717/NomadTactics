#!/usr/bin/env node
// Builds the web version of the workshop into dist/ (served by Cloudflare as static assets).
//   node tools/build_web.mjs
// dist/index.html = tactics.html, plus game/, engine/ and the game data in projects/nomadtactics/.
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(repo, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(repo, 'tactics.html'), path.join(out, 'index.html'));
for (const dir of ['game', 'engine', 'projects/nomadtactics']) fs.cpSync(path.join(repo, dir), path.join(out, dir), { recursive: true });
let count = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : count++; };
walk(out);
console.log(`dist/ gebaut: ${count} Dateien`);
