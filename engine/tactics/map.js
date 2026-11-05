// NomadTactics – maps: from a small JSON description to a ground grid.
// A map describes one wedge (quadrant or half) with shapes; symmetry fills the rest.
// Runs inside the lockstep (paths and speeds depend on it): integers only.
//
// Format (projects/nomadtactics/maps/<id>.json):
//   { name, size, meter, symmetry: off|rotate_2|rotate_4|mirror_x|mirror_y,
//     base: { ground, level }, slots: [[x, y], …] (metres, inside the wedge),
//     shapes: [{ rect: [x0, y0, x1, y1] | circle: [x, y, r] | path: [[x, y], …], width?,
//                ground?, level?, ramp? }, …] }   later shapes paint over earlier ones.

import { root } from './fixed.js';

export const MM = 1000; // 1 m = 1000 world units

export function buildMap(def, world) {
  const grid = world?.maps?.groundGrid || 2;
  const meter = def.meter || world?.maps?.sizes?.[def.size]?.meter || 256;
  const n = Math.floor(meter / grid);
  const cell = grid * MM;
  const grounds = Object.keys(world?.terrains || { grass: {} });
  const gIndex = Object.fromEntries(grounds.map((g, i) => [g, i]));
  const base = gIndex[def.base?.ground ?? 'grass'] ?? 0;
  const ground = new Uint8Array(n * n).fill(base);
  const level = new Int8Array(n * n).fill(def.base?.level | 0);
  const ramp = new Uint8Array(n * n);
  const sym = def.symmetry || 'off';
  const shapes = (def.shapes || []).map((s) => ({ ...s, g: s.ground != null ? gIndex[s.ground] : undefined }));

  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [ci, cj] = canonical(i, j, n, sym);
    // cell centre in mm, inside the wedge
    const x = ci * cell + (cell >> 1), y = cj * cell + (cell >> 1);
    const k = j * n + i;
    for (const s of shapes) {
      if (!inside(s, x, y)) continue;
      if (s.g !== undefined) ground[k] = s.g;
      if (s.level !== undefined) level[k] = s.level;
      if (s.ramp !== undefined) ramp[k] = s.ramp ? 1 : 0;
    }
  }
  const slots = slotsOf(def, n, cell, sym);
  return { id: def.id, name: def.name, n, cell, size: n * cell, grounds, ground, level, ramp, slots, symmetry: sym };
}

// Folds a cell into the wedge the shapes are written for
export function canonical(i, j, n, sym) {
  const h = n >> 1;
  if (sym === 'rotate_4') {
    for (let k = 0; k < 4 && !(i < h && j < h); k++) { const t = i; i = n - 1 - j; j = t; }
    return [i, j];
  }
  if (sym === 'rotate_2') return j < h ? [i, j] : [n - 1 - i, n - 1 - j];
  if (sym === 'mirror_x') return i < h ? [i, j] : [n - 1 - i, j];
  if (sym === 'mirror_y') return j < h ? [i, j] : [i, n - 1 - j];
  return [i, j];
}

// Start slots: the wedge slots, then their copies (so slot 0 and the opposite one come first for 2 players)
function slotsOf(def, n, cell, sym) {
  const full = n * cell;
  const own = (def.slots || []).map(([x, y]) => [Math.floor(x * MM), Math.floor(y * MM)]);
  const rot = ([x, y]) => [full - y, x]; // 90° about the centre, same as canonical in reverse
  if (sym === 'rotate_4') {
    const out = [];
    for (const p of own) { const a = rot(p), b = rot(a), c = rot(b); out.push(p, b, a, c); }
    return out;
  }
  if (sym === 'rotate_2') return own.flatMap(([x, y]) => [[x, y], [full - x, full - y]]);
  if (sym === 'mirror_x') return own.flatMap(([x, y]) => [[x, y], [full - x, y]]);
  if (sym === 'mirror_y') return own.flatMap(([x, y]) => [[x, y], [x, full - y]]);
  return own;
}

function inside(s, x, y) {
  if (s.rect) {
    const [x0, y0, x1, y1] = s.rect.map((v) => Math.floor(v * MM));
    return x >= Math.min(x0, x1) && x < Math.max(x0, x1) && y >= Math.min(y0, y1) && y < Math.max(y0, y1);
  }
  if (s.circle) {
    const [cx, cy, r] = s.circle.map((v) => Math.floor(v * MM));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }
  if (s.path) {
    const w = Math.floor((s.width || 6) * MM / 2);
    const p = s.path.map(([a, b]) => [Math.floor(a * MM), Math.floor(b * MM)]);
    for (let k = 0; k + 1 < p.length; k++) if (segmentDistance(x, y, p[k], p[k + 1]) <= w) return true;
    return false;
  }
  return false;
}

function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
  const ll = vx * vx + vy * vy;
  let px = ax, py = ay;
  if (ll > 0) {
    let t = Math.floor((wx * vx + wy * vy) * 1024 / ll);
    t = t < 0 ? 0 : t > 1024 ? 1024 : t;
    px = ax + Math.floor(vx * t / 1024); py = ay + Math.floor(vy * t / 1024);
  }
  const dx = x - px, dy = y - py;
  return root(dx * dx + dy * dy);
}

// Can a unit step from cell a to the neighbour cell b? Cliffs block, ramps connect one level.
export function stepAllowed(map, a, b) {
  const la = map.level[a], lb = map.level[b];
  if (la === lb) return true;
  const d = la > lb ? la - lb : lb - la;
  return d === 1 && (map.ramp[a] === 1 || map.ramp[b] === 1);
}
