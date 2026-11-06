// NomadTactics – behaviour of units without orders („Einheiten-Verstand“, 06.11.).
// Data in data/behavior.json (project.json › behavior), edited in the workshop under SPIELREGELN › Verhalten.
// Runs inside the lockstep: integers only, no Math.* with engine-dependent results, no clock.
//
// Principle (Daniel and Ava, 06.11.): an order always beats the unit's own will. The behaviour only decides
// what a unit does on its own: whom to shoot, how far to chase, when to take cover, when to pull back,
// whether to run over infantry or jump aside.
//
// Format:
//   { standardStance: 'aggressive',
//     stances: { id: { name, short, symbol, description, chase %, returns, fire: free|order, retreat, dodges } },
//     profiles: { id: { name, description, stance?, weights: { counter, threat, finish, near, buildings },
//                       retreatAt %, cover: { seek, radius m }, crush: { crushes, dodges, reaction ms },
//                       dodgeArtillery } } }
//   A unit picks a profile with `behavior` and may change single fields with `behaviorOver` (deep merge).
//   Without `behavior` the profile comes from the class (FALLBACK_PROFILE). Generals change both via their layer.

// the four target weights and what they mean (shown in the workshop)
export const WEIGHTS = {
  counter: { name: 'Konter', text: 'Wie gut die eigene Waffe gegen die Panzerung des Ziels wirkt (Schadenstabelle).' },
  threat: { name: 'Gefahr', text: 'Wer mich gerade beschießt, zählt voll. Sonst: wie stark das Ziel gegen meine Panzerung austeilen kann.' },
  finish: { name: 'Fast tot', text: 'Je weniger Leben das Ziel noch hat, desto lieber. Nimmt Feinde schnell aus dem Spiel.' },
  near: { name: 'Nähe', text: 'Je näher, desto lieber. Hält das Feuer ruhig auf dem, was direkt vor einem steht.' },
  buildings: { name: 'Gebäude', text: 'Zuschlag (positiv) oder Abschlag (negativ) für Gebäude wie den Landeplatz.' },
};
export const WEIGHT_KEYS = Object.keys(WEIGHTS);
export const FIRE = { free: 'feuert frei', order: 'nur auf Befehl' };
export const BEHAVIOR_FIELDS = {
  stance: 'Standard-Haltung neuer Einheiten mit diesem Profil (leer = Standard des Spiels)',
  retreatAt: 'Rückzug ab so wenig Leben (in %), nur in Haltungen mit Rückzug',
  'cover.seek': 'Sucht im Gefecht von selbst Deckung (Wald, Schutt)',
  'cover.radius': 'So weit (m) läuft die Einheit höchstens in Deckung',
  'crush.crushes': 'Walzt feindliche Infanterie platt und fährt sie dafür auch gezielt an',
  'crush.dodges': 'Springt vor Fahrzeugen zur Seite, die walzen können',
  'crush.reaction': 'So lange (ms) dauert es, bis die Einheit die Gefahr bemerkt',
  dodgeArtillery: 'Läuft aus der Einschlagstelle von Artillerie und Raketen, wenn sie den Einschlag kommen sieht',
};
export const emptyBehavior = () => ({ standardStance: 'aggressive', stances: {}, profiles: {} });
// without any data (old projects, tests): the nearest enemy, units before buildings (the behaviour before 06.11.)
export const DEFAULT_WEIGHTS = { counter: 0, threat: 0, finish: 0, near: 50, buildings: -60 };
// profile per class when a unit has no `behavior`
export const FALLBACK_PROFILE = { infantry: 'infanterie', air: 'drohne' };
const vehicleFallback = (u) => (u?.keywords?.aufbauen || u?.keywords?.indirekt ? 'artillerie' : 'panzer');
export function profileIdOf(B, u) {
  if (u?.behavior && B?.profiles?.[u.behavior]) return u.behavior;
  const id = FALLBACK_PROFILE[u?.class] || vehicleFallback(u);
  return B?.profiles?.[id] ? id : Object.keys(B?.profiles || {})[0] || null;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function mixDeep(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(out[k]) ? mixDeep(out[k], v) : v;
  return out;
}
// the effective behaviour of one unit (profile + its own changes), with defaults for missing fields
export function behaviorOf(B, u) {
  const id = profileIdOf(B, u);
  const p = mixDeep(id ? B.profiles[id] : {}, u?.behaviorOver);
  const w = p.weights || {};
  return {
    profile: id,
    name: p.name || id || '–',
    stance: p.stance && B?.stances?.[p.stance] ? p.stance : B?.standardStance || 'aggressive',
    weights: id ? Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number.isFinite(w[k]) ? w[k] : 0])) : { ...DEFAULT_WEIGHTS },
    retreatAt: p.retreatAt ?? 30,
    cover: { seek: !!p.cover?.seek, radius: p.cover?.radius ?? 0 },
    crush: { crushes: !!p.crush?.crushes, dodges: !!p.crush?.dodges, reaction: p.crush?.reaction ?? 600 },
    dodgeArtillery: !!p.dodgeArtillery,
  };
}

