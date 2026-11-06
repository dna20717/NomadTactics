// NomadTactics – vehicle kit (Daniel 06.11.: „Bau einen Satz neue Fahrzeuge“, all ground vehicles, 0.2 m voxels,
// real wheels). One builder per body type; every vehicle is a parameter set in data/models.json:
//   { source: "kit:<type>", paint: "<scheme>", kit: { …params } }
// A build returns { hull, turret, pivot, scale, wheels } like PROTOTYPES (models.js); wheels are a separate part
// (one wheel model + axle positions in m) so the renderer can spin, steer and spring them one by one.
// Kinds while building: 'c' camo paint (patterned per scheme), 'c1' second paint, 'hd' dark hardware, 'acc' accent,
// plus palette kinds (metall, black, track, tires, glass, lamp, tail, team, yellow …). paint() turns them into palette kinds.
// x = width, y = up, +z = front; voxel (x, y, z) spans x·s ± s/2, y·s … (y+1)·s, z·s ± s/2.
import { PAL, SURFACE, newModel, box } from './models.js';

export const KIT_SCALE = 0.2;

// ---------- paint schemes (Daniel's faction identity) ----------
// camo: up to three colours, pattern mono | blotch | stripes; second = panels/canvas, dark = hardware, accent = markings
export const PAINTS = {
  usa: { name: 'USA (Sand)', camo: [0xb7a27a, 0xa99470], pattern: 'mono', second: 0x6f6a4c, dark: 0x3e4148, accent: 0x2d3a5c },
  china: { name: 'China (Dunkelgrün)', camo: [0x4b5a3b, 0x56634a, 0x6a6e66], pattern: 'blotch', second: 0x6a6e66, dark: 0x343833, accent: 0xa8382c },
  ukraine: { name: 'Ukraine (Oliv/Khaki)', camo: [0x5d673d, 0x8f8459, 0x3f3f2c], pattern: 'blotch', second: 0x8f8459, dark: 0x35352a, accent: 0xd8c25a },
  europa: { name: 'Europa (NATO)', camo: [0x4a5838, 0x5a4934, 0x2b2b27], pattern: 'blotch', second: 0x6b6f6c, dark: 0x31332f, accent: 0x2d4f9e },
  site: { name: 'Baustelle (Gelb)', camo: [0xe2b232, 0xdcab2c], pattern: 'mono', second: 0xb98a22, dark: 0x3a3a35, accent: 0x222222 },
  // uniforms (fabric, pattern per 0.1-m voxel): OCP, Type 07 woodland, MM14, Flecktarn
  usa_u: { name: 'USA Uniform (OCP)', camo: [0x9c8f6b, 0x7d7454, 0xb7a988, 0x5f5a43], pattern: 'pixel', second: 0x6f6a4c, dark: 0x3b3a33, accent: 0x7d7454, fabric: true },
  china_u: { name: 'China Uniform (Type 07)', camo: [0x4d5a3a, 0x3c4630, 0x6b7350, 0x2d3326], pattern: 'pixel', second: 0x55603f, dark: 0x2f3329, accent: 0xa8382c, fabric: true },
  ukraine_u: { name: 'Ukraine Uniform (MM14)', camo: [0x6a6b48, 0x4d4f33, 0x8a7e58, 0x3a3524], pattern: 'pixel', second: 0x5c5a3e, dark: 0x302e25, accent: 0xd8c25a, fabric: true },
  europa_u: { name: 'Europa Uniform (Flecktarn)', camo: [0x5b6644, 0x3f4a30, 0x6e5a3e, 0x2a2b24, 0x7c855a], pattern: 'flecks', second: 0x55604a, dark: 0x2c2e28, accent: 0x2d4f9e, fabric: true },
};
// skin tones for soldiers (one per figure, chosen per unit in the renderer)
export const SKINS = [0xd9a37c, 0xb5835e, 0x7d5539];
for (const [i, c] of SKINS.entries()) { PAL[`skin${i}`] = [c]; SURFACE[`skin${i}`] = 3; }
Object.assign(PAL, { boots: [0x2e2924, 0x352f29], unblue: [0x4a8fd4, 0x5196da], kepi: [0xf1efe8, 0xe8e6de], kepiTop: [0x2a3550], scope: [0x1d1f22] });
Object.assign(SURFACE, { boots: 3, unblue: 5, kepi: 5, kepiTop: 5, scope: 2 });
const shade = (c, f) => { const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f); return (r << 16) | (g << 8) | b; };
const registered = new Set();
function register(id) {
  if (registered.has(id)) return; registered.add(id);
  const P = PAINTS[id] || PAINTS.usa;
  P.camo.forEach((c, i) => { PAL[`${id}_c${i}`] = [c, shade(c, 0.96), shade(c, 1.03)]; SURFACE[`${id}_c${i}`] = P.fabric ? 3 : 0; });
  PAL[`${id}_s`] = [P.second, shade(P.second, 0.95)]; SURFACE[`${id}_s`] = P.fabric ? 3 : 0;
  PAL[`${id}_d`] = [P.dark, shade(P.dark, 1.08)]; SURFACE[`${id}_d`] = 2;
  PAL[`${id}_a`] = [P.accent]; SURFACE[`${id}_a`] = 5;
}
const H = (x, y, z, s = 0) => { let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (s * 2654435761); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function camoAt(P, x, y, z, seed) {
  const n = P.camo.length;
  if (P.pattern === 'mono' || n === 1) return H(x, y, z, seed) < 0.06 && n > 1 ? 1 : 0;
  if (P.pattern === 'pixel') { const v = H(x >> 1, y, z, seed) * 0.6 + H(x, y, z, seed + 3) * 0.4; return v < 0.45 ? 0 : v < 0.7 ? 1 : v < 0.88 ? 2 : Math.min(3, n - 1); }
  if (P.pattern === 'flecks') { const v = H(x, y, z, seed); return v < 0.4 ? 0 : v < 0.62 ? 1 : v < 0.8 ? 2 : v < 0.9 ? 3 : Math.min(4, n - 1); }
  // soft blotches: coarse cells with jittered borders
  const jx = x + Math.round(Math.sin(z * 0.45 + y * 0.3 + seed) * 2), jz = z + Math.round(Math.cos(x * 0.5 + y * 0.2 + seed) * 2);
  const v = H(Math.floor(jx / 6), Math.floor(y / 5), Math.floor(jz / 7), seed);
  return v < 0.5 ? 0 : v < 0.82 ? 1 : Math.min(2, n - 1);
}
export function paint(W, id, seed = 1) {
  register(id);
  const P = PAINTS[id] || PAINTS.usa, R = new Map();
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    R.set(k, kind === 'c' ? `${id}_c${camoAt(P, x, y, z, seed)}` : kind === 'c1' ? `${id}_s` : kind === 'hd' ? `${id}_d` : kind === 'acc' ? `${id}_a` : kind);
  }
  return R;
}

