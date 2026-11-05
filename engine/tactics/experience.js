// NomadTactics – experience: evolution tiers per unit (Daniel, 04.11.: „tragende Rolle, ausführlich im Editor bearbeitbar“).
// daten/erfahrung.json: { quellen: { schaden, abschuss, … }, stufen: [Standard-Stufensatz] }.
// Unit: optional erfahrung: { tiers: [...] } (own tiers instead of the default). Generals change this via their layer.
// Tier: { id, name, ab (experience points), text?, effect: [stat | keyword | weapon] (like equipment, affects the unit itself), model? }
// Experience only applies within one match.
import { applyOn } from './index.js';

export const SOURCES = {
  damage: 'je ausgeteiltem Schadenspunkt', kill: 'je Abschuss (fest)', killStat: 'je Abschuss × Leben des Ziels', taken: 'je eingestecktem und überlebtem Schadenspunkt',
  fight: 'je Sekunde im Gefecht', support: 'je Sekunde Bauen/Reparieren/Heilen', recon: 'je Sekunde Aufklären',
};
export const TIERS_STATS = { health: 'Leben', damage: 'Schaden (Waffen)', range: 'Reichweite (Waffen)', speed: 'Tempo', sight: 'Sicht' };
const SHORT = { health: 'Leben', damage: 'Schaden', range: 'Reichweite', speed: 'Tempo', sight: 'Sicht' };
export const TIERS_EFFECTS = { stat: 'Wert ändern', keyword: 'Stichwort geben', weapon: 'Waffe geben/tauschen' };

export function emptyExperience() { return { sources: {}, tiers: [] }; }

// Applies to this unit: own tiers or the default
export function tiersFrom(p, unit) {
  const ownItems = unit?.experience?.tiers;
  return ownItems && ownItems.length ? ownItems : (p.data.experience?.tiers || []);
}
export const hasOwnItemsTiers = unit => !!unit?.experience?.tiers?.length;

// How many tiers has a unit reached with xp points?
export function tierAt(tiers, xp) { let n = 0; for (const s of tiers) if (xp >= (s.min || 0)) n++; else break; return n; }

// Unit with all effects up to and including tier n (1 = first tier)
export function withTier(p, unit, n) {
  const u = structuredClone(unit), st = tiersFrom(p, unit);
  u.weaponsStats = (u.weapons || []).map(id => ({ id, ...structuredClone(p.data.weapons?.[id] || {}) }));
  for (const s of st.slice(0, n)) { for (const w of s.effect || []) applyOn(u, w, p.data.weapons || {}); if (s.model) u.model = s.model; }
  return u;
}
// Factors relative to the base unit (for simulations that only know multipliers, e.g. the stress test)
export function tiersFactors(p, unit, n) {
  const a = withTier(p, unit, 0), b = withTier(p, unit, n);
  const q = (x, y) => (x ? y / x : 1);
  const sum = (u, f) => (u.weaponsStats || []).reduce((s, w) => s + (w[f] || 0), 0);
  return { health: q(a.health, b.health), speed: q(a.speed, b.speed), sight: q(a.sight, b.sight), damage: q(sum(a, 'damage'), sum(b, 'damage')), range: q(sum(a, 'range'), sum(b, 'range')),
    keywords: Object.keys(b.keywords || {}).filter(k => !(a.keywords || {})[k]), model: b.model !== a.model ? b.model : null };
}
// Short text for a tier, if there is no own one
export function tiersText(p, s) {
  if (s.text) return s.text;
  const S = p.data.keywords || {}, Wf = p.data.weapons || {};
  return (s.effect || []).map(w => w.kind === 'stat' ? `${SHORT[w.field] || w.field} ${w.times && w.times !== 1 ? (w.times > 1 ? '+' : '') + Math.round((w.times - 1) * 100) + ' %' : ''}${w.plus ? (w.plus > 0 ? ' +' : ' ') + w.plus : ''}`
    : w.kind === 'keyword' ? (S[w.keyword]?.name || w.keyword) + (w.stat != null && w.stat !== true ? `(${w.stat})` : '')
      : w.kind === 'weapon' ? (Wf[w.weapon]?.name || w.weapon) : '').filter(Boolean).join(', ');
}

export function validateExperience(p, report, effective) {
  const E = p.data.experience; if (!E) return;
  const place = p.paths.experience || 'experience';
  for (const [k, v] of Object.entries(E.sources || {})) {
    if (!SOURCES[k]) report('warning', `${place} quellen`, `unbekannte Quelle „${k}“`);
    else if (typeof v !== 'number' || v < 0) report('error', `${place} quellen`, `${k}: Zahl ≥ 0 erwartet`);
  }
  const validateTiers = (st, where) => {
    let ahead = 0;
    st.forEach((s, i) => {
      const w = `${where} stufe ${s.name || i + 1}`;
      if (!s.name) report('warning', w, 'ohne Namen');
      if (!(s.min > 0)) report('error', w, 'braucht „ab“ > 0 Erfahrungspunkte');
      else if (s.min <= ahead) report('error', w, `ab ${s.min} ist nicht größer als die Stufe davor (${ahead})`);
      ahead = Math.max(ahead, s.min || 0);
      if (s.model && !p.data.models?.[s.model]) report('error', w, `Modell „${s.model}“ gibt es nicht`);
      for (const x of s.effect || []) {
        if (!TIERS_EFFECTS[x.kind]) report('error', w, `Wirkung „${x.kind}“ geht bei Erfahrung nicht`);
        else if (x.kind === 'stat' && !TIERS_STATS[x.field]) report('error', w, `Wert „${x.field}“ geht bei Erfahrung nicht`);
        else if (x.kind === 'keyword' && !p.data.keywords?.[x.keyword]) report('error', w, `Stichwort „${x.keyword}“ gibt es nicht`);
        else if (x.kind === 'weapon' && !p.data.weapons?.[x.weapon]) report('error', w, `Waffe „${x.weapon}“ gibt es nicht`);
      }
    });
  };
  validateTiers(E.tiers || [], `${place} standard`);
  if (!(E.tiers || []).length) report('hint', place, 'kein Standard-Stufensatz: Einheiten ohne eigene Stufen sammeln Erfahrung ohne Wirkung');
  for (const [fid, f] of p.factions) {
    for (const gid of [null, ...Object.keys(f.generals || {})]) {
      const e = effective(f, gid);
      for (const [uid, u] of Object.entries(e.units || {})) if (hasOwnItemsTiers(u) && (!gid || f.generals[gid].modify?.units?.[uid]?.experience)) validateTiers(u.experience.tiers, `${fid}${gid ? '/' + gid : ''} einheit ${uid}`);
    }
  }
}
