// Tests for the party server core: room (lobby + lockstep relay), lockstep client, sample game.
// All without network and with a fake clock, so it is fast and reproducible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from '../engine/net/room.js';
import { Lockstep } from '../engine/net/lockstep.js';
import { PROTOCOL, ROUND_MS, NEXT_TO_MS, DEAD_AFTER_MS, HOLD_MIN, REASON, BLUE, COLORS, isBlue } from '../engine/net/protocol.js';
import { Probe, newProbe, probeRun, root, WIDTH } from '../engine/tactics/probe.js';

function world({ max = 4 } = {}) {
  let time = 1000;
  let z = 1;
  const room = new Room({ maxPlayer: max, now: () => time, random: () => ((z = (z * 48271) % 2147483647) / 2147483647) });
  const player = [];
  const w = {
    room,
    time: () => time,
    // Let time run, calling tick() every 20 ms like the real server
    run(ms) { const end = time + ms; while (time < end) { time = Math.min(end, time + 20); room.tick(); for (const s of player) s.compute(); } },
    new(name, { token = null } = {}) {
      const s = { name, eingang: [], token, seat: null, online: false, vid: null };
      s.ls = new Lockstep(newProbe, { reportSync: (round, sum) => s.send({ t: 'sync', round, sum: s.wrong ? 'broken' : sum }) });
      s.connect = () => {
        s.vid = room.connect((m) => {
          s.eingang.push(m);
          if (m.t === 'welcome') { s.token = m.token; s.seat = m.seat; }
          if (m.t === 'match') s.ls.match(m);
          if (m.t === 'round') s.ls.round(m);
          if (m.t === 'state') s.state = m;
        });
        s.online = true;
        s.send({ t: 'hello', protocol: PROTOCOL, name, token: s.token });
        return s;
      };
      s.send = (m) => { if (s.online) room.msg(s.vid, m); };
      s.disconnect = () => { room.disconnect(s.vid); s.online = false; };
      s.muted = false;
      s.compute = () => { if (!s.muted && s.online) s.ls.progress(); if (s.online && !s.muted && time % 1000 < 20) s.send({ t: 'ping', z: time }); };
      s.last = (t) => [...s.eingang].reverse().find((m) => m.t === t);
      player.push(s);
      return s;
    },
  };
  return w;
}

test('Ganzzahl-Wurzel ist exakt', () => {
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, 2 ** 31, 2304000000 + 729000000]) {
    const r = root(n);
    assert.ok(r * r <= n && (r + 1) * (r + 1) > n, `wurzel(${n}) = ${r}`);
  }
});

test('Probe-Spiel ist deterministisch und reagiert auf Befehle', () => {
  assert.equal(probeRun(5000), probeRun(5000));
  const a = new Probe(42, [0, 1]), b = new Probe(42, [0, 1]);
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  assert.equal(a.sum(), b.sum());
  a.command(0, { kind: 'target', ids: [0, 1, 2], x: 20000, y: 10000 });
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  assert.notEqual(a.sum(), b.sum());
  // Nonsense is ignored, foreign units don't obey
  const c = new Probe(42, [0, 1]), d = new Probe(42, [0, 1]);
  c.command(0, { kind: 'target', ids: [6, 7], x: 100, y: 100 });   // belong to player 1
  c.command(0, { kind: 'target', ids: 'broken', x: 1, y: 1 });
  c.command(0, { kind: 'target', ids: [0], x: WIDTH + 5, y: 1 }); // outside
  c.command(0, null);
  for (let i = 0; i < 100; i++) { c.step(); d.step(); }
  assert.equal(c.sum(), d.sum());
  // all coordinates remain integers
  for (const e of c.units) for (const k of ['x', 'y', 'zx', 'zy']) assert.ok(Number.isInteger(e[k]));
});

test('Simulation benutzt keine engine-abhängige Mathematik', () => {
  for (const file of ['engine/tactics/probe.js', 'engine/net/lockstep.js', 'engine/tactics/world.js', 'engine/tactics/fixed.js', 'engine/tactics/map.js', 'engine/tactics/flowfield.js', 'engine/tactics/battle.js']) {
    const code = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    const forbidden = code.match(/Math\.(?!imul\b|floor\b|trunc\b|abs\b|min\b|max\b|sign\b)\w+|Date\.|performance\.|new Date/g);
    assert.equal(forbidden, null, `${file}: ${forbidden}`);
  }
});

