// Tests for the behaviour of units without orders (06.11.): target weights, stances, cover, retreat, crushing,
// dodging, determinism, data check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Battle } from '../engine/tactics/battle.js';
import { loadSkirmish } from '../engine/tactics/skirmish.js';
import { behaviorOf, targetParts, targetScore, validateBehavior, renameBehavior, compileStances } from '../engine/tactics/behavior.js';
import { angleOf } from '../engine/tactics/fixed.js';

const read = async (p) => JSON.parse(fs.readFileSync(new URL('../projects/nomadtactics/' + p, import.meta.url), 'utf8'));
const setup = await loadSkirmish(read);
const B = setup.behavior;

// an empty battle (no waves): units are placed by hand
function arena(seed = 1) {
  const b = new Battle(seed, [0, 1], setup);
  b.mode = { waves: [{ units: {} }] };
  b.waveEvery = 1e9;
  b.step();
  return b;
}
const run = (b, n) => { for (let i = 0; i < n; i++) b.step(); };
const C = () => setup.map.size >> 1;
// an open grass spot at the given offset from the middle of the map (Kreuzung: the centre has a plateau)
function grassNear(b, dx, dy) {
  const g = b.map.grounds.indexOf('grass');
  for (let r = 0; r < 60; r++) for (let a = 0; a < 16; a++) {
    const x = C() + dx + (r * 2000 * Math.round(Math.cos(a * 0.39) * 100)) / 100 | 0, y = C() + dy + (r * 2000 * Math.round(Math.sin(a * 0.39) * 100)) / 100 | 0;
    const k = b.cellOf(x, y);
    let ok = b.map.ground[k] === g && !b.map.ramp[k];
    for (let q = -6; q <= 6 && ok; q++) for (let w = -6; w <= 6 && ok; w++) { const c = b.cellOf(x + q * 2000, y + w * 2000); ok = b.map.ground[c] === g && b.map.level[c] === b.map.level[k]; }
    if (ok) return [x, y];
  }
  throw new Error('kein Gras');
}

test('Profile: Einheiten finden ihr Profil, Generäle und Einheiten dürfen ändern', () => {
  const f = setup.faction;
  assert.equal(behaviorOf(B, f.units.kampfpanzer).profile, 'panzer');
  assert.equal(behaviorOf(B, f.units.soldat).profile, 'infanterie');   // fallback by class
  assert.equal(behaviorOf(B, f.units.lenkwerfer).profile, 'artillerie');
  const own = behaviorOf(B, { ...f.units.kampfpanzer, behaviorOver: { weights: { near: 90 }, stance: 'guard' } });
  assert.equal(own.weights.near, 90); assert.equal(own.weights.counter, B.profiles.panzer.weights.counter); assert.equal(own.stance, 'guard');
  assert.equal(behaviorOf(B, f.units.kampfpanzer).stance, B.standardStance);
});

test('Zielwahl: Gewichte entscheiden (Konter gegen Nähe)', () => {
  const near = targetParts({ myFactor: 25, itsFactor: 50, shootsMe: false, hpPct: 100, distance: 2000, reach: 40000, building: false });
  const counter = targetParts({ myFactor: 150, itsFactor: 50, shootsMe: false, hpPct: 100, distance: 30000, reach: 40000, building: false });
  assert.ok(targetScore({ counter: 60, near: 10 }, counter) > targetScore({ counter: 60, near: 10 }, near));
  assert.ok(targetScore({ counter: 5, near: 80 }, near) > targetScore({ counter: 5, near: 80 }, counter));
  const shooting = targetParts({ myFactor: 100, itsFactor: 100, shootsMe: true, hpPct: 100, distance: 10000, reach: 40000 });
  assert.equal(shooting.threat, 100);
  assert.equal(targetParts({ myFactor: 100, itsFactor: 0, shootsMe: false, hpPct: 30, distance: 0, reach: 1, building: true }).finish, 70);
});

test('Zielwahl in der Simulation: Panzer nimmt den Panzer statt der näheren Infanterie', () => {
  const b = arena();
  const [x, y] = grassNear(b, 0, -40000);
  const tank = b.spawn('kampfpanzer', 0, x, y, 64);
  const inf = b.spawn('soldat', 1, x + 7000, y + 2000, 0);
  inf.st = b.stances.ids.indexOf('holdFire');   // otherwise it shoots at the tank and becomes the danger
  const enemyTank = b.spawn('kampfpanzer', 1, x + 17000, y, 128);
  enemyTank.st = b.stances.ids.indexOf('holdFire');
  tank.st = b.stances.ids.indexOf('hold');
  run(b, 20);
  assert.equal(tank.tgt, enemyTank.id);
});