// ---------- shared pieces ----------
const sym = (s) => (x, y, z, k) => { s(x, y, z, k); s(-x, y, z, k); };
// track unit on one side: band (top/bottom runs, rounded ends), road wheels on the outer face, dark gap inside
function trackUnit(s, xOut, xIn, z0, z1, h) {
  const dir = Math.sign(xOut) || 1;
  for (let x = Math.min(xIn, xOut); x <= Math.max(xIn, xOut); x++) {
    for (let z = z0 + 2; z <= z1 - 2; z++) s(x, 0, z, 'track');
    for (let z = z0; z <= z1; z++) s(x, h - 1, z, 'track');
    for (let y = 1; y < h - 1; y++) { s(x, y, z0 + (y < 2 ? 1 : 0), 'track'); s(x, y, z1 - (y < 2 ? 1 : 0), 'track'); }
    for (let y = 1; y < h - 1; y++) for (let z = z0 + 1; z < z1; z++) if (!(y === 1 && (z === z0 + 1 || z === z1 - 1))) s(x, y, z, 'black');
  }
  // road wheels (discs on the outer face), sprocket front, idler back
  const r = Math.max(1, (h - 2) / 2);
  for (let c = z0 + 3; c <= z1 - 3; c += Math.max(3, Math.round(r * 2 + 1))) {
    for (let y = 1; y < h - 1; y++) for (let z = c - 1; z <= c + 1; z++) {
      const d = Math.hypot(y - (h - 1) / 2, z - c);
      if (d <= r + 0.2) s(xOut, y, z, d < r * 0.45 ? 'hd' : 'metall');
    }
  }
  s(xOut, Math.floor(h / 2), z1 - 1, 'hd'); s(xOut, Math.floor(h / 2), z0 + 1, 'hd');
  return dir;
}
// one wheel: tire ring, metal hub, dark centre; voxels around the axle (offset by half a voxel, see `center`)
function wheelModel(R, width = 2) {
  const [W, s] = newModel();
  for (let x = -(width - 1); x <= 0; x++) for (let y = -Math.ceil(R); y < Math.ceil(R); y++) for (let z = -Math.ceil(R); z < Math.ceil(R); z++) {
    const d = Math.hypot(y + 0.5, z + 0.5);
    if (d > R) continue;
    s(x, y, z, d > R - 1.05 ? 'tires' : x === 0 && d < R * 0.3 ? 'hd' : 'metall');
  }
  return W;
}
// wheels on both sides at the given axle positions (z in voxels), axle height = R voxels
function wheels(R, half, axles, width = 2) {
  const S = KIT_SCALE, at = [];
  for (const z of axles) for (const side of [-1, 1]) at.push({ x: side * (half + 0.5) * S, y: R * S, z: z * S, side, front: z > 0 });
  return { W: wheelModel(R, width), at, r: R * S, center: [-(width - 1) * S / 2, 0, -S / 2] };
}
function lights(s, xs, y, zf, zb) { for (const x of xs) { s(x, y, zf, 'lamp'); s(-x, y, zf, 'lamp'); s(x, y, zb, 'tail'); s(-x, y, zb, 'tail'); } }
function barrel(s, x, y, z0, len, { brake = false, sleeve = 0, base = 2 } = {}) {
  for (let z = z0; z < z0 + len; z++) s(x, y, z, z < z0 + base ? 'hd' : z >= z0 + len - 1 ? 'metall' : 'c');
  if (sleeve) for (let z = z0 + Math.round(len * 0.45); z < z0 + Math.round(len * 0.45) + sleeve; z++) { s(x, y + 1, z, 'hd'); s(x, y - 1, z, 'hd'); s(x + 1, y, z, 'hd'); s(x - 1, y, z, 'hd'); }
  if (brake) for (let z = z0 + len - 2; z < z0 + len; z++) { s(x - 1, y, z, 'hd'); s(x + 1, y, z, 'hd'); s(x, y + 1, z, 'hd'); }
}
function mg(s, x, y, z, len = 4) { s(x, y, z, 'hd'); s(x, y + 1, z, 'hd'); for (let i = 1; i <= len; i++) s(x, y + 1, z + i, 'metall'); }

