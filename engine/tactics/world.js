// NomadTactics – world: map frame, height, movement types, terrain, conversions, day and night, weather, climates.
// Everything is data (daten/world.json). Here are the rules that simulation and workshop share.
// Runs in lockstep: integers only, own randomness with a seed, no clock, no Math.random/sin/pow.

export const TRIGGER = { impact: 'Einschlag', collapse: 'Einsturz', runOver: 'Überfahren', weather: 'Wetter' };
export const SYMMETRY = { off: 'Aus', mirror_x: 'Spiegeln links/rechts', mirror_y: 'Spiegeln oben/unten', mirror_diagonal: 'Spiegeln diagonal', rotate_2: 'Drehen 2-fach', rotate_4: 'Drehen 4-fach' };
export const WATER = { flat: 'flach (Furt)', deep: 'deep' };
export const emptyWorld = () => ({ maps: { sizes: {} }, height: {}, movementTypes: {}, terrains: {}, transformations: {}, daytime: { phases: [] }, weather: {}, weatherSequence: {}, climates: {} });

// ---------- Bewegung ----------
// erkennung: „class:infanterie“ or „keyword:rad“
export function hitsDetection(det, u) {
  const [a, b] = String(det || '').split(':');
  if (a === 'class') return u?.class === b;
  if (a === 'keyword') return u?.keywords?.[b] != null && u.keywords[b] !== false;
  return false;
}
export function movementTypes(world, u) {
  return Object.entries(world?.movementTypes || {}).filter(([, b]) => hitsDetection(b.detection, u)).map(([id]) => id);
}
// Speed in percent on a ground (0 = cannot pass). Several movement types: the best counts (tracks + swims).
// Weather blocks movement types (storm: Schwebt) and slows everything that travels on the ground.
export function speedOnto(world, kinds, groundId, weatherId) {
  const B = world.movementTypes || {}, ground = world.terrains?.[groundId], weather = weatherId ? world.weather?.[weatherId] : null;
  const locked = new Set(weather?.blocks || []);
  let air = 0, best = 0;
  for (const a of kinds) {
    if (locked.has(a) || !B[a]) continue;
    if (B[a].ignoresGround) { air = 100; continue; }
    const t = ground?.speed?.[a] ?? B[a].standard ?? 100;
    if (t > best) best = t;
  }
  const amGround = Math.floor(best * (weather?.speed ?? 100) / 100);
  return Math.max(air, amGround);
}
export function coverOnto(world, kinds, groundId) {
  const d = world.terrains?.[groundId]?.cover || {};
  return kinds.reduce((m, a) => Math.max(m, d[a] || 0), 0);
}

// ---------- Height ----------
// dLayersCount = shooter height − target height (in cube layers). Returns bonuses in percent.
export function heightsEffect(world, dLayersCount, { weapon, shooter, target } = {}) {
  const h = world.height || {}, threshold = h.threshold ?? 5;
  const without = (x, list) => (list || []).some(s => x?.keywords?.[s] != null && x.keywords[s] !== false);
  if (without(weapon, h.withoutWeapon) || without(shooter, h.withoutUnit) || without(target, h.withoutUnit)) return { range: 0, hit: 0 };
  if (dLayersCount >= threshold) return { range: h.rangeDownhill ?? 0, hit: 0 };
  if (dLayersCount <= -threshold) return { range: 0, hit: h.hitUphill ?? 0 };
  return { range: 0, hit: 0 };
}

// ---------- Day and night ----------
export function cycleDuration(world) { return (world.daytime?.phases || []).reduce((a, p) => a + (p.duration || 0), 0); }
// Phase at second s (integer). start = phase the match begins with; zyklus=false holds the starting phase.
export function phaseUm(world, s, { start, cycle = true } = {}) {
  const P = world.daytime?.phases || [], n = cycleDuration(world);
  if (!P.length || n <= 0) return null;
  let i0 = Math.max(0, P.findIndex(p => p.id === (start ?? world.daytime?.lobby?.start)));
  if (!cycle) return { ...P[i0], index: i0, rest: null };
  let t = s % n, i = i0;
  for (let k = 0; k < P.length; k++) { if (t < P[i].duration) return { ...P[i], index: i, rest: P[i].duration - t }; t -= P[i].duration; i = (i + 1) % P.length; }
  return { ...P[i0], index: i0, rest: 0 };
}
// Sichtweite in Prozent: Tageszeit (Nachtsicht ignoriert sie) × Wetter
export function sightPercent(world, phase, weatherId, unit) {
  const nachtsicht = world.daytime?.ignores && unit?.keywords?.[world.daytime.ignores] != null;
  const tag = nachtsicht ? 100 : (phase?.sight ?? 100);
  return Math.floor(tag * (world.weather?.[weatherId]?.sight ?? 100) / 100);
}

