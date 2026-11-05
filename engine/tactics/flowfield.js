// NomadTactics – flowfields: one distance field per (movement type, target cell), shared by a whole group.
// Dijkstra over the ground grid with integer costs from the speed table. Runs inside the lockstep.
// A field is only a cache: computing it again gives the same numbers, so it never goes into the checksum.

import { stepAllowed } from './map.js';

export const FAR = 0x3fffffff;
const STRAIGHT = 1000, DIAGONAL = 1414;
// 8 neighbours: dx, dy
export const NEIGHBOURS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

// cost[k] = cost to enter cell k (0 = blocked), from the speed % of the movement type on its ground
export function costLayer(map, world, movement) {
  const c = new Int32Array(map.n * map.n);
  const per = map.grounds.map((g) => {
    const s = world?.terrains?.[g]?.speed?.[movement];
    const v = s == null ? (world?.movementTypes?.[movement]?.standard ?? 100) : s;
    return v > 0 ? Math.floor(100 * 100 / v) : 0;
  });
  for (let k = 0; k < c.length; k++) c[k] = per[map.ground[k]];
  return c;
}

export class FlowCache {
  constructor(map, world, limit = 48) {
    this.map = map; this.world = world; this.limit = limit;
    this.costs = new Map(); this.fields = new Map();
  }
  cost(movement) {
    if (!this.costs.has(movement)) this.costs.set(movement, costLayer(this.map, this.world, movement));
    return this.costs.get(movement);
  }
  // Ground changed (crater, rubble …): throw everything away, it is just a cache
  clear() { this.costs.clear(); this.fields.clear(); }
  field(movement, target) {
    const key = movement + ':' + target;
    let f = this.fields.get(key);
    if (f) { this.fields.delete(key); this.fields.set(key, f); return f; } // keep recently used at the end
    f = dijkstra(this.map, this.cost(movement), target);
    this.fields.set(key, f);
    if (this.fields.size > this.limit) this.fields.delete(this.fields.keys().next().value);
    return f;
  }
}

// Nearest passable cell to k (for targets on cliffs, in water …), searched in rings
export function nearestOpen(map, cost, k) {
  if (cost[k] > 0) return k;
  const n = map.n, i0 = k % n, j0 = Math.floor(k / n);
  for (let r = 1; r < n; r++) {
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      if (i !== i0 - r && i !== i0 + r && j !== j0 - r && j !== j0 + r) continue;
      const c = j * n + i;
      if (cost[c] > 0) return c;
    }
  }
  return k;
}

function dijkstra(map, cost, target) {
  const n = map.n, N = n * n;
  const dist = new Int32Array(N).fill(FAR);
  target = nearestOpen(map, cost, target);
  // binary heap of [distance, cell] packed into two parallel arrays
  const hd = new Int32Array(N * 4), hc = new Int32Array(N * 4);
  let size = 0;
  const push = (d, c) => {
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (hd[p] < d || (hd[p] === d && hc[p] <= c)) break; hd[i] = hd[p]; hc[i] = hc[p]; i = p; }
    hd[i] = d; hc[i] = c;
  };
  const pop = () => {
    const d = hd[0], c = hc[0];
    const ld = hd[--size], lc = hc[size];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1; if (m >= size) break;
      if (m + 1 < size && (hd[m + 1] < hd[m] || (hd[m + 1] === hd[m] && hc[m + 1] < hc[m]))) m++;
      if (hd[m] > ld || (hd[m] === ld && hc[m] >= lc)) break;
      hd[i] = hd[m]; hc[i] = hc[m]; i = m;
    }
    hd[i] = ld; hc[i] = lc;
    return [d, c];
  };
  dist[target] = 0; push(0, target);
  while (size > 0 && size < N * 4 - 8) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    const ci = c % n, cj = (c - ci) / n;
    for (let q = 0; q < 8; q++) {
      const [dx, dy] = NEIGHBOURS[q];
      const i = ci + dx, j = cj + dy;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i;
      if (cost[k] === 0 || !stepAllowed(map, k, c)) continue;
      // no cutting corners past blocked cells
      if (q >= 4 && (cost[cj * n + i] === 0 || cost[j * n + ci] === 0 || !stepAllowed(map, k, cj * n + i) || !stepAllowed(map, k, j * n + ci))) continue;
      // moving from k towards c costs the ground of k (where the unit drives)
      const nd = d + Math.floor(cost[k] * (q < 4 ? STRAIGHT : DIAGONAL) / 100);
      if (nd < dist[k]) { dist[k] = nd; push(nd, k); }
    }
  }
  return { target, dist };
}