// ---------- body types ----------
// MBT and light tanks (also wheeled tank ZTL-11 via apc + turret: 'mbt')
function mbtHull(p) {
  const [W, s] = newModel();
  const hw = p.width >> 1, zb = -(p.length >> 1), zf = zb + p.length - 1, th = p.trackH, hh = p.hullH, tw = p.trackW;
  trackUnit(s, hw, hw - tw + 1, zb, zf, th); trackUnit(s, -hw, -(hw - tw + 1), zb, zf, th);
  const inner = hw - tw;
  // lower hull between the tracks; lower front plate slopes back down
  for (let y = 1; y <= th; y++) box(s, -inner, inner, y, y, zb + 1, zf - 1 - (th - y), 'c');
  // upper hull with glacis over the full width
  for (let y = th + 1; y <= hh; y++) {
    const front = zf - Math.round((y - th - 1) * p.glacis), back = zb + (y === hh ? 1 : 0);
    box(s, -hw, hw, y, y, back, front, 'c');
  }
  // side skirts over the upper track run, team stripe along the top
  if (p.skirts) for (const x of [-hw, hw]) for (let z = zb + 2; z <= zf - 3; z++) { s(x, th - 1, z, 'c'); s(x, th, z, z % 9 === 0 ? 'hd' : 'c'); s(x, th + 1, z, 'team'); }
  else for (const x of [-hw, hw]) for (let z = zb + 4; z <= zf - 6; z++) s(x, th + 1, z, 'team');
  // engine deck grille, exhaust, lights, tools
  for (let z = zb + 1; z <= zb + 7; z++) for (let x = -hw + 2; x <= hw - 2; x += 2) s(x, hh + 1, z, 'hd');
  for (let x = -3; x <= 3; x++) s(x, th + 2, zb, 'black');
  lights(s, [hw - 1], th + 1, zf - (p.glacis > 1.5 ? 0 : 0), zb);
  if (p.era) for (let y = th + 1; y <= hh; y += 2) for (let x = -hw + 1; x <= hw - 1; x += 3) { const z = zf - Math.round((y - th - 1) * p.glacis) + 1; s(x, y, z, 'c1'); s(x + 1, y, z, 'c1'); }
  if (p.blade) { for (let x = -hw - 1; x <= hw + 1; x++) for (let y = 0; y <= th + 2; y++) s(x, y, zf + 2 + (y < 2 ? 1 : y > th ? -1 : 0), 'metall'); box(s, -hw + 2, -hw + 2, 2, 3, zf, zf + 1, 'hd'); box(s, hw - 2, hw - 2, 2, 3, zf, zf + 1, 'hd'); }
  return W;
}
function mbtTurret(p) {
  const [W, s] = newModel();
  const tl = p.turretL, tw = p.turretW >> 1, th = p.turretH, zf = (tl >> 1) - 1, zb = zf - tl + 1;
  for (let y = 0; y < th; y++) for (let z = zb; z <= zf; z++) {
    let half = tw;
    if (p.shape === 'round') {
      const fz = (z - (zb + zf) / 2) / (tl / 2), fy = y / th;
      half = Math.round(tw * Math.sqrt(Math.max(0, 1 - fz * fz * 0.85)) * (1 - fy * fy * 0.35));
    } else if (p.shape === 'wedge') {
      const wl = Math.round(tl * 0.35);
      if (z > zf - wl) half = Math.max(2, tw - Math.round((z - (zf - wl)) * 1.1));
      if (y === th - 1) half -= 1;
    } else {
      if (z >= zf - 1) half -= 1;
      if (y === th - 1) half -= 1;
    }
    if (z < zb + 3 && y < 1) continue;   // bustle overhang
    if (half > 0) box(s, -half, half, y, y, z, z, 'c');
  }
  // team band across the roof, hatches, cupola + MG, smoke dischargers, mantlet, barrel, ERA bricks, bustle rack
  for (let x = -tw + 1; x <= tw - 1; x++) for (const z of [zb + 3, zb + 4]) if (W.has(`${x},${th - 1},${z}`)) s(x, th - 1, z, 'team');
  box(s, -tw + 2, -tw + 4, th, th, -2, 0, 'hd'); mg(s, -tw + 3, th, 0, 4);
  box(s, tw - 4, tw - 2, th, th, -3, -1, 'hd');
  for (const x of [-tw, tw]) { s(x, th - 2, zf - 4, 'hd'); s(x, th - 2, zf - 5, 'hd'); }
  const by = Math.max(1, th - 3), front = Math.max(...[...W.keys()].map((k) => k.split(',').map(Number)).filter(([x, y]) => x === 0 && y === by).map(([, , z]) => z));
  box(s, -1, 1, by - 1, by + 1, front + 1, front + 1, 'hd');
  barrel(s, 0, by, front + 2, p.barrel, { brake: p.brake, sleeve: p.sleeve ? 2 : 0 });
  if (p.era) for (let y = 0; y < th - 1; y += 2) for (let z = zf - 6; z <= zf; z += 2) for (const x of [-1, 1]) { const edge = [...W.keys()].map((k) => k.split(',').map(Number)).filter(([a, b, c]) => b === y && c === z && Math.sign(a) === x); if (edge.length) { const ex = x > 0 ? Math.max(...edge.map((e) => e[0])) : Math.min(...edge.map((e) => e[0])); s(ex + x, y, z, 'c1'); } }
  if (p.rack) for (let x = -tw + 1; x <= tw - 1; x++) { s(x, 0, zb - 1, 'hd'); s(x, 1, zb - 1, x % 2 ? 'hd' : 'c1'); }
  return W;
}
// Self-propelled howitzer: tank hull, big turret far back, long barrel with muzzle brake
function spgTurret(p) {
  const [W, s] = newModel();
  const tl = p.turretL, tw = p.turretW >> 1, th = p.turretH, zf = (tl >> 1) - 1, zb = zf - tl + 1;
  for (let y = 0; y < th; y++) for (let z = zb; z <= zf; z++) {
    const half = tw - (z >= zf - 1 ? 1 : 0) - (y === th - 1 ? 1 : 0);
    box(s, -half, half, y, y, z, z, 'c');
  }
  for (let x = -tw + 1; x <= tw - 1; x++) s(x, th - 1, zb + 2, 'team');
  box(s, -tw + 2, -tw + 4, th, th, zb + 3, zb + 5, 'hd'); mg(s, -tw + 3, th, zb + 5, 3);
  box(s, -2, 2, 1, 4, zf + 1, zf + 1, 'hd');
  barrel(s, 0, 3, zf + 2, p.barrel, { brake: true, sleeve: 1 });
  for (const x of [-tw - 1, tw + 1]) box(s, x, x, 1, th - 2, zb + 2, zb + 6, 'c1');
  return W;
}
// Rocket pod (HIMARS, PHL-16, M270): tilted box with a tube grid in front
function podTurret(p) {
  const [W, s] = newModel();
  const pl = p.podL, pw = p.podW >> 1, ph = p.podH, zf = (pl >> 1) - 1, zb = zf - pl + 1;
  for (let z = zb; z <= zf; z++) {
    const lift = Math.round((z - zb) * p.tilt);
    for (let y = 0; y < ph; y++) for (let x = -pw; x <= pw; x++) s(x, y + lift, z, z === zf ? ((x + pw) % 2 === 0 && y % 2 === 0 ? 'black' : 'hd') : y === ph - 1 && Math.abs(x) <= 1 && (z - zb) % 6 < 3 ? 'team' : 'c');
  }
  for (let y = -2; y < 0; y++) box(s, -2, 2, y, y, zb + 2, zb + 6, 'hd');
  if (p.pods === 2) for (let z = zb; z <= zf; z++) { const lift = Math.round((z - zb) * p.tilt); for (let y = 0; y < ph; y++) s(0, y + lift, z, 'hd'); }
  return W;
}
// Gun on a truck bed (CAESAR, Bohdana)
function truckGunTurret(p) {
  const [W, s] = newModel();
  box(s, -3, 3, 0, 2, -4, 3, 'c'); box(s, -2, 2, 3, 3, -3, 2, 'c1');
  for (let x = -3; x <= 3; x++) s(x, 2, -4, 'team');
  box(s, -1, 1, 1, 3, 4, 5, 'hd');
  barrel(s, 0, 2, 6, p.barrel, { brake: true, sleeve: 2 });
  for (const x of [-4, 4]) box(s, x, x, 0, 3, -2, 2, 'hd');
  return W;
}
// Remote weapon station / small turrets for APCs and cars
function rcwsTurret(p) {
  const [W, s] = newModel();
  if (p.weapon === 'ifv') {
    box(s, -4, 4, 0, 3, -4, 3, 'c'); box(s, -3, 3, 4, 4, -3, 2, 'c');
    for (let x = -3; x <= 3; x++) s(x, 4, -3, 'team');
    box(s, -1, 1, 1, 2, 4, 4, 'hd'); barrel(s, 0, 2, 5, p.barrel || 12, { base: 1 });
    s(-4, 4, 1, 'hd'); s(-4, 5, 1, 'glass');
  } else if (p.weapon === 'gun') {
    box(s, -5, 5, 0, 3, -6, 5, 'c'); box(s, -4, 4, 4, 4, -5, 4, 'c');
    for (let x = -4; x <= 4; x++) s(x, 4, -4, 'team');
    box(s, -1, 1, 1, 3, 6, 6, 'hd'); barrel(s, 0, 2, 7, p.barrel || 22, { brake: true });
    box(s, -4, -2, 5, 5, -2, 0, 'hd');
  } else if (p.weapon === 'pickup') {
    box(s, -1, 1, 0, 0, -1, 1, 'hd'); s(0, 1, 0, 'hd'); box(s, -2, 2, 2, 3, 1, 1, 'c1'); mg(s, 0, 1, 1, 5);
    s(-1, 1, -1, 'team'); s(1, 1, -1, 'team');
  } else if (p.weapon === 'ring') {   // gunner ring with shield (Humvee, Mengshi)
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) s(x, 0, z, 'hd');
    box(s, -2, 2, 1, 2, 2, 2, 'c'); mg(s, 0, 0, 2, 5); s(0, 3, 2, 'team');
  } else {   // rcws
    box(s, -2, 2, 0, 1, -2, 2, 'c'); box(s, -1, 1, 2, 2, -1, 1, 'hd'); s(-2, 2, 1, 'glass');
    mg(s, 1, 1, 2, 5); s(0, 2, -1, 'team');
  }
  return W;
}
// Wheeled hull: APC 8x8 (also 6x6), boxy with sloped nose, recessed wheel belt; trucks and cars have their own shapes
function apcHull(p) {
  const [W, s] = newModel();
  const hw = p.width >> 1, zb = -(p.length >> 1), zf = zb + p.length - 1, R = p.wheelR, hh = p.hullH, low = R - 1;
  for (let y = low; y <= hh; y++) {
    const half = y <= R + 1 ? hw - 3 : hw;
    const front = zf - Math.max(0, Math.round((y - (hh - 4)) * 1.5)) - Math.max(0, R + 1 - y) * 2, back = zb + Math.max(0, R - y);
    box(s, -half, half, y, y, back, front, 'c');
  }
  for (let z = zb + 3; z <= zf - 6; z++) { s(-hw, R + 2, z, 'team'); s(hw, R + 2, z, 'team'); }
  if (p.module) box(s, -hw + 1, hw - 1, hh + 1, hh + 2, zb + 1, zb + Math.round(p.length * 0.55), 'c1');
  for (const x of [-hw + 2, hw - 2]) s(x, hh - 1, zf - Math.round(1.5 * 3), 'glass');
  lights(s, [hw - 2], R + 2, zf - 2, zb);
  box(s, -hw + 1, -hw + 1, hh + 1, hh + 5, zb + 2, zb + 2, 'metall');
  for (let z = zb + 2; z <= zb + 8; z += 2) s(0, hh + 1, z, 'hd');
  return W;
}
// Light 4x4: humvee | fennek | mengshi | mrap | pickup
function carHull(p) {
  const [W, s] = newModel();
  const hw = p.width >> 1, zb = -(p.length >> 1), zf = zb + p.length - 1, R = p.wheelR, st = p.style;
  const floor = R - 1, belt = R + 2;
  const hoodTop = st === 'fennek' ? belt + 1 : belt + 2, roof = st === 'mrap' ? belt + 7 : st === 'fennek' ? belt + 3 : belt + 5;
  const hoodEnd = zf - Math.round(p.length * (st === 'pickup' ? 0.32 : st === 'mrap' ? 0.22 : 0.3));
  const cabBack = st === 'pickup' ? hoodEnd - 6 : zb + (st === 'mrap' ? 2 : 3);
  for (let y = floor; y <= belt; y++) box(s, -hw + (y < R + 1 ? 2 : 0), hw - (y < R + 1 ? 2 : 0), y, y, zb + (y < R ? 1 : 0), zf - (y < R ? 1 : 0), 'c');
  for (let y = belt + 1; y <= hoodTop; y++) box(s, -hw, hw, y, y, hoodEnd, zf - (st === 'fennek' ? (y - belt) * 2 : 0), 'c');
  for (let y = belt + 1; y <= roof; y++) {
    const glassRow = st === 'fennek' ? y === roof - 1 : y >= roof - 2 && y < roof;
    for (let x = -hw; x <= hw; x++) for (let z = cabBack; z < hoodEnd; z++) {
      const shellX = Math.abs(x) === hw, shellZ = z === hoodEnd - 1 || z === cabBack;
      const k = glassRow && (shellX || z === hoodEnd - 1) && !(z === cabBack) && (st !== 'mrap' || (z % 3 !== 0)) ? 'glass' : 'c';
      if (y < roof && !shellX && !shellZ) continue;
      s(x, y, z, k);
    }
  }
  if (st === 'pickup') {
    for (let z = zb; z < cabBack; z++) { s(-hw, belt + 1, z, 'c'); s(hw, belt + 1, z, 'c'); }
    for (let x = -hw; x <= hw; x++) s(x, belt + 1, zb, 'c');
    box(s, -hw + 1, -hw + 3, belt + 1, belt + 1, zb + 2, zb + 4, 'c1'); s(hw - 1, belt + 1, zb + 3, 'acc');
  } else if (st !== 'fennek' && st !== 'mrap') {
    for (let y = belt + 1; y <= belt + 3; y++) box(s, -hw, hw, y, y, zb, cabBack - 1, 'c');
  }
  if (st === 'fennek') { box(s, -1, 1, roof + 1, roof + 4, cabBack + 2, cabBack + 2, 'hd'); box(s, -2, 2, roof + 5, roof + 5, cabBack + 1, cabBack + 3, 'c1'); }
  for (let x = -hw + 1; x <= hw - 1; x++) s(x, roof, cabBack + 1, 'team');
  box(s, -hw + 1, hw - 1, belt + 1, belt + 1, zf, zf, 'hd');   // grille
  lights(s, [hw - 1], belt, zf, zb);
  return W;
}
// Truck: cab in front, frame, payload behind (pod/gun turret, box, cargo, scrap)
function truckHull(p) {
  const [W, s] = newModel();
  const hw = p.width >> 1, zb = -(p.length >> 1), zf = zb + p.length - 1, R = p.wheelR, frame = R;
  box(s, -hw + 3, hw - 3, frame - 1, frame, zb + 1, zf - 2, 'hd');
  const cabL = p.cabL, cz = zf - cabL + 1, top = frame + p.cabH;
  for (let y = frame + 1; y <= top; y++) {
    const front = zf - (y > top - 3 ? 1 : 0);
    for (let x = -hw; x <= hw; x++) for (let z = cz; z <= front; z++) {
      const glass = y >= top - 3 && y < top && (z === front || (Math.abs(x) === hw && z > cz + 1));
      if (y < top && Math.abs(x) < hw && z > cz && z < front) continue;
      s(x, y, z, glass ? 'glass' : 'c');
    }
  }
  for (let x = -hw; x <= hw; x++) s(x, frame + 1, zf + 1, 'hd');
  for (let x = -hw + 1; x <= hw - 1; x++) s(x, top, cz + 1, 'team');
  lights(s, [hw - 1], frame + 2, zf + 1, zb);
  // fenders over the wheels
  for (const z of p.axles) for (const x of [-hw, hw]) box(s, x, x, frame + 1, frame + 1, z - R, z + R, 'c1');
  const bed = cz - 2;
  box(s, -hw, hw, frame + 1, frame + 1, zb, bed, 'c');
  if (p.payload === 'box') {
    box(s, -hw, hw, frame + 2, frame + 9, zb, bed - 1, 'c1');
    for (let x = -hw + 1; x <= hw - 1; x++) s(x, frame + 10, Math.round((zb + bed) / 2), 'team');
    box(s, hw - 2, hw - 2, frame + 10, frame + 16, zb + 3, zb + 3, 'metall'); box(s, -2, 2, frame + 10, frame + 10, zb + 2, zb + 4, 'hd');
  } else if (p.payload === 'cargo') {
    for (let y = frame + 2; y <= frame + 8; y++) for (let x = -hw; x <= hw; x++) for (let z = zb; z <= bed - 1; z++) {
      const out = Math.abs(x) === hw || z === zb || z === bed - 1 || y === frame + 8 || (y === frame + 7 && Math.abs(x) === hw - 1);
      if (out && !(y === frame + 8 && Math.abs(x) === hw)) s(x, y, z, y >= frame + 7 ? 'c1' : (z - zb) % 6 === 0 ? 'hd' : 'c1');
    }
    for (let x = -hw + 2; x <= hw - 2; x++) s(x, frame + 9, Math.round((zb + bed) / 2), 'team');
  } else if (p.payload === 'scrap') {
    for (let x = -hw; x <= hw; x++) for (let z = zb; z <= bed - 1; z++) {
      const n = Math.round(2 + H(x, 0, z, 9) * 4 - Math.abs(x) * 0.4);
      for (let y = frame + 2; y < frame + 2 + n; y++) s(x, y, z, ['metall', 'hd', 'brown', 'c', 'black'][Math.floor(H(x, y, z, 3) * 5)]);
    }
    for (let x = -hw; x <= hw; x++) s(x, frame + 2, bed, 'team');
  } else if (p.payload === 'gun') {
    box(s, -hw + 1, hw - 1, frame + 2, frame + 2, zb + 2, bed - 2, 'c1');
    for (const x of [-hw + 1, hw - 1]) box(s, x, x, frame - 2, frame + 1, zb - 1, zb, 'hd');   // spades
  } else {   // pod: cradle
    box(s, -hw + 2, hw - 2, frame + 2, frame + 2, zb + 2, bed - 2, 'c1');
  }
  return W;
}
// Tracked chassis with cab in front (M270) or dozer cabin
function trackedCabHull(p) {
  const [W, s] = newModel();
  const hw = p.width >> 1, zb = -(p.length >> 1), zf = zb + p.length - 1, th = p.trackH, tw = p.trackW, hh = p.hullH;
  trackUnit(s, hw, hw - tw + 1, zb, zf, th); trackUnit(s, -hw, -(hw - tw + 1), zb, zf, th);
  for (let y = 1; y <= hh; y++) box(s, y <= th ? -(hw - tw) : -hw, y <= th ? hw - tw : hw, y, y, zb + 1, zf - (y <= th ? th - y + 1 : 0), 'c');
  const cz = zf - p.cabL + 1, top = hh + p.cabH;
  for (let y = hh + 1; y <= top; y++) for (let x = -hw + 1; x <= hw - 1; x++) for (let z = cz; z <= zf - 1; z++) {
    const glass = y === top - 1 && (z === zf - 1 || Math.abs(x) === hw - 1) && x % 3 !== 0;
    s(x, y, z, glass ? 'glass' : 'c');
  }
  for (let x = -hw + 2; x <= hw - 2; x++) s(x, top, cz + 1, 'team');
  for (const x of [-hw, hw]) for (let z = zb + 2; z <= zf - 2; z++) s(x, th + 1, z, z % 4 === 0 ? 'team' : 'c');
  lights(s, [hw - 2], hh, zf, zb);
  if (p.blade) {
    for (let x = -hw - 1; x <= hw + 1; x++) for (let y = 0; y <= th + 3; y++) s(x, y, zf + 2 + (y < 2 ? 1 : y > th + 1 ? -1 : 0), 'metall');
    for (const x of [-hw + 1, hw - 1]) box(s, x, x, 2, 3, zf, zf + 1, 'hd');
    box(s, hw - 3, hw - 3, top + 1, top + 4, zb + 3, zb + 3, 'black');
  }
  return W;
}

