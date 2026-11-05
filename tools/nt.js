#!/usr/bin/env node
// nt – command line for NomadTactics (like kj for Cosy). Can do everything the workshop can, with the same logic
// (engine/tactics/overlay.js for base/general, rename… for references). Writes the JSON files and validates afterwards.
//
// Look
//   nt check                                         validate data (exit 1 on errors)
//   nt show <faction> [--general g] [--research a,b]
//   nt json <faction> [--general g]                  effective faction as JSON
//   nt equipment <faction> <unit> [--choice a,b,b] [--general g] [--research a]   run the numbers on a unit with equipment
//   nt image <target> [--general g] [--out file.png] [--bottom] [--probe a,b]   workshop page as image (Playwright), e.g. ukraine/units/kaempfer, weapons/mg, combat, world/terrains/wald
//                                                    --bottom scrolls the inspector to the end, --probe pre-fills the unit's „Durchrechnen“
// Edit a faction (with --general g on the general's overlay, otherwise in the base)
//   nt new <faction> <category> <id> '<json>'        category: units | building | research | equipment
//   nt set <faction> <id> <field> '<json>'           set a field (for a general only the difference)
//   nt reset <faction> <id> <field> --general g      inherit the field from the faction again
//   nt remove <faction> <id>                         base: delete including references · general: “without”
//   nt restore <faction> <id> --general g
//   nt rename <faction> <old> <new>                  rename an ID, references follow (also in all generals)
//   nt connect <faction> <from> <to>                 <from> becomes a prerequisite of <to>   ·   nt detach <faction> <from> <to>
//   nt faction <faction> <field> '<json>'            profile (name, color, resources, start …)
//   nt faction-new <id> '<json>'                     create a new faction (file + project.json)
//   nt general <faction> <gid> '<json>'              create a general or set fields (name, title, motto, description)
// Game rules
//   nt rule <area> <id> '<json>'                     create/replace: resources | keywords | weapons | models | slots | combat.damageTypes | combat.armors | combat.classes
//                                                    | ui (standard) | ui.moods | ui.hud | ui.radio | experience (tiers) | experience.sources | world.*
//   nt rule <area> <id> <field> '<json>'             set one field  ·  nt rule combat.table <damageType> <armor> <number>
//   nt rule-remove <area> <id>                       delete
//   nt rule-rename <kind> <old> <new>                kind: weapon | keyword | resource | model | armor | class | damageType | slot
// Options: --project <folder> (default projects/nomadtactics), --dry (write nothing, only show)
import fs from 'node:fs';
import path from 'node:path';
import { nodeLoader } from './loader.js';
import { pretty } from './json.js';
import { loadTactics, validateTactics, effective, withResearch, withEquipment, metrics, origin, renameGlobal, CATEGORIES, CATEGORY_NAME } from '../engine/tactics/index.js';
import { Overlay } from '../engine/tactics/overlay.js';

const args = process.argv.slice(2);
const WITH_VALUE = ['--project', '--general', '--research', '--choice', '--out', '--probe'];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const free = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && WITH_VALUE.includes(args[i - 1])));
const [command, ...rest] = free;
const root = path.resolve(opt('--project') || 'projects/nomadtactics');
const dry = args.includes('--dry');
const p = await loadTactics(nodeLoader(root));
const changed = new Set();
const error = t => { console.log('✗ ' + t); process.exit(1); };
const json = t => { if (t === undefined) error('Wert fehlt'); try { return JSON.parse(t); } catch { return t; } };   // plain text also works without quotes

