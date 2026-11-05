// Diorama look: voxel mesh with ambient occlusion per corner (AO), soft edges and color variation.
import * as THREE from 'three';

export const PAL = {
  // Tank (slightly brighter and warmer than before)
  oliv: [0x5f6a3e, 0x66714a, 0x5a653a], brown: [0x6e563c, 0x765e43], black: [0x34342e, 0x3a3a33],
  track: [0x33322e, 0x3a3934], metall: [0x7d8285, 0x868b8e], glass: [0x6fa7bd, 0x7bb3c8],
  // Buildings
  concrete: [0xc9c6bd, 0xd1cec5, 0xc2bfb6], concreteDark: [0xa9a69e, 0xb1aea6], plaster: [0xe8dcbc, 0xeee3c5, 0xe2d6b5],
  plasterDark: [0xb85a4c, 0xbf6254], roof: [0x5a5d63, 0x62656b, 0x55585e], roofBorder: [0xd9cfb3, 0xe0d6ba],
  door: [0x4f6a52, 0x557058], pane: [0x3b5566, 0x415b6c], sand: [0xcbb98a, 0xd2c092],
  holz: [0x8a6a48, 0x93724f], red: [0xc4473a, 0xc4473a], white: [0xffffff, 0xf6f7f9],
  // Terrain
  grass: [0x74b04a, 0x7cb952, 0x6aa444, 0x86c25a, 0x70ab48], grassBrightness: [0x92cc63, 0x9bd36b],
  earth: [0x8d6b47, 0x94724d], plate: [0xcfcbc2, 0xd6d2c9, 0xc8c4bb], platesJoint: [0xb3afa6, 0xb9b5ac],
  sheet: [0x4f9a3c, 0x58a443, 0x478f36, 0x61ad4a], trunk: [0x7a5a3c, 0x82613f],
  flower: [0xe8b23c, 0xe46a5a, 0xf2efe6], skin: [0xd9a37c, 0xc68d68, 0x9c6b4c], pants: [0x3b4f73, 0x4a4a52],
  shirt: [0x6b7d4a, 0x5f7243],
};

const DIR = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const PAGE = [0.9, 0.9, 1.0, 0.6, 0.95, 0.82];       // slight baked light per side
const AO = [0.52, 0.68, 0.84, 1.0];

export function mesh(W, { V = 0.4, team = 0x2f6fd6, pal = PAL } = {}) {
  const pos = [], nor = [], col = [], chan = [], c = new THREE.Color();
  const has = (x, y, z) => W.has(`${x},${y},${z}`);
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    const p = kind === 'team' ? [team] : pal[kind];
    const h = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));
    const basis = p[h % p.length];
    DIR.forEach((d, i) => {
      if (has(x + d[0], y + d[1], z + d[2])) return;
      const [u, v] = [0, 1, 2].filter(q => d[q] === 0);
      const corner = (a, b) => {
        const q = [x, y, z].map((w, ax) => d[ax] ? w + (d[ax] > 0 ? 1 : 0) : w + (ax === u ? a : ax === v ? b : 0));
        // AO: neighbors in the layer in front of the face
        const o = [x + d[0], y + d[1], z + d[2]];
        const su = [0, 0, 0], sv = [0, 0, 0]; su[u] = a ? 1 : -1; sv[v] = b ? 1 : -1;
        const s1 = has(o[0] + su[0], o[1] + su[1], o[2] + su[2]);
        const s2 = has(o[0] + sv[0], o[1] + sv[1], o[2] + sv[2]);
        const ck = has(o[0] + su[0] + sv[0], o[1] + su[1] + sv[1], o[2] + su[2] + sv[2]);
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + ck);
        return { q, ao, uv: [a, b] };
      };
      const e00 = corner(0, 0), e10 = corner(1, 0), e11 = corner(1, 1), e01 = corner(0, 1);
      const quad = e00.ao + e11.ao >= e10.ao + e01.ao ? [[e00, e10, e11], [e00, e11, e01]] : [[e10, e11, e01], [e10, e01, e00]];
      for (const tri of quad) {
        // Check outward winding
        t1.set(...tri[1].q).sub(new THREE.Vector3(...tri[0].q)); t2.set(...tri[2].q).sub(new THREE.Vector3(...tri[0].q));
        const n = t1.cross(t2);
        const ord = n.x * d[0] + n.y * d[1] + n.z * d[2] < 0 ? [tri[0], tri[2], tri[1]] : tri;
        for (const e of ord) {
          c.setHex(basis).multiplyScalar(PAGE[i] * AO[e.ao]);
          pos.push(e.q[0] * V - V / 2, e.q[1] * V, e.q[2] * V - V / 2);
          nor.push(...d); col.push(c.r, c.g, c.b); chan.push(...e.uv);
        }
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(chan, 2));
  const m = new THREE.Mesh(g, voxelMaterial());
  m.castShadow = m.receiveShadow = true;
  m.userData.voxel = W.size; m.userData.triangles = pos.length / 9;
  return m;
}

// Material with soft edges: borders of each cube face slightly lightened, the very outer edge a touch darker
export function voxelMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 kante;\nvarying vec2 vKante;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKante = kante;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vKante;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 kk = min(vKante, 1.0 - vKante);
        float r = min(kk.x, kk.y);
        float hell = 1.0 + 0.10 * (1.0 - smoothstep(0.03, 0.16, r));
        float dunkel = mix(0.86, 1.0, smoothstep(0.0, 0.035, r));
        diffuseColor.rgb *= hell * dunkel;`);
  };
  return m;
}

// --- Models for the scene ---
const box = (s, x0, x1, y0, y1, z0, z1, a) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) s(x, y, z, typeof a === 'function' ? a(x, y, z) : a); };
const new_ = () => { const W = new Map(); return [W, (x, y, z, a) => W.set(`${x},${y},${z}`, a)]; };

export function tree(size = 1, seed = 0) {
  const [W, s] = new_();
  const up = 3 + size;
  box(s, 0, 0, 0, up, 0, 0, 'trunk');
  const r0 = 2 + size;
  for (let y = up - 1; y <= up + 2 * r0; y++) {
    const t = (y - (up + r0)) / r0;
    const rr = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * r0);
    for (let x = -rr; x <= rr; x++) for (let z = -rr; z <= rr; z++)
      if (x * x + z * z <= rr * rr + 1 && ((x * 31 + z * 17 + y * 7 + seed) % 11) !== 0) s(x, y, z, 'sheet');
  }
  return W;
}

export function human(seed = 0) {
  const [W, s] = new_();
  const shirt = ['shirt', 'team', 'plasterDark', 'pane'][seed % 4];
  box(s, 0, 0, 0, 1, 0, 0, 'pants'); box(s, 1, 1, 0, 1, 0, 0, 'pants');
  box(s, 0, 1, 2, 3, 0, 0, shirt);
  box(s, 0, 1, 4, 5, 0, 0, 'skin');
  box(s, 0, 1, 6, 6, 0, 0, seed % 2 ? 'black' : 'holz');
  return W;
}

export function laterne() {
  const [W, s] = new_();
  box(s, 0, 0, 0, 7, 0, 0, 'roof'); s(0, 8, 0, 'white'); s(1, 8, 0, 'roof');
  return W;
}

export function kiste() { const [W, s] = new_(); box(s, 0, 1, 0, 1, 0, 1, 'holz'); s(0, 2, 0, 'holz'); return W; }
