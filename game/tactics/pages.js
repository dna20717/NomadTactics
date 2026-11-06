// Pages of the Tactics workshop. Each page fills the center (haupt) and the inspector (insp).
import { icon } from '../icons.js';
import { el, cleanId } from '../ui.js';
import { treeSurface } from '../tree_canvas.js';
import { renameGlobal, metrics, withEquipment, FUNCTIONS, PROJECTILES, EFFECTS, STAT_FIELDS, CATEGORIES, CATEGORY_NAME } from '../../engine/tactics/index.js';
import { freeId, short } from './workshop.js';
import { navbarWorld } from './world_pages.js';
import { navbarUi, experienceSection, factionUi } from './ui_pages.js';
import { lifePage, modelLifeFields } from './life_pages.js';

const CLASS_ICON = { infantry: 'humans', vehicle: 'vehicle', air: 'air' };
const FUNCTION_COLOR = { hq: '#f2c14e', power: '#5aa9ff', production: '#7cb0ff', resource: '#e0b240', research: '#a98bff', defense: '#ff8080', superweapon: '#ff5a3c', movement: '#5fd38d', misc: '#9a9aa3' };
const CAT_PAGE = { units: 'units', building: 'building', research: 'techTree', equipment: 'equipment' };
const sw = s => Object.entries(s || {}).map(([k, v]) => v === true ? k : `${k}(${v})`).join(', ');

// ---------- Navigation (accordion like Build › Data) ----------
export function NAVBAR(w, navbar) {
  const p = w.p, s = w.page, n = o => Object.keys(o || {}).length;
  const number = x => x == null ? null : el('span', { class: 'da-nav-number' }, String(x));
  const entry = (active, ic, name, right, onclick, extra = '') => el('button', { class: 'da-nav' + (active ? ' on' : '') + extra, onclick }, ic, el('span', { class: 'da-nav-name' }, name), right);
  navbar.append(el('div', { class: 'da-navbar-title' }, 'SPIELREGELN'));
  for (const [id, name, ic, z] of [['resources', 'Ressourcen', 'resource', n(p.data.resources)], ['combat', 'Kampf', 'armor'], ['keywords', 'Stichwörter', 'tag', n(p.data.keywords)], ['weapons', 'Waffen', 'weapon', n(p.data.weapons)], ['slots', 'Ausrüstungsplätze', 'overlays', n(p.data.slots)], ['experience', 'Erfahrung', 'star', (p.data.experience?.tiers || []).length || null], ['models', 'Modelle', 'cube', n(p.data.models)], ['life', 'Lebendigkeit', 'particles', n(p.data.life?.profiles)]]) {
    if (id === 'combat') {
      const isOpen = s.area === 'combat';
      navbar.append(entry(false, icon(ic, 18), name, el('span', { class: 'da-nav-arrow' }, icon('chevron_right', 14)), () => w.go({ area: 'combat', sub: s.area === 'combat' ? s.sub : 'table' }), isOpen ? ' isOpen' : ''));
      if (isOpen) navbar.append(el('div', { class: 'da-sub' }, ...[['table', 'Schaden gegen Rüstung'], ['damageTypes', 'Schadensarten', n(p.data.combat.damageTypes)], ['armors', 'Rüstungen', n(p.data.combat.armors)], ['classes', 'Klassen', n(p.data.combat.classes)]]
        .map(([u, un, uz]) => entry(s.sub === u, null, un, number(uz), () => w.go({ area: 'combat', sub: u })))));
      continue;
    }
    navbar.append(entry(s.area === id, icon(ic, 18), name, number(z), () => w.go({ area: id })));
  }
  navbarWorld(w, navbar, entry, number);
  navbarUi(w, navbar, entry, number);
  navbar.append(el('div', { class: 'da-navbar-title tk-spacing' }, 'FRAKTIONEN'));
  for (const [fid, f] of p.factions) {
    const isOpen = w.isOpen.has('f:' + fid), here = s.area === 'faction' && s.faction === fid;
    navbar.append(entry(false, el('i', { class: 'da-color rounded tk-fpoint', style: `background:${f.color || '#888'}` }), f.name || fid, el('span', { class: 'da-nav-arrow' }, icon('chevron_right', 14)),
      () => { if (isOpen && here) w.isOpen.delete('f:' + fid); else w.isOpen.add('f:' + fid); w.go({ area: 'faction', faction: fid, sub: here ? s.sub : 'overview' }); }, isOpen ? ' isOpen' : ''));
    if (!isOpen) continue;
    const gid = w.general[fid] && f.generals?.[w.general[fid]] ? w.general[fid] : null;
    const e = w.overlay(fid).e;
    navbar.append(el('div', { class: 'da-sub' }, ...[['overview', 'Übersicht', 'info'], ['units', 'Einheiten', 'vehicle', n(e.units)], ['building', 'Gebäude', 'building', n(e.building)], ['techTree', 'Techbaum', 'techTree', n(e.research)], ['equipment', 'Ausrüstung', 'anvil', n(e.equipment)], ['generals', 'Generäle', 'general', n(f.generals)]]
      .map(([u, un, ic, uz]) => entry(here && s.sub === u, icon(ic, 15), un, number(uz), () => w.go({ area: 'faction', faction: fid, sub: u }))),
      gid ? el('div', { class: 'tk-navGeneral' }, icon('general', 13), ` Ebene: ${f.generals[gid].name}`) : null));
  }
  navbar.append(el('button', { class: 'da-nav tk-new', onclick: () => newFaction(w) }, icon('plus', 16), el('span', { class: 'da-nav-name' }, 'Neue Fraktion')));
  const m = w.messages || [], fe = m.filter(x => x.kind === 'error').length, wa = m.filter(x => x.kind === 'warning').length;
  navbar.append(el('div', { class: 'da-navbar-title tk-spacing' }, 'PRÜFEN'),
    entry(s.area === 'validation', icon(fe ? 'error' : wa ? 'warning' : 'verify', 18), 'Prüfung', number(fe + wa || null), () => w.go({ area: 'validation' })));
}

function newFaction(w) {
  w.askId('Neue Fraktion', 'Grün', (name, id0) => {
    const id = freeId(id0 || 'faction', new Set(w.p.factions.keys())), path = `factions/${id}.json`;
    w.change(path, () => {
      w.p.factions.set(id, { id, name, color: '#5fd38d', description: '', resources: ['money'], start: { money: 5000, building: [], units: [] }, building: {}, units: {}, research: {}, generals: {} });
      w.p.factionPaths.set(id, path); w.p.def.factions = [...(w.p.def.factions || []), path]; w.changed('project.json');
    });
    w.isOpen.add('f:' + id); w.go({ area: 'faction', faction: id, sub: 'overview' });
  });
}

// ---------- Usages of global things (for inspectors) ----------
function usages(w, kind, id) {
  const r = [];
  const validate = (fid, gid, cat, eid, x) => {
    const hit = kind === 'weapon' ? (x.weapons || []).includes(id) || (x.effect || []).some(a => a.weapon === id)
      : kind === 'keyword' ? x.keywords?.[id] != null || (x.effect || []).some(a => a.keyword === id || a.target === 'keyword:' + id)
        : kind === 'model' ? x.model === id : kind === 'resource' ? x.cost?.[id] != null
          : kind === 'slot' ? x.slot === id : kind === 'armor' ? x.armor === id : kind === 'class' ? x.class === id || (x.effect || []).some(a => a.target === 'class:' + id) : false;
    if (hit) r.push({ fid, gid, cat, eid, name: x.name || eid });
  };
  for (const [fid, f] of w.p.factions) {
    for (const cat of CATEGORIES) for (const [eid, x] of Object.entries(f[cat] || {})) validate(fid, null, cat, eid, x);
    for (const [gid, g] of Object.entries(f.generals || {})) for (const cat of CATEGORIES) for (const [eid, x] of Object.entries(g.modify?.[cat] || {})) validate(fid, gid, cat, eid, x);
  }
  if (kind === 'keyword' || kind === 'damageType') for (const [wid, x] of Object.entries(w.p.data.weapons)) if (x.keywords?.[id] != null || x.damageType === id) r.push({ weapon: wid, name: x.name || wid });
  return r;
}
function usageList(w, kind, id) {
  const v = usages(w, kind, id);
  return [el('h4', {}, `Verwendet (${v.length})`), v.length ? el('div', { class: 'da-tags' }, ...v.map(x => el('button', { class: 'da-tag tk-leap', onclick: () => x.weapon ? w.go({ area: 'weapons', choice: x.weapon }) : w.go({ area: 'faction', faction: x.fid, sub: CAT_PAGE[x.cat], choice: x.eid, general: x.gid }) },
    x.weapon ? icon('weapon', 12) : el('i', { class: 'da-color rounded', style: `background:${w.p.factions.get(x.fid)?.color}` }), ' ' + x.name, x.gid ? el('small', {}, ' · ' + (w.p.factions.get(x.fid).generals[x.gid]?.name || x.gid)) : null))) : el('p', { class: 'ed-small' }, 'Noch nirgends benutzt.')];
}

