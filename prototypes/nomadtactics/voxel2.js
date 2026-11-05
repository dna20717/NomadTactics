// Coarse voxels (40 cm): Leopard-style tank and RTS barracks.
import * as THREE from 'three';

export const PAL = {
  oliv: [0x4f5634, 0x565d39], brown: [0x5a4632, 0x614d37], black: [0x272723, 0x2d2d28],
  track: [0x2a2926, 0x31302c], metall: [0x5d6164, 0x666a6d], glass: [0x6fa7bd, 0x7bb3c8],
  concrete: [0x9a978d, 0xa19e94], concreteDark: [0x7d7a72, 0x84817a], plaster: [0xc9b994, 0xd0c09b],
  plasterDark: [0xa8986f, 0xb09f76], roof: [0x4a4d50, 0x515457], roofBorder: [0x3a3c3f, 0x3f4144],
  door: [0x3e4a2e, 0x445033], pane: [0x2f4a5a, 0x35505f], sand: [0xb3a06a, 0xa99660],
  holz: [0x6b4f33, 0x735638], white: [0xffffff, 0xf4f6f8], red: [0xb03a2e, 0xb03a2e],
};

function hiss(x, y, z) {
  return Math.sin(x * 0.55 + z * 0.21) + Math.sin(z * 0.43 - y * 0.6 + 1.7) + Math.sin(x * 0.31 + y * 0.5 - z * 0.17 + 4.1);
}
const camo = (x, y, z) => { const n = hiss(x * 2, y * 2, z * 2); return n > 1.1 ? 'black' : n > 0.15 ? 'brown' : 'oliv'; };

function new_() { const W = new Map(); const s = (x, y, z, a) => W.set(`${x},${y},${z}`, a); return [W, s]; }
const box = (s, x0, x1, y0, y1, z0, z1, a) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) s(x, y, z, typeof a === 'function' ? a(x, y, z) : a); };

// Panzer: 9 breit (x -4..4), 20 lang (z -10..9), Rohr bis z 16
export function tank() {
  const [W, s] = new_();
  // Tracks and skirts
  box(s, -4, -3, 0, 0, -9, 8, 'track'); box(s, 3, 4, 0, 0, -9, 8, 'track');
  box(s, -4, -3, 1, 1, -10, 9, (x, y, z) => Math.abs(x) === 4 ? (z > 5 ? camo(x, y, z) : 'oliv') : 'track');
  box(s, 3, 4, 1, 1, -10, 9, (x, y, z) => Math.abs(x) === 4 ? (z > 5 ? camo(x, y, z) : 'oliv') : 'track');
  box(s, -2, 2, 1, 1, -9, 8, 'black');
  // Hull, bow beveled
  box(s, -4, 4, 2, 2, -10, 9, camo);
  box(s, -4, 4, 3, 3, -10, 6, camo);
  box(s, -3, 3, 4, 4, -10, -8, 'black');               // Motordeck hinten
  s(-2, 4, 5, 'black');                                      // Fahrerwinkelspiegel
  // Turret with wedge
  box(s, -4, 4, 4, 5, -7, 1, camo);
  box(s, -3, 3, 4, 5, 2, 2, camo);
  for (const x of [-2, -1, 1, 2]) box(s, x, x, 4, 5, 3, 3, camo);
  s(-2, 4, 4, camo(-2, 4, 4)); s(2, 4, 4, camo(2, 4, 4));
  // Staukorb
  box(s, -3, 3, 4, 4, -8, -8, (x) => x % 2 ? 'black' : 'oliv');
  // Mantlet and barrel
  s(0, 4, 3, 'black'); s(0, 5, 3, 'black');
  for (let z = 4; z <= 16; z++) s(0, 4, z, z >= 15 ? 'metall' : 'oliv');
  // Dach: Teamfarbe, Visier, Periskop, Luke
  box(s, -1, 1, 6, 6, -6, -4, 'team');
  box(s, 2, 3, 6, 6, 0, 0, 'black');
  s(2, 6, -3, 'black'); s(2, 7, -3, 'metall');
  s(-3, 6, -2, 'oliv'); s(-3, 6, -1, 'black');
  // Teamstreifen seitlich
  box(s, -5, -5, 5, 5, -6, -2, 'team'); box(s, 5, 5, 5, 5, -6, -2, 'team');
  return W;
}