test('Haltungen: Feuer zurückhalten schießt nicht, Stellung halten fährt nicht, Befehl setzt die Haltung', () => {
  const b = arena();
  const [x, y] = grassNear(b, 0, -40000);
  const a = b.spawn('kampfpanzer', 0, x, y, 0), c = b.spawn('kampfpanzer', 0, x, y + 9000, 0);
  b.spawn('spaeher', 1, x + 34000, y + 4000, 128);
  b.command(0, { kind: 'stance', ids: [a.id], stance: 'holdFire' });
  b.command(0, { kind: 'stance', ids: [c.id], stance: 'hold' });
  assert.equal(b.stances.ids[a.st], 'holdFire'); assert.equal(b.stances.ids[c.st], 'hold');
  const cx = c.x, cy = c.y;
  run(b, 60);
  assert.equal(a.tgt, 0, 'hält das Feuer');
  assert.ok(Math.abs(c.x - cx) + Math.abs(c.y - cy) < 2500, 'bleibt stehen');
  b.command(0, { kind: 'stance', ids: [a.id], stance: 'unsinn' });
  assert.equal(b.stances.ids[a.st], 'holdFire', 'unbekannte Haltung wird ignoriert');
});

test('Wachsam kehrt zurück, Aggressiv bleibt dort, wo der Kampf endete', () => {
  for (const [stance, back] of [['guard', true], ['aggressive', false]]) {
    const b = arena();
    const [x, y] = grassNear(b, 0, -40000);
    const u = b.spawn('spaeher', 0, x, y, 0);
    u.st = b.stances.ids.indexOf(stance);
    const e = b.spawn('soldat', 1, x + 30000, y, 0);
    e.st = b.stances.ids.indexOf('holdFire');
    let went = 0;
    for (let i = 0; i < 400; i++) { b.step(); went = Math.max(went, Math.abs(u.x - x)); if (e.hp <= 0 && !b.byId.has(e.id)) break; }
    run(b, 300);
    assert.ok(went > 5000, `${stance}: verfolgt`);
    const home = Math.abs(u.x - x) + Math.abs(u.y - y) < 4500;
    assert.equal(home, back, `${stance}: zurück = ${back} (Abstand ${Math.abs(u.x - x)})`);
  }
});

test('Vorsichtig: unter der Schwelle Rückzug zum Landeplatz, mit Funkmeldung', () => {
  const b = arena();
  const pad = b.units.find((p) => p.seat === 0);
  const [x, y] = grassNear(b, 0, 0);
  const u = b.spawn('kampfpanzer', 0, x, y, 0);
  u.st = b.stances.ids.indexOf('cautious');
  const d0 = Math.abs(u.x - pad.x) + Math.abs(u.y - pad.y);
  u.hp = Math.trunc(b.types.kampfpanzer.hp * 20 / 100);
  b.step();
  assert.equal(u.ret, 1); assert.equal(u.order, 1);
  assert.ok(b.events.some((e) => e.kind === 'retreat' && e.id === u.id));
  run(b, 300);
  assert.ok(Math.abs(u.x - pad.x) + Math.abs(u.y - pad.y) < d0 - 20000, 'näher am Landeplatz');
  // aggressive units fight on
  const v = b.spawn('kampfpanzer', 0, x, y, 0); v.hp = 10; b.step();
  assert.equal(v.ret, 0);
});

test('Deckung: Infanterie läuft im Gefecht in den nahen Wald', () => {
  const b = arena();
  const forest = b.map.grounds.indexOf('forest'), grass = b.map.grounds.indexOf('grass');
  // a grass cell 6 m beside a forest cell
  let spot = null;
  for (let k = 0; k < b.map.n * b.map.n && !spot; k++) {
    if (b.map.ground[k] !== forest) continue;
    const n = b.map.n, i = k % n, j = (k - i) / n;
    if (i + 3 >= n || b.map.ground[k + 3] !== grass || b.map.level[k + 3] !== b.map.level[k]) continue;
    spot = [(i + 3) * b.map.cell + 1000, j * b.map.cell + 1000];
  }
  assert.ok(spot, 'Wald neben Gras');
  const u = b.spawn('soldat', 0, spot[0], spot[1], 0);
  const e = b.spawn('soldat', 1, spot[0] + 13000, spot[1], 128);
  e.st = b.stances.ids.indexOf('holdFire');
  run(b, 120);
  const cover = b.coverPct.infantry[b.map.ground[b.cellOf(u.x, u.y)]];
  assert.ok(cover > 0, 'steht in Deckung');
  assert.equal(u.cv, 1);
});

