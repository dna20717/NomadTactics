// NomadTactics – battle simulation (milestone 1: units only, landing pads with reinforcement waves).
// Runs in lockstep on every device: integers only (1 m = 1000), own randomness, no clock.
// test/net.test.js checks the source for engine-dependent maths.
//
// API for the lockstep: command(seat, b), step(), sum(). For the view: units, projectiles, map, types,
// events (the view drains them; the simulation never reads them back), over, nextWave.
//
// Commands (same kinds as the HUD):
//   { kind: 'drive', ids, x, y }     drive there (formation kept loosely), 'target' is the old name
//   { kind: 'attack', ids, target }  attack a unit or building
//   { kind: 'halt', ids }            stop
//   seat −1 (game master): { kind: 'wind', direction: 0–7 } drifts rockets and shells for 3 s

import { sin, cos, angleOf, angleDiff, root, whole, Random, hasher } from './fixed.js';
import { MM, buildMap, stepAllowed } from './map.js';
import { FlowCache, FAR, NEIGHBOURS, nearestOpen } from './flowfield.js';
import { movementTypes } from './world.js';

export const TICKS_PER_SECOND = 20;
// Alone in the room: a practice opponent with its own landing pad. It gets waves like a player,
// never receives commands and only fights back what comes into sight.
export const PRACTICE_SEAT = 9;
export const PRACTICE = { name: 'Übungsgegner', color: '#9aa3ab' };
const BUCKET = 8 * MM;                    // spatial buckets for neighbours and targets
const MAX_IDS = 120;
const RADIUS = { tank: 2600, werfer: 2400, spaeher: 2100, dozer: 2400, soldat: 450 };
const TURN = { track: 5, wheel: 7, infantry: 40 };
const SHOT_SPEED = { gewehr: 20000, mg: 20000, granate: 12000, rakete: 2600, laser: 100000, flame: 3000, bomb: 1200 };
const PROJECTILE = ['gewehr', 'mg', 'granate', 'rakete', 'laser', 'flame', 'bomb'];
const SALVO_GAP = 3;                      // ticks between shots of a salvo

// ---------- compile game data into integer types (once per match, not part of the state) ----------
export function compileTypes(setup) {
  const { faction, weapons = {}, combat = {}, world = {}, mode = {} } = setup;
  const table = {};
  for (const [dt, row] of Object.entries(combat.table || {})) {
    table[dt] = {};
    for (const [ar, f] of Object.entries(row)) table[dt][ar] = whole(f * 100);
  }
  const types = {}, order = [];
  const add = (id, t) => { t.index = order.length; order.push(id); types[id] = t; };
  for (const [id, u] of Object.entries(faction.units || {})) {
    if (u.class === 'air') continue; // no aircraft in milestone 1
    const kinds = movementTypes(world, u);
    const movement = kinds.find((k) => k === 'track') || kinds.find((k) => k === 'wheel') || kinds[0] || 'infantry';
    const w = weapons[(u.weapons || [])[0]];
    const kw = u.keywords || {};
    add(id, {
      id, name: u.name, cls: u.class, armor: u.armor, model: u.model, movement,
      hp: whole((u.health || 100) * 100),
      speed: whole((u.speed || 3) * MM / TICKS_PER_SECOND),
      sight: whole((u.sight || 20) * MM),
      radius: RADIUS[u.model] ?? (u.class === 'infantry' ? 450 : 2200),
      turn: TURN[movement] ?? 8,
      tough: whole((typeof kw.tough === 'number' ? kw.tough : kw.tough ? 1 : 0) * 100),
      deploys: !!kw.aufbauen,
      weapon: w ? compileWeapon(w) : null,
    });
  }
  const padId = mode.pad || 'landeplatz';
  const pad = faction.building?.[padId] || { name: 'Landeplatz', health: 3000, armor: 'building', size: [12, 12] };
  add(padId, {
    id: padId, name: pad.name, cls: 'building', armor: pad.armor || 'building', model: pad.model, building: true,
    hp: whole((pad.health || 3000) * 100), speed: 0, sight: 0, radius: whole(((pad.size || [12])[0]) * MM / 2), turn: 0, tough: 0, weapon: null,
  });
  return { types, order, table, pad: padId };
}