// ---------- Catalog page for simple global lists ----------
export function catalog(w, main, insp, { title, singular, kind, ic, obj, file, new: new_, row, inspector, hint, renamed, deleted, aheadList }) {
  const o = obj(), choice = w.page.choice;
  main.append(w.head(title,
    w.button('plus', 'Neu', () => { const id = freeId('new', new Set(Object.keys(o))); w.change(file, () => { o[id] = new_(); }); w.go({ ...w.page, choice: id }); }),
    w.button('export', 'JSON', () => w.jsonDialogue(`${title} als JSON`, o, j => w.change(file, () => { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, j); })))),
    aheadList ? aheadList() : null, w.search(), w.list(Object.entries(o), choice, id => w.go({ ...w.page, choice: id }), row));
  const x = o[choice];
  if (!x) { insp.append(el('p', { class: 'ed-small' }, hint)); return; }
  insp.append(w.ihead(singular || title.replace(/n$|e$/, ''), ic, x.name || choice, choice, newId => {
    if (o[newId]) { w.hint(`„${newId}“ gibt es schon.`); return false; }
    w.change(file, () => {
      const newO = {}; for (const [k, v] of Object.entries(o)) newO[k === choice ? newId : k] = v; for (const k of Object.keys(o)) delete o[k]; Object.assign(o, newO);
      if (kind) { renameGlobal(w.p, kind, choice, newId); for (const f of w.allFiles()) w.changed(f); }
      renamed?.(choice, newId);
    });
    w.go({ ...w.page, choice: newId });
  }));
  inspector(x, choice);
  if (kind) insp.append(...usageList(w, kind, choice));
  insp.append(el('hr'), el('div', { class: 'ed-row' },
    w.button('duplicate', 'Duplizieren', () => { const n = freeId(choice, new Set(Object.keys(o))); w.change(file, () => { o[n] = structuredClone(x); }); w.go({ ...w.page, choice: n }); }),
    w.button('delete', 'Löschen', () => { w.change(file, () => { delete o[choice]; deleted?.(choice); }); w.go({ ...w.page, choice: null }); })));
}

