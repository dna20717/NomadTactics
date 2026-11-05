// Tests for the battle simulation (milestone 1): integer maths, map, flowfield, determinism, end of the match.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { angleOf, sin, cos } from '../engine/tactics/fixed.js';
import { Battle } from '../engine/tactics/battle.js';
import { loadSkirmish, battleRun } from '../engine/tactics/skirmish.js';
import { FAR } from '../engine/tactics/flowfield.js';

const setup = await loadSkirmish(async (p) => JSON.parse(fs.readFileSync(new URL('../projects/nomadtactics/' + p, import.meta.url), 'utf8')));

test('Winkel: angleOf passt zu sin/cos', () => {
  for (let a = 0; a < 256; a++) {
    const b = angleOf(cos(a) * 100, sin(a) * 100);
    const d = Math.abs(((b - a + 384) % 256) - 128);
    assert.ok(d <= 1, `Winkel ${a} → ${b}`);
  }
});

test('Karte Kreuzung: vierfach gedreht, Startplätze gegenüber', () => {
  const m = setup.map;
  assert.equal(m.n, 128);
  for (let j = 0; j < m.n; j++) for (let i = 0; i < m.n; i++) {
    const k = j * m.n + i, r = i * m.n + (m.n - 1 - j);
    assert.equal(m.ground[k], m.ground[r]); assert.equal(m.level[k], m.level[r]);
  }
  const [a, b] = m.slots;
  assert.equal(a[0] + b[0], m.size); assert.equal(a[1] + b[1], m.size);
});

test('Flowfield: vom Landeplatz ist die Mitte für alle Bewegungsarten erreichbar', () => {
  const b = new Battle(1, [0, 1], setup);
  const pad = b.units[0];
  const centre = b.cellOf(b.map.size >> 1, b.map.size >> 1);
  for (const mv of ['infantry', 'wheel', 'track']) {
    const f = b.flow.field(mv, centre);
    assert.ok(f.dist[b.cellOf(pad.x + 12000, pad.y + 12000)] < FAR, mv);
  }
});

test('Gefecht: gleich gerechnet, nur Ganzzahlen, Welle kommt', () => {
  assert.equal(battleRun(setup, 1500), battleRun(setup, 1500));
  const b = new Battle(9, [0, 1], setup);
  b.step();
  assert.ok(b.units.filter((u) => u.seat === 0).length > 5, 'erste Welle gelandet');
  for (let i = 0; i < 400; i++) {
    if (i === 5) for (const s of [0, 1]) b.command(s, { kind: 'drive', ids: b.units.filter((u) => u.seat === s).map((u) => u.id), x: 128000, y: 128000 });
    b.step();
  }
  for (const u of b.units) for (const k of ['x', 'y', 'h', 'hp', 'gx', 'gy']) assert.ok(Number.isInteger(u[k]), k);
  assert.ok(b.units.some((u) => u.order === 1 || Math.abs(u.x - u.ax) > 1000), 'Einheiten fahren');
});

test('Gefecht: unsinnige Befehle ändern nichts', () => {
  const a = new Battle(3, [0, 1], setup), b = new Battle(3, [0, 1], setup);
  a.step(); b.step();
  const enemy = a.units.find((u) => u.seat === 1).id;
  for (const x of [null, 5, { kind: 'drive' }, { kind: 'drive', ids: [enemy], x: 1000, y: 1000 }, { kind: 'drive', ids: [2], x: -5, y: 9e9 }, { kind: 'attack', ids: [2], target: 2 }, { kind: 'boom', ids: [2] }])
    a.command(0, x);
  a.command(7, { kind: 'drive', ids: [2], x: 1000, y: 1000 });
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.equal(a.sum(), b.sum());
});

test('Gefecht: wer keine Einheiten und keinen Landeplatz mehr hat, verliert', () => {
  const b = new Battle(5, [0, 1], setup);
  b.step();
  for (const u of b.units) if (u.seat === 1) u.hp = 0;
  b.step();
  assert.deepEqual(b.over, { winner: 0, tick: 2 });
  assert.ok(b.events.some((e) => e.kind === 'over'));
});

test('Allein: Übungsgegner mit eigenem Landeplatz, nimmt keine Befehle an, Sieg möglich', async () => {
  const { PRACTICE_SEAT } = await import('../engine/tactics/battle.js');
  const b = new Battle(11, [0], setup);
  assert.deepEqual(b.seats, [0, PRACTICE_SEAT]);
  b.step();
  const bot = b.units.filter((u) => u.seat === PRACTICE_SEAT);
  assert.ok(bot.length > 5, 'Übungsgegner hat eine Welle');
  const before = b.sum();
  b.command(PRACTICE_SEAT, { kind: 'drive', ids: bot.map((u) => u.id), x: 1000, y: 1000 });
  assert.equal(b.sum(), before, 'Befehle für den Übungsgegner werden ignoriert');
  for (const u of bot) u.hp = 0;
  b.step();
  assert.equal(b.over?.winner, 0);
});