test('Zwei Spieler: Lobby, Start, Befehle, gleiche Prüfsummen', () => {
  const w = world();
  const a = w.new('Daniel').connect();
  const b = w.new('Ava').connect();
  assert.equal(a.seat, 0); assert.equal(b.seat, 1);
  assert.equal(a.state.player.length, 2);
  a.send({ t: 'start' });
  assert.ok(a.last('match') && b.last('match'));
  w.run(NEXT_TO_MS - 100);
  assert.equal(w.room.match.rounds.length, 0, 'Countdown vor dem Start');
  w.run(1000);
  const n = w.room.match.rounds.length;
  assert.ok(n >= 9 && n <= 12, `Runden nach 1 s: ${n}`);
  a.send({ t: 'command', b: { kind: 'target', ids: [0, 1], x: 30000, y: 20000 } });
  b.send({ t: 'command', b: { kind: 'target', ids: [6], x: 3000, y: 2000 } });
  w.run(9000);
  assert.equal(a.ls.done, b.ls.done);
  assert.equal(a.ls.sim.sum(), b.ls.sim.sum());
  assert.equal(w.room.pause, null);
  // the commands really arrived
  assert.ok(a.ls.sim.units[0].x > 20000);
});

test('Allein starten geht (Übungsgegner kommt aus dem Spiel)', () => {
  const w = world();
  const a = w.new('A').connect();
  a.send({ t: 'start' });
  assert.equal(w.room.phase, 'running');
  assert.deepEqual(a.last('match').seats, [0]);
});

test('Voller Raum macht Zuschauer, falsche Version fliegt raus', () => {
  const w = world({ max: 2 });
  const a = w.new('A').connect();
  w.new('B').connect();
  const c = w.new('C').connect();
  assert.equal(c.last('welcome').spectator, true);
  assert.equal(c.seat, null);
  assert.deepEqual(c.state.spectator, [{ name: 'C' }]);
  const old = w.new('Alt');
  old.vid = w.room.connect((m) => old.eingang.push(m)); old.online = true;
  old.send({ t: 'hello', protocol: PROTOCOL + 99, name: 'Alt' });
  assert.equal(old.last('rejected').reason, 'version');
  a.send({ t: 'start' });
  const d = w.new('D').connect();
  assert.equal(d.last('welcome').spectator, true);
  assert.ok(d.last('match'), 'Zuschauer bekommt die Partie');
});

test('Verbindung reißt ab: Pause, Wiederverbinden mit Token, Nachrechnen, weiter', () => {
  const w = world();
  const a = w.new('Daniel').connect();
  const b = w.new('iPad').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 3000);
  a.send({ t: 'command', b: { kind: 'target', ids: [0], x: 40000, y: 20000 } });
  w.run(500);
  const before = w.room.match.rounds.length;
  b.disconnect();
  assert.equal(w.room.pause.reason, REASON.disconnected);
  w.run(3000);
  assert.equal(w.room.match.rounds.length, before, 'keine Runden während der Pause');
  assert.ok(a.state.pause, 'A sieht die Pause');
  // iPad comes back with a new sim (page reloaded): same token
  const b2 = w.new('iPad', { token: b.token }).connect();
  assert.equal(b2.seat, 1);
  assert.equal(w.room.pause, null);
  assert.ok(b2.last('match').rounds.length === before);
  w.run(NEXT_TO_MS + 4000);
  assert.ok(w.room.match.rounds.length > before + 30);
  assert.equal(a.ls.done, b2.ls.done);
  assert.equal(a.ls.sim.sum(), b2.ls.sim.sum());
});

test('Stille Verbindung wird erkannt, Nachzügler bremst die anderen', () => {
  const w = world();
  const a = w.new('A').connect();
  const b = w.new('B').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 1000);
  // B is silent (iPad asleep, socket still hanging)
  b.muted = true;
  w.run(DEAD_AFTER_MS + 500);
  assert.equal(w.room.pause?.reason, REASON.disconnected);
  assert.equal(w.room.seats[1].online, false);
  // B comes back but deliberately doesn't recompute: the server halts
  b.muted = false; b.disconnect();
  const b2 = w.new('B', { token: b.token });
  b2.compute = () => { if (w.time() % 1000 < 20) b2.send({ t: 'ping', z: 0 }); }; // alive, but not computing
  b2.connect();
  w.run(NEXT_TO_MS + 6000);
  const n = w.room.match.rounds.length;
  assert.ok(n - 1 - w.room.seats[1].sync.round <= HOLD_MIN + 3, 'Server wartet auf den Nachzügler');
  assert.deepEqual(a.state.waits, [1]);
  b2.compute = () => { b2.ls.progress(); if (w.time() % 1000 < 20) b2.send({ t: 'ping', z: 0 }); };
  w.run(3000);
  assert.deepEqual(a.state.waits, []);
  assert.ok(w.room.match.rounds.length > n + 10);
});

test('Desync wird gemeldet und hält die Partie an', () => {
  const w = world();
  const a = w.new('A').connect();
  const b = w.new('B').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 1000);
  b.wrong = true;
  w.run(1000);
  assert.equal(w.room.pause?.reason, REASON.desync);
  assert.ok(a.last('desync'));
  const n = w.room.match.rounds.length;
  w.run(2000);
  assert.equal(w.room.match.rounds.length, n);
  a.send({ t: 'new' });
  assert.equal(w.room.phase, 'lobby');
  assert.equal(a.last('lobby').t, 'lobby');
});