export const PAGES = {
  resources(w, main, insp) {
    const file = w.path('resources');
    catalog(w, main, insp, { title: 'Ressourcen', kind: 'resource', ic: 'resource', obj: () => w.p.data.resources, file, new: () => ({ name: 'Neue Ressource', color: '#9a9aa3', kind: 'supply' }),
      hint: 'Ressourcen gelten für alle Fraktionen. Jede Fraktion wählt, welche sie nutzt. „Kapazität“ funktioniert wie Strom: Gebäude liefern oder verbrauchen.',
      row: (id, r) => [el('i', { class: 'da-color rounded', style: `background:${r.color}` }), el('span', { class: 'da-name' }, `${r.symbol || ''} ${r.name || id}`), el('small', {}, { supply: 'Vorrat', capacity: 'Kapazität', points: 'Punkte' }[r.kind] || r.kind)],
      inspector: r => insp.append(w.field('Name', r, 'name', 'text', file), w.field('Symbol', r, 'symbol', 'text', file), w.field('Farbe', r, 'color', 'color', file),
        w.labeled('Art', w.selection([['supply', 'Vorrat (wird ausgegeben)'], ['capacity', 'Kapazität (wie Strom)'], ['points', 'Punkte (General)']], r.kind, v => w.change(file, () => { r.kind = v; }))),
        w.field('Beschreibung', r, 'description', 'textarea', file)) });
  },

  combat_table(w, main, insp) {
    const K = w.p.data.combat, file = w.path('combat');
    const sa = Object.entries(K.damageTypes || {}), ru = Object.entries(K.armors || {});
    main.append(w.head('Schaden gegen Rüstung', w.button('export', 'JSON', () => w.jsonDialogue('Kampf als JSON', K, j => w.change(file, () => { for (const k of Object.keys(K)) delete K[k]; Object.assign(K, j); })))),
      el('p', { class: 'ed-small' }, 'Jede Waffe hat eine Schadensart, jedes Ziel eine Rüstung. Der Wert multipliziert den Schaden: 1 = voll, 0 = wirkungslos, über 1 = besonders wirksam. Zahl am Kopf ziehen oder eintippen.'),
      el('table', { class: 'tk-matrix' }, el('tr', {}, el('th', {}), ...ru.map(([, r]) => el('th', {}, r.name))),
        ...sa.map(([sid, s]) => el('tr', {}, el('th', {}, s.name), ...ru.map(([rid]) => {
          const v = K.table?.[sid]?.[rid];
          const inp = el('input', { type: 'number', step: '0.05', min: 0, class: 'ed-field small', value: v ?? '' });
          inp.addEventListener('change', () => w.change(file, () => { K.table = K.table || {}; K.table[sid] = K.table[sid] || {}; if (inp.value === '') delete K.table[sid][rid]; else K.table[sid][rid] = +inp.value; }));
          const t = Math.min(1, (v ?? 1) / 1.5);
          return el('td', { style: `--w:${t}`, class: v === 0 ? 'null' : v > 1 ? 'strong' : '' }, inp);
        })))));
    insp.append(el('h3', {}, 'Kampf'), el('p', { class: 'ed-small' }, 'Generals-Prinzip: Panzerbrechend frisst Panzer, Kleinkaliber Infanterie, Flugabwehr trifft nur, was fliegt. Mit wenigen Zahlen entstehen so Konter.'),
      el('p', { class: 'ed-small' }, `${sa.length} Schadensarten × ${ru.length} Rüstungen. Fehlende Felder zählen als 1 (die Prüfung warnt).`));
  },
  combat_damageTypes(w, main, insp) {
    const file = w.path('combat');
    catalog(w, main, insp, { title: 'Schadensarten', kind: 'damageType', ic: 'weapon', obj: () => w.p.data.combat.damageTypes, file, new: () => ({ name: 'Neue Schadensart' }),
      hint: 'Jede Waffe macht Schaden einer Art. Die Tabelle legt fest, wie gut das gegen jede Rüstung wirkt.',
      row: (id, x) => [el('span', { class: 'da-name' }, x.name || id), el('small', {}, x.description || '')],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file), w.field('Beschreibung', x, 'description', 'textarea', file)) });
  },
  combat_armors(w, main, insp) {
    const file = w.path('combat');
    catalog(w, main, insp, { title: 'Rüstungen', kind: 'armor', ic: 'armor', obj: () => w.p.data.combat.armors, file, new: () => ({ name: 'Neue Rüstung' }),
      hint: 'Einheiten und Gebäude tragen eine Rüstung.', row: (id, x) => [el('span', { class: 'da-name' }, x.name || id)],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file)) });
  },
  combat_classes(w, main, insp) {
    const file = w.path('combat');
    catalog(w, main, insp, { title: 'Klassen', kind: 'class', ic: 'vehicle', obj: () => w.p.data.combat.classes, file, new: () => ({ name: 'Neue Klasse' }),
      hint: 'Klassen gruppieren Einheiten (Infanterie, Fahrzeug, Luft). Forschungen können eine ganze Klasse treffen.', row: (id, x) => [icon(CLASS_ICON[id] || 'cube', 16), el('span', { class: 'da-name' }, x.name || id)],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file)) });
  },

  keywords(w, main, insp) {
    const file = w.path('keywords');
    catalog(w, main, insp, { title: 'Stichwörter', kind: 'keyword', ic: 'tag', obj: () => w.p.data.keywords, file, new: () => ({ name: 'Neues Stichwort', description: '', for: ['unit'] }),
      hint: 'Stichwörter sind kurze Regeln, die man an Einheiten, Gebäude und Waffen hängt – wie bei One Page Rules: „Zäh(3)“, „Tarnung“, „Fliegt“. Mit „trägt eine Zahl“ bekommt es einen Wert.',
      row: (id, x) => [el('span', { class: 'da-name' }, x.name + (x.number ? '(X)' : '')), el('small', {}, (x.for || []).map(k => ({ unit: 'Einheit', building: 'Gebäude', weapon: 'Waffe' })[k] || k).join(' · '))],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file), w.field('Beschreibung', x, 'description', 'textarea', file), w.field('trägt eine Zahl', x, 'number', 'checkbox', file),
        w.labeled('Gilt für', w.chips(x.for, [['unit', 'Einheit'], ['building', 'Gebäude'], ['weapon', 'Waffe']], v => w.change(file, () => { x.for = v; }), '+'))) });
  },

  weapons(w, main, insp) {
    const file = w.path('weapons'), K = w.p.data.combat;
    catalog(w, main, insp, { title: 'Waffen', kind: 'weapon', ic: 'weapon', obj: () => w.p.data.weapons, file, new: () => ({ name: 'Neue Waffe', damageType: Object.keys(K.damageTypes)[0], damage: 10, range: 20, reload: 1, projectile: 'granate', targets: ['ground'] }),
      hint: 'Waffen gelten für alle Fraktionen. Einheiten und Gebäude tragen eine oder mehrere davon.',
      row: (id, x) => [el('span', { class: 'da-name' }, x.name || id), el('small', {}, `${K.damageTypes[x.damageType]?.name || x.damageType} · ${x.damage}${x.salvo > 1 ? '×' + x.salvo : ''} · ${x.range} m · ${dps(x)} DPS`)],
      inspector: x => insp.append(
        w.field('Name', x, 'name', 'text', file),
        w.labeled('Schadensart', w.selection(Object.entries(K.damageTypes).map(([k, s]) => [k, s.name]), x.damageType, v => w.change(file, () => { x.damageType = v; }))),
        w.field('Schaden', x, 'damage', 'number', file), w.field('Salve', x, 'salvo', 'number', file), w.field('Nachladen (s)', x, 'reload', 'number', file), w.field('Reichweite (m)', x, 'range', 'number', file),
        w.labeled('Geschoss', w.selection(PROJECTILES.map(g => [g, g]), x.projectile, v => w.change(file, () => { x.projectile = v; }))),
        w.labeled('Trifft', w.chips(x.targets, [['ground', 'Boden'], ['air', 'Luft']], v => w.change(file, () => { x.targets = v; }), '+')),
        w.labeled('Stichwörter', w.keywordEditor(x.keywords, 'weapon', v => w.change(file, () => { if (Object.keys(v).length) x.keywords = v; else delete x.keywords; }))),
        el('h4', {}, `Wirkung · ${dps(x)} Schaden pro Sekunde`), effectAgainst(w, x)) });
  },

  slots(w, main, insp) {
    const file = w.path('slots');
    catalog(w, main, insp, { title: 'Ausrüstungsplätze', kind: 'slot', ic: 'overlays', obj: () => (w.p.data.slots = w.p.data.slots || {}), file, new: () => ({ name: 'Neuer Platz', description: '' }),
      hint: 'Ein Platz ist ein Steckplatz für Einzel-Ausrüstung: Pro Einheit passt eine Option je Platz – eine Drohne pro Fahrzeug (Generals) oder eine schwere Waffe pro Trupp (Dawn of War). Welche Optionen es gibt, legt jede Fraktion unter „Ausrüstung“ fest.',
      row: (id, x) => [icon('overlays', 16), el('span', { class: 'da-name' }, x.name || id), el('small', {}, x.description || '')],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file), w.field('Beschreibung', x, 'description', 'textarea', file)) });
  },

  models(w, main, insp) {
    const file = w.path('models');
    catalog(w, main, insp, { title: 'Modelle', kind: 'model', ic: 'cube', obj: () => w.p.data.models, file, new: () => ({ name: 'Neues Modell', source: '' }),
      hint: 'Modelle verweisen auf Voxel-Modelle: „prototyp:panzer“ sind die Modelle aus dem Härtetest, ein Pfad auf eine .vox-Datei aus Voxel Max. Die Vorschau kommt später.',
      row: (id, x) => [icon('cube', 16), el('span', { class: 'da-name' }, x.name || id), el('small', {}, x.source || '')],
      inspector: x => insp.append(w.field('Name', x, 'name', 'text', file), w.field('Quelle', x, 'source', 'text', file), ...modelLifeFields(w, x, file), el('p', { class: 'ed-small' }, 'Tipp für Voxel Max: feste Teamfarbe in der Palette, Turm als eigene Ebene, Rohr nach vorne (+z).')) });
  },

  life(w, main, insp) {
    lifePage(w, main, insp);
  },

  // ---------- Faction ----------
  f_overview(w, main, insp) {
    const eb = w.overlay(); if (!eb) return main.append(el('p', {}, 'Keine Fraktion.'));
    const f = eb.f, e = eb.e, file = eb.file, R = w.p.data.resources, z = { ...metrics(e, w.p), generals: Object.keys(f.generals || {}).length };
    main.append(overlaysBar(w, eb),
      el('div', { class: 'tk-profileCard', style: `--f:${f.color}` },
        el('div', { class: 'tk-fhead' }, el('i', { class: 'tk-fflag' }, icon('flag', 26)), el('div', {}, el('h2', {}, e.name || f.id), el('div', { class: 'ed-small' }, e.playstyle || ''))),
        el('p', {}, e.description || ''),
        eb.g ? el('div', { class: 'tk-generalCard' }, icon('general', 18), el('div', {}, el('b', {}, `${eb.g.name} · ${eb.g.title || ''}`), el('div', { class: 'ed-small' }, eb.g.motto ? `„${eb.g.motto}“` : ''), el('p', {}, eb.g.description || ''))) : null,
        el('div', { class: 'tk-numbers' },
          ...[['vehicle', z.units, 'Einheiten', 'units'], ['building', z.building, 'Gebäude', 'building'], ['research', z.research, 'Forschungen', 'techTree'], ['general', z.generals, 'Generäle', 'generals']]
            .map(([ic, n, t, u]) => el('button', { class: 'tk-number', onclick: () => w.go({ ...w.page, sub: u }) }, icon(ic, 18), el('b', {}, String(n)), el('span', {}, t))),
          (e.resources || []).includes('power') ? el('div', { class: 'tk-number' + (z.powerPlus + z.powerMinus < 0 ? ' red' : '') }, icon('flash', 18), el('b', {}, `+${z.powerPlus} / ${z.powerMinus}`), el('span', {}, 'Strom (alle Gebäude je 1×)')) : null)),
      el('h3', {}, 'Armee auf einen Blick'),
      el('table', { class: 'tk-table' }, el('tr', {}, ...['Einheit', 'Klasse', 'Kosten', 'Leben', 'Tempo', 'DPS', 'Stichwörter'].map(t => el('th', {}, t))),
        ...Object.entries(e.units || {}).map(([id, u]) => el('tr', { onclick: () => w.go({ ...w.page, sub: 'units', choice: id }) },
          el('td', {}, u.name + (u.squad > 1 ? ` ×${u.squad}` : ''), mark(eb, 'units', id)), el('td', {}, w.p.data.combat.classes[u.class]?.name || u.class), el('td', {}, ...w.costText(u.cost)), el('td', {}, String(u.health ?? '')), el('td', {}, String(u.speed ?? '')), el('td', {}, String(z.dps[id] || '–')), el('td', { class: 'ed-small' }, sw(u.keywords))))));
    // Inspector: faction or start for the general
    insp.append(w.ihead('Fraktion', 'flag', f.name || f.id, f.id, null));
    if (eb.g) insp.append(el('p', { class: 'ed-small' }, 'Name, Farbe und Ressourcen gehören der Fraktion. Den Steckbrief des Generals bearbeitest du unter Generäle.'),
      w.button('general', `${eb.g.name} bearbeiten`, () => w.go({ ...w.page, sub: 'generals', choice: eb.gid })));
    else insp.append(w.field('Name', f, 'name', 'text', file), w.field('Farbe', f, 'color', 'color', file), w.field('Spielweise', f, 'playstyle', 'text', file), w.field('Beschreibung', f, 'description', 'textarea', file),
      w.labeled('Ressourcen', w.chips(f.resources, Object.entries(R).map(([k, r]) => [k, r.name]), v => w.change(file, () => { f.resources = v; }), '+ Ressource', r => R[r]?.name || r)),
      ...factionUi(w, f, file));
    // Start (with general: deviations land in general.start)
    const target = eb.g ? (eb.g.start = eb.g.start || {}) : (f.start = f.start || {}), st = e.start || {};
    const setStart = (k, v) => w.change(file, () => { if (v === undefined || (Array.isArray(v) && !v.length && !eb.g)) delete target[k]; else target[k] = v; if (eb.g && !Object.keys(eb.g.start).length) delete eb.g.start; });
    insp.append(el('h4', {}, eb.g ? `Start bei ${eb.g.name}` : 'Start'),
      ...(e.resources || []).filter(r => R[r]?.kind === 'supply').map(r => w.input(R[r].name, st[r], 'number', { set: v => setStart(r, v), inherited: !!eb.g && !(r in (eb.g.start || {})) })),
      w.labeled('Gebäude', w.chips(st.building, Object.entries(e.building).map(([k, g]) => [k, g.name]), v => setStart('building', v), '+ Gebäude', k => e.building[k]?.name || k), { inherited: !!eb.g && !('building' in (eb.g.start || {})) }),
      w.labeled('Einheiten', countEditor(w, st.units || [], Object.entries(e.units).map(([k, u]) => [k, u.name]), v => setStart('units', v)), { inherited: !!eb.g && !('units' in (eb.g.start || {})) }),
      el('hr'), el('div', { class: 'ed-row' },
        w.button('export', 'JSON', () => w.jsonDialogue(`Fraktion „${f.name}“ als JSON`, f, j => w.change(file, () => { const id = f.id; for (const k of Object.keys(f)) delete f[k]; Object.assign(f, j, { id }); }))),
        eb.g ? null : w.button('duplicate', 'Als neue Fraktion', () => {
          const id = freeId(f.id, new Set(w.p.factions.keys())), path = `factions/${id}.json`;
          w.change(path, () => { w.p.factions.set(id, { ...structuredClone(f), id, name: f.name + ' (Kopie)' }); w.p.factionPaths.set(id, path); w.p.def.factions = [...w.p.def.factions, path]; w.changed('project.json'); });
          w.isOpen.add('f:' + id); w.go({ area: 'faction', faction: id, sub: 'overview' });
        }),
        eb.g ? null : w.button('delete', 'Fraktion löschen', () => {
          w.change('project.json', () => { const path = w.p.factionPaths.get(f.id); w.p.factions.delete(f.id); w.p.factionPaths.delete(f.id); w.p.def.factions = w.p.def.factions.filter(x => x !== path); w.changed(path); });
          w.go({ area: 'faction', faction: [...w.p.factions.keys()][0], sub: 'overview' });
        })));
  },

  f_units(w, main, insp) { entryPage(w, main, insp, 'units'); },
  f_equipment(w, main, insp) { entryPage(w, main, insp, 'equipment'); },
  f_building(w, main, insp) { entryPage(w, main, insp, 'building'); },

  f_techTree(w, main, insp) {
    const eb = w.overlay(); if (!eb) return;
    const e = eb.e, R = w.p.data.resources, cat = id => e.building[id] ? 'building' : 'research';
    main.append(overlaysBar(w, eb),
      w.head('Techbaum', w.button('plus', 'Forschung', () => newResearch(w, eb, [Math.max(0, ...Object.values(e.research || {}).map(t => t.pos?.[0] ?? 0)) + 1, 1]))),
      el('p', { class: 'ed-small' }, 'Eckig = Gebäude, rund = Forschung. Ziehen verschiebt · am Punkt ● ziehen und auf einem anderen Knoten loslassen = Voraussetzung · Linie antippen löst sie · Doppeltippen ins Leere = neue Forschung.'),
      el('div', { class: 'tk-legend' }, ...Object.entries(FUNCTIONS).filter(([k]) => Object.values(e.building).some(g => (g.function || 'misc') === k)).map(([k, n]) => el('span', {}, el('i', { class: 'tk-q', style: `background:${FUNCTION_COLOR[k]}` }), n)),
        el('span', {}, el('i', { class: 'tk-q rounded' }), 'Forschung'), eb.gid ? el('span', {}, el('i', { class: 'tk-q dashed' }), `vom General geändert/new`) : null));
    const node = [
      ...Object.entries(e.building || {}).map(([id, g]) => [id, { pos: g.pos, requires: g.requires, name: g.name || id, symbol: (g.name || id)[0], color: FUNCTION_COLOR[g.function] || FUNCTION_COLOR.misc,
        cost: Object.entries(g.cost || {}).map(([r, n]) => [R[r]?.color || '#888', short(n)]), class: 'tk-building' + (eb.gid && eb.origin('building', id) !== 'basis' ? ' tk-fromGeneral' : ''), title: `${g.name} (${FUNCTIONS[g.function] || 'Gebäude'})` }]),
      ...Object.entries(e.research || {}).map(([id, t]) => [id, { pos: t.pos, requires: t.requires, name: t.name || id, symbol: t.symbol, color: R[Object.keys(t.cost || {})[0]]?.color || '#a98bff',
        cost: Object.entries(t.cost || {}).map(([r, n]) => [R[r]?.color || '#888', short(n)]), class: 'tk-research' + (eb.gid && eb.origin('research', id) !== 'basis' ? ' tk-fromGeneral' : ''), title: t.description }]),
    ];
    const setRequires = (id, list) => w.change(eb.file, () => eb.set(cat(id), id, 'requires', list));
    main.append(treeSurface({ node, chosen: w.page.choice,
      onChoice: id => w.go({ ...w.page, choice: id }),
      onMove: (id, p) => w.change(eb.file, () => eb.set(cat(id), id, 'pos', p)),
      onConnect: (from, after) => setRequires(after, [...(eb.obj(cat(after), after).requires || []), from]),
      onUnlink: (after, from) => setRequires(after, (eb.obj(cat(after), after).requires || []).filter(x => x !== from)),
      onNew: pos => newResearch(w, eb, pos), onEmpty: () => w.go({ ...w.page, choice: null }), hint: t => w.hint(t) }));
    const id = w.page.choice;
    if (id && e.building[id]) return entryInspector(w, eb, insp, 'building', id);
    if (id && e.research[id]) return entryInspector(w, eb, insp, 'research', id);
    insp.append(el('h3', {}, 'Techbaum'), el('p', { class: 'ed-small' }, 'Der Techbaum zeigt, was wovon abhängt: Gebäude schalten Gebäude frei, Forschungen verbessern die Armee. Einheiten nennen ihre Voraussetzungen selbst (Inspektor › Voraussetzungen).'),
      el('h4', {}, 'Einheiten mit Voraussetzungen'), el('div', { class: 'da-tags' }, ...Object.entries(e.units).filter(([, u]) => u.requires?.length).map(([uid, u]) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ ...w.page, sub: 'units', choice: uid }) }, `${u.name} ← ${u.requires.map(v => e.building[v]?.name || e.research[v]?.name || v).join(', ')}`))));
  },

  f_generals(w, main, insp) {
    const eb = w.overlay(); if (!eb) return;
    const f = eb.f, file = eb.file, G = f.generals = f.generals || {}, choice = w.page.choice;
    main.append(w.head('Generäle', w.button('plus', 'General', () => w.askId('Neuer General', 'General ', (name, id0) => {
      const id = freeId(id0 || 'general', new Set(Object.keys(G))); w.change(file, () => { G[id] = { name, title: '', motto: '', description: '' }; }); w.go({ ...w.page, choice: id });
    }))), el('p', { class: 'ed-small' }, 'Ein General ist eine Ebene über der Fraktion: Er ändert Werte, bringt eigene Einheiten, Gebäude und Forschungen mit und verzichtet auf andere. Alles Übrige erbt er.'),
    el('div', { class: 'tk-maps' }, ...Object.entries(G).map(([gid, g]) => {
      const z = changes(f, gid);
      return el('button', { class: 'tk-gcard' + (choice === gid ? ' on' : ''), style: `--f:${f.color}`, onclick: () => w.go({ ...w.page, choice: gid }) },
        el('div', { class: 'tk-ghead' }, icon('general', 22), el('div', {}, el('b', {}, g.name || gid), el('div', { class: 'ed-small' }, g.title || ''))),
        g.motto ? el('i', { class: 'ed-small' }, `„${g.motto}“`) : null, el('p', {}, g.description || ''),
        el('div', { class: 'tk-gnumbers' }, el('span', { class: 'tk-mark tk-ge' }, `${z.changed} geändert`), el('span', { class: 'tk-mark tk-nu' }, `${z.new} neu`), el('span', { class: 'tk-mark tk-oh' }, `${z.without} ohne`)));
    })));
    const g = G[choice];
    if (!g) { insp.append(el('p', { class: 'ed-small' }, 'General wählen oder neu anlegen. Mit „Als Ebene benutzen“ bearbeitest du Einheiten, Gebäude und Techbaum aus seiner Sicht.')); return; }
    insp.append(w.ihead('General', 'general', g.name || choice, choice, new_ => {
      if (G[new_]) { w.hint(`„${new_}“ gibt es schon.`); return false; }
      w.change(file, () => { const n = {}; for (const [k, v] of Object.entries(G)) n[k === choice ? new_ : k] = v; for (const k of Object.keys(G)) delete G[k]; Object.assign(G, n); if (w.general[f.id] === choice) w.general[f.id] = new_; });
      w.go({ ...w.page, choice: new_ });
    }),
    w.button('general', w.general[f.id] === choice ? 'Ist die aktive Ebene' : 'Als Ebene benutzen', () => { w.general[f.id] = choice; w.go({ ...w.page, sub: 'units', choice: null }); }, 'main'),
    w.field('Name', g, 'name', 'text', file), w.field('Titel', g, 'title', 'text', file), w.field('Motto', g, 'motto', 'text', file), w.field('Beschreibung', g, 'description', 'textarea', file),
    el('h4', {}, 'Änderungen'), ...changeList(w, f, choice),
    el('h4', {}, 'Ohne'), w.chips(g.without, [...CATEGORIES.flatMap(k => Object.entries(f[k] || {}).map(([id, x]) => [id, `${x.name || id} (${CATEGORY_NAME[k]})`]))], v => w.change(file, () => { if (v.length) g.without = v; else delete g.without; }), '+ verzichtet auf …', id => nameFrom(f, id)),
    el('hr'), el('div', { class: 'ed-row' },
      w.button('export', 'JSON', () => w.jsonDialogue(`General „${g.name}“ als JSON`, g, j => w.change(file, () => { for (const k of Object.keys(g)) delete g[k]; Object.assign(g, j); }))),
      w.button('duplicate', 'Duplizieren', () => { const n = freeId(choice, new Set(Object.keys(G))); w.change(file, () => { G[n] = { ...structuredClone(g), name: g.name + ' (Kopie)' }; }); w.go({ ...w.page, choice: n }); }),
      w.button('delete', 'Löschen', () => { w.change(file, () => { delete G[choice]; if (w.general[f.id] === choice) w.general[f.id] = null; }); w.go({ ...w.page, choice: null }); })));
  },

  validation(w, main, insp) {
    const m = w.messages || [];
    const groups = [['error', 'Fehler', 'error'], ['warning', 'Warnungen', 'warning'], ['hint', 'Hinweise', 'info']];
    main.append(w.head('Prüfung'), el('p', { class: 'ed-small' }, 'Läuft nach jeder Änderung, wie „node tools/nt.js check“ auf der Kommandozeile. Antippen springt zur Stelle. Geprüft werden die Fraktionen und jede General-Ebene.'));
    if (!m.length) main.append(el('div', { class: 'tk-allGood' }, icon('verify', 28), el('b', {}, 'Alles stimmig.'), el('span', { class: 'ed-small' }, 'Keine Fehler, Warnungen oder Hinweise.')));
    for (const [kind, title, ic] of groups) {
      const l = m.filter(x => x.kind === kind); if (!l.length) continue;
      main.append(el('h3', {}, `${title} (${l.length})`), el('div', { class: 'da-list' }, ...l.map(x => el('button', { class: 'da-entry tk-message ' + kind, onclick: () => jumpToTo(w, x.place) }, icon(ic, 16), el('span', { class: 'da-name' }, x.text), el('small', {}, x.place)))));
    }
    insp.append(el('h3', {}, 'Was wird geprüft?'), ...['Verweise: Waffen, Stichwörter, Rüstungen, Klassen, Modelle, Ressourcen, Voraussetzungen, „produziert“, „erforscht in“, Ziele von Wirkungen.',
      'Kreise in den Voraussetzungen und doppelte IDs.', 'Einheiten, die kein Gebäude baut; Kosten in Ressourcen, die die Fraktion nicht nutzt; Strom ohne Kraftwerk.',
      'Generäle: „ohne“ und Änderungen zeigen auf Vorhandenes, neue Einträge haben mindestens einen Namen.'].map(t => el('p', { class: 'ed-small' }, t)));
  },
};