// Barracks: footprint approx. 13 × 9 m, yard with sandbags, flagpole
export function kaserne() {
  const [W, s] = new_();
  box(s, -17, 17, 0, 0, -10, 13, (x, y, z) => (x + z) % 7 === 0 ? 'concreteDark' : 'concrete');   // Platte
  // Halle
  box(s, -14, 14, 1, 7, -7, 7, (x, y, z) => {
    if (Math.abs(x) === 14 || Math.abs(z) === 7 && Math.abs(x) % 7 === 0) return 'plasterDark'; // Pfeiler
    if (y === 1) return 'plasterDark';                                                            // Sockel
    return 'plaster';
  });
  // Windows front and back
  for (const z of [7, -7]) for (let x = -12; x <= 12; x++) if (Math.abs(x) >= 5 && (Math.abs(x) % 3) !== 0) box(s, x, x, 4, 5, z, z, 'pane');
  for (const x of [14, -14]) for (let z = -5; z <= 5; z++) if (Math.abs(z) % 3 !== 0) box(s, x, x, 4, 5, z, z, 'pane');
  // Tor
  box(s, -3, 3, 1, 5, 7, 7, (x, y) => x === 0 && y < 5 ? 'black' : 'door');
  // Canopy and sign in team color
  box(s, -4, 4, 6, 6, 8, 9, 'roofBorder');
  box(s, -4, 4, 7, 7, 7, 7, 'team');
  // Roof with rim and superstructures
  box(s, -15, 15, 8, 8, -8, 8, (x, y, z) => Math.abs(x) === 15 || Math.abs(z) === 8 ? 'roofBorder' : 'roof');
  box(s, -10, -7, 9, 10, -4, -1, 'metall');                  // Ventilation
  box(s, 6, 9, 9, 9, 1, 3, 'metall');
  for (let y = 9; y <= 13; y++) s(10, y, -5, 'metall');      // Funkmast
  s(10, 14, -5, 'red');
  // Sandbag wall in front of the yard, gap in the middle
  for (let x = -16; x <= 16; x++) if (Math.abs(x) > 3) box(s, x, x, 1, (Math.abs(x) % 4 === 0) ? 1 : 2, 12, 12, 'sand');
  for (const x of [-16, 16]) box(s, x, x, 1, 2, 9, 11, 'sand');
  // Flagpole with team flag
  for (let y = 1; y <= 15; y++) s(-12, y, 10, 'metall');
  box(s, -11, -8, 13, 14, 10, 10, 'team');
  // Kisten im Hof
  box(s, 9, 10, 1, 2, 9, 10, 'holz'); box(s, 11, 11, 1, 1, 9, 9, 'holz'); box(s, 9, 9, 3, 3, 9, 9, 'holz');
  return W;
}

const DIR = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const BRIGHTNESS = [0.86, 0.86, 1.0, 0.55, 0.93, 0.78];
export function mesh(W, { V = 0.4, team = 0x2f6fd6 } = {}) {
  const pos = [], col = [], c = new THREE.Color();
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    const pal = kind === 'team' ? [team, team] : PAL[kind];
    const basis = pal[(x * 7 + y * 13 + z * 5) & 1];
    DIR.forEach((d, i) => {
      if (W.has(`${x + d[0]},${y + d[1]},${z + d[2]}`)) return;
      c.setHex(basis).multiplyScalar(BRIGHTNESS[i]);
      const free = [0, 1, 2].filter(q => d[q] === 0);
      const corner = (a, b) => [x, y, z].map((v, ax) => d[ax] ? v + (d[ax] > 0 ? 1 : 0) : v + (ax === free[0] ? a : b));
      const p00 = corner(0, 0), p01 = corner(0, 1), p10 = corner(1, 0), p11 = corner(1, 1);
      const tri = (d[0] + d[1] + d[2]) > 0 ^ (i === 2 || i === 3) ? [p00, p10, p11, p00, p11, p01] : [p00, p11, p10, p00, p01, p11];
      for (const p of tri) { pos.push((p[0] - 0.5) * V, p[1] * V, (p[2] - 0.5) * V); col.push(c.r, c.g, c.b); }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true;
  m.userData.voxel = W.size; m.userData.triangles = pos.length / 9;
  return m;
}