function compileWeapon(w) {
  const kw = w.keywords || {};
  return {
    name: w.name, damageType: w.damageType,
    damage: whole((w.damage || 0) * 100),
    range: whole((w.range || 10) * MM),
    reload: Math.max(1, whole((w.reload || 1) * TICKS_PER_SECOND)),
    salvo: Math.max(1, w.salvo | 0),
    splash: whole((kw.surface || 0) * MM),
    indirect: !!kw.indirekt,
    minRange: whole((kw.mindestreichweite || 0) * MM),
    projectile: Math.max(0, PROJECTILE.indexOf(w.projectile)),
    shotSpeed: SHOT_SPEED[w.projectile] || 10000,
    ground: (w.targets || ['ground']).includes('ground'),
  };
}

// ---------- the simulation ----------
export class Battle {
  constructor(seed, seats, setup) {
    this.setup = setup;
    this.world = setup.world || {};
    this.map = setup.map.grounds ? setup.map : buildMap(setup.map, this.world);
    this.mode = setup.mode || {};
    const c = compileTypes(setup);
    this.types = c.types; this.typeOrder = c.order; this.table = c.table; this.padType = c.pad;
    this.flow = new FlowCache(this.map, this.world);
    this.random = new Random(seed);
    this.seats = seats.length === 1 ? [seats[0], PRACTICE_SEAT] : seats.slice();
    this.practice = seats.length === 1;
    this.tick = 0;
    this.nextId = 1;
    this.units = [];
    this.byId = new Map();
    this.projectiles = [];
    this.events = [];
    this.wind = { x: 0, y: 0, rest: 0 };
    this.over = null;
    this.out = [];               // seats that lost, in order
    this.waveEvery = Math.max(1, whole((this.mode.waveEvery || 60) * TICKS_PER_SECOND));
    this.waveCount = 0;
    this.maxUnits = this.mode.maxUnits || 60;
    // terrain speed % per movement type and ground, cover % for infantry
    this.speedPct = {}; this.coverPct = {};
    for (const mv of ['infantry', 'wheel', 'track']) {
      this.speedPct[mv] = this.map.grounds.map((g) => this.world.terrains?.[g]?.speed?.[mv] ?? 100);
      this.coverPct[mv] = this.map.grounds.map((g) => this.world.terrains?.[g]?.cover?.[mv] ?? 0);
    }
    // landing pads on the start slots
    const slots = this.map.slots;
    this.seats.forEach((seat, i) => {
      const [x, y] = slots[i % slots.length] || [this.map.size >> 1, this.map.size >> 1];
      this.spawn(this.padType, seat, x, y, 0);
    });
  }

  // ----- helpers -----
  cellOf(x, y) {
    const n = this.map.n, c = this.map.cell;
    let i = Math.floor(x / c), j = Math.floor(y / c);
    i = i < 0 ? 0 : i >= n ? n - 1 : i; j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return j * n + i;
  }
  passable(t, k) { return this.speedPct[t.movement]?.[this.map.ground[k]] > 0; }
  levelAt(x, y) { return this.map.level[this.cellOf(x, y)]; }

  spawn(type, seat, x, y, h) {
    const t = this.types[type];
    const u = {
      id: this.nextId++, seat, type, x, y, h: h & 255, hp: t.hp,
      cd: 0, salvo: 0, gap: 0, tgt: 0,
      order: 0, gx: x, gy: y, fkey: -1, best: FAR, since: 0, ax: x, ay: y, moved: 0,
    };
    this.units.push(u); this.byId.set(u.id, u);
    return u;
  }

