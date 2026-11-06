// NomadTactics – battle simulation (milestone 1: units only, landing pads with reinforcement waves).
// Runs in lockstep on every device: integers only (1 m = 1000), own randomness, no clock.
// test/net.test.js checks the source for engine-dependent maths.
//
// API for the lockstep: command(seat, b), step(), sum(). For the view: units, projectiles, map, types,
// events (the view drains them; the simulation never reads them back), over, nextWave.
//
// Commands (same kinds as the HUD):
//   { kind: 'drive', ids, x, y }     drive there in formation, 'target' is the old name
//   { kind: 'attack', ids, target }  attack a unit or building
//   { kind: 'halt', ids }            stop
//   seat −1 (game master): { kind: 'wind', direction: 0–7 } drifts rockets and shells for 3 s
//
// Companion drones (06.11.): the mode's loadout gives some units equipment with a companion (e.g. tanks with a
// combat drone). Drones are units of their own (air, never commanded), hover around their host, shoot what the
// host shoots, repair it (keyword repaired) or lend it their sight (keyword scout). Only weapons with
// targets: air can hit them; when the host dies they crash.
//
// Behaviour without orders (06.11., data/behavior.json, engine/tactics/behavior.js): an order always beats the
// unit's own will. Without one, the unit's profile and stance decide: whom to shoot (target weights), how far to
// chase and whether to come back (stance), taking cover, pulling back to the pad (stance „Vorsichtig“),
// running over enemy infantry and jumping aside, leaving the impact point of artillery.
//   { kind: 'stance', ids, stance }  set the stance (id from behavior.json › stances)

import { sin, cos, angleOf, angleDiff, root, whole, Random, hasher } from './fixed.js';
import { MM, buildMap, stepAllowed } from './map.js';
import { FlowCache, FAR, NEIGHBOURS, nearestOpen } from './flowfield.js';
import { movementTypes } from './world.js';
import { compileStances, compileBehavior, targetParts, targetScore } from './behavior.js';

export const TICKS_PER_SECOND = 20;
// Alone in the room: a practice opponent with its own landing pad. It gets waves like a player,
// never receives commands and only fights back what comes into sight.
export const PRACTICE_SEAT = 9;
export const PRACTICE = { name: 'Übungsgegner', color: '#9aa3ab' };
const BUCKET = 8 * MM;                    // spatial buckets for neighbours and targets
const MAX_IDS = 120;
const RADIUS = { tank: 2600, werfer: 2400, spaeher: 2100, dozer: 2400, soldat: 450 };
// Body for pushing apart (06.11.): vehicles are capsules along their heading, a circle of radius r
// moved ±core forward/back (tank 8 × 4.4 m, launcher 7.6 × 2.8 m …). Targeting keeps RADIUS.
export const FOOTPRINTS = ['tank', 'werfer', 'spaeher', 'dozer', 'soldat'];
const BODY = { tank: [2300, 1700], werfer: [1500, 2300], spaeher: [1500, 700], dozer: [2200, 400], soldat: [450, 0] };
const SEPARATE_PASSES = 2;
const TURN = { track: 5, wheel: 7, infantry: 40 };
const SHOT_SPEED = { gewehr: 20000, mg: 20000, granate: 12000, rakete: 2600, laser: 100000, flame: 3000, bomb: 1200 };
const PROJECTILE = ['gewehr', 'mg', 'granate', 'rakete', 'laser', 'flame', 'bomb'];
const SALVO_GAP = 3;                      // ticks between shots of a salvo
// Formation (06.11., Daniel: „mehr militärische Formation, weniger Autoscooter“): a drive order splits the
// selection into blocks by arm (vehicles, infantry). Each block gets rows across the direction of march
// (tanks in front, scouts behind, launchers last; infantry as its own block behind the vehicles), marches
// at the pace of its slowest member, waits for stragglers and faces the direction of march on arrival.
const FORMATION = {
  vehicle: { gapX: 7000, gapY: 11000, cols: 5, depth: 4000 },
  infantry: { gapX: 2400, gapY: 2600, cols: 8, depth: 1200 },
};
const PACE_BAND = 4000;                   // ahead of the block's average by more than this: slow down
const LINE_MAX = 160000;                  // straight to the own slot when the way is clear (checked up to 160 m)