// ---------- rating a target: the same numbers in the simulation and in the workshop's „Durchrechnen“ ----------
// Every part is a number 0–100; the score is the sum of part × weight. The highest score wins
// (ties: the nearer one, then the lower id). Integers only.
//   counter: damage factor of my weapon against the target's armour (100 % → 50, 200 % → 100)
//   threat:  60 if it shoots at me, plus up to 40 for its damage factor against my armour
//   finish:  100 − its remaining health in %
//   near:    100 at the muzzle, 0 at the edge of what I look at
export function targetParts({ myFactor, itsFactor, shootsMe, hpPct, distance, reach, building }) {
  const clamp = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);
  return {
    counter: clamp(Math.trunc(myFactor / 2)),
    threat: clamp((shootsMe ? 60 : 0) + Math.trunc(clamp(itsFactor) * 40 / 100)),
    finish: clamp(100 - hpPct),
    near: reach > 0 ? clamp(100 - Math.trunc(distance * 100 / reach)) : 0,
    buildings: building ? 100 : 0,
  };
}
export function targetScore(weights, parts) {
  let s = 0;
  for (const k of WEIGHT_KEYS) s += (weights[k] | 0) * parts[k];
  return s;
}

// ---------- compiled for the simulation (integers, per unit type) ----------
// stances in a fixed order (index = state of the unit), each compiled once per match
export function compileStances(B) {
  const ids = Object.keys(B?.stances || {});
  if (!ids.length) ids.push('aggressive');
  const list = ids.map((id) => {
    const s = B?.stances?.[id] || {};
    return { id, chase: Math.max(0, Math.trunc(s.chase ?? 100)), returns: s.returns ? 1 : 0, fire: s.fire === 'order' ? 0 : 1, retreat: s.retreat ? 1 : 0, dodges: s.dodges === false ? 0 : 1 };
  });
  const standard = Math.max(0, ids.indexOf(B?.standardStance || 'aggressive'));
  return { ids, list, standard };
}
export function compileBehavior(B, u, stances, ticksPerSecond) {
  const b = behaviorOf(B, u), si = stances.ids.indexOf(b.stance);
  return {
    weights: b.weights,
    stance: si >= 0 ? si : stances.standard,
    retreatAt: Math.max(0, Math.min(100, Math.trunc(b.retreatAt))),
    seek: b.cover.seek ? 1 : 0,
    coverRadius: Math.max(0, Math.trunc(b.cover.radius * 1000)),
    crushes: b.crush.crushes ? 1 : 0,
    dodges: b.crush.dodges ? 1 : 0,
    reaction: Math.max(1, Math.trunc(b.crush.reaction * ticksPerSecond / 1000)),
    dodgeArtillery: b.dodgeArtillery ? 1 : 0,
  };
}