test('Hand-Pause und „ohne … weiter“', () => {
  const w = world();
  const a = w.new('A').connect();
  const b = w.new('B').connect();
  const c = w.new('C').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 1000);
  b.send({ t: 'pause' });
  assert.equal(w.room.pause.reason, REASON.manual);
  const n = w.room.match.rounds.length;
  w.run(1000);
  assert.equal(w.room.match.rounds.length, n);
  a.send({ t: 'next' });
  w.run(NEXT_TO_MS + 1000);
  assert.ok(w.room.match.rounds.length > n);
  c.disconnect();
  assert.equal(w.room.pause.reason, REASON.disconnected);
  a.send({ t: 'without', seat: 2 });
  assert.equal(w.room.pause, null);
  w.run(NEXT_TO_MS + 1000);
  assert.equal(a.ls.sim.sum(), b.ls.sim.sum());
  // C comes back (without token, only with the name) and takes over their cubes again
  const c2 = w.new('c ').connect();
  assert.equal(c2.seat, 2);
  assert.equal(w.room.seats[2].out, false);
  w.run(NEXT_TO_MS + 3000);
  assert.equal(w.room.pause, null);
  c2.send({ t: 'command', b: { kind: 'target', ids: [12], x: 1000, y: 1000 } });
  w.run(6000);
  assert.equal(a.ls.sim.sum(), c2.ls.sim.sum());
  assert.ok(a.ls.sim.units[12].x < 36000, 'Cs Befehl wirkt wieder');
});

test('Wiederkommen über den Namen: neues Fenster übernimmt, altes wird abgelöst', () => {
  const w = world();
  const a = w.new('Daniel').connect();
  const b = w.new('Ava').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 1000);
  // same name, no token, old connection still open (e.g. switching PC → iPad)
  const a2 = w.new('DANIEL').connect();
  assert.equal(a2.seat, 0);
  assert.equal(a.last('rejected').reason, 'superseded');
  assert.equal(w.room.pause, null);
  assert.equal(w.room.state().player.length, 2);
  w.run(NEXT_TO_MS + 3000);
  assert.equal(a2.ls.sim.sum(), b.ls.sim.sum());
  // in the lobby: same name ends up in the same seat, no duplication
  a2.send({ t: 'new' });
  const a3 = w.new('Daniel').connect();
  assert.equal(a3.seat, 0);
  assert.equal(w.room.state().player.length, 2);
});

test('Zuschauer bremsen nicht, können nichts befehlen und rücken in der Lobby nach', () => {
  const w = world({ max: 2 });
  const a = w.new('A').connect();
  const b = w.new('B').connect();
  a.send({ t: 'start' });
  const z = w.new('Zuschauerin').connect();
  assert.equal(z.seat, null);
  w.run(NEXT_TO_MS + 2000);
  assert.equal(z.ls.done, a.ls.done);
  assert.equal(z.ls.sim.sum(), a.ls.sim.sum());
  // Spectator no longer computes along → nobody waits for them
  z.muted = true;
  const n = w.room.match.rounds.length;
  w.run(2000);
  assert.ok(w.room.match.rounds.length > n + 15);
  z.muted = false;
  // Commands and pause from spectators are ignored
  z.send({ t: 'command', b: { kind: 'target', ids: [0], x: 1, y: 1 } });
  z.send({ t: 'pause' });
  w.run(500);
  assert.equal(w.room.pause, null);
  assert.ok(w.room.match.rounds.every((r) => r.every(([pl]) => pl === 0 || pl === 1)));
  // B leaves, back to the lobby: spectator moves up
  b.disconnect();
  a.send({ t: 'new' });
  assert.equal(z.seat, 1);
  assert.deepEqual(w.room.state().spectator, []);
  assert.equal(w.room.state().player.map((x) => x.name).join(), 'A,Zuschauerin');
});

test('Runden-Takt: höchstens ein paar Runden nachholen, Befehle landen in fester Reihenfolge', () => {
  const w = world();
  const a = w.new('A').connect();
  const b = w.new('B').connect();
  a.send({ t: 'start' });
  w.run(NEXT_TO_MS + 200);
  a.send({ t: 'command', b: { kind: 'target', ids: [0], x: 1, y: 1 } });
  b.send({ t: 'command', b: { kind: 'target', ids: [6], x: 2, y: 2 } });
  a.send({ t: 'command', b: { kind: 'target', ids: [1], x: 3, y: 3 } });
  w.run(ROUND_MS);
  const r = w.room.match.rounds.find((x) => x.length);
  assert.deepEqual(r.map(([p, b]) => [p, b.x]), [[0, 1], [1, 2], [0, 3]]);
});

