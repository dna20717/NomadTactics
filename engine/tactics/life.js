// NomadTactics – liveliness (Daniel, 06.11.: „Einheiten mit Leben … so systemisch wie möglich, für alle zukünftigen
// Einheiten und Gebäude“). Pure optics: the simulation never reads this. data/life.json holds profiles;
// a model (data/models.json) picks one with `life` and may override single fields with `lifeOver`.
// Every unit or building whose model has a profile moves, fires, raises dust and shows damage by it.
//
// Profile: { name, description?, drive, tilt, pitch, roll, spring, damping, bob, kick, barrel, recover, flash, smoke,
//            casings, dust, dustSize, exhaust, stages: [{ below, missing, soot, smoke, fire }] }
// Terrain (data/world.json › terrains): dust (%), dustColor? → how much dust a ground raises and in which colour.

export const DRIVES = { track: 'Ketten', wheel: 'Räder', walk: 'Zu Fuß', hover: 'Schwebt', none: 'Steht' };

// [field, label, min, max, step, unit, help] – the workshop builds its fields from this list, the check uses it too
export const LIFE_GROUPS = [
  { id: 'motion', name: 'Bewegung', icon: 'vehicle', fields: [
    ['tilt', 'Gelände folgen', 0, 100, 5, '%', 'Wie stark der Rumpf sich an Hänge und Rampen anlegt.'],
    ['pitch', 'Nicken', 0, 12, 0.5, '°', 'Nase hebt sich beim Anfahren und taucht beim Bremsen.'],
    ['roll', 'Neigen in Kurven', 0, 12, 0.5, '°', 'Rumpf legt sich in schnellen Kurven nach außen.'],
    ['spring', 'Federhärte', 2, 30, 1, '', 'Hoch = straff (Kette), niedrig = weich und schaukelnd (Rad).'],
    ['damping', 'Dämpfung', 10, 150, 5, '%', '100 = schwingt nicht nach, darunter wippt es nach.'],
    ['bob', 'Wippen', 0, 30, 1, 'cm', 'Schritt-Wippen (zu Fuß) bzw. Motorzittern im Stand.'],
  ] },
  { id: 'fire', name: 'Feuern', icon: 'weapon', fields: [
    ['kick', 'Rückstoß Rumpf', 0, 10, 0.5, '°', 'Der ganze Rumpf schaukelt beim Schuss zurück.'],
    ['barrel', 'Rohrrücklauf', 0, 100, 5, 'cm', 'Turm/Rohr fährt beim Schuss zurück und wieder vor.'],
    ['recover', 'Erholung', 80, 2000, 20, 'ms', 'Zeit, bis Rohr und Rumpf wieder ruhig sind.'],
    ['flash', 'Mündungsfeuer', 0, 300, 10, '%', 'Größe des Feuerballs an der Mündung.'],
    ['smoke', 'Mündungsrauch', 0, 10, 1, '', 'Rauchwölkchen je Schuss.'],
    ['casings', 'Hülsen', 0, 6, 1, '', 'Ausgeworfene Hülsen je Schuss (MG, Gewehr).'],
  ] },
  { id: 'dust', name: 'Staub & Abgas', icon: 'wind', fields: [
    ['dust', 'Staubfahne', 0, 300, 10, '%', 'Wie viel Staub die Bewegung aufwirbelt (mal Boden: Sand viel, Straße kaum).'],
    ['dustSize', 'Wolkengröße', 0.2, 4, 0.1, 'm', ''],
    ['exhaust', 'Abgas', 0, 300, 10, '%', 'Auspuffrauch, stärker beim Anfahren.'],
  ] },
];
export const STAGE_FIELDS = [
  ['below', 'unter Leben', 1, 99, 1, '%'],
  ['missing', 'Würfel fehlen', 0, 40, 1, '%'],
  ['soot', 'Ruß', 0, 100, 5, '%'],
  ['smoke', 'Rauch', 0, 10, 1, '/s'],
  ['fire', 'Feuer', 0, 10, 1, '/s'],
];
export const LIFE_FIELDS = Object.fromEntries(LIFE_GROUPS.flatMap((g) => g.fields.map((f) => [f[0], f])));

// A model without a profile stands still like before (all zero)
export const LIFE_NONE = { drive: 'none', tilt: 0, pitch: 0, roll: 0, spring: 10, damping: 100, bob: 0, kick: 0, barrel: 0, recover: 300,
  flash: 100, smoke: 0, casings: 0, dust: 0, dustSize: 1, exhaust: 0, stages: [] };