// ---------- Unit and building list ----------
function entryPage(w, main, insp, cat) {
  const eb = w.overlay(); if (!eb) return;
  const e = eb.e, K = w.p.data.combat, unit = cat === 'units', equip = cat === 'equipment', PL = w.p.data.slots || {};
  const entries = Object.entries(e[cat] || {});
  if (eb.gid) for (const id of eb.g.without || []) if (eb.f[cat]?.[id]) entries.push([id, { ...eb.f[cat][id], _without: true }]);
  const groups = unit ? Object.entries(K.classes).map(([k, x]) => [k, x.name]) : equip ? Object.entries(PL).map(([k, x]) => [k, x.name]) : Object.entries(FUNCTIONS);
  const groupFrom = x => unit ? x.class : equip ? x.slot : (x.function || 'misc');
  main.append(overlaysBar(w, eb),
    w.head(unit ? 'Einheiten' : equip ? 'Ausrüstung' : 'Gebäude', w.button('plus', 'Neu', () => {
      const template = equip ? { name: 'Neue Ausrüstung', symbol: '', slot: Object.keys(PL)[0], cost: { money: 100 }, time: 5, effect: [] } : unit ? { name: 'Neue Einheit', role: '', class: 'infantry', armor: 'infantry', cost: { money: 300 }, buildTime: 6, health: 100, speed: 3, sight: 20, weapons: [] }
        : { name: 'Neues Gebäude', function: 'production', cost: { money: 800 }, buildTime: 15, health: 1000, armor: 'building', size: [4, 4], produces: [], pos: [0, 3] };
      const id = w.change(eb.file, () => eb.new(cat, unit ? 'unit' : equip ? 'equipment' : 'building', template));
      w.go({ ...w.page, choice: id });
    })), w.search());
  for (const [gk, gn] of [...groups, ['?', 'Ohne Zuordnung']]) {
    const l = entries.filter(([, x]) => gk === '?' ? !groups.some(([k]) => k === groupFrom(x)) : groupFrom(x) === gk);
    if (!l.length) continue;
    main.append(el('h3', { class: 'tk-group' }, unit ? icon(CLASS_ICON[gk] || 'cube', 15) : equip ? icon('overlays', 15) : el('i', { class: 'tk-q', style: `background:${FUNCTION_COLOR[gk] || '#888'}` }), ' ' + gn),
      w.list(l, w.page.choice, id => w.go({ ...w.page, choice: id }), (id, x) => [
        el('span', { class: 'da-name' }, (x.name || id) + (x.squad > 1 ? ` ×${x.squad}` : '')), mark(eb, cat, id),
        el('span', { class: 'tk-role' }, unit ? x.role || '' : equip ? (fitsOnto(e, id).map(u => e.units[u].name).join(', ') || 'passt noch auf nichts') : (x.produces?.length ? '→ ' + x.produces.map(u => e.units[u]?.name || u).join(', ') : '')),
        el('small', {}, el('span', { class: 'tk-costRow' }, ...w.costText(x.cost)), equip ? (x.multiple > 1 ? ` bis ${x.multiple}×` : '') : ` ${x.health ?? '–'} ♥`)], (id, x) => x._without ? 'tk-without' : ''));
  }
  const id = w.page.choice;
  if (id && (e[cat]?.[id] || (eb.gid && eb.g.without?.includes(id)))) entryInspector(w, eb, insp, cat, id);
  else insp.append(el('p', { class: 'ed-small' }, equip ? 'Einzel-Ausrüstung kauft man für eine einzelne Einheit: eine Drohne für ein Fahrzeug wie bei Generals, eine schwere Waffe oder einen Anführer für einen Trupp wie bei Dawn of War. Pro Platz passt eine Option; welche Einheiten sie nehmen können, steht bei „Passt auf“.' : unit ? 'Einheit wählen oder neu anlegen. Eine Einheit ist eine Regelkarte: Werte, Waffen, Stichwörter. Das Modell kommt aus Voxel Max.' : 'Gebäude wählen oder neu anlegen. Gebäude bauen Einheiten, liefern oder brauchen Strom und schalten über Voraussetzungen andere frei.'),
    eb.gid ? el('p', { class: 'ed-small' }, `Ebene „${eb.g.name}“: Änderungen landen beim General. Neu Angelegtes gibt es nur bei ihm.`) : null);
}

