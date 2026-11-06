// Liveliness profiles (data/life.json): resolving, damage stages, check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loadTactics, validateTactics, lifeOf, stageAt, renameLife, LIFE_NONE } from '../engine/tactics/index.js';
import { damagedModel, muzzleOf, recoilCurve, spring } from '../game/party/unit_life.js';

const root = path.resolve('projects/nomadtactics');
const loader = { json: async (d) => JSON.parse(fs.readFileSync(path.join(root, d), 'utf8')) };

test('Modell nimmt sein Profil, lifeOver überschreibt, ohne Profil steht es still', async () => {
  const p = await loadTactics(loader);
  const tank = lifeOf(p.data.life, p.data.models.abrams);
  assert.equal(tank.id, 'tracked'); assert.equal(tank.drive, 'track'); assert.ok(tank.stages.length >= 2);
  const over = lifeOf(p.data.life, { life: 'tracked', lifeOver: { kick: 9 } });
  assert.equal(over.kick, 9); assert.equal(over.spring, tank.spring);
  const none = lifeOf(p.data.life, { name: 'x' });
  assert.equal(none.id, null); assert.equal(none.drive, LIFE_NONE.drive);
  assert.equal(lifeOf(p.data.life, null, 'building').id, 'building');
});

test('Schadensstufe nach Leben', () => {
  const prof = lifeOf({ profiles: { a: { stages: [{ below: 20 }, { below: 70 }, { below: 45 }] } } }, { life: 'a' });
  assert.deepEqual(prof.stages.map((s) => s.below), [70, 45, 20]);
  assert.equal(stageAt(prof, 1), 0); assert.equal(stageAt(prof, 0.69), 1); assert.equal(stageAt(prof, 0.3), 2); assert.equal(stageAt(prof, 0.05), 3);
});

test('Prüfung meldet falsche Werte und Verweise', async () => {
  const p = await loadTactics(loader);
  assert.equal(validateTactics(p).filter((m) => m.kind === 'error').length, 0);
  p.data.life.profiles.tracked.kick = 99;
  p.data.models.abrams.life = 'gibtsnicht';
  p.data.models.himars.scale = 7;
  const e = validateTactics(p).filter((m) => m.kind === 'error').map((m) => m.text).join(' | ');
  assert.match(e, /Rückstoß Rumpf/); assert.match(e, /gibtsnicht/); assert.match(e, /Voxel-Größe/);
});

test('Umbenennen zieht die Modelle mit, Löschen räumt auf', async () => {
  const p = await loadTactics(loader);
  renameLife(p, 'tracked', 'kette');
  assert.equal(p.data.models.abrams.life, 'kette');
  renameLife(p, 'kette', null);
  assert.equal(p.data.models.abrams.life, undefined);
});

test('Beschädigte Modelle verlieren Würfel, schwerere Stufen mehr, der Boden bleibt', () => {
  const W = new Map();
  for (let x = -3; x <= 3; x++) for (let y = 0; y <= 4; y++) for (let z = -5; z <= 5; z++) W.set(`${x},${y},${z}`, y === 0 ? 'track' : 'oliv');
  const a = damagedModel(W, { missing: 5 }), b = damagedModel(W, { missing: 20 });
  assert.ok(a.size < W.size && b.size < a.size);
  for (const k of a.keys()) if (!b.has(k)) continue; else assert.ok(W.has(k));
  for (const k of W.keys()) if (k.split(',')[1] === '0') assert.ok(b.has(k), 'unterste Lage bleibt');
  for (const k of W.keys()) if (!a.has(k)) assert.ok(!b.has(k), 'schwerere Stufe nimmt mindestens dasselbe weg');
  assert.deepEqual(muzzleOf(W, 0.5), [-1.5, 2.25, 2.75]);
});

test('Rückstoß und Feder kommen zur Ruhe', () => {
  assert.equal(recoilCurve(0, 400), 0); assert.ok(recoilCurve(55, 400) > 0.8); assert.equal(recoilCurve(500, 400), 0);
  const s = { a: 0 };
  for (let i = 0; i < 200; i++) spring(s, 'a', 1, 0.1, 30, 0.5);
  assert.ok(Math.abs(s.a - 1) < 1e-3, 'stabil auch bei großen Zeitschritten');
});

test('Fahrzeug-Baukasten: Listen stimmen, jedes Modell baut, Räder und Türme sitzen', async () => {
  const { KIT_TYPES, PAINTS, buildKit } = await import('../game/tactics/voxel/kit.js');
  const { KIT_TYPE_IDS, PAINT_IDS, FOOTPRINT_IDS } = await import('../engine/tactics/life.js');
  const { FOOTPRINTS } = await import('../engine/tactics/battle.js');
  assert.deepEqual(Object.keys(KIT_TYPES).sort(), [...KIT_TYPE_IDS].sort());
  assert.deepEqual(Object.keys(PAINTS).sort(), [...PAINT_IDS].sort());
  assert.deepEqual([...FOOTPRINTS].sort(), [...FOOTPRINT_IDS].sort());
  const models = JSON.parse(fs.readFileSync(path.join(root, 'data/models.json'), 'utf8'));
  const kits = Object.entries(models).filter(([, m]) => m.source?.startsWith('kit:'));
  assert.ok(kits.length >= 80);
  for (const [id, m] of kits) {
    const k = buildKit(m.source.slice(4), m.kit, m.paint);
    const soldier = m.source === 'kit:soldier';
    const type = m.source.slice(4), small = soldier || type === 'uav' || type === 'building';
    assert.ok(k.hull.size > (small ? 60 : 500), id);
    if (type === 'heli') assert.ok(k.rotors.length >= 2, `${id}: Rotoren`);
    if (soldier) { assert.equal(k.legs?.at.length, 2, `${id}: Beine`); assert.equal(k.scale, 0.1); }
    for (const kind of k.hull.values()) assert.ok(!['c', 'c1', 'hd', 'acc'].includes(kind), `${id}: unbemalter Würfel`);
    if (k.turret) assert.ok(k.pivot, id);
    if (KIT_TYPES[m.source.slice(4)].life === 'wheeled') assert.ok(k.wheels?.at.length >= 4, `${id}: Räder`);
    assert.equal(m.footprint, KIT_TYPES[m.source.slice(4)].footprint, id);
  }
});