// ---------- Wetter ----------
// Own randomness with integers (mulberry32), so every device sees the same sequence.
export function randomWhole(seed) {
  let s = (seed >>> 0) || 1;
  return n => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) % n; };
}
function weighted(r, entries) {
  const sum = entries.reduce((a, [, g]) => a + g, 0);
  if (sum <= 0) return null;
  let x = r(sum);
  for (const [id, g] of entries) { if (x < g) return id; x -= g; }
  return entries[entries.length - 1][0];
}
// Sequence for a match: [{ ab, until, weather, announcement }] in seconds. announcement = from then on it is in the weather report.
export function weatherPlan(world, climateId, seed, duration) {
  const K = world.climates?.[climateId], W = world.weather || {};
  if (!K) return [];
  const possible = Object.entries(K.weather || {}).filter(([id, g]) => W[id] && g > 0);
  if (!possible.length) return [];
  const r = randomWhole(seed), ahead = world.weatherSequence?.announce ?? 60, plan = [];
  let now = W[K.start] ? K.start : weighted(r, possible), t = 0;
  while (t < duration) {
    const [min, max] = W[now].duration || [60, 120];
    const d = Math.max(1, min + r(Math.max(1, max - min + 1)));
    plan.push({ min: t, until: t + d, weather: now, announcement: t === 0 ? null : Math.max(0, t - ahead) });
    t += d;
    const other = possible.filter(([id]) => id !== now);
    now = weighted(r, other.length ? other : possible);
  }
  return plan;
}
export function weatherUm(plan, s) { return plan.find(x => s >= x.min && s < x.until) || plan[plan.length - 1] || null; }

// ---------- Validation ----------
export function validateWorld(p, report, effective) {
  const W = p.data.world;
  if (!W || !Object.keys(W).length) return;
  const S = p.data.keywords || {}, KL = p.data.combat?.classes || {};
  const B = W.movementTypes || {}, BO = W.terrains || {}, WE = W.weather || {};
  const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const sw = (place, s) => { if (s && !S[s]) report('error', place, `unbekanntes Stichwort „${s}“`); };
  // Karten
  const k = W.maps || {}, chunkMm = Math.floor((p.def.voxel || 0.4) * 32000 + 0.5), chunk = chunkMm / 1000;
  for (const [id, g] of Object.entries(k.sizes || {})) {
    const place = `welt größe ${id}`;
    if (!(g.meter > 0)) report('error', place, 'braucht eine Größe in Metern');
    else if (Math.floor(g.meter * 1000 + 0.5) % chunkMm) report('warning', place, `${g.meter} m ist kein Vielfaches der Brocken (${chunk} m)`);
    const [a, b] = g.player || [];
    if (!whole(a, 1, 8) || !whole(b, a || 1, 8)) report('warning', place, 'Spieler von–bis zwischen 1 und 8');
  }
  // Height
  const h = W.height || {};
  if (h.threshold != null && !whole(h.threshold, 1, 100)) report('warning', 'welt höhe', 'Schwelle in ganzen Lagen');
  for (const s of [...(h.withoutWeapon || []), ...(h.withoutUnit || [])]) sw('welt höhe', s);
  // Bewegungsarten
  for (const [id, b] of Object.entries(B)) {
    const place = `welt bewegung ${id}`, [a, x] = String(b.detection || '').split(':');
    if (a === 'class' ? !KL[x] : a === 'keyword' ? !S[x] : true) report('error', place, `Erkennung „${b.detection || ''}“ trifft nichts (klasse:… oder stichwort:…)`);
    if (b.standard != null && !whole(b.standard, 0, 300)) report('warning', place, 'Standard-Tempo 0–300 %');
  }
  // Bodenarten
  for (const [id, bo] of Object.entries(BO)) {
    const place = `welt boden ${id}`;
    for (const [a, v] of Object.entries(bo.speed || {})) { if (!B[a]) report('error', place, `unbekannte Bewegungsart „${a}“`); else if (!whole(v, 0, 300)) report('warning', place, `Tempo ${a}: ganze Zahl 0–300 %`); }
    for (const [a, v] of Object.entries(bo.cover || {})) { if (!B[a]) report('error', place, `Deckung für unbekannte Bewegungsart „${a}“`); else if (!whole(v, 0, 90)) report('warning', place, `Deckung ${a}: ganze Zahl 0–90 %`); }
    if (bo.water && !WATER[bo.water]) report('warning', place, `unbekannte Wassertiefe „${bo.water}“`);
    const ground = Object.entries(B).filter(([, b]) => !b.ignoresGround);
    if (ground.length && ground.every(([a, b]) => (bo.speed?.[a] ?? b.standard ?? 100) === 0)) report('hint', place, 'kein Bodenfahrzeug kommt hier durch');
  }
  // Umwandlungen
  for (const [id, u] of Object.entries(W.transformations || {})) {
    const place = `welt umwandlung ${id}`;
    if (!TRIGGER[u.trigger]) report('error', place, `unbekannter Auslöser „${u.trigger}“`);
    if (!BO[u.to]) report('error', place, `wird zu unbekanntem Boden „${u.to}“`);
    if (!(u.from || []).length) report('warning', place, 'kein Ausgangsboden');
    for (const v of u.from || []) if (!BO[v]) report('error', place, `unbekannter Boden „${v}“`);
    if ((u.from || []).includes(u.to)) report('warning', place, `„${u.to}“ wird zu sich selbst`);
    if (u.trigger === 'weather' && !WE[u.weather]) report('error', place, `unbekanntes Wetter „${u.weather}“`);
    if (u.trigger === 'runOver') { for (const a of u.who || []) if (!B[a]) report('error', place, `unbekannte Bewegungsart „${a}“`); if (!(u.who || []).length) report('warning', place, 'niemand löst sie aus (wer)'); }
    for (const f of ['after', 'back', 'count', 'minDamage']) if (u[f] != null && !whole(u[f], 0, 100000)) report('warning', place, `${f}: ganze Zahl`);
  }
  // Day and night
  const T = W.daytime || {}, ids = new Set();
  for (const ph of T.phases || []) {
    const place = `welt tageszeit ${ph.id || '?'}`;
    if (!ph.id || ids.has(ph.id)) report('error', 'welt tageszeit', `Phase ohne oder mit doppelter ID „${ph.id || ''}“`); ids.add(ph.id);
    if (!whole(ph.duration, 1, 100000)) report('error', place, 'Dauer in ganzen Sekunden');
    if (!whole(ph.sight, 0, 100)) report('warning', place, 'Sicht 0–100 %');
  }
  sw('welt tageszeit', T.ignores);
  if (T.lobby?.start && !ids.has(T.lobby.start)) report('error', 'welt tageszeit', `Startphase „${T.lobby.start}“ gibt es nicht`);
  // Wetter
  for (const [id, x] of Object.entries(WE)) {
    const place = `welt wetter ${id}`;
    if (!whole(x.sight ?? 100, 0, 100)) report('warning', place, 'Sicht 0–100 %');
    if (!whole(x.speed ?? 100, 0, 200)) report('warning', place, 'Tempo 0–200 %');
    for (const a of x.blocks || []) if (!B[a]) report('error', place, `sperrt unbekannte Bewegungsart „${a}“`);
    const [min, max] = x.duration || [];
    if (!whole(min, 1, 100000) || !whole(max, min || 1, 100000)) report('error', place, 'Dauer von–bis in ganzen Sekunden');
  }
  // Klimata
  for (const [id, kl] of Object.entries(W.climates || {})) {
    const place = `welt klima ${id}`, e = Object.entries(kl.weather || {});
    for (const [w, g] of e) { if (!WE[w]) report('error', place, `unbekanntes Wetter „${w}“`); else if (!whole(g, 0, 10000)) report('warning', place, `Gewicht ${w}: ganze Zahl`); }
    if (!e.some(([, g]) => g > 0)) report('error', place, 'mindestens ein Wetter braucht ein Gewicht');
    if (kl.start && !WE[kl.start]) report('error', place, `Startwetter „${kl.start}“ gibt es nicht`);
  }
  // Every unit should be able to move somehow
  if (Object.keys(B).length && effective) for (const [fid, f] of p.factions) {
    const seen = new Set();
    for (const gid of [null, ...Object.keys(f.generals || {})]) for (const [uid, u] of Object.entries(effective(f, gid).units || {})) {
      if (seen.has(uid)) continue; seen.add(uid);
      if (!movementTypes(W, u).length) report('hint', `${gid ? fid + '/' + gid : fid} einheit ${uid}`, 'keine Bewegungsart (Rad, Kette, Schwebt …), fährt sonst nirgends');
    }
  }
}

