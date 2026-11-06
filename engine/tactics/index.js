// NomadTactics – data model: loading, generals as a layer above the faction, research effects, validation.
// Runs in Node and in the browser, without dependencies (like the rest of the engine).
import { validateWorld, emptyWorld } from './world.js';
import { validateUi, emptyUi } from './ui.js';
import { validateExperience, emptyExperience } from './experience.js';
import { validateLife, emptyLife, renameLife } from './life.js';
import { validateBehavior, emptyBehavior, renameBehavior } from './behavior.js';
export * from './world.js';
export * from './ui.js';
export * from './experience.js';
export * from './life.js';
export * from './behavior.js';

export const CATEGORIES = ['units', 'building', 'research', 'equipment'];
export const CATEGORY_NAME = { units: 'Einheit', building: 'Gebäude', research: 'Forschung', equipment: 'Ausrüstung' };
export const FUNCTIONS = {
  hq: 'Zentrale', power: 'Strom', production: 'Produktion', resource: 'Ressource', research: 'Forschung',
  defense: 'Abwehr', superweapon: 'Superwaffe', movement: 'Bewegung', misc: 'Sonstiges',
};
export const PROJECTILES = ['gewehr', 'mg', 'granate', 'rakete', 'laser', 'flame', 'bomb'];
export const EFFECTS = { stat: 'Wert ändern', keyword: 'Stichwort geben', weapon: 'Waffe geben/tauschen', companion: 'Begleiter (Drohne)', ability: 'Fähigkeit' };
export const STAT_FIELDS = { health: 'Leben', squad: 'Truppstärke', speed: 'Tempo', sight: 'Sicht', buildTime: 'Bauzeit', range: 'Reichweite (Waffen)', damage: 'Schaden (Waffen)', 'cost.money': 'Kosten Geld', power: 'Strom' };

// ---------- Laden ----------
export async function loadTactics(loader, path = 'project.json') {
  const def = await loader.json(path);
  const p = { def, path, data: {}, paths: {}, factions: new Map(), factionPaths: new Map(), messages: [] };
  for (const kind of ['resources', 'combat', 'keywords', 'weapons', 'models', 'slots', 'world', 'ui', 'experience', 'life', 'behavior']) {
    if (!def[kind]) { p.data[kind] = kind === 'life' ? emptyLife() : kind === 'behavior' ? emptyBehavior() : kind === 'combat' ? { damageTypes: {}, armors: {}, table: {}, classes: {} } : kind === 'world' ? emptyWorld() : kind === 'ui' ? emptyUi() : kind === 'experience' ? emptyExperience() : {}; continue; }
    p.paths[kind] = def[kind];
    try { p.data[kind] = withoutSchema(await loader.json(def[kind])); }
    catch (e) { p.messages.push({ kind: 'error', place: def[kind], text: `nicht lesbar: ${e.message}` }); p.data[kind] = {}; }
  }
  for (const fp of def.factions || []) {
    try { const f = withoutSchema(await loader.json(fp)); p.factions.set(f.id, f); p.factionPaths.set(f.id, fp); }
    catch (e) { p.messages.push({ kind: 'error', place: fp, text: `nicht lesbar: ${e.message}` }); }
  }
  return p;
}
const withoutSchema = o => { if (o && typeof o === 'object') delete o.$schema; return o; };

