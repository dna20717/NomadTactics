// NomadTactics – integer math for the lockstep simulation.
// Same results in every JS engine (V8 on the PC, JavaScriptCore on the iPad):
// only + − * / with Math.floor/trunc, Math.imul and bit operations. No Math.sin/cos/sqrt/random.
//
// Angles are 0 … 255 (256 steps per turn, 0 = +x, 64 = +y). Sine/cosine are scaled by 1024.

export const ANGLE = 256;
export const ONE = 1024;

// sin(i · 2π/256) · 1024 for i = 0 … 64 (quarter wave), precomputed once
const QUARTER = [0, 25, 50, 75, 100, 125, 150, 175, 200, 224, 249, 273, 297, 321, 345, 369, 392, 415, 438, 460, 483, 505, 526, 548, 569, 590, 610, 630, 650, 669, 688, 706, 724, 742, 759, 775, 792, 807, 822, 837, 851, 865, 878, 891, 903, 915, 926, 936, 946, 955, 964, 972, 980, 987, 993, 999, 1004, 1009, 1013, 1016, 1019, 1021, 1023, 1024, 1024];

export function sin(a) {
  a &= 255;
  if (a < 64) return QUARTER[a];
  if (a < 128) return QUARTER[128 - a];
  if (a < 192) return -QUARTER[a - 128];
  return -QUARTER[256 - a];
}
export function cos(a) { return sin(a + 64); }

// Direction of the vector (dx, dy) as angle 0 … 255 (like atan2), by binary search in the quarter wave.
export function angleOf(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  // smallest a in 0 … 64 with ay·cos(a) <= ax·sin(a)
  let lo = 0, hi = 64;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ay * QUARTER[64 - m] <= ax * QUARTER[m]) hi = m; else lo = m + 1;
  }
  // lo is the first angle at or past the true angle; pick the nearer of lo−1 and lo
  if (lo > 0) {
    const e1 = ay * QUARTER[64 - lo] - ax * QUARTER[lo];
    const e0 = ay * QUARTER[64 - lo + 1] - ax * QUARTER[lo - 1];
    if ((e0 < 0 ? -e0 : e0) < (e1 < 0 ? -e1 : e1)) lo--;
  }
  if (dx >= 0 && dy >= 0) return lo;
  if (dx < 0 && dy >= 0) return 128 - lo;
  if (dx < 0) return 128 + lo;
  return (256 - lo) & 255;
}

// Signed difference b − a, range −128 … 127
export function angleDiff(a, b) { return (((b - a) & 255) ^ 128) - 128; }

// Integer square root (Newton), exact and identical everywhere
export function root(n) {
  if (n <= 0) return 0;
  let x = n, y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}

// Round a data value (e.g. 5.5 m/s) into the integer world. Plain multiplication is bit-exact everywhere.
export function whole(v) { return Math.floor(Number(v || 0) + 0.5); }

// mulberry32 with integers only
export class Random {
  constructor(seed) { this.z = (seed >>> 0) || 1; }
  next() {
    let t = (this.z = (this.z + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  number(limit) { return limit > 0 ? this.next() % limit : 0; }
}

// FNV-1a, fed with integers
export function hasher() {
  let h = 0x811c9dc5 | 0;
  return {
    mix(v) { h = Math.imul(h ^ (v | 0), 0x01000193); },
    text() { return (h >>> 0).toString(16).padStart(8, '0'); },
  };
}
