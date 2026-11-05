// Editing a faction on a layer: base or a general on top (like template/instance in Cosy).
// Without UI, so that the workshop (browser) and nt (command line) use exactly the same logic.
import { effective, origin, renameInFaction, CATEGORIES } from './index.js';

export const freeId = (basis, present) => { let i = 1, id = basis; while (present.has(id)) id = `${basis}_${++i}`; return id; };
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
export const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => same(a[k], b[k])); }
  return false;
};

export class Overlay {
  constructor(f, gid) { this.f = f; this.gid = gid && f.generals?.[gid] ? gid : null; this.e = effective(f, this.gid); }
  get g() { return this.gid ? this.f.generals[this.gid] : null; }
  newCalculate() { this.e = effective(this.f, this.gid); return this; }
  obj(cat, id) { return this.e[cat]?.[id]; }
  // Which category does an ID belong to (including entries that only a general knows)?
  category(id) { for (const k of CATEGORIES) { if (this.f[k]?.[id]) return k; for (const g of Object.values(this.f.generals || {})) if (g.modify?.[k]?.[id]) return k; } return null; }
  origin(cat, id, field) { return origin(this.f, this.gid, cat, id, field); }
  inherited(cat, id, field) { return !!this.gid && !!this.f[cat]?.[id] && this.origin(cat, id, field) === 'basis'; }
  overridden(cat, id, field) { return !!this.gid && !!this.f[cat]?.[id] && this.origin(cat, id, field) === 'general'; }
  // Writing: without a general into the base, with a general as small a difference as possible in aendern
  set(cat, id, field, stat) {
    const empty = stat === undefined || stat === '' || (Array.isArray(stat) && !stat.length) || (isObj(stat) && !Object.keys(stat).length);
    if (!this.gid) { const o = this.f[cat][id]; if (!o) throw new Error(`${cat}/${id} gibt es nicht`); if (empty) delete o[field]; else o[field] = stat; return; }
    const g = this.g; g.modify = g.modify || {}; g.modify[cat] = g.modify[cat] || {};
    const basis = this.f[cat]?.[id];
    if (!basis) { const t = g.modify[cat][id]; if (!t) throw new Error(`${cat}/${id} gibt es bei ${g.name} nicht`); if (empty) delete t[field]; else t[field] = stat; return; }
    const bw = basis[field]; let part;
    if (same(empty ? undefined : stat, bw)) part = undefined;
    else if (empty) part = null;
    else if (isObj(stat) && isObj(bw)) { part = {}; for (const k of Object.keys(stat)) if (!same(stat[k], bw[k])) part[k] = stat[k]; for (const k of Object.keys(bw)) if (!(k in stat)) part[k] = null; }
    else part = stat;
    const t = g.modify[cat][id] = g.modify[cat][id] || {};
    if (part === undefined) delete t[field]; else t[field] = part;
    this.tidy(cat, id);
  }
  reset(cat, id, field) { const t = this.g?.modify?.[cat]?.[id]; if (t) { delete t[field]; this.tidy(cat, id); } }
  tidy(cat, id) {
    const g = this.g; if (!g?.modify) return;
    if (g.modify[cat]?.[id] && !Object.keys(g.modify[cat][id]).length && this.f[cat]?.[id]) delete g.modify[cat][id];
    if (g.modify[cat] && !Object.keys(g.modify[cat]).length) delete g.modify[cat];
    if (!Object.keys(g.modify).length) delete g.modify;
  }
  allIds() { const s = new Set(); for (const k of CATEGORIES) { for (const id of Object.keys(this.f[k] || {})) s.add(id); for (const g of Object.values(this.f.generals || {})) for (const id of Object.keys(g.modify?.[k] || {})) s.add(id); } return s; }
  // New: without a general into the faction, with a general only at that general. Returns the (possibly adjusted) ID.
  new(cat, basisId, obj) {
    const id = freeId(basisId, this.allIds());
    if (!this.gid) { this.f[cat] = this.f[cat] || {}; this.f[cat][id] = obj; }
    else { const g = this.g; g.modify = g.modify || {}; g.modify[cat] = g.modify[cat] || {}; g.modify[cat][id] = obj; }
    return id;
  }
  // Remove: base = really delete together with references, general = „ohne“ (or delete own new entry)
  remove(cat, id) {
    if (this.gid) {
      if (!this.f[cat]?.[id]) { delete this.g.modify[cat][id]; this.tidy(cat, id); return 'deleted'; }
      this.g.without = [...new Set([...(this.g.without || []), id])]; return 'without';
    }
    delete this.f[cat][id];
    const way = l => Array.isArray(l) ? l.filter(x => x !== id) : l;
    const clean = x => {
      for (const field of ['requires', 'produces', 'equipment']) if (x[field]) { x[field] = way(x[field]); if (!x[field].length && field !== 'produces') delete x[field]; }
      if (x.researchIn === id) delete x.researchIn; if (x.onlyAt === id) delete x.onlyAt;
      if (x.effect) x.effect = x.effect.filter(w => !(w.kind === 'companion' && w.unit === id));
    };
    for (const k of CATEGORIES) for (const x of Object.values(this.f[k] || {})) clean(x);
    if (this.f.start) for (const k of ['building', 'units']) if (this.f.start[k]) this.f.start[k] = way(this.f.start[k]);
    for (const g of Object.values(this.f.generals || {})) {
      if (g.without) { g.without = way(g.without); if (!g.without.length) delete g.without; }
      for (const k of CATEGORIES) if (g.modify?.[k]) { delete g.modify[k][id]; for (const x of Object.values(g.modify[k])) clean(x); }
    }
    return 'deleted';
  }
  restore(id) { if (this.g?.without) { this.g.without = this.g.without.filter(x => x !== id); if (!this.g.without.length) delete this.g.without; } }
  rename(old, new_) { if (this.allIds().has(new_)) return false; renameInFaction(this.f, old, new_); return true; }
}