// ---------- Inspector for unit, building and research (with general overlay) ----------
function entryInspector(w, eb, insp, cat, id) {
  const e = eb.e, x = e[cat]?.[id] || eb.f[cat]?.[id], file = eb.file, K = w.p.data.combat, R = w.p.data.resources;
  const her = eb.origin(cat, id), kindName = CATEGORY_NAME[cat];
  const kindIc = { units: CLASS_ICON[x.class] || 'vehicle', building: 'building', research: 'research', equipment: 'anvil' }[cat];
  insp.append(w.ihead(kindName + (eb.gid ? ` · ${{ basis: 'inherited', general: 'geändert', new: 'nur beim General', without: 'without' }[her]}` : ''), kindIc, x.name || id, id, new_ => {
    let ok; w.change(file, () => { ok = eb.rename(id, new_); }); if (!ok) { w.hint(`„${new_}“ gibt es in dieser Fraktion schon.`); return false; }
    w.go({ ...w.page, choice: new_ });
  }));
  if (her === 'without') {
    insp.append(el('p', { class: 'ed-small' }, `${eb.g.name} verzichtet auf „${x.name}“. Für alle anderen gibt es das weiterhin.`),
      w.button('restart', 'Zurückholen', () => w.change(file, () => eb.restore(id)), 'main'));
    return;
  }
  // Field building blocks with overlay
  const opt = field => ({ inherited: eb.inherited(cat, id, field), back: eb.overridden(cat, id, field) ? () => w.change(file, () => eb.reset(cat, id, field)) : null });
  const F = (label, field, type = 'text') => w.input(label, x[field], type, { set: v => w.change(file, () => eb.set(cat, id, field, v)), live: v => { eb.set(cat, id, field, v); w.changed(file); }, ...opt(field) });
  const B = (label, field, construction) => w.labeled(label, construction(x[field], v => w.change(file, () => eb.set(cat, id, field, v))), opt(field));
  const W = (label, field, options, empty) => B(label, field, (v, s) => w.selection(options, v || '', n => s(n || undefined), empty));
  const resources = e.resources || [];
  const requiresOptions = [...Object.entries(e.building).map(([k, g]) => [k, `${g.name} (Gebäude)`]), ...Object.entries(e.research).map(([k, t]) => [k, `${t.name} (Forschung)`])].filter(([k]) => k !== id);
  const nameIn = k => e.building[k]?.name || e.research[k]?.name || e.units[k]?.name || k;
  insp.append(F('Name', 'name'));
  if (cat === 'units') {
    insp.append(F('Rolle', 'role'), F('Beschreibung', 'description', 'textarea'),
      W('Klasse', 'class', Object.entries(K.classes).map(([k, c]) => [k, c.name])), W('Rüstung', 'armor', Object.entries(K.armors).map(([k, r]) => [k, r.name])),
      W('Modell', 'model', Object.entries(w.p.data.models).map(([k, m]) => [k, m.name]), '— kein Modell —'),
      el('h4', {}, 'Werte'), B('Kosten', 'cost', (v, s) => w.costEditor(v, resources, s)),
      F('Bauzeit (s)', 'buildTime', 'number'), F('Truppstärke', 'squad', 'number'), F(x.squad > 1 ? 'Leben je Mann' : 'Leben', 'health', 'number'), F('Tempo (m/s)', 'speed', 'number'), F('Sicht (m)', 'sight', 'number'),
      el('h4', {}, 'Waffen & Regeln'), B('Waffen', 'weapons', (v, s) => w.chips(v, Object.entries(w.p.data.weapons).map(([k, a]) => [k, a.name]), s, '+ Waffe', k => w.p.data.weapons[k]?.name || k)),
      B('Stichwörter', 'keywords', (v, s) => w.keywordEditor(v, 'unit', s)),
      B('Voraussetzungen', 'requires', (v, s) => w.chips(v, requiresOptions, s, '+ Voraussetzung', nameIn)),
      builtIn(w, eb, id),
      el('h4', {}, 'Einzel-Ausrüstung'), B('Kann nehmen', 'equipment', (v, s) => w.chips(v, Object.entries(e.equipment || {}).map(([k, o]) => [k, `${o.name} (${w.p.data.slots?.[o.slot]?.name || o.slot})`]), s, '+ Ausrüstung', k => e.equipment?.[k]?.name || k)),
      calculate(w, eb, id),
      ...experienceSection(w, eb, id, x, B));
    insp.append(el('h4', {}, 'Wirkung'), ...(x.weapons || []).map(wid => { const a = w.p.data.weapons[wid]; return a ? el('div', { class: 'tk-effect' }, el('b', {}, `${a.name} · ${dps(a)} DPS · ${a.range} m`), effectAgainst(w, a)) : null; }),
      (x.weapons || []).length ? null : el('p', { class: 'ed-small' }, 'Unbewaffnet.'));
  } else if (cat === 'building') {
    insp.append(F('Beschreibung', 'description', 'textarea'), W('Funktion', 'function', Object.entries(FUNCTIONS)), W('Modell', 'model', Object.entries(w.p.data.models).map(([k, m]) => [k, m.name]), '— kein Modell —'),
      el('h4', {}, 'Werte'), B('Kosten', 'cost', (v, s) => w.costEditor(v, resources, s)), F('Bauzeit (s)', 'buildTime', 'number'), F('Leben', 'health', 'number'),
      W('Rüstung', 'armor', Object.entries(K.armors).map(([k, r]) => [k, r.name])),
      B('Größe (Felder)', 'size', (v, s) => el('span', { class: 'ed-row' }, ...[0, 1].map(i => { const f = el('input', { type: 'number', min: 1, class: 'ed-field small', value: v?.[i] ?? '' }); f.addEventListener('change', () => { const n = [...(v || [1, 1])]; n[i] = +f.value || 1; s(n); }); return f; }))),
      resources.includes('power') ? F('Strom (+ liefert, − braucht)', 'power', 'number') : null,
      el('h4', {}, 'Was es kann'), B('Baut Einheiten', 'produces', (v, s) => w.chips(v, Object.entries(e.units).map(([k, u]) => [k, u.name]), s, '+ Einheit', k => e.units[k]?.name || k)),
      B('Waffen', 'weapons', (v, s) => w.chips(v, Object.entries(w.p.data.weapons).map(([k, a]) => [k, a.name]), s, '+ Waffe', k => w.p.data.weapons[k]?.name || k)),
      B('Stichwörter', 'keywords', (v, s) => w.keywordEditor(v, 'building', s)),
      B('Voraussetzungen', 'requires', (v, s) => w.chips(v, requiresOptions, s, '+ Voraussetzung', nameIn)),
      el('h4', {}, 'Erforscht hier'), el('div', { class: 'da-tags' }, ...Object.entries(e.research).filter(([, t]) => t.researchIn === id).map(([tid, t]) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ ...w.page, sub: 'techTree', choice: tid }) }, icon('research', 12), ' ' + t.name))));
  } else if (cat === 'equipment') {
    const PL = w.p.data.slots || {};
    insp.append(F('Symbol (ein Zeichen)', 'symbol'), F('Beschreibung', 'description', 'textarea'),
      W('Platz', 'slot', Object.entries(PL).map(([k, x]) => [k, x.name])),
      B('Kosten', 'cost', (v, s) => w.costEditor(v, resources, s)), F('Dauer (s)', 'time', 'number'), F('Höchstens (×)', 'multiple', 'number'),
      W('Nur bei Gebäude', 'onlyAt', Object.entries(e.building).map(([k, g]) => [k, g.name]), '— überall —'),
      B('Voraussetzungen', 'requires', (v, s) => w.chips(v, requiresOptions, s, '+ Voraussetzung', nameIn)),
      el('h4', {}, 'Wirkung auf die eigene Einheit'), B('', 'effect', (v, s) => effectEditor(w, eb, v || [], s, true)),
      el('h4', {}, 'Passt auf'), w.labeled('Einheiten', w.chips(fitsOnto(e, id), Object.entries(e.units).filter(([, u]) => !u.keywords?.companion).map(([k, u]) => [k, u.name]), new_ => w.change(file, () => {
        for (const [uid, u] of Object.entries(e.units)) {
          const has = (u.equipment || []).includes(id), should = new_.includes(uid);
          if (should && !has) eb.set('units', uid, 'equipment', [...(u.equipment || []), id]);
          if (!should && has) eb.set('units', uid, 'equipment', u.equipment.filter(x => x !== id));
        }
      }), '+ Einheit', k => e.units[k]?.name || k)));
  } else {
    insp.append(F('Symbol (ein Zeichen)', 'symbol'), F('Beschreibung', 'description', 'textarea'),
      B('Kosten', 'cost', (v, s) => w.costEditor(v, resources, s, true)), F('Dauer (s)', 'time', 'number'),
      W('Erforscht in', 'researchIn', Object.entries(e.building).map(([k, g]) => [k, g.name]), '— sofort / General-Fähigkeit —'),
      B('Voraussetzungen', 'requires', (v, s) => w.chips(v, requiresOptions, s, '+ Voraussetzung', nameIn)),
      el('h4', {}, 'Wirkung'), B('', 'effect', (v, s) => effectEditor(w, eb, v || [], s)));
  }
  // Footer: duplicate, delete or "ohne"
  insp.append(el('hr'), el('div', { class: 'ed-row' },
    w.button('duplicate', 'Duplizieren', () => { const n = w.change(file, () => eb.new(cat, id, { ...structuredClone(x), name: (x.name || id) + ' (Kopie)', ...(x.pos ? { pos: [x.pos[0] + 1, x.pos[1]] } : {}) })); w.go({ ...w.page, choice: n }); }),
    eb.gid && her !== 'new' ? w.button('x', `Ohne bei ${eb.g.name}`, () => { w.change(file, () => eb.remove(cat, id)); w.hint(`${eb.g.name} verzichtet auf „${x.name}“.`, { undo: true }); })
      : w.button('delete', 'Löschen', () => { w.change(file, () => eb.remove(cat, id)); w.go({ ...w.page, choice: null }); })));
}
function builtIn(w, eb, uid) {
  const e = eb.e, who = Object.entries(e.building).filter(([, g]) => (g.produces || []).includes(uid)).map(([k]) => k);
  return w.labeled('Gebaut in', w.chips(who, Object.entries(e.building).map(([k, g]) => [k, g.name]), new_ => w.change(eb.file, () => {
    for (const k of new Set([...who, ...new_])) {
      const p = e.building[k].produces || [], should = new_.includes(k);
      if (should && !p.includes(uid)) eb.set('building', k, 'produces', [...p, uid]);
      if (!should && p.includes(uid)) eb.set('building', k, 'produces', p.filter(x => x !== uid));
    }
  }), '+ Gebäude', k => e.building[k]?.name || k));
}
function newResearch(w, eb, pos) {
  const id = w.change(eb.file, () => eb.new('research', 'research', { name: 'Neue Forschung', symbol: '', cost: { money: 1000 }, time: 20, pos, effect: [] }));
  w.go({ ...w.page, choice: id });
}

