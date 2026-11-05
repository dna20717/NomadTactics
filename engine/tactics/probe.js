// NomadTactics – test game for the party server MVP.
// A few dice per player, click = drive there, they shove each other and twitch randomly.
// Small, but nasty enough to reveal non-determinism.
//
// RULE: Only integers are used here (fixed point, 1 field = 1000). No Math.sin/cos/sqrt/pow,
// no Math.random, no clock, no floating-point results in the state. test/net.test.js checks this.
// Integer operations (+ − * | & >> Math.imul) are bit-exact in every JS engine (V8, JavaScriptCore …).

export const FIELD = 1000;
export const WIDTH = 48 * FIELD;
export const HEIGHT = 27 * FIELD;
const SPEED = 140;          // pro Schritt (20 Schritte/s → 2,8 Felder/s)
const SPACING = 900;        // Dice shove each other below this distance
const PER_PLAYER = 6;

// Integer square root (Newton), exact and identical everywhere
export function root(n) {
  if (n <= 0) return 0;
  let x = n, y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}

export class Probe {
  constructor(seed, seats) {
    this.tick = 0;
    this.z = (seed >>> 0) || 1;
    this.seats = seats.slice();
    this.units = [];
    this.wind = { x: 0, y: 0, rest: 0 }; // Game-master wind (proof that the host can intervene)
    const corners = [[4, 4], [44, 23], [44, 4], [4, 23], [24, 4], [24, 23], [4, 13], [44, 13]];
    seats.forEach((seat, i) => {
      const [ex, ey] = corners[i % corners.length];
      for (let k = 0; k < PER_PLAYER; k++) {
        const x = ex * FIELD + ((k % 3) - 1) * 1200 + this.number(300);
        const y = ey * FIELD + (Math.floor(k / 3) * 2 - 1) * 700 + this.number(300);
        this.units.push({ id: this.units.length, seat, x, y, zx: x, zy: y, target: false });
      }
    });
  }

  // mulberry32, integers only; returns 0 … grenze−1
  number(limit) {
    let t = (this.z = (this.z + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t = (t ^ (t >>> 14)) >>> 0;
    return t % limit;
  }

  // Commands are data from the network: validate everything, silently ignore nonsense (identical on all devices).
  command(seat, b) {
    // Game master (slot −1): gust of wind in one of 8 directions, for 3 seconds
    if (seat === -1 && b && b.kind === 'wind') {
      const R = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const r = R[(b.direction | 0) & 7];
      this.wind = { x: r[0] * 90, y: r[1] * 90, rest: 60 };
      return;
    }
    if (!b || b.kind !== 'target' || !Array.isArray(b.ids)) return;
    const x = b.x | 0, y = b.y | 0;
    if (x < 0 || y < 0 || x > WIDTH || y > HEIGHT) return;
    const ids = b.ids.slice(0, 50);
    let n = 0;
    for (const id of ids) {
      const e = this.units[id | 0];
      if (!e || e.seat !== seat) continue;
      // in kleiner Formation um den Zielpunkt
      e.zx = x + ((n % 3) - 1) * 900; e.zy = y + (Math.floor(n / 3) - 1) * 900;
      e.target = true; n++;
    }
  }

  step() {
    this.tick++;
    const es = this.units;
    for (const e of es) {
      // without an order, twitch a bit now and then (randomness in the simulation)
      if (!e.target && this.number(40) === 0) { e.zx = e.x + this.number(1601) - 800; e.zy = e.y + this.number(1601) - 800; }
      const dx = e.zx - e.x, dy = e.zy - e.y;
      const d = root(dx * dx + dy * dy);
      if (d <= SPEED) { e.x = e.zx; e.y = e.zy; e.target = false; }
      else { e.x += Math.trunc(dx * SPEED / d); e.y += Math.trunc(dy * SPEED / d); }
    }
    if (this.wind.rest > 0) { this.wind.rest--; for (const e of es) { e.x += this.wind.x; e.y += this.wind.y; e.zx += this.wind.x; e.zy += this.wind.y; } }
    // schubsen
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > SPACING || dx < -SPACING || dy > SPACING || dy < -SPACING) continue;
      const d = root(dx * dx + dy * dy);
      if (d >= SPACING) continue;
      const deep = Math.trunc((SPACING - d) / 2) + 1;
      const nx = d ? Math.trunc(dx * deep / d) : (i & 1 ? deep : -deep);
      const ny = d ? Math.trunc(dy * deep / d) : 0;
      a.x -= nx; a.y -= ny; b.x += nx; b.y += ny;
    }
    for (const e of es) {
      e.x = e.x < 0 ? 0 : e.x > WIDTH ? WIDTH : e.x;
      e.y = e.y < 0 ? 0 : e.y > HEIGHT ? HEIGHT : e.y;
    }
  }

  // FNV-1a over the whole state
  sum() {
    let h = 0x811c9dc5 | 0;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
    mix(this.tick); mix(this.z); mix(this.wind.x); mix(this.wind.y); mix(this.wind.rest);
    for (const e of this.units) { mix(e.x); mix(e.y); mix(e.zx); mix(e.zy); mix(e.target ? 1 : 0); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

export function newProbe(seed, seats) { return new Probe(seed, seats); }

// Fixed test run for „Is this device deterministic?“: same number on PC and iPad = good.
export function probeRun(steps = 20000) {
  const p = new Probe(12345, [0, 1, 2, 3]);
  const r = new Probe(777, [0]); // own randomness for the commands
  for (let i = 0; i < steps; i++) {
    if (i % 37 === 0) {
      const seat = r.number(4);
      const ids = p.units.filter((e) => e.seat === seat).map((e) => e.id);
      p.command(seat, { kind: 'target', ids, x: r.number(WIDTH), y: r.number(HEIGHT) });
    }
    p.step();
  }
  return p.sum();
}