  // ----- commands from the network: validate everything, ignore nonsense silently -----
  command(seat, b) {
    if (!b || typeof b !== 'object' || this.over) return;
    if (seat === -1 && b.kind === 'wind') {
      const R = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const r = R[(b.direction | 0) & 7];
      this.wind = { x: r[0] * 120, y: r[1] * 120, rest: 3 * TICKS_PER_SECOND };
      return;
    }
    if (!this.seats.includes(seat) || seat === PRACTICE_SEAT || !Array.isArray(b.ids)) return;
    const own = [];
    for (const id of b.ids.slice(0, MAX_IDS)) {
      const u = this.byId.get(id | 0);
      if (u && u.seat === seat && !this.types[u.type].building && !own.includes(u)) own.push(u);
    }
    if (!own.length) return;
    if (b.kind === 'halt') { for (const u of own) this.stop(u); return; }
    if (b.kind === 'attack') {
      const target = this.byId.get(b.target | 0);
      if (!target || target.seat === seat) return;
      for (const u of own) if (this.types[u.type].weapon) { u.order = 2; u.tgt = target.id; u.fkey = -1; u.best = FAR; u.since = 0; }
      return;
    }
    if (b.kind !== 'drive' && b.kind !== 'target') return;
    const size = this.map.size;
    const x = b.x | 0, y = b.y | 0;
    if (x < 0 || y < 0 || x > size || y > size) return;
    // loose formation: keep the offset to the group centre, squeezed to a radius that grows with the group
    let cx = 0, cy = 0;
    for (const u of own) { cx += u.x; cy += u.y; }
    cx = Math.trunc(cx / own.length); cy = Math.trunc(cy / own.length);
    const maxR = 2000 + 2200 * root(own.length);
    const k = this.cellOf(x, y);
    for (const u of own) {
      const t = this.types[u.type];
      let ox = u.x - cx, oy = u.y - cy;
      const d = root(ox * ox + oy * oy);
      if (d > maxR) { ox = Math.trunc(ox * maxR / d); oy = Math.trunc(oy * maxR / d); }
      let gx = x + ox, gy = y + oy;
      const gk = this.cellOf(gx, gy);
      if (gx < 0 || gy < 0 || gx > size || gy > size || !this.passable(t, gk) || this.map.level[gk] !== this.map.level[k]) { gx = x; gy = y; }
      u.order = 1; u.gx = gx; u.gy = gy; u.tgt = 0;
      u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), k);
      u.best = FAR; u.since = 0;
    }
  }

  stop(u) { u.order = 0; u.tgt = 0; u.ax = u.x; u.ay = u.y; u.fkey = -1; }

  // ----- one simulation step -----
  step() {
    this.tick++;
    if (this.over) return;
    if ((this.tick - 1) % this.waveEvery === 0) this.wave();
    this.buckets();
    for (const u of this.units) {
      const t = this.types[u.type];
      if (t.building || u.hp <= 0) continue;
      u.moved = 0;
      if (t.weapon) this.aim(u, t);
      this.move(u, t);
    }
    this.separate();
    for (const u of this.units) {
      const t = this.types[u.type];
      if (t.weapon && u.hp > 0) this.fire(u, t);
    }
    this.flight();
    if (this.wind.rest > 0) this.wind.rest--;
    this.cleanup();
  }

  get nextWave() { return this.waveEvery - ((this.tick - 1) % this.waveEvery) - 1; }

  wave() {
    const list = this.mode.waves || [];
    const w = list[Math.min(this.waveCount, list.length - 1)] || { units: { soldat: 3 } };
    const extra = (this.mode.extra || []).filter((e) => e.each > 0 && (this.waveCount + 1) % e.each === 0);
    this.waveCount++;
    const centre = this.map.size >> 1;
    for (const seat of this.seats) {
      const pad = this.units.find((u) => u.seat === seat && u.type === this.padType && u.hp > 0);
      if (!pad) continue;
      let count = this.units.filter((u) => u.seat === seat && u.hp > 0 && !this.types[u.type].building).length;
      const h = angleOf(centre - pad.x, centre - pad.y);
      let slot = 0;
      for (const part of [w.units || {}, ...extra.map((e) => e.units || {})]) {
        for (const [type, n] of Object.entries(part)) {
          const t = this.types[type];
          if (!t || t.building) continue;
          for (let i = 0; i < (n | 0) && count < this.maxUnits; i++) {
            const [x, y] = this.freeSpot(pad, t, slot++);
            const u = this.spawn(type, seat, x, y, h);
            count++;
            this.events.push({ kind: 'spawn', id: u.id, seat, x, y });
          }
        }
      }
      this.events.push({ kind: 'wave', seat, x: pad.x, y: pad.y, n: this.waveCount });
    }
  }

  // Spots on rings around the pad, in front first (towards the map centre)
  freeSpot(pad, t, slot) {
    const r0 = this.types[pad.type].radius + 4000;
    const centre = this.map.size >> 1;
    const h = angleOf(centre - pad.x, centre - pad.y);
    for (let s = slot; s < slot + 64; s++) {
      const ring = Math.floor(s / 8), step = s % 8;
      const a = h + ((step & 1) ? -1 : 1) * ((step + 1) >> 1) * 16;
      const r = r0 + ring * 5000;
      const x = pad.x + Math.trunc(cos(a) * r / 1024), y = pad.y + Math.trunc(sin(a) * r / 1024);
      if (x < 0 || y < 0 || x >= this.map.size || y >= this.map.size) continue;
      if (this.passable(t, this.cellOf(x, y))) return [x, y];
    }
    return [pad.x, pad.y];
  }

  // spatial buckets, rebuilt every step (order = unit order, so iteration stays deterministic)
  buckets() {
    const nb = Math.floor((this.map.size + BUCKET - 1) / BUCKET);
    this.nb = nb;
    this.bucket = Array.from({ length: nb * nb }, () => []);
    for (const u of this.units) if (u.hp > 0) this.bucket[this.bucketOf(u.x, u.y)].push(u);
  }
  bucketOf(x, y) {
    const nb = this.nb;
    let i = Math.floor(x / BUCKET), j = Math.floor(y / BUCKET);
    i = i < 0 ? 0 : i >= nb ? nb - 1 : i; j = j < 0 ? 0 : j >= nb ? nb - 1 : j;
    return j * nb + i;
  }
  around(x, y, r, fn) {
    const nb = this.nb, R = Math.floor((r + BUCKET - 1) / BUCKET);
    const i0 = Math.floor(x / BUCKET), j0 = Math.floor(y / BUCKET);
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
      if (i < 0 || j < 0 || i >= nb || j >= nb) continue;
      for (const u of this.bucket[j * nb + i]) fn(u);
    }
  }

  range(u, t, target) {
    let r = t.weapon.range;
    if (this.levelAt(u.x, u.y) > this.levelAt(target.x, target.y)) r += Math.trunc(r * (this.world.height?.rangeDownhill ?? 20) / 100);
    return r + this.types[target.type].radius;
  }

  // ----- choose a target -----
  aim(u, t) {
    const cur = u.tgt ? this.byId.get(u.tgt) : null;
    if (u.order === 2) {
      if (cur && cur.hp > 0) return;
      this.stop(u); // target gone
    }
    if (cur && cur.hp > 0) {
      const dx = cur.x - u.x, dy = cur.y - u.y, d = root(dx * dx + dy * dy);
      const keep = u.order === 1 ? this.range(u, t, cur) : t.sight + this.types[cur.type].radius;
      if (d <= keep) return;
    }
    u.tgt = 0;
    if ((this.tick + u.id) % 8 !== 0 && !cur) return; // look around every 8 steps, staggered
    const reach = u.order === 1 ? t.weapon.range + 3000 : t.sight;
    let best = null, bestScore = FAR;
    this.around(u.x, u.y, reach + 8000, (e) => {
      if (e.seat === u.seat || e.hp <= 0) return;
      const et = this.types[e.type];
      const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy) - et.radius;
      if (d > reach) return;
      const score = d + (et.building ? 30000 : 0);
      if (score < bestScore || (score === bestScore && best && e.id < best.id)) { best = e; bestScore = score; }
    });
    if (best) u.tgt = best.id;
  }

  // ----- movement -----
  move(u, t) {
    if (t.speed === 0) return;
    let goalX, goalY, field = -1, arrive = Math.max(t.radius, t.speed * 2);
    if (u.order === 2) {
      const e = this.byId.get(u.tgt);
      if (!e) return;
      const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy);
      if (d <= this.range(u, t, e) - 1500) return; // in range: stand and shoot
      goalX = e.x; goalY = e.y; arrive = 0;
      if (u.fkey < 0 || (this.tick + u.id) % 20 === 0) u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(e.x, e.y));
      field = u.fkey;
    } else if (u.order === 1) {
      goalX = u.gx; goalY = u.gy; field = u.fkey;
    } else {
      // idle: chase what is in sight a little, then hold the new spot
      const e = u.tgt ? this.byId.get(u.tgt) : null;
      if (!e) return;
      const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy);
      if (d <= this.range(u, t, e) - 1500) return;
      const lx = u.x - u.ax, ly = u.y - u.ay;
      if (root(lx * lx + ly * ly) > t.sight) return; // leash
      goalX = e.x; goalY = e.y; arrive = 0;
      if (u.fkey < 0 || (this.tick + u.id) % 20 === 0) u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(e.x, e.y));
      field = u.fkey;
    }
    const gx = goalX - u.x, gy = goalY - u.y;
    const gd = root(gx * gx + gy * gy);
    if (u.order === 1) {
      if (gd <= arrive) { this.stop(u); return; }
      // not getting closer for 2 s (crowd at the goal, blocked): good enough when near, else keep trying
      if (gd < u.best - 300) { u.best = gd; u.since = 0; }
      else if (++u.since > 40 && gd < 6000 + 1500 * root(this.groupNear(u))) { this.stop(u); return; }
      else if (u.since > 200) { this.stop(u); return; }
    }
    // direction: flowfield gradient far away, straight line in the last metres
    let vx = gx, vy = gy;
    const k = this.cellOf(u.x, u.y);
    if (field >= 0 && gd > 2 * this.map.cell + 2000) {
      const f = this.flow.field(t.movement, field);
      if (f.dist[k] >= FAR) { if (u.order === 1) this.stop(u); return; } // unreachable
      const v = this.gradient(f, k, t);
      if (v) { vx = v[0]; vy = v[1]; }
    }
    if (vx === 0 && vy === 0) return;
    const want = angleOf(vx, vy);
    const diff = angleDiff(u.h, want);
    const ad = diff < 0 ? -diff : diff;
    if (ad <= t.turn) u.h = want;
    else u.h = (u.h + (diff > 0 ? t.turn : -t.turn)) & 255;
    // tracks turn on the spot, wheels slow down in curves, infantry just walks
    let pct = this.speedPct[t.movement][this.map.ground[k]];
    if (ad > 40) pct = t.movement === 'track' ? 0 : t.movement === 'wheel' ? pct >> 1 : pct;
    if (pct <= 0) return;
    let s = Math.trunc(t.speed * pct / 100);
    if (arrive > 0 && gd < s) s = gd;
    const nx = u.x + Math.trunc(cos(u.h) * s / 1024), ny = u.y + Math.trunc(sin(u.h) * s / 1024);
    this.place(u, t, nx, ny);
    u.moved = 1;
  }

  groupNear(u) {
    let n = 0;
    this.around(u.gx, u.gy, 8000, (e) => { if (e.seat === u.seat && e.id !== u.id && !this.types[e.type].building) n++; });
    return n;
  }

  // Sum of the drops to all reachable neighbours = smooth direction downhill in the field
  gradient(f, k, t) {
    const n = this.map.n, i = k % n, j = (k - i) / n, d0 = f.dist[k];
    let vx = 0, vy = 0, bestDrop = 0, bx = 0, by = 0;
    const cost = this.flow.cost(t.movement);
    for (let q = 0; q < 8; q++) {
      const [dx, dy] = NEIGHBOURS[q];
      const a = i + dx, b = j + dy;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const c = b * n + a;
      if (f.dist[c] >= FAR || !stepAllowed(this.map, k, c)) continue;
      if (q >= 4 && (cost[j * n + a] === 0 || cost[b * n + i] === 0)) continue;
      const drop = d0 - f.dist[c];
      if (drop <= 0) continue;
      const w = q < 4 ? 1024 : 724;
      vx += dx * drop * w; vy += dy * drop * w;
      if (drop > bestDrop) { bestDrop = drop; bx = dx; by = dy; }
    }
    if (vx === 0 && vy === 0) return bx || by ? [bx, by] : null;
    // never steer against the best neighbour (narrow passages): fall back to it if the blend points elsewhere
    if (vx * bx + vy * by <= 0) return [bx, by];
    return [vx, vy];
  }

  // Move to (nx, ny) if the ground allows it, else slide along one axis
  place(u, t, nx, ny) {
    const size = this.map.size - 1;
    nx = nx < 0 ? 0 : nx > size ? size : nx; ny = ny < 0 ? 0 : ny > size ? size : ny;
    const k = this.cellOf(u.x, u.y);
    const ok = (x, y) => { const c = this.cellOf(x, y); return c === k || (this.passable(t, c) && stepAllowed(this.map, k, c) && this.corner(k, c, t)); };
    if (ok(nx, ny)) { u.x = nx; u.y = ny; return true; }
    if (ok(nx, u.y)) { u.x = nx; return true; }
    if (ok(u.x, ny)) { u.y = ny; return true; }
    return false;
  }
  corner(k, c, t) {
    const n = this.map.n, ki = k % n, ci = c % n;
    if (ki === ci || (k - ki) === (c - ci)) return true;
    const kj = (k - ki) / n, cj = (c - ci) / n;
    const a = kj * n + ci, b = cj * n + ki;
    return this.passable(t, a) && this.passable(t, b) && stepAllowed(this.map, k, a) && stepAllowed(this.map, k, b);
  }

  // Units push each other apart; infantry gives way to vehicles
  separate() {
    for (const a of this.units) {
      const ta = this.types[a.type];
      if (ta.building || a.hp <= 0) continue;
      this.around(a.x, a.y, 6000, (b) => {
        if (b.id <= a.id || b.hp <= 0) return;
        const tb = this.types[b.type];
        if (tb.building) return;
        const min = ta.radius + tb.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > min || dx < -min || dy > min || dy < -min) return;
        const d = root(dx * dx + dy * dy);
        if (d >= min) return;
        const deep = Math.trunc((min - d) / 2) + 1;
        let nx, ny;
        if (d > 0) { nx = Math.trunc(dx * deep / d); ny = Math.trunc(dy * deep / d); }
        else { nx = (a.id & 1) ? deep : -deep; ny = 0; }
        // weight: the heavier one moves less, standing units yield to moving ones
        let wa = ta.radius, wb = tb.radius;
        if (!a.moved && b.moved) wa >>= 1; else if (a.moved && !b.moved) wb >>= 1;
        const sa = Math.trunc(nx * 2 * wb / (wa + wb)), sb = Math.trunc(nx * 2 * wa / (wa + wb));
        const ta2 = Math.trunc(ny * 2 * wb / (wa + wb)), tb2 = Math.trunc(ny * 2 * wa / (wa + wb));
        this.place(a, ta, a.x - sa, a.y - ta2);
        this.place(b, tb, b.x + sb, b.y + tb2);
      });
    }
  }

  // ----- weapons -----
  fire(u, t) {
    const w = t.weapon;
    if (u.cd > 0) u.cd--;
    if (u.salvo > 0 && u.gap > 0) { u.gap--; }
    const e = u.tgt ? this.byId.get(u.tgt) : null;
    if (!e || e.hp <= 0) { u.salvo = 0; return; }
    if (!w.ground) return;
    if (t.deploys && u.moved) return;
    const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy);
    if (d > this.range(u, t, e) || d < w.minRange) return;
    if (u.salvo > 0) { if (u.gap > 0) return; u.salvo--; u.gap = SALVO_GAP; }
    else if (u.cd === 0) { u.cd = w.reload; u.salvo = w.salvo - 1; u.gap = SALVO_GAP; }
    else return;
    let tx = e.x, ty = e.y;
    if (w.indirect) { tx += this.random.number(4001) - 2000; ty += this.random.number(4001) - 2000; }
    const time = 1 + Math.floor(d / w.shotSpeed);
    // infantry in cover and shooting uphill take less damage
    let dmg = w.damage;
    if (!w.indirect && this.levelAt(u.x, u.y) < this.levelAt(e.x, e.y)) dmg += Math.trunc(dmg * (this.world.height?.hitUphill ?? -25) / 100);
    this.projectiles.push({ seat: u.seat, src: u.id, tgt: w.indirect ? 0 : e.id, x: tx, y: ty, t: time, all: time, dmg, dt: w.damageType, splash: w.splash, kind: w.projectile, indirect: w.indirect ? 1 : 0, fx: u.x, fy: u.y });
    this.events.push({ kind: 'shot', src: u.id, seat: u.seat, x: u.x, y: u.y, tx, ty, projectile: w.projectile, time });
  }

  flight() {
    const keep = [];
    for (const p of this.projectiles) {
      if (p.indirect && this.wind.rest > 0) { p.x += this.wind.x; p.y += this.wind.y; }
      if (--p.t > 0) { keep.push(p); continue; }
      const e = p.tgt ? this.byId.get(p.tgt) : null;
      if (e && e.hp > 0) { p.x = e.x; p.y = e.y; }
      if (p.splash > 0) {
        this.around(p.x, p.y, p.splash + 3000, (v) => {
          if (v.seat === p.seat || v.hp <= 0) return;
          const dx = v.x - p.x, dy = v.y - p.y, d = root(dx * dx + dy * dy) - this.types[v.type].radius;
          if (d > p.splash) return;
          this.hurt(v, d * 2 <= p.splash ? p.dmg : p.dmg >> 1, p);
        });
      } else if (e && e.hp > 0) this.hurt(e, p.dmg, p);
      this.events.push({ kind: 'impact', x: p.x, y: p.y, projectile: p.kind, splash: p.splash, hit: !!(e && e.hp >= 0) });
    }
    this.projectiles = keep;
  }

  hurt(v, dmg, p) {
    const t = this.types[v.type];
    let d = Math.trunc(dmg * (this.table[p.dt]?.[t.armor] ?? 100) / 100);
    const cover = this.coverPct[t.movement]?.[this.map.ground[this.cellOf(v.x, v.y)]] || 0;
    if (cover && !t.building) d -= Math.trunc(d * cover / 100);
    const min = Math.trunc(d / 10);
    d -= t.tough; if (d < min) d = min;
    if (d <= 0) return;
    v.hp -= d;
    // hit from out of sight: idle units turn towards the shooter
    if (!v.tgt && !t.building && v.order === 0 && p.src) v.tgt = p.src;
  }

  cleanup() {
    if (this.units.some((u) => u.hp <= 0)) {
      const alive = [];
      for (const u of this.units) {
        if (u.hp > 0) { alive.push(u); continue; }
        this.byId.delete(u.id);
        this.events.push({ kind: 'dead', id: u.id, seat: u.seat, type: u.type, x: u.x, y: u.y, h: u.h });
      }
      this.units = alive;
    }
    if (this.seats.length < 2) return;
    const living = this.seats.filter((s) => this.units.some((u) => u.seat === s));
    for (const s of this.seats) if (!living.includes(s) && !this.out.includes(s)) { this.out.push(s); this.events.push({ kind: 'out', seat: s }); }
    if (living.length <= 1) {
      this.over = { winner: living.length ? living[0] : -1, tick: this.tick };
      this.events.push({ kind: 'over', winner: this.over.winner });
    }
  }

  sum() {
    const h = hasher();
    h.mix(this.tick); h.mix(this.random.z); h.mix(this.nextId); h.mix(this.waveCount);
    h.mix(this.wind.x); h.mix(this.wind.y); h.mix(this.wind.rest);
    for (const u of this.units) {
      h.mix(u.id); h.mix(u.seat); h.mix(this.types[u.type].index); h.mix(u.x); h.mix(u.y); h.mix(u.h); h.mix(u.hp);
      h.mix(u.cd); h.mix(u.salvo); h.mix(u.tgt); h.mix(u.order); h.mix(u.gx); h.mix(u.gy); h.mix(u.fkey);
    }
    for (const p of this.projectiles) { h.mix(p.src); h.mix(p.tgt); h.mix(p.x); h.mix(p.y); h.mix(p.t); h.mix(p.dmg); }
    if (this.over) { h.mix(this.over.winner); h.mix(this.over.tick); }
    return h.text();
  }
}

export function newBattle(setup) { return (seed, seats) => new Battle(seed, seats, setup); }
