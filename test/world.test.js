// NomadTactics – world: terrain, movement, height, day and night, weather, validation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeLoader } from '../tools/loader.js';
import { loadTactics, validateTactics, movementTypes, speedOnto, coverOnto, heightsEffect, phaseUm, sightPercent, cycleDuration, weatherPlan, weatherUm } from '../engine/tactics/index.js';

const load = () => loadTactics(nodeLoader(new URL('../projects/nomadtactics', import.meta.url).pathname));

test('Bewegungsarten kommen aus Klasse und Stichwörtern', async () => {
  const p = await load(), W = p.data.world;
  assert.deepEqual(movementTypes(W, p.factions.get('usa').units.soldat), ['infantry']);
  assert.deepEqual(movementTypes(W, p.factions.get('usa').units.spaeher), ['wheel']);
  assert.deepEqual(movementTypes(W, p.factions.get('china').units.zbl08), ['wheel', 'schwimmt']);
});

test('Tempo je Boden: Tabelle, beste Bewegungsart, Wetter', async () => {
  const W = (await load()).data.world;
  assert.equal(speedOnto(W, ['wheel'], 'strasse'), 130);
  assert.equal(speedOnto(W, ['wheel'], 'forest'), 0);
  assert.equal(speedOnto(W, ['track'], 'tiefwasser'), 0);
  assert.equal(speedOnto(W, ['track', 'schwimmt'], 'tiefwasser'), 60);
  assert.equal(speedOnto(W, ['schwimmt'], 'grass'), 0, 'reine Schwimmer bleiben im Wasser');
  assert.equal(speedOnto(W, ['track'], 'schlamm', 'snow'), 68);
  assert.equal(speedOnto(W, ['hovers'], 'forest'), 100, 'Flieger ignorieren den Boden');
  assert.equal(speedOnto(W, ['hovers'], 'forest', 'storm'), 0, 'Sturm holt Hubschrauber runter');
  assert.equal(speedOnto(W, ['jet'], 'forest', 'storm'), 100);
  assert.equal(coverOnto(W, ['infantry'], 'forest'), 30);
  assert.equal(coverOnto(W, ['track'], 'forest'), 0);
});

test('Höhenvorteil: bergab weiter, bergauf schlechter, Indirekt und Flieger ausgenommen', async () => {
  const W = (await load()).data.world;
  assert.deepEqual(heightsEffect(W, 5), { range: 20, hit: 0 });
  assert.deepEqual(heightsEffect(W, -5), { range: 0, hit: -25 });
  assert.deepEqual(heightsEffect(W, 4), { range: 0, hit: 0 });
  assert.deepEqual(heightsEffect(W, 9, { weapon: { keywords: { indirekt: true } } }), { range: 0, hit: 0 });
  assert.deepEqual(heightsEffect(W, -9, { target: { keywords: { flies: true } } }), { range: 0, hit: 0 });
});

test('Tag und Nacht: 12 Minuten, Phasen, Nachtsicht', async () => {
  const W = (await load()).data.world;
  assert.equal(cycleDuration(W), 720);
  assert.deepEqual([0, 299, 300, 360, 659, 660, 719, 720].map(s => phaseUm(W, s).id), ['tag', 'tag', 'dusk', 'night', 'night', 'dawn', 'dawn', 'tag']);
  assert.equal(phaseUm(W, 0, { start: 'night' }).id, 'night');
  assert.equal(phaseUm(W, 400, { start: 'night', cycle: false }).id, 'night');
  const night = phaseUm(W, 400);
  assert.equal(sightPercent(W, night, 'clear', { keywords: {} }), 50);
  assert.equal(sightPercent(W, night, 'clear', { keywords: { nachtsicht: true } }), 100);
  assert.equal(sightPercent(W, night, 'fog', {}), 20);
});

test('Wetter: gleicher Startwert, gleicher Ablauf; Klima bestimmt die Auswahl', async () => {
  const W = (await load()).data.world;
  const a = weatherPlan(W, 'gemaessigt', 42, 1800), b = weatherPlan(W, 'gemaessigt', 42, 1800), c = weatherPlan(W, 'gemaessigt', 43, 1800);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a[0].min, 0); assert.equal(a[0].weather, 'clear'); assert.equal(a[0].announcement, null);
  for (let i = 1; i < a.length; i++) { assert.equal(a[i].min, a[i - 1].until); assert.notEqual(a[i].weather, a[i - 1].weather); assert.equal(a[i].announcement, a[i].min - 60); }
  for (const x of a) assert.ok(Number.isInteger(x.min) && Number.isInteger(x.until));
  assert.ok(a[a.length - 1].until >= 1800);
  const wueste = new Set(Array.from({ length: 20 }, (_, i) => weatherPlan(W, 'wueste', i + 1, 3600)).flat().map(x => x.weather));
  assert.ok(!wueste.has('snow') && !wueste.has('fog'));
  assert.equal(weatherUm(a, 0).weather, 'clear');
});

test('Prüfung findet Fehler in den Welt-Daten', async () => {
  const p = await load();
  assert.equal(validateTactics(p).filter(m => m.kind === 'error').length, 0);
  const W = p.data.world;
  W.terrains.grass.speed.tankTrack = 50;
  W.transformations.regen_schlamm.weather = 'hail';
  W.climates.wueste.weather = { sandstorm: 10 };
  W.daytime.lobby.start = 'noon';
  W.maps.sizes.s.meter = 250;
  const m = validateTactics(p), text = m.map(x => x.text).join(' | ');
  for (const t of ['tankTrack', 'hail', 'sandstorm', 'noon']) assert.match(text, new RegExp(t));
  assert.ok(m.some(x => x.place === 'welt größe s' && x.kind === 'warning'));
});

test('Umbenennen und Löschen ziehen Verweise mit', async () => {
  const { renameWorld } = await import('../engine/tactics/index.js');
  const p = await load(), W = p.data.world;
  renameWorld(W, 'ground', 'schlamm', 'matsch');
  assert.equal(W.transformations.regen_schlamm.to, 'matsch'); assert.ok(W.terrains.matsch && !W.terrains.schlamm);
  renameWorld(W, 'movement', 'track', 'raupe');
  assert.equal(W.terrains.forest.speed.raupe, 60); assert.deepEqual(W.transformations.wald_schneise.who, ['raupe']);
  renameWorld(W, 'weather', 'rain', 'niesel');
  assert.equal(W.transformations.regen_schlamm.weather, 'niesel'); assert.equal(W.climates.gemaessigt.weather.niesel, 20);
  delete W.weather.storm; renameWorld(W, 'weather', 'storm', null);
  assert.ok(!('storm' in W.climates.winter.weather));
  assert.equal(validateTactics(p).filter(m => m.kind === 'error' && m.place.startsWith('world')).length, 0);
});
