// NomadTactics – liveliness of units and buildings in the 3D view (Fidelity step 2, Daniel 06.11.).
// Pure optics. Everything comes from the profiles in data/life.json (engine/tactics/life.js), so every model
// with a profile gets the same treatment: suspension and terrain tilt, recoil, muzzle flash and smoke,
// casings, dust and exhaust, damage stages (missing voxels, soot, smoke, fire).
// Helpers here know no scene; battle_3d.js calls them per frame.

const hash = (x, y, z, s = 0) => {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (s * 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Size of a voxel model in voxels: { lo: [x,y,z], hi: [x,y,z] }
export function bounds(W) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const k of W.keys()) { const p = k.split(',').map(Number); for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; } }
  return { lo, hi };
}

// Muzzle in model coordinates (m): the frontmost voxel, the highest of them (barrel tip, rifle, rocket box)
export function muzzleOf(W, scale) {
  let best = null;
  for (const k of W.keys()) {
    const [x, y, z] = k.split(',').map(Number);
    if (!best || z > best[2] || (z === best[2] && y > best[1])) best = [x, y, z];
  }
  return best ? [best[0] * scale, (best[1] + 0.5) * scale, (best[2] + 0.5) * scale] : [0, scale, scale];
}

// Damaged variant of a model for one stage: drops `missing` % of the exposed voxels (the same order for every
// stage, so heavier damage only takes more away) and returns the soot share for the mesher.
// Bottom layer (tracks, wheels, plates) stays, so the model still stands.
export function damagedModel(W, stage, seed = 7) {
  if (!stage || !stage.missing) return W;
  const exposed = [];
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    if (y < 1 || kind === 'track' || kind === 'tires') continue;
    if (NEIGHBOURS.some(([a, b, c]) => !W.has(`${x + a},${y + b},${z + c}`))) exposed.push([k, hash(x >> 1, y >> 1, z >> 1, seed) * 0.6 + hash(x, y, z, seed + 1) * 0.4 - y * 0.004]);
  }
  exposed.sort((a, b) => a[1] - b[1]);
  const n = Math.round(exposed.length * stage.missing / 100);
  const D = new Map(W);
  for (let i = 0; i < n; i++) D.delete(exposed[i][0]);
  return D;
}

// Soot per voxel for the mesher: chunky patches, stronger at the top (0…1)
export function sootAt(share, seed = 3) {
  if (!share) return null;
  return (x, y, z) => {
    const blob = hash(x >> 1, y >> 1, z >> 1, seed);
    return Math.min(1, share * (0.25 + blob * 1.1)) * (blob < 1 - share * 0.9 ? 0.35 : 1);
  };
}

// Damped spring towards a target (semi-implicit, stable for big dt): s[key], s[key + 'v']
export function spring(s, key, target, dt, w, zeta) {
  const v = key + 'V';
  const n = Math.max(1, Math.ceil(dt * w / 0.25)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s[v] = (s[v] || 0) + ((target - (s[key] || 0)) * w * w - (s[v] || 0) * 2 * zeta * w) * h;
    s[key] = (s[key] || 0) + s[v] * h;
  }
}

// Barrel recoil curve 0…1 over time since the shot (fast back, slow forward)
export function recoilCurve(ms, recover) {
  if (ms < 0 || ms > recover) return 0;
  const back = Math.min(60, recover * 0.15);
  if (ms < back) return ms / back;
  const q = (ms - back) / (recover - back);
  return (1 - q) * (1 - q);
}

const DEG = Math.PI / 180;
export { DEG };