const faction = id => p.factions.get(id) || error(`Fraktion „${id}“ gibt es nicht. Da sind: ${[...p.factions.keys()].join(', ')}`);
const overlay = fid => { const f = faction(fid), g = opt('--general'); if (g && !f.generals?.[g]) error(`General „${g}“ gibt es nicht. Da sind: ${Object.keys(f.generals || {}).join(', ') || '—'}`); changed.add(p.factionPaths.get(fid)); return new Overlay(f, g); };
const catFrom = (eb, id) => eb.category(id) || error(`„${id}“ gibt es in ${eb.f.name} nicht`);
const AREAS = { resources: ['resources'], keywords: ['keywords'], weapons: ['weapons'], models: ['models'], slots: ['slots'], 'combat.damageTypes': ['combat', 'damageTypes'], 'combat.armors': ['combat', 'armors'], 'combat.classes': ['combat', 'classes'], 'combat.table': ['combat', 'table'],
  ...Object.fromEntries(['maps', 'maps.sizes', 'height', 'movementTypes', 'terrains', 'transformations', 'daytime', 'weather', 'weatherSequence', 'climates'].map(b => ['world.' + b, ['world', ...b.split('.')]])),
  ui: ['ui'], 'ui.moods': ['ui', 'moods'], 'ui.hud': ['ui', 'hud'], 'ui.radio': ['ui', 'radio'],
  experience: ['experience'], 'experience.sources': ['experience', 'sources'] };
const area = b => {
  const [kind, ...sub] = AREAS[b] || error(`Bereich „${b}“ gibt es nicht: ${Object.keys(AREAS).join(', ')}`);
  if (!p.paths[kind]) { p.paths[kind] = p.def[kind] = `data/${kind}.json`; changed.add('project.json'); }
  changed.add(p.paths[kind]);
  let d = p.data[kind] = p.data[kind] || {};
  for (const u of sub) d = (d[u] = d[u] || {});
  return d;
};

function write() {
  const content = d => d === 'project.json' ? p.def : Object.entries(p.paths).find(([, x]) => x === d) ? p.data[Object.entries(p.paths).find(([, x]) => x === d)[0]] : p.factions.get([...p.factionPaths].find(([, x]) => x === d)?.[0]);
  for (const d of changed) {
    const x = content(d); if (!x) continue;
    if (dry) { console.log(`— ${d} (trocken, nicht geschrieben)`); continue; }
    fs.mkdirSync(path.dirname(path.join(root, d)), { recursive: true });
    fs.writeFileSync(path.join(root, d), pretty(x) + '\n');
    console.log(`geschrieben: ${d}`);
  }
  const m = validateTactics(p), f = m.filter(x => x.kind === 'error');
  for (const x of f) console.log(`FEHLER  ${x.place}: ${x.text}`);
  console.log(`Prüfung: ${f.length} Fehler, ${m.filter(x => x.kind === 'warning').length} Warnungen, ${m.filter(x => x.kind === 'hint').length} Hinweise`);
  process.exit(f.length ? 1 : 0);
}