// Vehicle kit (game/tactics/voxel/kit.js, test/life.test.js keeps these lists equal): body types, paint schemes,
// size classes of the simulation (engine/tactics/battle.js › FOOTPRINTS)
export const KIT_TYPE_IDS = ['soldier', 'mbt', 'spg', 'mlrs', 'dozer', 'apc', 'car', 'truck'];
export const PAINT_IDS = ['usa', 'china', 'ukraine', 'europa', 'site', 'usa_u', 'china_u', 'ukraine_u', 'europa_u'];
export const KIT_SOLDIER = 'soldier';
export const FOOTPRINT_IDS = ['tank', 'werfer', 'spaeher', 'dozer', 'soldat'];

export function emptyLife() { return { profiles: {} }; }

// Resolved profile for a model entry (models.json): profile + lifeOver, missing fields from LIFE_NONE,
// stages sorted from light to heavy damage (highest `below` first)
export function lifeOf(life, model, fallback = null) {
  const id = model?.life || fallback;
  const base = (id && life?.profiles?.[id]) || null;
  const r = { ...LIFE_NONE, ...(base || {}), ...(model?.lifeOver || {}), id: base ? id : null };
  r.stages = [...(r.stages || [])].sort((a, b) => (b.below ?? 0) - (a.below ?? 0));
  return r;
}

// Index of the damage stage for a health share 0…1 (0 = undamaged, 1 = first stage …)
export function stageAt(prof, share) {
  let n = 0;
  for (const s of prof.stages) if (share * 100 < (s.below ?? 0)) n++; else break;
  return n;
}

export function validateLife(p, report) {
  const L = p.data.life; if (!L) return;
  const place = p.paths.life || 'life';
  for (const [id, x] of Object.entries(L.profiles || {})) {
    const at = `${place} profil ${id}`;
    if (!x.name) report('warning', at, 'ohne Namen');
    if (x.drive && !DRIVES[x.drive]) report('error', at, `Antrieb „${x.drive}“ gibt es nicht (${Object.keys(DRIVES).join(', ')})`);
    for (const [k, v] of Object.entries(x)) {
      const f = LIFE_FIELDS[k];
      if (!f) { if (!['name', 'description', 'drive', 'stages'].includes(k)) report('warning', at, `unbekanntes Feld „${k}“`); continue; }
      if (typeof v !== 'number' || v < f[2] || v > f[3]) report('error', at, `${f[1]}: ${v} liegt nicht zwischen ${f[2]} und ${f[3]}`);
    }
    let last = 101;
    for (const [i, s] of (x.stages || []).entries()) {
      for (const f of STAGE_FIELDS) { const v = s[f[0]]; if (v != null && (typeof v !== 'number' || v < f[2] || v > f[3])) report('error', `${at} stufe ${i + 1}`, `${f[1]}: ${v} liegt nicht zwischen ${f[2]} und ${f[3]}`); }
      if ((s.below ?? 0) >= last) report('warning', `${at} stufe ${i + 1}`, 'Schadensstufen sollten von leicht (hoher Wert) nach schwer (kleiner Wert) sortiert sein');
      last = s.below ?? 0;
    }
  }
  for (const [id, m] of Object.entries(p.data.models || {})) {
    if (m.life && !L.profiles?.[m.life]) report('error', `models ${id}`, `Lebendigkeit „${m.life}“ gibt es nicht`);
    if (m.scale != null && !(typeof m.scale === 'number' && m.scale >= 0.05 && m.scale <= 2)) report('error', `models ${id}`, `Voxel-Größe ${m.scale} m liegt nicht zwischen 0,05 und 2`);
    if (m.source?.startsWith('kit:') && !KIT_TYPE_IDS.includes(m.source.slice(4))) report('error', `models ${id}`, `Bauform „${m.source.slice(4)}“ gibt es nicht (${KIT_TYPE_IDS.join(', ')})`);
    if (m.paint && !PAINT_IDS.includes(m.paint)) report('error', `models ${id}`, `Bemalung „${m.paint}“ gibt es nicht (${PAINT_IDS.join(', ')})`);
    if (m.footprint && !FOOTPRINT_IDS.includes(m.footprint)) report('error', `models ${id}`, `Größenklasse „${m.footprint}“ gibt es nicht (${FOOTPRINT_IDS.join(', ')})`);
    for (const k of Object.keys(m.lifeOver || {})) if (!LIFE_FIELDS[k] && k !== 'drive' && k !== 'stages') report('warning', `models ${id}`, `lifeOver: unbekanntes Feld „${k}“`);
  }
  for (const [id, t] of Object.entries(p.data.world?.terrains || {})) {
    if (t.dust != null && !(typeof t.dust === 'number' && t.dust >= 0 && t.dust <= 300)) report('error', `world boden ${id}`, `Staub ${t.dust} liegt nicht zwischen 0 und 300`);
  }
}

// Renames a profile everywhere (null deletes the references)
export function renameLife(p, old, neu) {
  for (const m of Object.values(p.data.models || {})) if (m.life === old) { if (neu) m.life = neu; else delete m.life; }
}