// ---------- soldiers (0.1-m voxels): body with arms and weapon as the hull, one leg model swung twice ----------
// headgear: helmet | ops (helmet with night vision) | boonie | cap | beret | kepi | unhelmet | none
// weapon: rifle | at (launcher on the shoulder) | mg | sniper | grenade | tool | drone | none; pack: pack | shovel | radio | none
function soldierBody(p) {
  const [W, s] = newModel();
  const skin = `skin${(p.skin ?? 0) % SKINS.length}`;
  box(s, -2, 2, 8, 9, -1, 1, 'c');                     // hips
  box(s, -2, 2, 10, 14, -1, 1, 'c');                   // torso
  if (p.vest) { box(s, -2, 2, 10, 13, 2, 2, 'c1'); box(s, -2, 2, 10, 13, -2, -2, 'c1'); box(s, -1, 1, 11, 12, 3, 3, 'hd'); }
  box(s, -2, 2, 9, 9, -2, 2, 'hd');                    // belt
  for (const x of [-3, 3]) { box(s, x, x, 11, 14, -1, 0, 'c'); s(x, 13, 1, 'team'); s(x, 14, 1, 'team'); }   // upper arms, team patch
  for (const x of [-3, 3]) { s(x, 11, 1, 'c'); s(x, 11, 2, 'c'); }   // forearms reach forward to the weapon, gloves
  s(-2, 11, 3, 'hd'); s(2, 11, 3, 'hd'); s(-1, 11, 4, 'hd');
  box(s, -1, 1, 15, 15, -1, 0, skin);                  // neck
  box(s, -1, 1, 16, 18, -1, 1, skin);                  // head
  s(-1, 17, 1, 'black'); s(1, 17, 1, 'black');         // eyes (in the face)
  const hg = p.headgear;
  if (p.mask) box(s, -1, 1, 16, 16, 1, 1, 'hd');
  if (hg === 'helmet' || hg === 'ops' || hg === 'unhelmet') {
    const k = hg === 'unhelmet' ? 'unblue' : hg === 'ops' ? 'hd' : 'c1';
    box(s, -2, 2, 18, 19, -2, 2, k); box(s, -1, 1, 20, 20, -1, 1, k);
    for (const x of [-2, 2]) box(s, x, x, 17, 17, -2, 1, k);
    box(s, -1, 1, 17, 17, -2, -2, k);
    s(0, 20, -2, 'team');
    if (hg === 'ops') { box(s, -1, 1, 19, 19, 3, 3, 'black'); s(0, 20, 3, 'black'); }
  } else if (hg === 'boonie') { box(s, -3, 3, 18, 18, -3, 3, 'c'); box(s, -1, 1, 19, 19, -1, 1, 'c'); s(0, 19, -2, 'team'); }
  else if (hg === 'cap') { box(s, -1, 1, 19, 19, -1, 1, 'c1'); box(s, -1, 1, 18, 18, 2, 3, 'c1'); s(0, 19, 0, 'team'); }
  else if (hg === 'beret') { box(s, -2, 1, 19, 19, -1, 1, 'acc'); s(1, 19, 2, 'acc'); }
  else if (hg === 'kepi') { box(s, -1, 1, 19, 20, -1, 1, 'kepi'); box(s, -1, 1, 21, 21, -1, 1, 'kepiTop'); box(s, -1, 1, 18, 18, 2, 2, 'black'); }
  // pack on the back with the team flap on top (visible from above)
  if (p.pack !== 'none') {
    box(s, -2, 2, 10, 13, -3, -3, 'c1'); box(s, -1, 1, 11, 13, -4, -4, 'c1'); box(s, -2, 2, 14, 14, -4, -3, 'team');
    if (p.pack === 'shovel') { box(s, 2, 2, 10, 15, -5, -5, 'holz'); box(s, 1, 3, 9, 10, -5, -5, 'metall'); }
    if (p.pack === 'radio') for (let y = 15; y <= 21; y++) s(-2, y, -4, 'black');
  } else box(s, -2, 2, 14, 14, -2, -2, 'team');
  const w = p.weapon;
  if (w === 'rifle' || w === 'grenade' || w === 'mg' || w === 'sniper') {
    const len = w === 'mg' ? 8 : w === 'sniper' ? 9 : 6;
    for (let z = 0; z <= len; z++) s(0, 12, z, z === len ? 'metall' : 'hd');
    s(0, 11, 3, 'hd'); s(0, 10, 3, 'hd');              // magazine / grip
    if (w === 'grenade') for (let z = 3; z <= 5; z++) s(0, 11, z, 'c1');
    if (w === 'mg') { box(s, -1, -1, 10, 11, 2, 3, 'c1'); s(0, 11, len - 1, 'hd'); s(0, 10, len - 1, 'hd'); }
    if (w === 'sniper') { s(0, 13, 3, 'scope'); s(0, 13, 4, 'scope'); s(0, 13, 5, 'scope'); }
  } else if (w === 'at') {
    for (let z = -4; z <= 5; z++) { s(2, 15, z, z === 5 || z === -4 ? 'hd' : 'c1'); s(2, 16, z, z === 5 || z === -4 ? 'hd' : 'c1'); }
    s(2, 14, 1, 'hd'); s(1, 15, 2, 'scope');
  } else if (w === 'tool') { s(2, 11, 3, 'metall'); s(2, 11, 4, 'metall'); s(2, 12, 5, 'metall'); s(2, 10, 5, 'metall'); }
  else if (w === 'drone') {
    box(s, -1, 1, 11, 11, 3, 4, 'hd'); s(-1, 12, 4, 'black'); s(1, 12, 4, 'black');   // controller
    box(s, -1, 1, 15, 15, -5, -3, 'black');
    for (const [x, z] of [[-3, -6], [3, -6], [-3, -2], [3, -2]]) { s(x, 15, z, 'metall'); s(x, 16, z, 'black'); s(Math.sign(x) * 2, 15, z === -6 ? -5 : -3, 'black'); }
  }
  return W;
}
// one leg hanging from the hip (y = 0); boots at the bottom
function soldierLeg() {
  const [W, s] = newModel();
  for (let y = -8; y <= -1; y++) for (let x = -1; x <= 0; x++) for (let z = -1; z <= 0; z++) s(x, y, z, y <= -7 ? 'boots' : y === -4 && z === 0 ? 'c1' : 'c');
  s(-1, -8, 1, 'boots'); s(0, -8, 1, 'boots');
  return W;
}