// Effects of a research as building blocks (like actions in Cosy rules)
function effectEditor(w, eb, list, set, self = false) {
  const e = eb.e, K = w.p.data.combat, S = w.p.data.keywords;
  const targets = [['all_units', 'alle Einheiten'], ['all_building', 'alle Gebäude'],
    ...Object.entries(K.classes).map(([k, c]) => ['class:' + k, `Klasse: ${c.name}`]), ...Object.entries(FUNCTIONS).map(([k, n]) => ['function:' + k, `Funktion: ${n}`]),
    ...Object.entries(S).filter(([, d]) => !d.for || d.for.some(x => x !== 'weapon')).map(([k, d]) => ['keyword:' + k, `mit Stichwort: ${d.name}`]),
    ...Object.entries(e.units).map(([k, u]) => ['unit:' + k, `Einheit: ${u.name}`]), ...Object.entries(e.building).map(([k, g]) => ['building:' + k, `Gebäude: ${g.name}`])];
  const change = (i, part) => set(list.map((a, j) => j === i ? { ...a, ...part } : a));
  const number = (stat, f, ph) => { const n = el('input', { type: 'number', step: 'any', class: 'ed-field small', placeholder: ph, value: stat ?? '' }); n.addEventListener('change', () => f(n.value === '' ? undefined : +n.value)); return n; };
  const text = (stat, f, ph) => { const n = el('input', { class: 'ed-field', placeholder: ph, value: stat ?? '' }); n.addEventListener('change', () => f(n.value || undefined)); return n; };
  return el('div', { class: 'tk-effects' }, ...list.map((a, i) => el('div', { class: 'da-row' },
    el('b', { class: 'da-kind' }, EFFECTS[a.kind] || a.kind),
    a.kind !== 'ability' && !self ? w.selection(targets, a.target || '', v => change(i, { target: v }), '— Ziel —') : null,
    ...(a.kind === 'stat' ? [w.selection(Object.entries(STAT_FIELDS), a.field || '', v => change(i, { field: v }), '— Feld —'), el('span', { class: 'ed-small' }, '×'), number(a.times, v => change(i, { times: v }), '1'), el('span', { class: 'ed-small' }, '+'), number(a.plus, v => change(i, { plus: v }), '0')]
      : a.kind === 'keyword' ? [w.selection(Object.entries(S).map(([k, d]) => [k, d.name]), a.keyword || '', v => change(i, { keyword: v }), '— Stichwort —'), S[a.keyword]?.number ? number(a.stat, v => change(i, { stat: v }), 'X') : null]
        : a.kind === 'weapon' ? [w.selection(Object.entries(w.p.data.weapons).map(([k, x]) => [k, x.name]), a.weapon || '', v => change(i, { weapon: v }), '— Waffe —'), w.selection(Object.entries(w.p.data.weapons).map(([k, x]) => [k, 'ersetzt ' + x.name]), a.replaced || '', v => change(i, { replaced: v || undefined }), 'zusätzlich')]
          : a.kind === 'companion' ? [w.selection(Object.entries(e.units).sort(([, x], [, y]) => !!y.keywords?.companion - !!x.keywords?.companion).map(([k, u]) => [k, u.name + (u.keywords?.companion ? ' (Begleiter)' : '')]), a.unit || '', v => change(i, { unit: v }), '— Einheit —'), el('span', { class: 'ed-small' }, '×'), number(a.count, v => change(i, { count: v }), '1')]
          : [text(a.name, v => change(i, { name: v }), 'Name'), number(a.cooldown, v => change(i, { cooldown: v }), 'Abklingzeit s'), text(a.description, v => change(i, { description: v }), 'Was passiert?')]),
    el('button', { class: 'ed-button small red', title: 'Entfernen', onclick: () => set(list.filter((_, j) => j !== i)) }, icon('x', 14)))),
  w.selection(Object.entries(EFFECTS).filter(([k]) => !(self && k === 'ability')), '', v => v && set([...list, v === 'stat' ? (self ? { kind: v, field: 'health', plus: 50 } : { kind: v, target: 'all_units', field: 'health', times: 1.1 }) : v === 'ability' ? { kind: v, name: 'Neue Fähigkeit', cooldown: 120 } : { kind: v }]), '+ Wirkung'));
}

