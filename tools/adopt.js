#!/usr/bin/env node
// Imports editor drafts (from the artifact database, collection "drafts") into the project.
//   node tools/adopt.js <dump.json> [--project projects/nomadtactics]
// dump.json: list [{ file, json }] or { documents: [...] } – as db_list returns the documents
// (json is the saved file content as a string).
// - Files are written in readable formatting.
// - Images and sounds as data: URLs are unpacked (tileset sheets and sprites to grafik/editor/, sounds to ton/) and the path is replaced.
// - Images in the asset store (/_blob/<id>) are listed: Ava downloads them with read_asset,
//   puts them at grafik/editor/<tileset>_<blatt>.png and calls the script again with --assets <folder>.
import fs from 'node:fs';
import path from 'node:path';
import { pretty } from './json.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dumpPath = args.find(a => !a.startsWith('--') && a !== opt('--project') && a !== opt('--assets'));
if (!dumpPath) { console.log('node tools/adopt.js <dump.json> [--project <ordner>] [--assets <ordner>]'); process.exit(1); }
const root = path.resolve(opt('--project') || 'projects/nomadtactics');
const assets = opt('--assets');

let dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
if (!Array.isArray(dump)) dump = dump.documents || dump.docs || [];
const isOpen = [];
for (const d of dump) {
  const x = d.data || d;
  if (!x.file || typeof x.json !== 'string') continue;
  const content = JSON.parse(x.json);
  // Unpack uploaded files: data: URL directly, asset store (/_blob/<id>) via --assets
  const pack = (source, target, set, whatFor) => {
    if (typeof source !== 'string') return;
    if (source.startsWith('data:')) {
      const ext = (source.match(/^data:[a-z]+\/([a-z0-9.+-]+)/i)?.[1] || 'bin').replace('mpeg', 'mp3').replace('x-wav', 'wav').replace('wave', 'wav');
      const z = target.replace(/\.\w+$/, '') + '.' + ext;
      fs.mkdirSync(path.dirname(path.join(root, z)), { recursive: true });
      fs.writeFileSync(path.join(root, z), Buffer.from(source.split(',')[1], 'base64'));
      set(z); console.log(`  ausgepackt → ${z}`);
    } else if (source.includes('/_blob/')) {
      const id = source.split('/_blob/')[1];
      const local = assets && fs.readdirSync(assets).find(f => f.startsWith(id));
      if (local) {
        const z = target.replace(/\.\w+$/, '') + (path.extname(local) || path.extname(target));
        fs.mkdirSync(path.dirname(path.join(root, z)), { recursive: true });
        fs.copyFileSync(path.join(assets, local), path.join(root, z));
        set(z); console.log(`  Asset ${id} → ${z}`);
      } else isOpen.push({ asset: id, target, whatFor });
    }
  };
  if (x.file.startsWith('tilesets/')) for (const [name, source] of Object.entries(content.sheets || {})) pack(source, `graphic/editor/${content.id}_${name}.png`, z => { content.sheets[name] = z; }, `Tileset ${content.id}`);
  if (/sprites\.json$/.test(x.file)) for (const [id, sp] of Object.entries(content)) if (sp?.image) pack(sp.image, `graphic/editor/sprite_${id}.png`, z => { sp.image = z; }, `Sprite ${id}`);
  if (/sounds\.json$/.test(x.file)) for (const [id, t] of Object.entries(content.sounds || {})) if (t?.file) pack(t.file, `sound/${id}.mp3`, z => { t.file = z; }, `Ton ${id}`);
  fs.mkdirSync(path.dirname(path.join(root, x.file)), { recursive: true });
  const schema = { 'project.json': '../../schema/project.schema.json', 'sounds.json': '../../schema/sounds.schema.json', 'assets.json': '../../schema/assets.schema.json', 'sprites.json': '../../schema/sprites.schema.json' }[x.file]
    || (x.file.startsWith('tilesets/') ? '../../../schema/tileset.schema.json' : x.file.startsWith('maps/') ? '../../../schema/map.schema.json' : null);
  const { $schema: _old, ...without } = content;
  const ordered = schema ? { $schema: schema, ...without } : content;
  fs.writeFileSync(path.join(root, x.file), pretty(ordered) + '\n');
  console.log(`✓ ${x.file}`);
}
if (isOpen.length) {
  console.log('\nNoch herunterzuladen (read_asset), dann mit --assets <ordner> erneut ausführen:');
  for (const o of isOpen) console.log(`  ${o.asset} → ${o.target}`);
  process.exit(2);
}
console.log('\nJetzt: node tools/nt.js check und npm test – dann committen und die Stände in der Datenbank löschen.');
