// Voxel tank in the style of a Leopard 2A7. One voxel = 0.2 m.
// Model = function (x, y, z) -> color or null. From it, a mesh with visible faces only.
import * as THREE from 'three';

export const V = 0.2;
const C = {
  oliv: [0x4f5634, 0x58603a],      // slight grain
  brown: [0x5a4632, 0x63503a],
  black: [0x262622, 0x2c2c27],
  track: [0x2b2a27, 0x33322e],
  wheel: [0x3c4229, 0x434a2e],
  metall: [0x55595c, 0x5d6164],
  glass: [0x7fb6c9, 0x8cc2d4],
};

// Flecktarn camo: three colors in large patches, fixed via noise
function hiss(x, y, z) {
  const s = Math.sin(x * 0.55 + z * 0.21) + Math.sin(z * 0.43 - y * 0.6 + 1.7) + Math.sin(x * 0.31 + y * 0.5 - z * 0.17 + 4.1);
  return s;
}
function camo(x, y, z) {
  const n = hiss(x, y, z);
  return n > 1.1 ? 'black' : n > 0.15 ? 'brown' : 'oliv';
}

// Tank in voxel coordinates: x across (-9..9), y up (0..), z lengthwise (-20..20)
export function tankVoxel(teamColor) {
  const W = new Map();
  const set = (x, y, z, kind) => W.set(`${x},${y},${z}`, kind);
  const team = 'team';

  for (let z = -20; z <= 20; z++) for (let x = -9; x <= 9; x++) for (let y = 0; y <= 15; y++) {
    const ax = Math.abs(x);
    // Tracks outside (|x| 5..8), height 1..4, ends beveled
    const tracksEnd = z > 15 ? z - 15 : z < -18 ? -18 - z : 0;
    if (ax >= 5 && ax <= 8 && y >= 1 + Math.max(0, tracksEnd - 1) && y <= 4 - Math.max(0, tracksEnd - 2) && z >= -19 && z <= 19) {
      const role = ax === 8 && y >= 1 && y <= 3 && ((z + 14) % 4 === 0);
      set(x, y, z, role ? 'wheel' : 'track'); continue;
    }
    // Skirt (|x| = 9), y 3..5, z -16..18
    if (ax === 9 && y >= 3 && y <= 5 && z >= -16 && z <= 18) { set(x, y, z, z > 12 ? camo(x, y, z) : 'oliv'); continue; }
    // Unterwanne zwischen den Ketten
    if (ax <= 4 && y >= 2 && y <= 4 && z >= -18 && z <= 17 - Math.max(0, 3 - y)) { set(x, y, z, 'black'); continue; }
    // Upper hull across full width y 5..7, bow beveled
    const bug = z - 12;                       // from z=12 the top side slopes down
    const top = bug > 0 ? 7 - Math.floor(bug / 2.2) : 7;
    if (ax <= 9 && y >= 5 && y <= top && z >= -19 && z <= 19) { set(x, y, z, camo(x, y, z)); continue; }
  }
  // Motorgitter hinten
  for (let z = -18; z <= -12; z += 2) for (let x = -6; x <= 6; x++) set(x, 8, z, 'black');
  // Fahrerluke
  for (let x = -5; x <= -2; x++) for (let z = 9; z <= 11; z++) set(x, 8, z, z === 11 ? 'glass' : 'oliv');

  // Turm: z -13..9, y 8..11, Keil vorne (Pfeilform von oben)
  for (let z = -13; z <= 10; z++) for (let x = -9; x <= 9; x++) for (let y = 8; y <= 11; y++) {
    const ax = Math.abs(x);
    let width = 8;
    if (z > 2) width = 8 - Math.round((z - 2) * 0.75);       // Wedge tapers toward the front
    if (y === 11) width -= 1;                                  // Dach etwas schmaler
    const notch = z >= 8 && ax <= 1;                            // Notch for the mantlet
    if (ax <= width && !notch) set(x, y, z, camo(x, y, z));
  }
  // Team color: patch on the turret roof and stripes on the sides
  for (let x = -3; x <= 3; x++) for (let z = -9; z <= -5; z++) set(x, 12, z, team);
  for (const s of [-1, 1]) for (let z = -11; z <= -3; z++) set(s * 9, 9, z, team);
  // Staukorb am Heck
  for (let x = -8; x <= 8; x++) for (let y = 8; y <= 10; y++) set(x, y, -14, (x + 8) % 3 === 0 ? 'black' : 'oliv');
  // Mantlet and gun
  for (let x = -1; x <= 1; x++) for (let y = 8; y <= 10; y++) for (let z = 9; z <= 11; z++) set(x, y, z, 'black');
  for (let z = 12; z <= 37; z++) {
    set(0, 9, z, z > 33 ? 'metall' : 'oliv');
    if (z < 20) { set(0, 10, z, 'oliv'); set(1, 9, z, 'oliv'); }   // dickeres Rohrende am Turm
  }
  set(0, 10, 36, 'black');                                        // Muzzle reference
  // Sight (front right) and periscope (rear right)
  for (let x = 4; x <= 6; x++) for (let z = 3; z <= 5; z++) set(x, 12, z, z === 5 ? 'glass' : 'black');
  for (let y = 12; y <= 14; y++) { set(5, y, -4, 'black'); set(6, y, -4, 'black'); }
  set(5, 15, -4, 'glass'); set(6, 15, -4, 'oliv');
  // Loader's hatch with MG
  for (let x = -6; x <= -3; x++) for (let z = -4; z <= -1; z++) set(x, 12, z, 'oliv');
  for (let z = -2; z <= 3; z++) set(-4, 13, z, 'black');
  // Nebelwurfbecher
  for (const s of [-1, 1]) for (let z = -2; z <= 1; z++) set(s * 9, 11, z, 'black');
  // Antennen
  for (const x of [-7, 7]) for (let y = 12; y <= 19; y++) set(x, y, -11, 'black');

  return { W, team: teamColor };
}

// Only outer faces into a mesh with vertex colors
const DIR = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const BRIGHTNESS = [0.86, 0.86, 1.0, 0.55, 0.93, 0.78];   // baked light per side
export function voxelMesh({ W, team }) {
  const pos = [], col = [], c = new THREE.Color();
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    const pal = kind === 'team' ? [team, team] : C[kind];
    const basis = pal[(x * 7 + y * 13 + z * 5) & 1];
    DIR.forEach(([dx, dy, dz], i) => {
      if (W.has(`${x + dx},${y + dy},${z + dz}`)) return;
      c.setHex(basis).multiplyScalar(BRIGHTNESS[i]);
      // four corners of the face
      const corners = [];
      for (const a of [0, 1]) for (const b of [0, 1]) {
        const p = [x, y, z].map((v, ax) => {
          if (DIR[i][ax] !== 0) return v + (DIR[i][ax] > 0 ? 1 : 0);
          const free = [0, 1, 2].filter(q => DIR[i][q] === 0);
          return v + (ax === free[0] ? a : b);
        });
        corners.push(p);
      }
      // two triangles, order depending on direction
      const [p00, p01, p10, p11] = corners;
      const tri = (dx + dy + dz) > 0 ^ (i === 2 || i === 3) ? [p00, p10, p11, p00, p11, p01] : [p00, p11, p10, p00, p01, p11];
      for (const p of tri) { pos.push((p[0] - 0.5) * V, p[1] * V, (p[2] - 0.5) * V); col.push(c.r, c.g, c.b); }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true;
  m.userData.voxel = W.size;
  return m;
}