// ---------- Single equipment: who can take it, and calculation in the inspector ----------
function fitsOnto(e, oid) { return Object.entries(e.units || {}).filter(([, u]) => (u.equipment || []).includes(oid)).map(([k]) => k); }
function calculate(w, eb, uid) {
  const e = eb.e, u = e.units[uid], opts = (u.equipment || []).filter(o => e.equipment?.[o]);
  if (!opts.length) return el('p', { class: 'ed-small' }, 'Diese Einheit hat keine Einzel-Ausrüstung. Optionen legst du unter „Ausrüstung“ an.');
  const keyStr = `${eb.f.id}/${eb.gid || ''}/${uid}`; w.probe = w.probe || {};
  const choice = w.probe[keyStr] = (w.probe[keyStr] || []).filter(o => opts.includes(o));
  const r = withEquipment(e, w.p, uid, choice), PL = w.p.data.slots || {}, x = r.unit;
  const set = new_ => { w.probe[keyStr] = new_; w.draw(); };
  const afterSlot = {}; for (const o of opts) (afterSlot[e.equipment[o].slot] = afterSlot[e.equipment[o].slot] || []).push(o);
  const rows = Object.entries(afterSlot).map(([pl, l]) => el('div', { class: 'tk-probeRow' }, el('span', { class: 'ed-small' }, PL[pl]?.name || pl),
    el('div', { class: 'ed-segment' }, el('button', { class: l.some(o => choice.includes(o)) ? '' : 'on', onclick: () => set(choice.filter(o => !l.includes(o))) }, '—'),
      ...l.map(o => { const n = choice.filter(v => v === o).length, A = e.equipment[o];
        return el('button', { class: n ? 'on' : '', title: A.description || '', onclick: () => set(n && (A.multiple || 1) > n ? [...choice, o] : n ? choice.filter(v => v !== o) : [...choice.filter(v => !l.includes(v)), o]) }, A.name + (n > 1 ? ` ×${n}` : '')); }))));
  const cost = k => Object.entries(k || {}).map(([rr, n]) => `${n} ${w.p.data.resources[rr]?.symbol || rr}`).join(' ') || '—';
  return el('div', { class: 'tk-probe' }, el('div', { class: 'tk-probeHead' }, icon('scale', 15), el('b', {}, 'Durchrechnen'), el('span', { class: 'ed-small' }, 'Probieren ändert nichts an den Daten. Mehrfach-Optionen: nochmal tippen = +1.')),
    ...rows,
    el('div', { class: 'tk-probeResult' },
      el('div', {}, el('b', {}, x.name + (x.squad > 1 ? ` · Trupp ×${x.squad}` : '')), el('span', { class: 'ed-small' }, ` · ${x.health} Leben${x.squad > 1 ? ' je Mann' : ''} · ${x.speed} m/s`)),
      el('div', { class: 'ed-small' }, `Kosten ${cost(r.total)} (davon Ausrüstung ${cost(r.cost)})`),
      el('div', { class: 'ed-small' }, 'Waffen: ' + (x.weaponsStats.map(a => a.name || a.id).join(', ') || '—')),
      el('div', { class: 'ed-small' }, 'Stichwörter: ' + (sw(x.keywords) || '—')),
      r.companion.length ? el('div', { class: 'tk-companion' }, icon('air', 14), ' Begleiter: ' + r.companion.map(b => `${b.count}× ${e.units[b.unit]?.name || b.unit}`).join(', ')) : null,
      ...r.problems.map(t => el('div', { class: 'ed-error' }, t))));
}