// ---------- Generals: layer above the faction ----------
// aendern: { units|building|research: { id: partial object } } – fields are deep-merged, lists replaced, null deletes.
// An ID that does not exist in the faction is new (then the partial object must be complete).
// ohne: [ids] – removes entries together with references. start: replaces fields of the start.
export function mix(basis, over) {
  if (over === undefined) return structuredClone(basis);
  if (over === null) return undefined;
  if (typeof over !== 'object' || Array.isArray(over) || typeof basis !== 'object' || basis === null || Array.isArray(basis)) return structuredClone(over);
  const r = structuredClone(basis);
  for (const [k, v] of Object.entries(over)) { const m = mix(basis[k], v); if (m === undefined) delete r[k]; else r[k] = m; }
  return r;
}
export function effective(f, gid) {
  const g = gid && f.generals?.[gid];
  const r = structuredClone(f);
  delete r.generals;
  r.general = g ? gid : null;
  if (!g) return r;
  for (const cat of CATEGORIES) {
    r[cat] = r[cat] || {};
    for (const [id, part] of Object.entries(g.modify?.[cat] || {})) {
      const m = mix(r[cat][id], part);
      if (m === undefined) delete r[cat][id]; else r[cat][id] = m;
    }
  }
  if (g.start) r.start = mix(r.start || {}, g.start);
  const way = new Set(g.without || []);
  for (const cat of CATEGORIES) for (const id of way) delete r[cat][id];
  const filter = l => Array.isArray(l) ? l.filter(x => !way.has(x)) : l;
  for (const cat of CATEGORIES) for (const x of Object.values(r[cat])) { if (x.requires) x.requires = filter(x.requires); if (x.produces) x.produces = filter(x.produces); if (x.equipment) x.equipment = filter(x.equipment); }
  if (r.start) for (const k of ['building', 'units']) if (r.start[k]) r.start[k] = filter(r.start[k]);
  return r;
}
// Where does a field come from in the view with a general? 'basis' | 'general' (overridden) | 'new' (only at the general) | 'without' (removed)
export function origin(f, gid, cat, id, field) {
  const g = gid && f.generals?.[gid];
  if (!g) return 'basis';
  if ((g.without || []).includes(id)) return 'without';
  const part = g.modify?.[cat]?.[id];
  if (!f[cat]?.[id]) return part ? 'new' : 'basis';
  if (!part) return 'basis';
  if (field === undefined) return 'general';
  return Object.hasOwn(part, field) ? 'general' : 'basis';
}
// All IDs of a faction (across all categories and generals), e.g. for validation and renaming
export function allIds(f) {
  const m = new Map();
  for (const cat of CATEGORIES) for (const id of Object.keys(f[cat] || {})) m.set(id, cat);
  for (const g of Object.values(f.generals || {})) for (const cat of CATEGORIES) for (const id of Object.keys(g.modify?.[cat] || {})) if (!m.has(id)) m.set(id, cat);
  return m;
}