// ---------- types: defaults, builder, which params the workshop shows ----------
const TRACKED = { trackH: 5, trackW: 4 };
export const KIT_TYPES = {
  soldier: { name: 'Soldat', life: 'infantry', footprint: 'soldat', scale: 0.1,
    defaults: { headgear: 'helmet', weapon: 'rifle', pack: 'pack', vest: true, mask: false },
    build: (p) => ({ hull: soldierBody(p), legs: { W: soldierLeg(), at: [{ x: -0.1, side: -1 }, { x: 0.1, side: 1 }], hip: 0.8, center: [-0.05, 0, -0.05] } }) },
  mbt: { name: 'Kampfpanzer', life: 'tracked', footprint: 'tank',
    defaults: { length: 38, width: 19, ...TRACKED, hullH: 8, glacis: 2, skirts: true, era: false, turretL: 18, turretW: 13, turretH: 5, shape: 'box', barrel: 26, brake: false, sleeve: true, rack: true, pivotZ: -2 },
    build: (p) => ({ hull: mbtHull(p), turret: mbtTurret(p), pivot: [0, p.hullH + 1, p.pivotZ] }) },
  spg: { name: 'Panzerhaubitze', life: 'tracked', footprint: 'tank',
    defaults: { length: 38, width: 17, ...TRACKED, hullH: 7, glacis: 1.5, skirts: false, era: false, turretL: 20, turretW: 15, turretH: 7, barrel: 30, pivotZ: -6 },
    build: (p) => ({ hull: mbtHull(p), turret: spgTurret(p), pivot: [0, p.hullH + 1, p.pivotZ] }) },
  mlrs: { name: 'Raketenwerfer auf Ketten', life: 'tracked', footprint: 'tank',
    defaults: { length: 36, width: 15, ...TRACKED, hullH: 6, cabL: 10, cabH: 6, podL: 18, podW: 13, podH: 6, tilt: 0.25, pods: 1, pivotZ: -6 },
    build: (p) => ({ hull: trackedCabHull(p), turret: podTurret(p), pivot: [0, p.hullH + 2, p.pivotZ] }) },
  dozer: { name: 'Bautrupp', life: 'tracked', footprint: 'dozer',
    defaults: { length: 26, width: 15, ...TRACKED, hullH: 7, cabL: 9, cabH: 7, blade: true },
    build: (p) => ({ hull: trackedCabHull(p) }) },
  apc: { name: 'Radpanzer', life: 'wheeled', footprint: 'werfer',
    defaults: { length: 36, width: 15, wheelR: 3, hullH: 10, axles: 4, module: false, weapon: 'rcws', barrel: 0, pivotZ: 2 },
    build: (p) => {
      const ax = axlesOf(p);
      const turret = p.weapon === 'none' ? null : rcwsTurret(p);
      return { hull: apcHull(p), turret, pivot: [0, p.hullH + (p.module ? 3 : 1), p.pivotZ], wheels: wheels(p.wheelR, (p.width >> 1) - 2, ax) };
    } },
  car: { name: 'Geländewagen', life: 'wheeled', footprint: 'spaeher',
    defaults: { length: 24, width: 11, wheelR: 2, style: 'humvee', weapon: 'ring', pivotZ: -2 },
    build: (p) => {
      const zb = -(p.length >> 1), zf = zb + p.length - 1;
      const roof = p.wheelR + 2 + (p.style === 'mrap' ? 7 : p.style === 'fennek' ? 3 : 5);
      const turret = p.weapon === 'none' ? null : rcwsTurret(p);
      const pivot = p.style === 'pickup' ? [0, p.wheelR + 2, zb + 4] : [0, roof + 1, p.pivotZ];
      return { hull: carHull(p), turret, pivot, wheels: wheels(p.wheelR, (p.width >> 1) - 1, [zf - 4, zb + 4]) };
    } },
  truck: { name: 'Lastwagen', life: 'wheeled', footprint: 'werfer',
    defaults: { length: 36, width: 13, wheelR: 3, axles: 3, cabL: 8, cabH: 8, payload: 'cargo', podL: 16, podW: 11, podH: 6, tilt: 0.2, pods: 1, barrel: 28, pivotZ: -6 },
    build: (p) => {
      const ax = axlesOf(p, true); p.axles = ax;
      const turret = p.payload === 'pod' ? podTurret(p) : p.payload === 'gun' ? truckGunTurret(p) : null;
      return { hull: truckHull(p), turret, pivot: [0, p.wheelR + 3, p.pivotZ], wheels: wheels(p.wheelR, (p.width >> 1) - 1, ax) };
    } },
};
function axlesOf(p, truck = false) {
  if (Array.isArray(p.axles)) return p.axles;
  const zb = -(p.length >> 1), zf = zb + p.length - 1, n = p.axles || 2, R = p.wheelR;
  if (truck) {   // one axle under the cab, the rest at the back
    const front = zf - Math.round(p.cabL / 2), rear = []; for (let i = 0; i < n - 1; i++) rear.push(zb + R + 2 + i * (2 * R + 2));
    return [front, ...rear];
  }
  const first = zf - R - 3, last = zb + R + 3, out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(first + (last - first) * (n === 1 ? 0 : i / (n - 1))));
  return out;
}
// workshop fields per param: [label, kind (number|check|choice), extra]
export const KIT_FIELDS = {
  length: ['Länge (Würfel)', 'number'], width: ['Breite (Würfel)', 'number'], hullH: ['Rumpfhöhe', 'number'], trackH: ['Kettenhöhe', 'number'], trackW: ['Kettenbreite', 'number'],
  glacis: ['Bugschräge', 'number'], skirts: ['Kettenschürzen', 'check'], era: ['Reaktivpanzer', 'check'], rack: ['Gepäckkorb', 'check'],
  turretL: ['Turmlänge', 'number'], turretW: ['Turmbreite', 'number'], turretH: ['Turmhöhe', 'number'], shape: ['Turmform', 'choice', { box: 'Kasten', wedge: 'Keil', round: 'Rund' }],
  barrel: ['Rohrlänge', 'number'], brake: ['Mündungsbremse', 'check'], sleeve: ['Rauchabsauger', 'check'], pivotZ: ['Turm vor/zurück', 'number'],
  wheelR: ['Radgröße', 'number'], axles: ['Achsen', 'number'], module: ['Missionsmodul', 'check'],
  weapon: ['Bewaffnung', 'choice', { rcws: 'Waffenstation', ifv: 'Maschinenkanone', gun: 'Kanonenturm', ring: 'MG-Ring', pickup: 'MG auf der Ladefläche', none: 'Keine' }],
  style: ['Bauart', 'choice', { humvee: 'Humvee', fennek: 'Spähwagen flach', mengshi: 'Geländewagen', mrap: 'MRAP', pickup: 'Pick-up' }],
  cabL: ['Kabinenlänge', 'number'], cabH: ['Kabinenhöhe', 'number'], payload: ['Aufbau', 'choice', { pod: 'Raketenbehälter', gun: 'Haubitze', box: 'Kofferaufbau', cargo: 'Plane', scrap: 'Schrott' }],
  podL: ['Behälterlänge', 'number'], podW: ['Behälterbreite', 'number'], podH: ['Behälterhöhe', 'number'], tilt: ['Behälter-Neigung', 'number'], pods: ['Behälter', 'number'], blade: ['Planierschild', 'check'],
  headgear: ['Kopfbedeckung', 'choice', { helmet: 'Helm', ops: 'Helm mit Nachtsicht', boonie: 'Buschhut', cap: 'Feldmütze', beret: 'Barett', kepi: 'Képi', unhelmet: 'Blauhelm', none: 'Keine' }],
  weapon_soldier: ['Waffe', 'choice', { rifle: 'Sturmgewehr', at: 'Panzerfaust', mg: 'Maschinengewehr', sniper: 'Scharfschützengewehr', grenade: 'Granatwerfer', tool: 'Werkzeug', drone: 'Drohne + Steuerung', none: 'Keine' }],
  pack: ['Rucksack', 'choice', { pack: 'Rucksack', shovel: 'Mit Spaten', radio: 'Mit Funkgerät', none: 'Keiner' }],
  vest: ['Schutzweste', 'check'], mask: ['Sturmhaube', 'check'],
};

const cache = new Map();
// Build a model from data: type (KIT_TYPES), params (models.json › kit), paint scheme id. Cached per parameter set.
export function buildKit(type, params = {}, paintId = 'usa') {
  const key = JSON.stringify([type, params, paintId]);
  if (cache.has(key)) return cache.get(key);
  const T = KIT_TYPES[type] || KIT_TYPES.mbt;
  const p = { ...T.defaults, ...params };
  const b = T.build(p);
  const seed = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) & 1023;
  const out = { hull: paint(b.hull, paintId, seed), turret: b.turret ? paint(b.turret, paintId, seed + 1) : null, pivot: b.pivot || null, scale: T.scale || KIT_SCALE,
    wheels: b.wheels ? { ...b.wheels, W: paint(b.wheels.W, paintId) } : null, trackMid: T.life === 'tracked' ? (p.trackH || 5) * KIT_SCALE / 2 : 0,
    legs: b.legs ? { ...b.legs, W: paint(b.legs.W, paintId, seed + 2) } : null };
  cache.set(key, out);
  return out;
}