// ---------- kleine Helfer ----------
function overlaysBar(w, eb) {
  const f = eb.f, G = Object.entries(f.generals || {});
  return el('div', { class: 'tk-overlays' }, el('span', { class: 'ed-small' }, 'Ebene'),
    el('span', { class: 'ed-segment' }, el('button', { class: eb.gid ? '' : 'on', onclick: () => { w.general[f.id] = null; w.draw(); } }, el('i', { class: 'da-color rounded', style: `background:${f.color}` }), ' ' + (f.name || f.id)),
      ...G.map(([gid, g]) => el('button', { class: eb.gid === gid ? 'on' : '', title: g.title || '', onclick: () => { w.general[f.id] = gid; w.draw(); } }, icon('general', 14), ' ' + (g.name || gid)))),
    eb.gid ? el('span', { class: 'ed-small tk-layerText' }, 'Kursiv = von der Fraktion geerbt, ↺ = zurücksetzen') : null);
}
function mark(eb, cat, id) {
  if (!eb.gid) return null;
  const h = eb.origin(cat, id);
  return h === 'basis' ? null : el('span', { class: 'tk-mark ' + { general: 'tk-ge', new: 'tk-nu', without: 'tk-oh' }[h] }, { general: 'geändert', new: 'new', without: 'without' }[h]);
}
function changes(f, gid) {
  const g = f.generals[gid], z = { changed: 0, new: 0, without: (g.without || []).length };
  for (const k of CATEGORIES) for (const id of Object.keys(g.modify?.[k] || {})) f[k]?.[id] ? z.changed++ : z.new++;
  return z;
}
function changeList(w, f, gid) {
  const g = f.generals[gid], r = [];
  for (const k of CATEGORIES) for (const [id, t] of Object.entries(g.modify?.[k] || {})) {
    const new_ = !f[k]?.[id];
    r.push(el('button', { class: 'da-entry', onclick: () => { w.general[f.id] = gid; w.go({ ...w.page, sub: CAT_PAGE[k], choice: id }); } },
      el('span', { class: 'tk-mark ' + (new_ ? 'tk-nu' : 'tk-ge') }, new_ ? 'new' : 'geändert'), el('span', { class: 'da-name' }, t.name || f[k]?.[id]?.name || id), el('small', {}, new_ ? CATEGORY_NAME[k] : Object.keys(t).join(', '))));
  }
  return r.length ? [el('div', { class: 'da-list' }, ...r)] : [el('p', { class: 'ed-small' }, 'Noch keine Änderungen. „Als Ebene benutzen“ und dann einfach Werte ändern.')];
}
function nameFrom(f, id) { for (const k of CATEGORIES) if (f[k]?.[id]) return f[k][id].name || id; return id; }
function countEditor(w, list, options, set) {
  const number = new Map(); for (const x of list) number.set(x, (number.get(x) || 0) + 1);
  const construct = m => [...m].flatMap(([k, n]) => Array(n).fill(k));
  const name = k => options.find(([v]) => v === k)?.[1] || k;
  return el('div', { class: 'da-tags' }, ...[...number].map(([k, n]) => {
    const f = el('input', { type: 'number', min: 0, class: 'ed-field small', value: n });
    f.addEventListener('change', () => { const m = new Map(number); if (+f.value > 0) m.set(k, +f.value); else m.delete(k); set(construct(m)); });
    return el('span', { class: 'da-tag' }, name(k), f);
  }), w.selection(options.filter(([v]) => !number.has(v)), '', v => { if (!v) return; const m = new Map(number); m.set(v, 1); set(construct(m)); }, '+ Einheit'));
}
const dps = a => Math.round((a.damage || 0) * (a.salvo || 1) / (a.reload || 1) * 10) / 10;
function effectAgainst(w, a) {
  const K = w.p.data.combat;
  return el('div', { class: 'tk-against' }, ...Object.entries(K.armors).map(([r, x]) => {
    const m = K.table?.[a.damageType]?.[r] ?? 1, hitsAir = (a.targets || ['ground']).includes('air'), hitsGround = (a.targets || ['ground']).includes('ground');
    const eff = (r === 'air' ? hitsAir : hitsGround) ? m : 0;
    return el('span', { class: 'tk-counterCell' + (eff === 0 ? ' null' : eff > 1 ? ' strong' : eff < 0.5 ? ' weak' : ''), title: `${x.name}: ×${eff}` }, el('small', {}, x.name), el('b', {}, eff === 0 ? '—' : `×${eff}`));
  }));
}
function jumpToTo(w, place) {
  const m = place.match(/^(\w+)(?:\/(\w+))?(?: (einheit|gebäude|forschung|ausrüstung) (\w+))?/);
  if (place.startsWith('platz ')) return w.go({ area: 'slots', choice: place.split(' ')[1] });
  if (place.startsWith('waffe ')) return w.go({ area: 'weapons', choice: place.split(' ')[1] });
  if (place === 'combat') return w.go({ area: 'combat', sub: 'table' });
  if (place.startsWith(w.p.paths.ui || 'ui')) { const st = place.match(/stimmung (\w+)/); return w.go({ area: 'ui', sub: st ? 'moods' : place.includes(' hud') ? 'hud' : 'moods', choice: st?.[1] || null }); }
  if (place.startsWith(w.p.paths.experience || 'experience')) return w.go({ area: 'experience' });
  if (place.startsWith('welt ')) { const [, a, id] = place.split(' '); const sub = { 'größe': 'maps', 'höhe': 'maps', bewegung: 'movementTypes', boden: 'terrains', umwandlung: 'transformations', tageszeit: 'daytime', wetter: 'weather', klima: 'climates' }[a] || 'maps'; return w.go({ area: 'world', sub, choice: sub === 'daytime' || a === 'höhe' ? null : id || null }); }
  if (m && w.p.factions.has(m[1])) {
    const sub = { einheit: 'units', 'gebäude': 'building', forschung: 'techTree', 'ausrüstung': 'equipment' }[m[3]] || (place.includes('start') ? 'overview' : m[2] ? 'generals' : 'overview');
    return w.go({ area: 'faction', faction: m[1], sub, choice: m[4] || (sub === 'generals' ? m[2] : null), general: m[2] || null });
  }
  w.hint('Stelle nicht gefunden: ' + place);
}