test('Teamfarben: Blau nur für Daniel und den Geist, alle anderen wählen frei aus acht', () => {
  for (const n of ['Daniel', 'DANIEL', ' daniel ', 'Dan-iel', 'geist', 'GeIsT', 'Geist!']) assert.ok(isBlue(n), n);
  for (const n of ['Dani', 'Daniela', 'Geister', 'Ava']) assert.ok(!isBlue(n), n);
  assert.ok(!COLORS.includes(BLUE) && COLORS.length === 8);
  const w = world({ max: 4 });
  const a = w.new('Ava').connect();
  const d = w.new('dAnIeL').connect();
  const g = w.new('Geist').connect();
  const color = (pl) => w.room.state().player.find((x) => x.seat === pl).color;
  assert.equal(color(d.seat), BLUE);
  assert.equal(color(g.seat), BLUE);
  assert.notEqual(color(a.seat), BLUE);
  // Blue wishes are ignored, Daniel cannot switch
  a.send({ t: 'color', color: BLUE });
  d.send({ t: 'color', color: COLORS[3] });
  assert.notEqual(color(a.seat), BLUE);
  assert.equal(color(d.seat), BLUE);
  // freie Wahl, aber keine doppelte Farbe
  a.send({ t: 'color', color: COLORS[5] });
  assert.equal(color(a.seat), COLORS[5]);
  const b = w.new('Bert').connect();
  assert.notEqual(color(b.seat), COLORS[5]);
  b.send({ t: 'color', color: COLORS[5] });
  assert.equal(b.last('error').text.includes('schon'), true);
  // im Spiel keine Farbwechsel
  a.send({ t: 'start' });
  a.send({ t: 'color', color: COLORS[7] });
  assert.equal(color(a.seat), COLORS[5]);
});

test('Gastgeber: starten, pausieren, rauswerfen und als Spielleiter eingreifen', () => {
  const w = world();
  const a = w.new('A').connect();
  assert.equal(w.room.host({ t: 'start' }).ok, false);
  const b = w.new('B').connect();
  const c = w.new('C').connect();
  assert.equal(w.room.host({ t: 'command', b: { kind: 'wind', direction: 0 } }).ok, false, 'nur in einer Partie');
  assert.equal(w.room.host({ t: 'start' }).ok, true);
  w.run(NEXT_TO_MS + 1000);
  const x0 = a.ls.sim.units.map((e) => e.x);
  assert.equal(w.room.host({ t: 'command', b: { kind: 'wind', direction: 0 } }).ok, true);
  w.run(1000);
  assert.ok(w.room.match.rounds.some((r) => r.some(([pl, bf]) => pl === -1 && bf.kind === 'wind')));
  w.run(3000);
  // Wind to the east: on average everyone has moved clearly to the right, and all devices agree
  const center = (l) => l.reduce((s, x) => s + x, 0) / l.length;
  assert.ok(center(a.ls.sim.units.map((e) => e.x)) > center(x0) + 3000);
  assert.equal(a.ls.sim.sum(), b.ls.sim.sum());
  assert.equal(b.ls.sim.sum(), c.ls.sim.sum());
  w.room.host({ t: 'pause' });
  assert.equal(w.room.pause.who, 'Gastgeber');
  w.room.host({ t: 'next' });
  assert.equal(w.room.pause, null);
  // Kick: C is kicked, match continues without pause; with their name C may return
  assert.equal(w.room.host({ t: 'out', seat: 2 }).ok, true);
  assert.equal(c.last('rejected').reason, 'out');
  assert.equal(w.room.pause, null);
  const c2 = w.new('C').connect();
  assert.equal(c2.seat, 2);
  w.room.host({ t: 'lobby' });
  assert.equal(w.room.phase, 'lobby');
});

test('Unterschiedliche Spieldaten: Start wird abgelehnt, mit gleichen Daten geht es', () => {
  const w = world();
  const a = w.new('A'), b = w.new('B');
  a.connect(); b.connect();
  a.send({ t: 'hello', protocol: PROTOCOL, name: 'A', token: a.token, data: 'aaaa1111' });
  b.send({ t: 'hello', protocol: PROTOCOL, name: 'B', token: b.token, data: 'bbbb2222' });
  assert.deepEqual(a.state.player.map((p) => p.data), ['aaaa1111', 'bbbb2222']);
  a.send({ t: 'start' });
  assert.equal(w.room.phase, 'lobby');
  assert.ok(a.last('error').text.includes('Spieldaten'));
  b.send({ t: 'hello', protocol: PROTOCOL, name: 'B', token: b.token, data: 'aaaa1111' });
  a.send({ t: 'start' });
  assert.equal(w.room.phase, 'running');
});