// ---------- Renaming with references ----------
// Within a faction: voraus, produziert, researchIn, start, targets of effects, ohne, aendern keys
export function renameInFaction(f, old, new_) {
  const replace = l => Array.isArray(l) ? l.map(x => x === old ? new_ : x) : l;
  const targetNew = z => typeof z === 'string' && /^(unit|building):/.test(z) && z.split(':')[1] === old ? z.split(':')[0] + ':' + new_ : z;
  const entry = x => {
    if (!x || typeof x !== 'object') return;
    if (x.requires) x.requires = replace(x.requires); if (x.produces) x.produces = replace(x.produces); if (x.equipment) x.equipment = replace(x.equipment);
    if (x.researchIn === old) x.researchIn = new_; if (x.onlyAt === old) x.onlyAt = new_;
    for (const w of x.effect || []) { w.target = targetNew(w.target); if (w.unit === old) w.unit = new_; }
  };
  const rekey = o => { if (o && Object.hasOwn(o, old)) { const newO = {}; for (const [k, v] of Object.entries(o)) newO[k === old ? new_ : k] = v; for (const k of Object.keys(o)) delete o[k]; Object.assign(o, newO); } };
  for (const cat of CATEGORIES) { rekey(f[cat]); for (const x of Object.values(f[cat] || {})) entry(x); }
  if (f.start) for (const k of ['building', 'units']) if (f.start[k]) f.start[k] = replace(f.start[k]);
  for (const g of Object.values(f.generals || {})) {
    g.without = replace(g.without);
    for (const cat of CATEGORIES) { rekey(g.modify?.[cat]); for (const x of Object.values(g.modify?.[cat] || {})) entry(x); }
    if (g.start) for (const k of ['building', 'units']) if (g.start[k]) g.start[k] = replace(g.start[k]);
  }
}
// Global (weapons, keywords, resources, models, damage types, armors) in all factions
export function renameGlobal(p, kind, old, new_) {
  const visit = x => {
    if (!x || typeof x !== 'object') return;
    if (kind === 'weapon') { if (Array.isArray(x.weapons)) x.weapons = x.weapons.map(w => w === old ? new_ : w); for (const w of x.effect || []) { if (w.weapon === old) w.weapon = new_; if (w.replaced === old) w.replaced = new_; } }
    if (kind === 'slot' && x.slot === old) x.slot = new_;
    if (kind === 'keyword') { if (x.keywords && Object.hasOwn(x.keywords, old)) { x.keywords[new_] = x.keywords[old]; delete x.keywords[old]; } for (const w of x.effect || []) { if (w.keyword === old) w.keyword = new_; if (w.target === 'keyword:' + old) w.target = 'keyword:' + new_; } }
    if (kind === 'resource' && x.cost && Object.hasOwn(x.cost, old)) { x.cost[new_] = x.cost[old]; delete x.cost[old]; }
    if (kind === 'model' && x.model === old) x.model = new_;
    if (kind === 'armor' && x.armor === old) x.armor = new_;
    if (kind === 'class') { if (x.class === old) x.class = new_; for (const w of x.effect || []) if (w.target === 'class:' + old) w.target = 'class:' + new_; }
  };
  for (const f of p.factions.values()) {
    if (kind === 'resource') { f.resources = (f.resources || []).map(r => r === old ? new_ : r); if (f.start && Object.hasOwn(f.start, old)) { f.start[new_] = f.start[old]; delete f.start[old]; } }
    for (const cat of CATEGORIES) for (const x of Object.values(f[cat] || {})) visit(x);
    for (const g of Object.values(f.generals || {})) for (const cat of CATEGORIES) for (const x of Object.values(g.modify?.[cat] || {})) visit(x);
  }
  const k = p.data.combat;
  if (kind === 'damageType') { for (const w of Object.values(p.data.weapons)) if (w.damageType === old) w.damageType = new_; if (k.table?.[old]) { k.table[new_] = k.table[old]; delete k.table[old]; } }
  if (kind === 'armor') for (const z of Object.values(k.table || {})) if (Object.hasOwn(z, old)) { z[new_] = z[old]; delete z[old]; }
  if (kind === 'keyword') for (const w of Object.values(p.data.weapons)) visit(w);
  if (kind === 'life') renameLife(p, old, new_);
  if (kind === 'behavior') renameBehavior(p, 'profile', old, new_);
  if (kind === 'stance') renameBehavior(p, 'stance', old, new_);
}

// ---------- Applying research (for the view „Werte nach Forschung“ and later the simulation) ----------
export function hits(target, cat, id, x) {
  if (!target) return false;
  if (target === 'all_units') return cat === 'units';
  if (target === 'all_building') return cat === 'building';
  const [a, b] = target.split(':');
  if (a === 'unit') return cat === 'units' && id === b;
  if (a === 'building') return cat === 'building' && id === b;
  if (a === 'class') return cat === 'units' && x.class === b;
  if (a === 'function') return cat === 'building' && x.function === b;
  if (a === 'keyword') return (cat === 'units' || cat === 'building') && x.keywords?.[b] != null && x.keywords[b] !== false;
  return false;
}
// Returns a copy of the faction with research applied; weapon stats end up as weaponsStats on the unit
export function withResearch(f, weapons, researched = []) {
  const r = structuredClone(f);
  for (const cat of ['units', 'building']) for (const x of Object.values(r[cat] || {})) x.weaponsStats = (x.weapons || []).map(w => ({ id: w, ...structuredClone(weapons[w] || {}) }));
  for (const fid of researched) for (const w of r.research?.[fid]?.effect || []) for (const cat of ['units', 'building']) for (const [id, x] of Object.entries(r[cat] || {})) {
    if (hits(w.target, cat, id, x)) applyOn(x, w, weapons);
  }
  return r;
}
// Apply an effect to exactly one thing (x needs weaponsStats); companions end up in x.companion
export function applyOn(x, w, weapons) {
  x.weaponsStats = x.weaponsStats || (x.weapons || []).map(id => ({ id, ...structuredClone(weapons[id] || {}) }));
  if (w.kind === 'stat') {
    const compute = v => Math.round(((v ?? 0) * (w.times ?? 1) + (w.plus ?? 0)) * 100) / 100;
    if (w.field === 'range' || w.field === 'damage') for (const ww of x.weaponsStats) ww[w.field] = compute(ww[w.field]);
    else if (w.field?.startsWith('cost.')) { const res = w.field.split('.')[1]; x.cost = x.cost || {}; x.cost[res] = compute(x.cost[res]); }
    else x[w.field] = compute(x[w.field] ?? (w.field === 'squad' ? 1 : 0));
  } else if (w.kind === 'keyword') { x.keywords = x.keywords || {}; x.keywords[w.keyword] = w.stat ?? true; }
  else if (w.kind === 'weapon' && w.weapon) {
    x.weapons = x.weapons || [];
    const i = w.replaced ? x.weapons.indexOf(w.replaced) : -1;
    const new_ = { id: w.weapon, ...structuredClone(weapons[w.weapon] || {}) };
    if (i >= 0) { x.weapons[i] = w.weapon; x.weaponsStats[i] = new_; } else { x.weapons.push(w.weapon); x.weaponsStats.push(new_); }
  } else if (w.kind === 'companion' && w.unit) (x.companion = x.companion || []).push({ unit: w.unit, count: w.count || 1 });
  return x;
}