// ---------- compile game data into integer types (once per match, not part of the state) ----------
export function compileTypes(setup) {
  const { faction, weapons = {}, combat = {}, world = {}, mode = {} } = setup;
  const stances = compileStances(setup.behavior);
  const table = {};
  for (const [dt, row] of Object.entries(combat.table || {})) {
    table[dt] = {};
    for (const [ar, f] of Object.entries(row)) table[dt][ar] = whole(f * 100);
  }
  const types = {}, order = [];
  const add = (id, t) => { t.index = order.length; order.push(id); types[id] = t; };
  for (const [id, u] of Object.entries(faction.units || {})) {
    const air = u.class === 'air';
    if (air && !u.keywords?.companion) continue; // no aircraft in milestone 1, only companion drones
    const kinds = movementTypes(world, u);
    const movement = kinds.find((k) => k === 'track') || kinds.find((k) => k === 'wheel') || kinds[0] || 'infantry';
    const w = weapons[(u.weapons || [])[0]];
    const kw = u.keywords || {};
    // size class for collisions and aiming: models.json › footprint (vehicle kit), else the model id itself
    const shape = setup.models?.[u.model]?.footprint || u.model;
    add(id, {
      id, name: u.name, cls: u.class, armor: u.armor, model: u.model, shape, movement, squad: u.squad || 1,   // squad: figures in the picture only
      hp: whole((u.health || 100) * 100),
      speed: whole((u.speed || 3) * MM / TICKS_PER_SECOND),
      sight: whole((u.sight || 20) * MM),
      radius: RADIUS[shape] ?? (u.class === 'infantry' ? 450 : 2200),
      body: BODY[shape]?.[0] ?? (u.class === 'infantry' ? 450 : 2000), core: BODY[shape]?.[1] ?? (u.class === 'infantry' ? 0 : 1000),
      turn: TURN[movement] ?? 8,
      tough: whole((typeof kw.tough === 'number' ? kw.tough : kw.tough ? 1 : 0) * 100),
      deploys: !!kw.aufbauen,
      weapon: w ? compileWeapon(w) : null,
      air: air ? 1 : 0,
      repair: air ? whole((typeof kw.repaired === 'number' ? kw.repaired : 0) * 100 / TICKS_PER_SECOND) : 0,
      scout: air && kw.scout ? 1 : 0,
      beh: compileBehavior(setup.behavior, u, stances, TICKS_PER_SECOND),
    });
    if (air) Object.assign(types[id], { radius: 700, body: 700, core: 0, movement: 'air', turn: 24 });
  }
  // loadouts of the mode: { unit: [[equipment, …], …] } in turn per seat → companion unit types
  const loadouts = {};
  for (const [unit, list] of Object.entries(mode.loadout || {})) {
    if (!types[unit] || !Array.isArray(list)) continue;
    loadouts[unit] = list.map((choice) => (choice || []).flatMap((eq) => (faction.equipment?.[eq]?.effect || [])
      .filter((e) => e.kind === 'companion' && types[e.unit]?.air)
      .flatMap((e) => Array.from({ length: Math.max(1, e.count | 0) }, () => e.unit))));
  }
  const padId = mode.pad || 'landeplatz';
  const pad = faction.building?.[padId] || { name: 'Landeplatz', health: 3000, armor: 'building', size: [12, 12] };
  add(padId, {
    id: padId, name: pad.name, cls: 'building', armor: pad.armor || 'building', model: pad.model, building: true,
    hp: whole((pad.health || 3000) * 100), speed: 0, sight: 0, radius: whole(((pad.size || [12])[0]) * MM / 2), turn: 0, tough: 0, weapon: null,
    beh: compileBehavior(null, { class: 'building' }, stances, TICKS_PER_SECOND),
  });
  return { types, order, table, pad: padId, loadouts, stances };
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
    air: (w.targets || []).includes('air'),
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
    this.types = c.types; this.typeOrder = c.order; this.table = c.table; this.padType = c.pad; this.loadouts = c.loadouts; this.stances = c.stances;
    this.issued = {};            // loadouts handed out per seat and unit type (turn order)
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
    this.groups = new Map();     // formation blocks: id → { speed, avg, sum, cnt }
    this.nextGroup = 1;
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
      grp: 0, face: -1, direct: 0, gd: 0, host: 0, slot: 0, eye: 0,
      // behaviour: stance (index into this.stances), pulled back once, took cover once, dodging (ticks, heading), crushed
      st: t.beh.stance, ret: 0, cv: 0, dodge: 0, dh: 0, crushed: 0,
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
      if (u && u.seat === seat && !this.types[u.type].building && !this.types[u.type].air && !own.includes(u)) own.push(u);
    }
    if (!own.length) return;
    if (b.kind === 'stance') {
      const i = this.stances.ids.indexOf(String(b.stance));
      if (i >= 0) for (const u of own) u.st = i;
      return;
    }
    for (const u of own) u.dodge = 0;   // an order beats the own will
    if (b.kind === 'halt') { for (const u of own) { this.stop(u); u.face = -1; } return; }
    if (b.kind === 'attack') {
      const target = this.byId.get(b.target | 0);
      if (!target || target.seat === seat) return;
      for (const u of own) if (this.types[u.type].weapon) { u.order = 2; u.tgt = target.id; u.fkey = -1; u.best = FAR; u.since = 0; u.grp = 0; u.face = -1; }
      return;
    }
    if (b.kind !== 'drive' && b.kind !== 'target') return;
    const size = this.map.size;
    const x = b.x | 0, y = b.y | 0;
    if (x < 0 || y < 0 || x > size || y > size) return;
    let cx = 0, cy = 0;
    for (const u of own) { cx += u.x; cy += u.y; }
    cx = Math.trunc(cx / own.length); cy = Math.trunc(cy / own.length);
    const dir = cx === x && cy === y ? own[0].h : angleOf(x - cx, y - cy);
    const vehicles = own.filter((u) => this.types[u.type].cls !== 'infantry');
    const infantry = own.filter((u) => this.types[u.type].cls === 'infantry');
    const depth = this.formation(vehicles, x, y, dir, cx, cy, FORMATION.vehicle);
    const back = vehicles.length ? depth + 5000 : 0;
    this.formation(infantry, x - Math.trunc(cos(dir) * back / 1024), y - Math.trunc(sin(dir) * back / 1024), dir, cx, cy, FORMATION.infantry);
  }

  // One block: rows across the direction, front rows by role, inside a row by the current side (no crossing).
  // Returns the depth of the block (mm).
  formation(list, px, py, dir, cx, cy, F) {
    if (!list.length) return 0;
    const size = this.map.size;
    px = px < 0 ? 0 : px >= size ? size - 1 : px; py = py < 0 ? 0 : py >= size ? size - 1 : py;
    const c = cos(dir), sn = sin(dir);
    const role = (t) => (t.weapon?.indirect || t.deploys ? 2 : t.movement === 'wheel' ? 1 : 0);
    const info = list.map((u) => {
      const dx = u.x - cx, dy = u.y - cy;
      return { u, role: role(this.types[u.type]), f: Math.trunc((dx * c + dy * sn) / 1024), l: Math.trunc((dy * c - dx * sn) / 1024) };
    });
    info.sort((a, b) => a.role - b.role || b.f - a.f || a.u.id - b.u.id);
    let cols = 1;
    while (cols < F.cols && cols * cols < list.length * 2) cols++;
    const rows = Math.floor((list.length + cols - 1) / cols);
    const k = this.cellOf(px, py);
    let speed = FAR;
    for (const { u } of info) speed = Math.min(speed, this.types[u.type].speed);
    const g = { id: this.nextGroup++, speed, avg: 0, sum: 0, cnt: 0 };
    this.groups.set(g.id, g);
    for (let r = 0; r < rows; r++) {
      const row = info.slice(r * cols, (r + 1) * cols).sort((a, b) => a.l - b.l || a.u.id - b.u.id);
      const m = row.length;
      row.forEach(({ u }, i) => {
        const t = this.types[u.type];
        const lat = ((2 * i - (m - 1)) * F.gapX) >> 1, fwd = -r * F.gapY;
        let gx = px + Math.trunc((fwd * c - lat * sn) / 1024), gy = py + Math.trunc((fwd * sn + lat * c) / 1024);
        [gx, gy] = this.slotNear(t, gx, gy, k, px, py);
        u.order = 1; u.gx = gx; u.gy = gy; u.tgt = 0;
        u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), k);
        u.best = FAR; u.since = 0; u.grp = g.id; u.face = dir; u.direct = 0; u.gd = FAR; u.cv = 0;
      });
    }
    return (rows - 1) * F.gapY + F.depth;
  }

  // a slot on open ground at the level of the goal, else the nearest such cell around it, else the goal
  slotNear(t, gx, gy, k, px, py) {
    const n = this.map.n, cell = this.map.cell, size = this.map.size, lv = this.map.level[k];
    const ok = (x, y) => { if (x < 0 || y < 0 || x >= size || y >= size) return false; const c = this.cellOf(x, y); return this.passable(t, c) && this.map.level[c] === lv; };
    if (ok(gx, gy)) return [gx, gy];
    for (let ring = 1; ring <= 2; ring++) for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
      if (di !== -ring && di !== ring && dj !== -ring && dj !== ring) continue;
      const x = gx + di * cell, y = gy + dj * cell;
      if (ok(x, y)) return [x, y];
    }
    void n;
    return [px, py];
  }

  // straight line from the unit to (x1, y1) over open ground (every metre: passable, no cliff in between)
  clearLine(u, t, x1, y1) {
    const dx = x1 - u.x, dy = y1 - u.y, d = root(dx * dx + dy * dy);
    if (d > LINE_MAX) return false;
    const steps = Math.max(1, Math.trunc(d / 1000));
    let prev = this.cellOf(u.x, u.y);
    for (let s = 1; s <= steps; s++) {
      const c = this.cellOf(u.x + Math.trunc(dx * s / steps), u.y + Math.trunc(dy * s / steps));
      if (c === prev) continue;
      if (!this.passable(t, c) || !stepAllowed(this.map, prev, c) || !this.corner(prev, c, t)) return false;
      prev = c;
    }
    return true;
  }

  // the nearest own vehicle right in front (inside the width of both bodies), for keeping distance
  blocker(u, t, h) {
    const c = cos(h), sn = sin(h);
    let best = null, bestF = FAR, bestL = 0;
    this.around(u.x, u.y, 9000, (e) => {
      if (e === u || e.seat !== u.seat || e.hp <= 0) return;
      const te = this.types[e.type];
      if (te.building || te.cls === 'infantry' || te.air) return;
      const dx = e.x - u.x, dy = e.y - u.y;
      const f = Math.trunc((dx * c + dy * sn) / 1024);
      if (f <= 0 || f >= t.body + t.core + te.body + te.core + 2000) return;
      const l = Math.trunc((dy * c - dx * sn) / 1024);
      if ((l < 0 ? -l : l) >= t.body + te.body + 400) return;
      if (f < bestF || (f === bestF && best && e.id < best.id)) { best = e; bestF = f; bestL = l; }
    });
    return best ? { e: best, l: bestL } : null;
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
      if (t.air) { this.drone(u, t); continue; }
      this.mind(u, t);
      if (t.weapon) this.aim(u, t);
      this.move(u, t);
    }
    this.separate();
    this.pace();
    for (const u of this.units) {
      const t = this.types[u.type];
      if (t.weapon && u.hp > 0) this.fire(u, t);
    }
    this.flight();
    if (this.wind.rest > 0) this.wind.rest--;
    this.cleanup();
  }

  // average remaining distance per block (for the next step); empty blocks are gone
  pace() {
    for (const [id, g] of this.groups) {
      if (!g.cnt) { this.groups.delete(id); continue; }
      g.avg = Math.trunc(g.sum / g.cnt); g.sum = 0; g.cnt = 0;
    }
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
      let count = this.units.filter((u) => u.seat === seat && u.hp > 0 && !this.types[u.type].building && !this.types[u.type].air).length;
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
            this.equip(u, seat, type);
          }
        }
      }
      this.events.push({ kind: 'wave', seat, x: pad.x, y: pad.y, n: this.waveCount });
    }
  }

  // the next loadout in turn for this seat and type: spawn its companion drones next to the unit
  equip(u, seat, type) {
    const list = this.loadouts[type];
    if (!list || !list.length) return;
    const issued = this.issued[seat] || (this.issued[seat] = {});
    const n = issued[type] | 0;
    issued[type] = n + 1;
    list[n % list.length].forEach((drone, i) => {
      const d = this.spawn(drone, seat, u.x, u.y, u.h);
      d.host = u.id; d.slot = i;
      this.events.push({ kind: 'spawn', id: d.id, seat, x: d.x, y: d.y });
    });
  }

  // a drone: hover beside the host (slowly circling), take over its target if in reach, repair it, lend it sight
  drone(u, t) {
    const host = this.byId.get(u.host);
    if (!host || host.hp <= 0) { u.hp = 0; return; }
    const ht = this.types[host.type];
    const a = (host.h + 64 + u.slot * 128 + (this.tick >> 2)) & 255;
    const r = ht.body + ht.core + 2500;
    const wx = host.x + Math.trunc(cos(a) * r / 1024), wy = host.y + Math.trunc(sin(a) * r / 1024);
    const dx = wx - u.x, dy = wy - u.y, d = root(dx * dx + dy * dy);
    const sp = t.speed;
    if (d > 0) {
      const s = d < sp ? d : sp;
      u.x += Math.trunc(dx * s / d); u.y += Math.trunc(dy * s / d);
      u.moved = 1;
    }
    const size = this.map.size - 1;
    u.x = u.x < 0 ? 0 : u.x > size ? size : u.x; u.y = u.y < 0 ? 0 : u.y > size ? size : u.y;
    if (t.weapon) {
      const ht2 = host.tgt ? this.byId.get(host.tgt) : null;
      if (ht2 && ht2.hp > 0 && (this.types[ht2.type].air ? t.weapon.air : t.weapon.ground)) {
        const ex = ht2.x - u.x, ey = ht2.y - u.y;
        if (root(ex * ex + ey * ey) <= this.range(u, t, ht2)) u.tgt = ht2.id; else this.aim(u, t);
      } else this.aim(u, t);
    }
    const tg = u.tgt ? this.byId.get(u.tgt) : null;
    const want = tg ? angleOf(tg.x - u.x, tg.y - u.y) : d > 300 ? angleOf(dx, dy) : host.h;
    const diff = angleDiff(u.h, want);
    u.h = (diff > t.turn ? u.h + t.turn : diff < -t.turn ? u.h - t.turn : want) & 255;
    if (t.repair && host.hp < ht.hp) host.hp = Math.min(ht.hp, host.hp + t.repair);
    if (t.scout) host.eye = t.sight;
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
  // Rated by the unit's behaviour profile (target weights, behavior.js): counter, threat, finish, near, buildings.
  // The current target is kept while it stays in reach; every 2 s the unit looks again and switches only to a
  // clearly better one (more than 10 % higher score).
  aim(u, t) {
    const cur = u.tgt ? this.byId.get(u.tgt) : null;
    if (u.order === 2) {
      if (cur && cur.hp > 0) return;
      this.stop(u); // target gone
    }
    const S = this.stances.list[u.st] || this.stances.list[0];
    if (!S.fire && !t.air) { u.tgt = 0; u.eye = 0; return; }   // hold fire: only on order
    let keepCur = false;
    if (cur && cur.hp > 0) {
      const dx = cur.x - u.x, dy = cur.y - u.y, d = root(dx * dx + dy * dy);
      const keep = u.order === 1 ? this.range(u, t, cur) : (u.eye > t.sight ? u.eye : t.sight) + this.types[cur.type].radius;
      if (d <= keep) {
        if ((this.tick + u.id) % 40 !== 0) return;
        keepCur = true;
      }
    }
    if (!keepCur) {
      if (u.tgt && u.order === 0 && !S.returns) { u.ax = u.x; u.ay = u.y; }   // aggressive: stays where the fight ended
      u.tgt = 0;
      if ((this.tick + u.id) % 8 !== 0 && !cur) return; // look around every 8 steps, staggered
    }
    const reach = u.order === 1 ? t.weapon.range + 3000 : (u.eye > t.sight ? u.eye : t.sight);
    u.eye = 0; // a scout drone renews it every step
    const W = t.beh.weights, my = t.weapon.damageType;
    let best = null, bestScore = 0, bestD = FAR, curScore = null;
    this.around(u.x, u.y, reach + 8000, (e) => {
      if (e.seat === u.seat || e.hp <= 0) return;
      const et = this.types[e.type];
      if (et.air ? !t.weapon.air : !t.weapon.ground) return;
      const dx = e.x - u.x, dy = e.y - u.y, d0 = root(dx * dx + dy * dy) - et.radius, d = d0 < 0 ? 0 : d0;
      if (d > reach && e !== cur) return;
      const score = targetScore(W, targetParts({
        myFactor: this.table[my]?.[et.armor] ?? 100,
        itsFactor: et.weapon ? (this.table[et.weapon.damageType]?.[t.armor] ?? 100) : 0,
        shootsMe: e.tgt === u.id, hpPct: Math.trunc(e.hp * 100 / et.hp), distance: d, reach, building: et.building,
      }));
      if (e === cur) curScore = score;
      if (d > reach) return;
      if (!best || score > bestScore || (score === bestScore && (d < bestD || (d === bestD && e.id < best.id)))) { best = e; bestScore = score; bestD = d; }
    });
    if (keepCur && curScore !== null) {
      const margin = Math.trunc((curScore < 0 ? -curScore : curScore) / 10);
      if (best === cur || bestScore <= curScore + margin) return;
    }
    if (best) {
      const first = !u.tgt;
      u.tgt = best.id;
      if (first && u.order === 0) this.takeCover(u, t, S);
    }
  }

  // ----- the unit's own will (behaviour profile and stance) -----
  mind(u, t) {
    const B = t.beh, S = this.stances.list[u.st] || this.stances.list[0];
    // „Vorsichtig“: below the profile's threshold pull back to the own landing pad, once
    if (S.retreat && !u.ret && u.hp * 100 < t.hp * B.retreatAt) {
      const pad = this.units.find((p) => p.seat === u.seat && p.type === this.padType && p.hp > 0);
      u.ret = 1;
      if (pad) {
        const [gx, gy] = this.freeSpot(pad, t, 8 + (u.id % 16));
        u.order = 1; u.gx = gx; u.gy = gy; u.grp = 0; u.face = -1; u.direct = 0; u.gd = FAR; u.best = FAR; u.since = 0; u.tgt = 0;
        u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(gx, gy));
        this.events.push({ kind: 'retreat', id: u.id, seat: u.seat, x: u.x, y: u.y });
      }
    }
    if (u.dodge > 0 || !S.dodges) return;   // dodging already, or a stance that never gives way („Stellung halten“)
    // leave the impact point of artillery that is on its way (only shells that fly to a spot, not homing ones)
    if (B.dodgeArtillery && (this.tick + u.id) % 4 === 0) {
      for (const p of this.projectiles) {
        if (!p.indirect || p.seat === u.seat || p.t < 3) continue;
        const dx = u.x - p.x, dy = u.y - p.y, r = p.splash + t.radius + 1500;
        if (dx > r || dx < -r || dy > r || dy < -r || dx * dx + dy * dy > r * r) continue;
        u.dodge = p.t + 4 < 40 ? p.t + 4 : 40;
        u.dh = dx === 0 && dy === 0 ? (u.id * 37) & 255 : angleOf(dx, dy);
        return;
      }
    }
    // jump aside when an enemy vehicle that crushes comes straight at me (noticed after the reaction time)
    if (B.dodges && (this.tick + u.id) % B.reaction === 0) {
      let hit = null, hitF = FAR, hitL = 0;
      this.around(u.x, u.y, 14000, (e) => {
        if (e.seat === u.seat || e.hp <= 0 || !e.moved) return;
        const te = this.types[e.type];
        if (!te.beh.crushes || te.cls === 'infantry' || te.air || te.building) return;
        const c = cos(e.h), sn = sin(e.h), dx = u.x - e.x, dy = u.y - e.y;
        const f = Math.trunc((dx * c + dy * sn) / 1024), l = Math.trunc((dy * c - dx * sn) / 1024);
        if (f <= 0 || f > te.body + te.core + 9000) return;
        if ((l < 0 ? -l : l) > te.body + t.body + 1200) return;
        if (f < hitF || (f === hitF && hit && e.id < hit.id)) { hit = e; hitF = f; hitL = l; }
      });
      if (hit) { u.dodge = 20; u.dh = (hit.h + (hitL >= 0 ? 64 : -64)) & 255; }
    }
  }

  // infantry (profile cover.seek) runs into the nearest cover within the radius when a fight starts
  takeCover(u, t, S) {
    const B = t.beh;
    if (!B.seek || u.cv || !S.chase || !B.coverRadius) return;
    u.cv = 1;
    const cov = this.coverPct[t.movement];
    if (!cov) return;
    const k0 = this.cellOf(u.x, u.y);
    if (cov[this.map.ground[k0]] > 0) return;   // already in cover
    const n = this.map.n, cell = this.map.cell, R = Math.trunc(B.coverRadius / cell) + 1, i0 = k0 % n, j0 = (k0 - i0) / n;
    let best = -1, bestQ = FAR;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i, q = (di * di + dj * dj) * cell * cell;
      if (q > B.coverRadius * B.coverRadius || !(cov[this.map.ground[k]] > 0) || !this.passable(t, k) || this.map.level[k] !== this.map.level[k0]) continue;
      if (q < bestQ) { bestQ = q; best = k; }
    }
    if (best < 0) return;
    const bi = best % n, bj = (best - bi) / n;
    u.order = 1; u.gx = bi * cell + (cell >> 1); u.gy = bj * cell + (cell >> 1); u.grp = 0; u.face = -1; u.direct = 0; u.gd = FAR; u.best = FAR; u.since = 0;
    u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), best);
  }

  // ----- movement -----
  move(u, t) {
    if (t.speed === 0) return;
    if (u.dodge > 0) {   // jumping aside / out of an impact point: quick steps, nothing else
      u.dodge--;
      const k = this.cellOf(u.x, u.y), pct = this.speedPct[t.movement][this.map.ground[k]];
      const s = Math.trunc(t.speed * 2 * (pct > 0 ? pct : 0) / 100);   // sprint
      if (s > 0 && this.place(u, t, u.x + Math.trunc(cos(u.dh) * s / 1024), u.y + Math.trunc(sin(u.dh) * s / 1024))) { u.h = u.dh; u.moved = 1; }
      return;
    }
    const S = this.stances.list[u.st] || this.stances.list[0];
    let goalX, goalY, field = -1, arrive = Math.max(t.radius, t.speed * 2);
    if (u.order === 2) {
      const e = this.byId.get(u.tgt);
      if (!e) return;
      const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy);
      if (d <= this.range(u, t, e) - 1500 && !this.runsOver(t, e)) return; // in range: stand and shoot
      goalX = e.x; goalY = e.y; arrive = 0;
      if (u.fkey < 0 || (this.tick + u.id) % 20 === 0) u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(e.x, e.y));
      field = u.fkey;
    } else if (u.order === 1) {
      goalX = u.gx; goalY = u.gy; field = u.fkey;
    } else {
      // idle: chase what is in sight as far as the stance allows (leash = sight × chase %), then hold the new
      // spot (aggressive) or go back to the old one (stances with „returns“)
      const e = u.tgt ? this.byId.get(u.tgt) : null;
      const lx = u.x - u.ax, ly = u.y - u.ay, away = root(lx * lx + ly * ly);
      const home = () => {
        if (!S.returns || away <= 3000) return false;
        goalX = u.ax; goalY = u.ay; arrive = 1500;
        field = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(u.ax, u.ay));
        return true;
      };
      if (!e) { if (!home()) { this.turnTo(u, t); return; } }
      else {
        const dx = e.x - u.x, dy = e.y - u.y, d = root(dx * dx + dy * dy);
        if (d <= this.range(u, t, e) - 1500 && !(S.chase && this.runsOver(t, e))) return;
        if (u.cv && t.beh.seek && this.coverPct[t.movement]?.[this.map.ground[this.cellOf(u.x, u.y)]] > 0) return;   // stays in cover
        if (!S.chase || away > Math.trunc(t.sight * S.chase / 100)) { if (!home()) return; } // leash
        else {
          goalX = e.x; goalY = e.y; arrive = 0;
          if (u.fkey < 0 || (this.tick + u.id) % 20 === 0) u.fkey = nearestOpen(this.map, this.flow.cost(t.movement), this.cellOf(e.x, e.y));
          field = u.fkey;
        }
      }
    }
    const gx = goalX - u.x, gy = goalY - u.y;
    const gd = root(gx * gx + gy * gy);
    if (u.order === 1) {
      u.gd = gd;
      const g = u.grp ? this.groups.get(u.grp) : null;
      if (g) { g.sum += gd; g.cnt++; }
      if (gd <= arrive) { this.stop(u); return; }
      // not getting closer for 2 s (crowd at the goal, blocked): good enough when near, else keep trying
      if (gd < u.best - 300) { u.best = gd; u.since = 0; }
      else if (++u.since > 40 && gd < 6000 + 1500 * root(this.groupNear(u))) { this.stop(u); return; }
      else if (u.since > 200) { this.stop(u); return; }
    }
    // direction: flowfield gradient far away, straight line in the last metres
    let vx = gx, vy = gy;
    const k = this.cellOf(u.x, u.y);
    if (u.order === 1 && (this.tick + u.id) % 10 === 0) u.direct = this.clearLine(u, t, goalX, goalY) ? 1 : 0;
    if (field >= 0 && gd > 2 * this.map.cell + 2000 && !(u.order === 1 && u.direct)) {
      const f = this.flow.field(t.movement, field);
      if (f.dist[k] >= FAR) { if (u.order === 1) this.stop(u); return; } // unreachable
      const v = this.gradient(f, k, t);
      if (v) { vx = v[0]; vy = v[1]; }
    }
    if (vx === 0 && vy === 0) return;
    let want = angleOf(vx, vy);
    // pace of the block: the slowest member's speed; ahead of the others → slower, behind → own top speed
    let top = t.speed;
    const g = u.order === 1 && u.grp ? this.groups.get(u.grp) : null;
    if (g && g.avg) {
      top = g.speed;
      if (gd + PACE_BAND < g.avg) top = Math.trunc(g.speed * 3 / 5);
      else if (gd > g.avg + PACE_BAND) top = t.speed;
    }
    // vehicles keep their distance: follow the one in front, go round one that stands
    if (t.cls !== 'infantry') {
      const b = this.blocker(u, t, want);
      if (b) {
        const tb = this.types[b.e.type];
        if (b.e.order) top = Math.min(top, tb.speed);
        else if (!(u.order === 2 && b.e.id === u.tgt)) { want = (want + (b.l >= 0 ? -24 : 24)) & 255; top = top >> 1; }
      }
    }
    const diff = angleDiff(u.h, want);
    const ad = diff < 0 ? -diff : diff;
    if (ad <= t.turn) u.h = want;
    else u.h = (u.h + (diff > 0 ? t.turn : -t.turn)) & 255;
    // tracks turn on the spot, wheels slow down in curves, infantry just walks
    let pct = this.speedPct[t.movement][this.map.ground[k]];
    if (ad > 40) pct = t.movement === 'track' ? 0 : t.movement === 'wheel' ? pct >> 1 : pct;
    if (pct <= 0) return;
    let s = Math.trunc(top * pct / 100);
    if (arrive > 0 && gd < s) s = gd;
    const nx = u.x + Math.trunc(cos(u.h) * s / 1024), ny = u.y + Math.trunc(sin(u.h) * s / 1024);
    this.place(u, t, nx, ny);
    u.moved = 1;
  }

  // a vehicle that crushes drives right into enemy infantry instead of stopping at weapon range (Generals)
  runsOver(t, e) {
    if (!t.beh.crushes || t.cls === 'infantry' || t.air) return false;
    const te = this.types[e.type];
    return te.cls === 'infantry' && !te.air;
  }

  // standing without anything to do: turn to the direction of the last march (formation faces forward)
  turnTo(u, t) {
    if (u.face < 0 || t.turn === 0) return;
    const diff = angleDiff(u.h, u.face), ad = diff < 0 ? -diff : diff;
    if (ad <= t.turn) { u.h = u.face; u.face = -1; }
    else u.h = (u.h + (diff > 0 ? t.turn : -t.turn)) & 255;
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

  // Units push each other apart; infantry gives way to vehicles.
  // Vehicles are capsules (three circles along the heading), so long tanks no longer slide into each other
  // nose first. Two passes per step settle crowds; the order is the unit order (deterministic).
  separate() {
    for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
      for (const a of this.units) {
        const ta = this.types[a.type];
        if (ta.building || ta.air || a.hp <= 0) continue;
        const ea = ta.body + ta.core;
        this.around(a.x, a.y, 8000, (b) => {
          if (b.id <= a.id || b.hp <= 0) return;
          const tb = this.types[b.type];
          if (tb.building || tb.air) return;
          const reach = ea + tb.body + tb.core;
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) return;
          const min = ta.body + tb.body;
          // closest pair of body circles (centre, front, back)
          const ax = ta.core ? Math.trunc(cos(a.h) * ta.core / 1024) : 0, ay = ta.core ? Math.trunc(sin(a.h) * ta.core / 1024) : 0;
          const bx = tb.core ? Math.trunc(cos(b.h) * tb.core / 1024) : 0, by = tb.core ? Math.trunc(sin(b.h) * tb.core / 1024) : 0;
          let wx = 0, wy = 0, wq = -1;
          for (let i = ta.core ? -1 : 0; i <= (ta.core ? 1 : 0); i++) for (let j = tb.core ? -1 : 0; j <= (tb.core ? 1 : 0); j++) {
            const ex = dx + j * bx - i * ax, ey = dy + j * by - i * ay, q = ex * ex + ey * ey;
            if (wq < 0 || q < wq) { wq = q; wx = ex; wy = ey; }
          }
          if (wq >= min * min) return;
          // a moving enemy vehicle that crushes runs infantry over
          if (a.seat !== b.seat) {
            if (a.moved && ta.beh.crushes && ta.cls !== 'infantry' && tb.cls === 'infantry') { b.hp = 0; b.crushed = 1; return; }
            if (b.moved && tb.beh.crushes && tb.cls !== 'infantry' && ta.cls === 'infantry') { a.hp = 0; a.crushed = 1; return; }
          }
          const d = root(wq);
          const deep = Math.trunc((min - d) / 2) + 1;
          let nx, ny;
          if (d > 0) { nx = Math.trunc(wx * deep / d); ny = Math.trunc(wy * deep / d); }
          else { nx = (a.id & 1) ? deep : -deep; ny = 0; }
          // weight: the heavier one moves less, standing units yield to moving ones
          let wa = ta.body + ta.core, wb = tb.body + tb.core;
          if (!a.moved && b.moved) wa >>= 1; else if (a.moved && !b.moved) wb >>= 1;
          const sa = Math.trunc(nx * 2 * wb / (wa + wb)), sb = Math.trunc(nx * 2 * wa / (wa + wb));
          const ta2 = Math.trunc(ny * 2 * wb / (wa + wb)), tb2 = Math.trunc(ny * 2 * wa / (wa + wb));
          this.place(a, ta, a.x - sa, a.y - ta2);
          this.place(b, tb, b.x + sb, b.y + tb2);
        });
      }
    }
  }

  // ----- weapons -----
  fire(u, t) {
    const w = t.weapon;
    if (u.cd > 0) u.cd--;
    if (u.salvo > 0 && u.gap > 0) { u.gap--; }
    const e = u.tgt ? this.byId.get(u.tgt) : null;
    if (!e || e.hp <= 0) { u.salvo = 0; return; }
    if (this.types[e.type].air ? !w.air : !w.ground) return;
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
    this.events.push({ kind: 'shot', src: u.id, tgt: e.id, seat: u.seat, x: u.x, y: u.y, tx, ty, projectile: w.projectile, time });
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
          if (v.seat === p.seat || v.hp <= 0 || this.types[v.type].air) return;
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
    if (!v.tgt && !t.building && !t.air && v.order === 0 && p.src && (this.stances.list[v.st] || this.stances.list[0]).fire) v.tgt = p.src;
  }

  cleanup() {
    if (this.units.some((u) => u.hp <= 0)) {
      const alive = [];
      for (const u of this.units) {
        if (u.hp > 0) { alive.push(u); continue; }
        this.byId.delete(u.id);
        this.events.push({ kind: 'dead', id: u.id, seat: u.seat, type: u.type, x: u.x, y: u.y, h: u.h, crushed: u.crushed });
      }
      this.units = alive;
    }
    if (this.seats.length < 2) return;
    const living = this.seats.filter((s) => this.units.some((u) => u.seat === s && !this.types[u.type].air));
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
      h.mix(u.grp); h.mix(u.face); h.mix(u.direct); h.mix(u.host); h.mix(u.eye);
      h.mix(u.st); h.mix(u.ret); h.mix(u.cv); h.mix(u.dodge); h.mix(u.dh); h.mix(u.ax); h.mix(u.ay);
    }
    for (const [id, g] of this.groups) { h.mix(id); h.mix(g.speed); h.mix(g.avg); }
    for (const seat of Object.keys(this.issued)) for (const [type, n] of Object.entries(this.issued[seat])) { h.mix(seat | 0); h.mix(this.types[type].index); h.mix(n); }
    for (const p of this.projectiles) { h.mix(p.src); h.mix(p.tgt); h.mix(p.x); h.mix(p.y); h.mix(p.t); h.mix(p.dmg); }
    if (this.over) { h.mix(this.over.winner); h.mix(this.over.tick); }
    return h.text();
  }
}

export function newBattle(setup) { return (seed, seats) => new Battle(seed, seats, setup); }