const B = {
  check() {
    const m = validateTactics(p), number = a => m.filter(x => x.kind === a).length;
    for (const x of m) console.log(`${{ error: 'FEHLER  ', warning: 'Warnung ', hint: 'Hinweis ' }[x.kind]} ${x.place}: ${x.text}`);
    console.log(`\n${p.factions.size} Fraktionen, ${Object.keys(p.data.weapons).length} Waffen, ${Object.keys(p.data.keywords).length} Stichwörter, ${Object.keys(p.data.slots || {}).length} Ausrüstungsplätze · ${number('error')} Fehler, ${number('warning')} Warnungen, ${number('hint')} Hinweise`);
    process.exit(number('error') ? 1 : 0);
  },
  json([fid]) { console.log(JSON.stringify(effective(faction(fid), opt('--general')), null, 1)); },
  show([fid]) {
    const f = faction(fid), gid = opt('--general'); let e = effective(f, gid);
    const researched = (opt('--research') || '').split(',').filter(Boolean);
    if (researched.length) e = withResearch(e, p.data.weapons, researched);
    const mark = (cat, id) => ({ general: ' *', new: ' +', basis: '' })[origin(f, gid, cat, id)] ?? '';
    const cost = k => Object.entries(k || {}).map(([r, n]) => `${n} ${p.data.resources[r]?.symbol || r}`).join(' ');
    const sw = s => Object.entries(s || {}).map(([k, v]) => v === true ? k : `${k}(${v})`).join(', ');
    const g = gid && f.generals[gid];
    console.log(`${e.name}${g ? ` + ${g.name} (${g.title})` : ''}\n${e.description || ''}\n`);
    const z = metrics(e, p);
    console.log(`Gebäude (${z.building}), Strom +${z.powerPlus}/${z.powerMinus}`);
    for (const [id, x] of Object.entries(e.building)) console.log(`  ${(x.name + mark('building', id)).padEnd(26)} ${cost(x.cost).padEnd(14)} ${String(x.health).padStart(5)} Leben  ${x.produces?.length ? '→ ' + x.produces.join(', ') : ''}`);
    console.log(`\nEinheiten (${z.units})`);
    for (const [id, u] of Object.entries(e.units)) console.log(`  ${(u.name + (u.squad > 1 ? ` ×${u.squad}` : '') + mark('units', id)).padEnd(26)} ${cost(u.cost).padEnd(14)} ${String(u.health).padStart(5)} Leben  ${String(u.speed).padStart(4)} m/s  ${(u.weapons || []).join(', ').padEnd(16)} ${sw(u.keywords)}${u.equipment?.length ? '  [' + u.equipment.join(', ') + ']' : ''}`);
    console.log(`\nForschung (${z.research})`);
    for (const [id, t] of Object.entries(e.research)) console.log(`  ${(t.name + mark('research', id)).padEnd(26)} ${cost(t.cost).padEnd(14)} ${t.description || ''}`);
    const A = Object.entries(e.equipment || {});
    if (A.length) { console.log(`\nAusrüstung (${A.length})`); for (const [id, o] of A) console.log(`  ${(o.name + mark('equipment', id)).padEnd(26)} ${cost(o.cost).padEnd(14)} Platz ${(p.data.slots?.[o.slot]?.name || o.slot).padEnd(14)} ${o.description || ''}`); }
    if (g) console.log(`\n* vom General geändert, + nur beim General · ohne: ${(g.without || []).join(', ') || '—'}`);
  },
  equipment([fid, uid]) {
    const e = effective(faction(fid), opt('--general'));
    const r = withEquipment(e, p, uid, (opt('--choice') || '').split(',').filter(Boolean), (opt('--research') || '').split(',').filter(Boolean));
    if (!r) error(`Einheit „${uid}“ gibt es nicht`);
    const u = r.unit, cost = k => Object.entries(k || {}).map(([x, n]) => `${n} ${p.data.resources[x]?.symbol || x}`).join(' ') || '—';
    const opts = (e.units[uid].equipment || []).map(o => e.equipment?.[o]).filter(Boolean);
    console.log(`${u.name}${u.squad > 1 ? ` (Trupp ×${u.squad})` : ''} · Leben ${u.health} · Tempo ${u.speed} · Kosten gesamt ${cost(r.total)} (Ausrüstung ${cost(r.cost)})`);
    console.log(`Waffen: ${u.weaponsStats.map(w => `${w.name || w.id} (${w.damage}${w.salvo > 1 ? '×' + w.salvo : ''}, ${w.range} m)`).join(', ') || '—'}`);
    console.log(`Stichwörter: ${Object.entries(u.keywords || {}).map(([k, v]) => v === true ? k : `${k}(${v})`).join(', ') || '—'}`);
    if (r.companion.length) console.log(`Begleiter: ${r.companion.map(b => `${b.count}× ${e.units[b.unit]?.name || b.unit}`).join(', ')}`);
    for (const x of r.problems) console.log(`! ${x}`);
    const afterSlot = {}; for (const [i, o] of opts.entries()) (afterSlot[o.slot] = afterSlot[o.slot] || []).push(`${(e.units[uid].equipment)[i]} (${cost(o.cost)})`);
    console.log('Möglich: ' + (Object.entries(afterSlot).map(([pl, l]) => `${p.data.slots?.[pl]?.name || pl}: ${l.join(' | ')}`).join(' · ') || '—'));
  },
  new([fid, cat, id, stat]) {
    if (!CATEGORIES.includes(cat)) error(`Kategorie: ${CATEGORIES.join(' | ')}`);
    const eb = overlay(fid), obj = json(stat);
    if (eb.allIds().has(id)) error(`„${id}“ gibt es schon (${CATEGORY_NAME[eb.category(id)]})`);
    const newId = eb.new(cat, id, obj); console.log(`${CATEGORY_NAME[cat]} „${newId}“ angelegt${eb.gid ? ` (nur bei ${eb.g.name})` : ''}`); write();
  },
  set([fid, id, field, stat]) {
    const eb = overlay(fid), cat = catFrom(eb, id); eb.set(cat, id, field, json(stat));
    console.log(`${id}.${field} = ${JSON.stringify(eb.newCalculate().obj(cat, id)?.[field])}${eb.gid ? ` (bei ${eb.g.name}: ${eb.origin(cat, id, field) === 'basis' ? 'wie Fraktion' : 'eigener Wert'})` : ''}`); write();
  },
  reset([fid, id, field]) { const eb = overlay(fid); if (!eb.gid) error('Nur mit --general'); eb.reset(catFrom(eb, id), id, field); console.log(`${id}.${field} erbt wieder von der Fraktion`); write(); },
  remove([fid, id]) { const eb = overlay(fid), r = eb.remove(catFrom(eb, id), id); console.log(r === 'without' ? `${eb.g.name} verzichtet auf ${id}` : `${id} gelöscht (Verweise aufgeräumt)`); write(); },
  restore([fid, id]) { const eb = overlay(fid); if (!eb.gid) error('Nur mit --general'); eb.restore(id); console.log(`${id} ist bei ${eb.g.name} wieder da`); write(); },
  rename([fid, old, new_]) { const eb = overlay(fid); catFrom(eb, old); if (!eb.rename(old, new_)) error(`„${new_}“ gibt es schon`); console.log(`${old} → ${new_}`); write(); },
  connect([fid, from, to]) { const eb = overlay(fid), cat = catFrom(eb, to); catFrom(eb, from); const v = [...(eb.obj(cat, to)?.requires || [])]; if (!v.includes(from)) v.push(from); eb.set(cat, to, 'requires', v); console.log(`${from} → ${to}`); write(); },
  detach([fid, from, to]) { const eb = overlay(fid), cat = catFrom(eb, to); eb.set(cat, to, 'requires', (eb.obj(cat, to)?.requires || []).filter(x => x !== from)); console.log(`${from} ↛ ${to}`); write(); },
  faction([fid, field, stat]) { const f = faction(fid); changed.add(p.factionPaths.get(fid)); const v = json(stat); if (v === null) delete f[field]; else f[field] = v; console.log(`${fid}.${field} gesetzt`); write(); },
  'faction-new'([fid, stat]) {
    if (p.factions.has(fid)) error(`„${fid}“ gibt es schon`);
    const pf = `factions/${fid}.json`;
    p.factions.set(fid, { id: fid, name: fid, color: '#5fd38d', description: '', resources: ['money'], start: { money: 5000, building: [], units: [] }, building: {}, units: {}, research: {}, equipment: {}, generals: {}, ...(stat ? json(stat) : {}), id: fid });
    p.factionPaths.set(fid, pf); p.def.factions = [...(p.def.factions || []), pf]; changed.add(pf); changed.add('project.json'); write();
  },
  general([fid, gid, stat]) { const f = faction(fid); changed.add(p.factionPaths.get(fid)); f.generals = f.generals || {}; f.generals[gid] = { ...(f.generals[gid] || { title: '', motto: '', description: '' }), ...json(stat) }; console.log(`General ${gid} gespeichert`); write(); },
  rule([b, id, a, c, d]) {
    const o = area(b);
    if (b === 'combat.table') { o[id] = o[id] || {}; o[id][a] = +c; console.log(`${id} gegen ${a} = ${c}`); return write(); }
    if (c === undefined) { o[id] = json(a); console.log(`${b}/${id} gespeichert`); }
    else { if (!o[id]) error(`${b}/${id} gibt es nicht`); const v = json(c); if (v === null) delete o[id][a]; else o[id][a] = v; console.log(`${b}/${id}.${a} gesetzt`); }
    write();
  },
  'rule-remove'([b, id]) { const o = area(b); if (!o[id]) error(`${b}/${id} gibt es nicht`); delete o[id]; console.log(`${b}/${id} gelöscht`); write(); },
  'rule-rename'([kind, old, new_]) {
    const target = { weapon: 'weapons', keyword: 'keywords', resource: 'resources', model: 'models', armor: 'combat.armors', class: 'combat.classes', damageType: 'combat.damageTypes', slot: 'slots' }[kind] || error('Art: weapon | keyword | resource | model | armor | class | damageType | slot');
    const o = area(target); if (!o[old]) error(`„${old}“ gibt es nicht`); if (o[new_]) error(`„${new_}“ gibt es schon`);
    const n = {}; for (const [k, v] of Object.entries(o)) n[k === old ? new_ : k] = v; for (const k of Object.keys(o)) delete o[k]; Object.assign(o, n);
    renameGlobal(p, kind, old, new_);
    if (kind === 'slot') for (const f of p.factions.values()) for (const x of [...Object.values(f.equipment || {}), ...Object.values(f.generals || {}).flatMap(g => Object.values(g.modify?.equipment || {}))]) if (x.slot === old) x.slot = new_;
    for (const f of p.factionPaths.values()) changed.add(f); for (const f of Object.values(p.paths)) changed.add(f);
    console.log(`${kind} ${old} → ${new_}`); write();
  },
  async image([target]) {
    if (!target) error('Ziel fehlt, z. B. ukraine/einheiten/kaempfer, usa/techbaum, waffen/mg, kampf, pruefung');
    let chromium; try { ({ chromium } = await import('playwright')); } catch { error('Playwright fehlt (ln -s "$(npm root -g)/playwright" node_modules/playwright)'); }
    const { createServer } = await import('node:http');
    const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
    const srv = createServer((q, a) => { try { const f = path.join(repo, decodeURIComponent(q.url.split('?')[0])); a.writeHead(200, { 'Content-Type': type[path.extname(f)] || 'application/octet-stream' }); a.end(fs.readFileSync(f)); } catch { a.writeHead(404); a.end(); } }).listen(0);
    const port = srv.address().port;
    const t = target.split('/'), fid = p.factions.has(t[0]) ? t[0] : null;
    const SUB = { units: 'units', building: 'building', techTree: 'techTree', generals: 'generals', equipment: 'equipment', overview: 'overview' };
    const go = fid ? { area: 'faction', faction: fid, sub: SUB[t[1]] || 'overview', choice: t[2] || null, general: opt('--general') || null }
      : t[0] === 'combat' ? { area: 'combat', sub: t[1] || 'table', choice: t[2] || null } : t[0] === 'world' ? { area: 'world', sub: t[1] || 'maps', choice: t[2] || null } : t[0] === 'ui' ? { area: 'ui', sub: t[1] || 'moods', choice: t[2] || null } : { area: t[0], choice: t[1] || null };
    const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const s = await b.newPage({ viewport: { width: 1440, height: 900 } });
    s.on('pageerror', e => console.log('Seitenfehler:', e.message));
    await s.goto(`http://localhost:${port}/tactics.html`);
    await s.waitForFunction(() => window.workshop?.p && !document.getElementById('tk-load'), null, { timeout: 30000 });
    if (opt('--project')) console.log('Hinweis: die Werkstatt zeigt immer projects/nomadtactics');
    const probe = (opt('--probe') || '').split(',').filter(Boolean);
    await s.evaluate(([z, pr]) => { if (pr.length) { workshop.probe = { [`${z.faction}/${z.general || ''}/${z.choice}`]: pr }; } workshop.go(z); }, [go, probe]); await s.waitForTimeout(300);
    if (args.includes('--bottom')) { await s.evaluate(() => { const i = document.querySelector('.da-insp'); i.scrollTop = i.scrollHeight; }); await s.waitForTimeout(150); }
    const off = opt('--out') || path.join(repo, 'output', `workshop_${target.replace(/[^a-z0-9]+/gi, '_')}${opt('--general') ? '_' + opt('--general') : ''}.png`);
    fs.mkdirSync(path.dirname(off), { recursive: true });
    await s.screenshot({ path: off }); console.log(off);
    await b.close(); srv.close();
  },
};
if (!command) B.check();
else if (!B[command]) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(1, 32).map(l => l.slice(3)).join('\n')); process.exit(1); }
else await B[command](rest);