// ---------- Individual equipment (Dawn of War: squad re-equips; Generals: drone per vehicle) ----------
// An option belongs to a slot (slots.json); one option fits per slot, an option may be taken up to „mehrfach“ times.
// wahl: list of option IDs (for multiple, name it multiple times). Returns the equipped unit, costs, companions and problems.
export function withEquipment(f, p, uid, choice = [], researched = []) {
  const basis = researched.length ? withResearch(f, p.data.weapons, researched) : f;
  const u = structuredClone(basis.units?.[uid]);
  if (!u) return null;
  u.weaponsStats = (u.weapons || []).map(id => ({ id, ...structuredClone(p.data.weapons[id] || {}) }));
  const allowed = new Set(u.equipment || []), problems = [], cost = {}, slotOccupied = new Map(), enumerate = new Map();
  for (const oid of choice) {
    const o = f.equipment?.[oid];
    if (!o) { problems.push(`„${oid}“ gibt es nicht`); continue; }
    if (!allowed.has(oid)) { problems.push(`${o.name} passt nicht auf ${u.name}`); continue; }
    const n = (enumerate.get(oid) || 0) + 1; enumerate.set(oid, n);
    if (n > (o.multiple || 1)) { problems.push(`${o.name} höchstens ${o.multiple || 1}×`); continue; }
    const occupied = slotOccupied.get(o.slot);
    if (occupied && occupied !== oid) { problems.push(`Platz ${p.data.slots?.[o.slot]?.name || o.slot} ist schon mit ${f.equipment[occupied].name} belegt`); continue; }
    slotOccupied.set(o.slot, oid);
    for (const [r, k] of Object.entries(o.cost || {})) cost[r] = (cost[r] || 0) + k;
    for (const w of o.effect || []) applyOn(u, w, p.data.weapons);
  }
  const total = { ...u.cost }; for (const [r, k] of Object.entries(cost)) total[r] = (total[r] || 0) + k;
  return { unit: u, cost, total, companion: u.companion || [], problems };
}

// Power balance and simple metrics (hints in the editor)
export function metrics(f, p) {
  const z = { units: Object.keys(f.units || {}).length, building: Object.keys(f.building || {}).length, research: Object.keys(f.research || {}).length, generals: Object.keys(f.generals || {}).length };
  z.powerPlus = Object.values(f.building || {}).reduce((a, g) => a + Math.max(0, g.power || 0), 0);
  z.powerMinus = Object.values(f.building || {}).reduce((a, g) => a + Math.min(0, g.power || 0), 0);
  // „Feuerkraft pro Geld“ grob: Schaden pro Sekunde je 100 Geld
  z.dps = Object.fromEntries(Object.entries(f.units || {}).map(([id, e]) => {
    const dps = (e.squad || 1) * (e.weapons || []).reduce((a, w) => { const W = p.data.weapons[w]; return a + (W ? W.damage * (W.salvo || 1) / (W.reload || 1) : 0); }, 0);
    return [id, Math.round(dps * 10) / 10];
  }));
  return z;
}