// ---------- check (part of nt check) ----------
export function validateBehavior(p, report) {
  const B = p.data.behavior;
  if (!B || !Object.keys(B).length) return;
  const S = B.stances || {}, P = B.profiles || {};
  const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (!Object.keys(S).length) report('error', 'verhalten', 'braucht mindestens eine Haltung');
  if (B.standardStance && !S[B.standardStance]) report('error', 'verhalten', `unbekannte Standard-Haltung „${B.standardStance}“`);
  for (const [id, s] of Object.entries(S)) {
    const place = `verhalten haltung ${id}`;
    if (!s.name) report('warning', place, 'braucht einen Namen');
    if (s.chase != null && !whole(s.chase, 0, 1000)) report('warning', place, 'Verfolgen: ganze Zahl 0–1000 % der Sichtweite');
    if (s.fire && !FIRE[s.fire]) report('error', place, `unbekanntes Feuer „${s.fire}“ (free oder order)`);
  }
  for (const [id, b] of Object.entries(P)) {
    const place = `verhalten profil ${id}`;
    if (b.stance && !S[b.stance]) report('error', place, `unbekannte Haltung „${b.stance}“`);
    for (const [k, v] of Object.entries(b.weights || {})) {
      if (!WEIGHTS[k]) report('warning', place, `unbekanntes Gewicht „${k}“`);
      else if (!whole(v, -100, 100)) report('warning', place, `Gewicht ${WEIGHTS[k].name}: ganze Zahl −100 bis 100`);
    }
    if (b.retreatAt != null && !whole(b.retreatAt, 0, 100)) report('warning', place, 'Rückzug ab: ganze Zahl 0–100 %');
    if (b.cover?.radius != null && !(b.cover.radius >= 0 && b.cover.radius <= 60)) report('warning', place, 'Deckungs-Radius 0–60 m');
    if (b.crush?.reaction != null && !whole(b.crush.reaction, 0, 5000)) report('warning', place, 'Reaktionszeit 0–5000 ms');
  }
  // units: profile known
  for (const f of factionsOf(p)) for (const [uid, u] of Object.entries(f.units || {})) {
    if (u.behavior && !P[u.behavior]) report('error', `${f.id} ${uid}`, `unbekanntes Verhaltensprofil „${u.behavior}“`);
    if (u.behaviorOver?.stance && !S[u.behaviorOver.stance]) report('error', `${f.id} ${uid}`, `unbekannte Haltung „${u.behaviorOver.stance}“`);
  }
}

const factionsOf = (p) => (p.factions instanceof Map ? [...p.factions.values()] : Object.values(p.factions || {}));
// units of a faction including the generals' changes (they may set behavior / behaviorOver too)
const unitsOf = (f) => [...Object.values(f.units || {}), ...Object.values(f.generals || {}).flatMap((g) => Object.values(g.modify?.units || {}))];

// rename or delete (new = null) a profile or stance, references follow
export function renameBehavior(p, kind, old, neu) {
  const B = p.data.behavior; if (!B) return;
  const swap = (o) => { if (!o || !(old in o)) return; const v = o[old]; delete o[old]; if (neu) o[neu] = v; };
  if (kind === 'profile') {
    swap(B.profiles);
    for (const f of factionsOf(p)) for (const u of unitsOf(f)) if (u.behavior === old) { if (neu) u.behavior = neu; else delete u.behavior; }
  } else if (kind === 'stance') {
    swap(B.stances);
    if (B.standardStance === old) B.standardStance = neu || Object.keys(B.stances || {})[0];
    for (const b of Object.values(B.profiles || {})) if (b.stance === old) { if (neu) b.stance = neu; else delete b.stance; }
    for (const f of factionsOf(p)) for (const u of unitsOf(f)) if (u.behaviorOver?.stance === old) { if (neu) u.behaviorOver.stance = neu; else delete u.behaviorOver.stance; }
  }
}