test('Walzen: Panzer überfährt feindliche Infanterie, die nicht ausweicht; mit Ausweichen springt sie zur Seite', () => {
  for (const dodges of [false, true]) {
    const b = arena();
    b.types.soldat.beh.dodges = dodges ? 1 : 0;
    b.types.soldat.beh.dodgeArtillery = 0;
    const [x, y] = grassNear(b, 0, -40000);
    const tank = b.spawn('kampfpanzer', 0, x, y, 0);
    const s = b.spawn('soldat', 1, x + 16000, y, 0);
    s.st = b.stances.ids.indexOf('holdFire');
    b.types.soldat.beh.seek = 0;
    b.command(0, { kind: 'drive', ids: [tank.id], x: x + 40000, y });
    let crushed = false;
    for (let i = 0; i < 200; i++) { b.step(); if (b.events.some((e) => e.kind === 'dead' && e.id === s.id && e.crushed)) crushed = true; b.events.length = 0; }
    assert.equal(crushed, !dodges, dodges ? 'ausgewichen' : 'überfahren');
  }
});

test('Walzen gezielt: Panzer fährt Infanterie in Reichweite an, statt stehen zu bleiben', () => {
  const b = arena();
  b.types.soldat.beh.dodges = 0; b.types.soldat.beh.dodgeArtillery = 0; b.types.soldat.beh.seek = 0;
  const [x, y] = grassNear(b, 0, -40000);
  const tank = b.spawn('kampfpanzer', 0, x, y, 0);
  const s = b.spawn('soldat', 1, x + 20000, y, 128);
  s.st = b.stances.ids.indexOf('holdFire'); s.hp = 1e9;   // survives the gun, only the tracks get it
  let gone = false;
  for (let i = 0; i < 400 && !gone; i++) { b.step(); gone = !b.byId.has(s.id); }
  assert.ok(gone, 'überfahren');
});

test('Artillerie: Infanterie läuft aus der Einschlagstelle', () => {
  const b = arena();
  const [x, y] = grassNear(b, 0, -40000);
  const u = b.spawn('soldat', 0, x, y, 0);
  u.st = b.stances.ids.indexOf('guard');
  b.projectiles.push({ seat: 1, src: 0, tgt: 0, x, y, t: 30, all: 30, dmg: 5000, dt: 'explosiv', splash: 4000, kind: 3, indirect: 1, fx: x, fy: y });
  run(b, 32);
  const dx = u.x - x, dy = u.y - y;
  assert.ok(dx * dx + dy * dy > 4000 * 4000, 'aus dem Wirkungskreis');
  assert.ok(b.byId.has(u.id), 'überlebt');
});

test('Determinismus: gleiche Partie mit Haltungen, gleiche Prüfsumme', () => {
  const play = () => {
    const b = new Battle(99, [0, 1], setup);
    for (let i = 0; i < 1600; i++) {
      if (i === 30) for (const s of [0, 1]) b.command(s, { kind: 'stance', ids: b.units.filter((u) => u.seat === s).map((u) => u.id), stance: s ? 'cautious' : 'guard' });
      if (i % 300 === 60) for (const s of [0, 1]) b.command(s, { kind: 'drive', ids: b.units.filter((u) => u.seat === s).map((u) => u.id), x: C(), y: C() });
      b.step(); b.events.length = 0;
    }
    return b.sum();
  };
  assert.equal(play(), play());
});

test('Prüfung und Umbenennen', () => {
  const p = { data: { behavior: structuredClone(B) }, factions: new Map([['usa', structuredClone(setup.faction)]]) };
  const msgs = []; const report = (kind, place, text) => msgs.push({ kind, place, text });
  validateBehavior(p, report);
  assert.deepEqual(msgs.filter((m) => m.kind === 'error'), []);
  p.factions.get('usa').units.soldat.behavior = 'gibtsnicht';
  p.data.behavior.profiles.panzer.stance = 'auch_nicht';
  validateBehavior(p, report);
  assert.equal(msgs.filter((m) => m.kind === 'error').length, 2);
  renameBehavior(p, 'profile', 'panzer', 'schwer');
  assert.ok(p.data.behavior.profiles.schwer); assert.equal(p.factions.get('usa').units.kampfpanzer.behavior, 'schwer');
  renameBehavior(p, 'stance', 'aggressive', 'wild');
  assert.equal(p.data.behavior.standardStance, 'wild');
  assert.deepEqual(compileStances(p.data.behavior).ids.includes('wild'), true);
  void angleOf;
});