// ---------- Validation (like kj check) ----------
export function validateTactics(p) {
  const m = [...p.messages];
  const report = (kind, place, text) => m.push({ kind, place, text });
  const D = p.data, R = D.resources || {}, S = D.keywords || {}, W = D.weapons || {}, K = D.combat || {}, M = D.models || {};
  const damageTypes = K.damageTypes || {}, armors = K.armors || {}, classes = K.classes || {}, PL = D.slots || {};
  // Regeln
  for (const [sa, row] of Object.entries(K.table || {})) {
    if (!damageTypes[sa]) report('error', 'combat', `Tabelle: unbekannte Schadensart „${sa}“`);
    for (const ru of Object.keys(row)) if (!armors[ru]) report('error', 'combat', `Tabelle ${sa}: unbekannte Rüstung „${ru}“`);
  }
  for (const sa of Object.keys(damageTypes)) for (const ru of Object.keys(armors)) if (K.table?.[sa]?.[ru] == null) report('warning', 'combat', `Tabelle: ${sa} gegen ${ru} fehlt (zählt als 1)`);
  const keywordVerify = (place, sw, for_) => {
    for (const [s, v] of Object.entries(sw || {})) {
      if (!S[s]) { report('error', place, `unbekanntes Stichwort „${s}“`); continue; }
      if (S[s].number && typeof v !== 'number') report('warning', place, `Stichwort „${s}“ braucht eine Zahl`);
      if (S[s].for && !S[s].for.includes(for_)) report('warning', place, `Stichwort „${s}“ ist für ${S[s].for.join('/')} gedacht`);
    }
  };
  for (const [id, x] of Object.entries(PL)) if (!x.name) report('warning', `platz ${id}`, 'ohne Namen');
  for (const [id, w] of Object.entries(W)) {
    const place = `waffe ${id}`;
    if (!damageTypes[w.damageType]) report('error', place, `unbekannte Schadensart „${w.damageType}“`);
    if (!(w.damage > 0) && !w.keywords?.paralyzes) report('warning', place, 'kein Schaden');
    if (w.projectile && !PROJECTILES.includes(w.projectile)) report('warning', place, `unbekanntes Geschoss „${w.projectile}“`);
    keywordVerify(place, w.keywords, 'weapon');
  }
  // Factions (base and every general view)
  for (const [fid, f] of p.factions) {
    const views = [[null, f.name || fid], ...Object.entries(f.generals || {}).map(([g, x]) => [g, `${f.name || fid} + ${x.name || g}`])];
    const ids = new Map();
    for (const cat of CATEGORIES) for (const id of Object.keys(f[cat] || {})) { if (ids.has(id)) report('error', fid, `ID „${id}“ gibt es doppelt (${CATEGORY_NAME[ids.get(id)]} und ${CATEGORY_NAME[cat]})`); ids.set(id, cat); }
    for (const r of f.resources || []) if (!R[r]) report('error', fid, `unbekannte Ressource „${r}“`);
    for (const [gid, g] of Object.entries(f.generals || {})) {
      for (const id of g.without || []) if (!ids.has(id)) report('error', `${fid}/${gid}`, `„ohne“: „${id}“ gibt es nicht`);
      for (const cat of CATEGORIES) for (const [id, part] of Object.entries(g.modify?.[cat] || {})) {
        if (ids.has(id) && ids.get(id) !== cat) report('error', `${fid}/${gid}`, `„${id}“ ist ${CATEGORY_NAME[ids.get(id)]}, nicht ${CATEGORY_NAME[cat]}`);
        if (!ids.has(id) && !part?.name) report('error', `${fid}/${gid}`, `neue ${CATEGORY_NAME[cat]} „${id}“ braucht mindestens einen Namen`);
      }
    }
    for (const [gid, title] of views) {
      const e = effective(f, gid), pre = gid ? `${fid}/${gid}` : fid;
      const all = new Map(); for (const cat of CATEGORIES) for (const id of Object.keys(e[cat] || {})) all.set(id, cat);
      const res = new Set(e.resources || []);
      const costVerify = (place, k) => { for (const r of Object.keys(k || {})) { if (!R[r]) report('error', place, `Kosten in unbekannter Ressource „${r}“`); else if (!res.has(r)) report('warning', place, `kostet ${R[r].name || r}, das ${title} nicht nutzt`); } };
      const requiresVerify = (place, v) => { for (const x of v || []) if (!all.has(x)) report('error', place, `Voraussetzung „${x}“ gibt es nicht`); else if (all.get(x) === 'units') report('warning', place, `Voraussetzung „${x}“ ist eine Einheit`); };
      const produces = new Set();
      for (const [id, g] of Object.entries(e.building || {})) {
        const place = `${pre} gebäude ${id}`;
        if (!g.name) report('warning', place, 'ohne Namen');
        if (g.function && !FUNCTIONS[g.function]) report('warning', place, `unbekannte Funktion „${g.function}“`);
        if (g.armor && !armors[g.armor]) report('error', place, `unbekannte Rüstung „${g.armor}“`);
        if (g.model && !M[g.model]) report('warning', place, `unbekanntes Modell „${g.model}“`);
        for (const w of g.weapons || []) if (!W[w]) report('error', place, `unbekannte Waffe „${w}“`);
        for (const u of g.produces || []) { if (all.get(u) !== 'units') report('error', place, `produziert „${u}“, das ist keine Einheit`); produces.add(u); }
        if (g.power && !res.has('power') && g.power < 0) report('warning', place, 'verbraucht Strom, aber die Fraktion hat keinen');
        costVerify(place, g.cost); requiresVerify(place, g.requires); keywordVerify(place, g.keywords, 'building');
      }
      const companionUsed = new Set(), optionUsed = new Set();
      for (const o of Object.values(e.equipment || {})) for (const w of o.effect || []) if (w.kind === 'companion') companionUsed.add(w.unit);
      for (const u of Object.values(e.units || {})) for (const o of u.equipment || []) optionUsed.add(o);
      for (const [id, o] of Object.entries(e.equipment || {})) {
        const place = `${pre} ausrüstung ${id}`;
        if (!o.name) report('warning', place, 'ohne Namen');
        if (!PL[o.slot]) report('error', place, `unbekannter Platz „${o.slot}“`);
        if (o.onlyAt && all.get(o.onlyAt) !== 'building') report('error', place, `nur bei „${o.onlyAt}“, das ist kein Gebäude`);
        if (!optionUsed.has(id)) report('hint', place, 'keine Einheit kann sie nehmen');
        costVerify(place, o.cost); requiresVerify(place, o.requires);
        for (const w of o.effect || []) {
          if (!EFFECTS[w.kind]) report('error', place, `unbekannte Wirkung „${w.kind}“`);
          if (w.kind === 'companion' && all.get(w.unit) !== 'units') report('error', place, `Begleiter „${w.unit}“ ist keine Einheit`);
          if (w.kind === 'weapon' && !W[w.weapon]) report('error', place, `unbekannte Waffe „${w.weapon}“`);
          if (w.kind === 'weapon' && w.replaced && !W[w.replaced]) report('error', place, `ersetzt unbekannte Waffe „${w.replaced}“`);
          if (w.kind === 'keyword' && !S[w.keyword]) report('error', place, `unbekanntes Stichwort „${w.keyword}“`);
          if (w.kind === 'stat' && !STAT_FIELDS[w.field]) report('warning', place, `unbekanntes Feld „${w.field}“`);
        }
      }
      for (const [id, u] of Object.entries(e.units || {})) {
        const place = `${pre} einheit ${id}`;
        for (const o of u.equipment || []) if (all.get(o) !== 'equipment') report('error', place, `Ausrüstung „${o}“ gibt es nicht`);
        if (u.squad != null && !(u.squad >= 1)) report('warning', place, 'Truppstärke muss mindestens 1 sein');
        if (!u.name) report('warning', place, 'ohne Namen');
        if (!classes[u.class]) report('error', place, `unbekannte Klasse „${u.class}“`);
        if (!armors[u.armor]) report('error', place, `unbekannte Rüstung „${u.armor}“`);
        if (u.model && !M[u.model]) report('warning', place, `unbekanntes Modell „${u.model}“`);
        for (const w of u.weapons || []) if (!W[w]) report('error', place, `unbekannte Waffe „${w}“`);
        if (u.keywords?.companion) { if (!companionUsed.has(id)) report('hint', place, 'Begleiter, den keine Ausrüstung mitbringt'); }
        else if (u.keywords?.lieferung) { if (produces.has(id)) report('hint', place, 'Lieferung, wird aber auch gebaut'); }
        else if (!produces.has(id)) report('warning', place, 'wird in keinem Gebäude gebaut');
        if (!(u.health > 0)) report('error', place, 'braucht Leben');
        costVerify(place, u.cost); requiresVerify(place, u.requires); keywordVerify(place, u.keywords, 'unit');
        if (u.class === 'air' && !u.keywords?.flies) report('hint', place, 'Luft-Einheit ohne Stichwort „Fliegt“');
      }
      for (const [id, t] of Object.entries(e.research || {})) {
        const place = `${pre} forschung ${id}`;
        if (t.researchIn && all.get(t.researchIn) !== 'building') report('error', place, `wird in „${t.researchIn}“ erforscht, das ist kein Gebäude`);
        costVerify(place, t.cost); requiresVerify(place, t.requires);
        for (const w of t.effect || []) {
          if (!EFFECTS[w.kind]) { report('error', place, `unbekannte Wirkung „${w.kind}“`); continue; }
          if (w.kind === 'ability') continue;
          const [a, b] = String(w.target || '').split(':');
          if (!w.target) report('error', place, 'Wirkung ohne Ziel');
          else if ((a === 'unit' && all.get(b) !== 'units') || (a === 'building' && all.get(b) !== 'building') || (a === 'class' && !classes[b]) || (a === 'keyword' && !S[b]) || (a === 'function' && !FUNCTIONS[b]))
            report(gid ? 'hint' : 'warning', place, `Ziel „${w.target}“ trifft nichts`);
          if (w.kind === 'keyword' && !S[w.keyword]) report('error', place, `unbekanntes Stichwort „${w.keyword}“`);
          if (w.kind === 'weapon' && !W[w.weapon]) report('error', place, `unbekannte Waffe „${w.weapon}“`);
          if (w.kind === 'stat' && !STAT_FIELDS[w.field]) report('warning', place, `unbekanntes Feld „${w.field}“`);
        }
      }
      // Kreise in den Voraussetzungen
      const visited = new Map();
      const deep = (id, way) => {
        if (visited.get(id) === 2) return; if (visited.get(id) === 1) { report('error', pre, `Kreis in den Voraussetzungen: ${[...way, id].join(' → ')}`); return; }
        visited.set(id, 1); const x = e[all.get(id)]?.[id]; for (const v of x?.requires || []) if (all.has(v)) deep(v, [...way, id]); visited.set(id, 2);
      };
      for (const id of all.keys()) deep(id, []);
      for (const id of e.start?.building || []) if (all.get(id) !== 'building') report('error', `${pre} start`, `Startgebäude „${id}“ gibt es nicht`);
      for (const id of e.start?.units || []) if (all.get(id) !== 'units') report('error', `${pre} start`, `Starteinheit „${id}“ gibt es nicht`);
      if (res.has('power')) { const z = metrics(e, p); if (z.powerPlus <= 0) report('warning', pre, 'nutzt Strom, hat aber kein Kraftwerk'); }
    }
  }
  validateWorld(p, report, effective);
  validateUi(p, report);
  validateExperience(p, report, effective);
  validateLife(p, report);
  validateBehavior(p, report);
  return m;
}