// ---------- Renaming and deleting with references (workshop and nt) ----------
// art: ground | movement | weather. neu = null deletes the references.
export function renameWorld(W, kind, old, new_) {
  const list = l => Array.isArray(l) ? (new_ ? l.map(x => x === old ? new_ : x) : l.filter(x => x !== old)) : l;
  const invKey = o => { if (!o || !Object.hasOwn(o, old)) return o; const n = {}; for (const [k, v] of Object.entries(o)) { if (k !== old) n[k] = v; else if (new_) n[new_] = v; } return n; };
  const swap = (collection) => { if (!collection || !Object.hasOwn(collection, old)) return; const n = invKey(collection); for (const k of Object.keys(collection)) delete collection[k]; Object.assign(collection, n); };
  if (kind === 'ground') {
    if (new_) swap(W.terrains);
    for (const u of Object.values(W.transformations || {})) { u.from = list(u.from); if (u.to === old) { if (new_) u.to = new_; else delete u.to; } }
  }
  if (kind === 'movement') {
    if (new_) swap(W.movementTypes);
    for (const b of Object.values(W.terrains || {})) { if (b.speed) b.speed = invKey(b.speed); if (b.cover) b.cover = invKey(b.cover); }
    for (const u of Object.values(W.transformations || {})) if (u.who) u.who = list(u.who);
    for (const x of Object.values(W.weather || {})) if (x.blocks) x.blocks = list(x.blocks);
  }
  if (kind === 'weather') {
    if (new_) swap(W.weather);
    for (const u of Object.values(W.transformations || {})) if (u.weather === old) { if (new_) u.weather = new_; else delete u.weather; }
    for (const k of Object.values(W.climates || {})) { k.weather = invKey(k.weather); if (k.start === old) { if (new_) k.start = new_; else delete k.start; } }
  }
}
