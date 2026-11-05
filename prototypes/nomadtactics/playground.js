// NomadTactics – playground: voxel diorama to destroy.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { tank, kaserne } from './voxel2.js';
import { PAL as PAL3, tree, laterne, kiste, voxelMaterial } from './voxel3.js';

// ---------- Grundlagen ----------
const PAL = {
  ...PAL3,
  grass: [0x6fa449, 0x77ad50, 0x669a43, 0x7fb556, 0x6b9f47], grassBrightness: [0x88bd5f, 0x8fc366],
  soot: [0x2e2b27, 0x3a352e, 0x45403a, 0x24221f], earth: [0x7d5f40, 0x866646, 0x735737],
};
const V = 0.4, BLUE = 0x3a78d8, RED = 0xd8473a;
const K = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
const D = k => { const z = (k % 1024) - 512, t = Math.floor(k / 1024); return [Math.floor(t / 1024) - 512, (t % 1024) - 512, z]; };
const offStr = W => { const M = new Map(); for (const [k, a] of W) { const [x, y, z] = k.split(',').map(Number); M.set(K(x, y, z), a); } return M; };
function color(kind, x, y, z, team) {
  const p = kind === 'team' ? [team] : (PAL[kind] || [0xff00ff]);
  return p[Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % p.length];
}

const DIR = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const AXES = DIR.map(d => [0, 1, 2].filter(q => d[q] === 0));
const PAGE = [0.9, 0.9, 1.0, 0.6, 0.95, 0.82];
const AOW = [0.52, 0.68, 0.84, 1.0];
const CORNER = [[0, 0], [1, 0], [1, 1], [0, 1]];

function constructGeo(W, keys, Vx, team) {
  const pos = [], nor = [], col = [], chan = [], c = new THREE.Color();
  const has = (x, y, z) => W.has(K(x, y, z));
  for (const k of keys) {
    const kind = W.get(k); if (kind === undefined) continue;
    const [x, y, z] = D(k);
    const basis = color(kind, x, y, z, team);
    for (let i = 0; i < 6; i++) {
      const d = DIR[i];
      if (has(x + d[0], y + d[1], z + d[2])) continue;
      const [u, v] = AXES[i];
      const ox = x + d[0], oy = y + d[1], oz = z + d[2];
      const e = CORNER.map(([a, b]) => {
        const q = [x, y, z];
        for (let ax = 0; ax < 3; ax++) { if (d[ax]) q[ax] += d[ax] > 0 ? 1 : 0; else q[ax] += ax === u ? a : b; }
        const su = [0, 0, 0], sv = [0, 0, 0]; su[u] = a ? 1 : -1; sv[v] = b ? 1 : -1;
        const s1 = has(ox + su[0], oy + su[1], oz + su[2]), s2 = has(ox + sv[0], oy + sv[1], oz + sv[2]);
        const ck = has(ox + su[0] + sv[0], oy + su[1] + sv[1], oz + su[2] + sv[2]);
        return { q, ao: s1 && s2 ? 0 : 3 - (s1 + s2 + ck), a, b };
      });
      const quad = e[0].ao + e[2].ao >= e[1].ao + e[3].ao ? [[e[0], e[1], e[2]], [e[0], e[2], e[3]]] : [[e[1], e[2], e[3]], [e[1], e[3], e[0]]];
      for (const tri of quad) {
        const A = tri[0].q, B = tri[1].q, C = tri[2].q;
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const n = (uy * vz - uz * vy) * d[0] + (uz * vx - ux * vz) * d[1] + (ux * vy - uy * vx) * d[2];
        const o = n < 0 ? [tri[0], tri[2], tri[1]] : tri;
        for (const p of o) {
          c.setHex(basis).multiplyScalar(PAGE[i] * AOW[p.ao]);
          pos.push(p.q[0] * Vx - Vx / 2, p.q[1] * Vx, p.q[2] * Vx - Vx / 2);
          nor.push(d[0], d[1], d[2]); col.push(c.r, c.g, c.b); chan.push(p.a, p.b);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(chan, 2));
  g.computeBoundingSphere();
  return g;
}

// ---------- Renderer, Szene, Licht ----------
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
r.setSize(innerWidth, innerHeight);
r.shadowMap.enabled = true; r.shadowMap.type = THREE.VSMShadowMap;
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
document.body.appendChild(r.domElement);

const s = new THREE.Scene();
s.background = new THREE.Color(0xd8e6ea);
s.fog = new THREE.Fog(0xd8e6ea, 120, 260);
s.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5a, 1.6));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.position.set(-18, 26, 14); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 8; sun.shadow.blurSamples = 12; sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, far: 120 });
s.add(sun);
const fill = new THREE.DirectionalLight(0xbfd6ff, 0.5); fill.position.set(20, 10, -15); s.add(fill);
const flashes = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffa040, 0, 30, 1.6); s.add(l); return { l, t: 9, i0: 0 }; });

const material = voxelMaterial();

// ---------- Terrain in chunks ----------
const N = 60, CH = 16, GROUND_MIN = -3;
const G = new Map();
const hmap = new Int16Array((2 * N + 1) * (2 * N + 1)).fill(GROUND_MIN);
const hi = (gx, gz) => (gx + N) * (2 * N + 1) + (gz + N);
const way = (x, z) => (Math.abs(x - 5) <= 3 && z > 18) || (Math.abs(z - 22) <= 3 && x < 8 && x > -40);
const hof = (x, z) => Math.abs(x) <= 43 && z >= -30 && z <= 34;
for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  let h = 0;
  if (!hof(x, z)) h = Math.max(0, Math.round(1.6 + Math.sin(x * 0.08) * 1.5 + Math.cos(z * 0.07 + 1) * 1.5 - (d < 52 ? 1.2 : 0)));
  for (let y = GROUND_MIN; y <= h; y++) {
    let a = y < h ? 'earth' : 'grass';
    if (y === h && way(x, z)) a = ((x + 99) % 3 === 0 || (z + 99) % 3 === 0) ? 'platesJoint' : 'plate';
    G.set(K(x, y, z), a);
  }
  hmap[hi(x, z)] = h;
  const hs = Math.abs((x * 92837111) ^ (z * 689287499)) % 100;
  if (!way(x, z) && hs < 3) { G.set(K(x, h + 1, z), hs < 1 ? 'flower' : 'grassBrightness'); }
}
const chunk = new Map();       // id -> { keys:Set, mesh }
const bid = (gx, gz) => `${Math.floor(gx / CH)},${Math.floor(gz / CH)}`;
for (const k of G.keys()) { const [x, , z] = D(k); const id = bid(x, z); if (!chunk.has(id)) chunk.set(id, { keys: new Set() }); chunk.get(id).keys.add(k); }
for (const b of chunk.values()) {
  b.mesh = new THREE.Mesh(constructGeo(G, b.keys, V, 0), material);
  b.mesh.position.y = -V; b.mesh.receiveShadow = true; b.mesh.castShadow = true; b.mesh.userData.ground = true;
  s.add(b.mesh);
}
function groundNew(ids) { for (const id of ids) { const b = chunk.get(id); if (!b) continue; b.mesh.geometry.dispose(); b.mesh.geometry = constructGeo(G, b.keys, V, 0); } }
function groundHeight(wx, wz) {
  const gx = Math.round(wx / V), gz = Math.round(wz / V);
  if (Math.abs(gx) > N || Math.abs(gz) > N) return -10;
  return hmap[hi(gx, gz)] * V;
}

// ---------- Objekte ----------
const objects = [];
function spot(type, Wstr, team, x, z, red = 0) {
  const W = offStr(Wstr);
  const mesh = new THREE.Mesh(constructGeo(W, W.keys(), V, team), material);
  mesh.position.set(x, 0, z); mesh.rotation.y = red; mesh.castShadow = mesh.receiveShadow = true;
  s.add(mesh); mesh.updateMatrixWorld();
  const o = { type, W, mesh, team, start: W.size, dead: false };
  mesh.userData.object = o; objects.push(o); return o;
}
spot('building', kaserne(), BLUE, 0, 0);
spot('tank', tank(), BLUE, 11, 10.5, 0.35);
spot('tank', tank(), BLUE, 4.5, 12.5, -0.1);
spot('tank', tank(), RED, -17, 15, 2.3);
spot('tank', tank(), RED, -12, 19.5, 2.6);
spot('tank', tank(), RED, -19.5, 7, 2.0);
for (const [x, z] of [[-4.5, 9], [9.5, 13.8], [-9, 13.8], [14.5, 13.8]]) spot('small', laterne(), 0, x, z);
for (const [x, z, rr] of [[12.5, 4.6, 0.2], [-14, 5.5, 0.6], [-15, 7, 0], [7, -6.5, 0.3]]) spot('small', kiste(), 0, x, z, rr);
[[-19, -4, 2], [-22, 2, 1], [19, -6, 1], [21, 3, 2], [17, 17, 1], [-12, -13, 1], [12, -14, 2], [0, -16, 1], [22, 12, 0], [-21, -12, 2], [-4, 21, 1], [20, 20, 2], [-21, 21, 1]]
  .forEach(([x, z, g], i) => spot('tree', tree(g, i), 0, x, z, i));

// ---------- Debris (real cubes with physics) ----------
const MAXT = 4500;
const tr = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAXT);
tr.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tr.castShadow = true; tr.receiveShadow = true; tr.frustumCulled = false;
const TP = new Float32Array(MAXT * 3), TV = new Float32Array(MAXT * 3), TR = new Float32Array(MAXT * 3), TW = new Float32Array(MAXT * 3);
const TS = new Float32Array(MAXT), TL = new Float32Array(MAXT), TRest = new Uint8Array(MAXT);
let tNext = 0; const tActive = new Set();
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(), col4 = new THREE.Color();
for (let i = 0; i < MAXT; i++) { m4.makeScale(0, 0, 0); tr.setMatrixAt(i, m4); tr.setColorAt(i, col4.set(0xffffff)); }
s.add(tr);
function debris(x, y, z, vx, vy, vz, size, colorHex, health = 9 + Math.random() * 5) {
  const i = tNext; tNext = (tNext + 1) % MAXT;
  TP.set([x, y, z], i * 3); TV.set([vx, vy, vz], i * 3);
  TR.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
  const sp = Math.hypot(vx, vy, vz) * 0.8 + 1;
  TW.set([(Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp], i * 3);
  TS[i] = size * (0.75 + Math.random() * 0.25); TL[i] = health; TRest[i] = 0;
  tr.setColorAt(i, col4.setHex(colorHex).multiplyScalar(0.92));
  tActive.add(i);
}
function debrisStep(dt) {
  for (const i of tActive) {
    const j = i * 3;
    if (!TRest[i]) {
      TV[j + 1] -= 22 * dt;
      TP[j] += TV[j] * dt; TP[j + 1] += TV[j + 1] * dt; TP[j + 2] += TV[j + 2] * dt;
      TR[j] += TW[j] * dt; TR[j + 1] += TW[j + 1] * dt; TR[j + 2] += TW[j + 2] * dt;
      const ground = groundHeight(TP[j], TP[j + 2]) + TS[i] / 2;
      if (TP[j + 1] < ground) {
        TP[j + 1] = ground;
        if (TV[j + 1] < -2.5) { TV[j + 1] *= -0.3; TV[j] *= 0.55; TV[j + 2] *= 0.55; TW[j] *= 0.5; TW[j + 1] *= 0.5; TW[j + 2] *= 0.5; }
        else {
          TV[j + 1] = 0; TV[j] *= 0.8; TV[j + 2] *= 0.8; TW[j] *= 0.6; TW[j + 1] *= 0.6; TW[j + 2] *= 0.6;
          if (Math.hypot(TV[j], TV[j + 2]) < 0.25) { TRest[i] = 1; TR[j] = Math.round(TR[j] / 1.5708) * 1.5708; TR[j + 2] = Math.round(TR[j + 2] / 1.5708) * 1.5708; }
        }
      }
    }
    TL[i] -= dt;
    let sc = TS[i] * Math.min(1, TL[i] / 1.5);
    if (TL[i] <= 0) { tActive.delete(i); sc = 0; }
    e4.set(TR[j], TR[j + 1], TR[j + 2]); q4.setFromEuler(e4);
    tr.setMatrixAt(i, m4.compose(v4.set(TP[j], TP[j + 1], TP[j + 2]), q4, s4.set(sc, sc, sc)));
  }
  tr.instanceMatrix.needsUpdate = true; if (tr.instanceColor) tr.instanceColor.needsUpdate = true;
}

// ---------- Feuer, Rauch, Staub, Pilz ----------
const MAXF = 3500;
const fx = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: true }), MAXF);
fx.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fx.frustumCulled = false;
const FP = new Float32Array(MAXF * 3), FV = new Float32Array(MAXF * 3), FL = new Float32Array(MAXF), FM = new Float32Array(MAXF), FS = new Float32Array(MAXF), FA = new Uint8Array(MAXF), FR = new Float32Array(MAXF);
let fNext = 0; const fActive = new Set();
for (let i = 0; i < MAXF; i++) { m4.makeScale(0, 0, 0); fx.setMatrixAt(i, m4); fx.setColorAt(i, col4.set(0)); }
s.add(fx);
// Arten: 0 Feuerball, 1 Rauch, 2 Staub, 3 Pilz, 4 Funken
function particles(kind, x, y, z, vx, vy, vz, size, health) {
  const i = fNext; fNext = (fNext + 1) % MAXF;
  FP.set([x, y, z], i * 3); FV.set([vx, vy, vz], i * 3); FL[i] = FM[i] = health; FS[i] = size; FA[i] = kind; FR[i] = Math.random() * 3;
  fActive.add(i);
}
const COL = {
  hot: new THREE.Color(7, 5.5, 3.6), orange: new THREE.Color(4.2, 1.5, 0.3), red: new THREE.Color(1.3, 0.3, 0.08),
  smoke: new THREE.Color(0.2, 0.19, 0.18), smokeBrightness: new THREE.Color(0.55, 0.54, 0.53), dust: new THREE.Color(0.78, 0.7, 0.56),
};
const cTmp = new THREE.Color();
function colorHistory(t, stops) {
  for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) {
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    return cTmp.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
  }
  return cTmp.copy(stops[stops.length - 1][1]);
}
const HISTORY = {
  0: [[0, COL.hot], [0.12, COL.hot], [0.35, COL.orange], [0.6, COL.red], [0.75, COL.smoke], [1, COL.smoke]],
  1: [[0, COL.smoke], [1, COL.smokeBrightness]],
  2: [[0, COL.dust], [1, COL.dust]],
  3: [[0, COL.hot], [0.1, COL.orange], [0.3, COL.red], [0.5, new THREE.Color(0.42, 0.33, 0.28)], [1, COL.smokeBrightness]],
  4: [[0, COL.hot], [0.5, COL.orange], [1, COL.red]],
};
function particlesStep(dt) {
  for (const i of fActive) {
    const j = i * 3, kind = FA[i];
    FL[i] -= dt;
    if (FL[i] <= 0) { fActive.delete(i); fx.setMatrixAt(i, m4.makeScale(0, 0, 0)); continue; }
    const t = 1 - FL[i] / FM[i];
    const move = kind === 4 ? 0.4 : kind === 3 ? 1.1 : 2.6;
    FV[j] *= 1 - move * dt; FV[j + 1] *= 1 - move * dt; FV[j + 2] *= 1 - move * dt;
    if (kind === 4) FV[j + 1] -= 18 * dt;
    else FV[j + 1] += (kind === 1 ? 1.4 : kind === 0 ? (t > 0.4 ? 2.2 : 0.6) : kind === 2 ? 0.3 : 0.9) * dt;
    if (kind === 3 && FV[j + 1] < 2.5) {            // Mushroom cap: push outward at the top
      const dx = FP[j] - mushroomCenter.x, dz = FP[j + 2] - mushroomCenter.z, l = Math.hypot(dx, dz) + 0.01;
      FV[j] += dx / l * 3.2 * dt; FV[j + 2] += dz / l * 3.2 * dt;
    }
    FP[j] += FV[j] * dt; FP[j + 1] += FV[j + 1] * dt; FP[j + 2] += FV[j + 2] * dt;
    const b = groundHeight(FP[j], FP[j + 2]);
    if (FP[j + 1] < b) { FP[j + 1] = b; if (kind === 4) FV[j + 1] *= -0.3; }
    const grow = kind === 0 ? (t < 0.15 ? 0.5 + t * 4 : 1.1 + t * 0.6) : kind === 1 ? 0.6 + t * 1.8 : kind === 2 ? 0.7 + t * 1.4 : kind === 3 ? 0.7 + t * 0.9 : 1;
    const end = t > 0.82 ? (1 - t) / 0.18 : 1;
    const sc = FS[i] * grow * end;
    q4.setFromEuler(e4.set(FR[i], FR[i] * 1.7, FR[i] * 0.6));
    fx.setMatrixAt(i, m4.compose(v4.set(FP[j], FP[j + 1], FP[j + 2]), q4, s4.set(sc, sc, sc)));
    fx.setColorAt(i, colorHistory(t, HISTORY[kind]));
  }
  fx.instanceMatrix.needsUpdate = true; if (fx.instanceColor) fx.instanceColor.needsUpdate = true;
}
const mushroomCenter = new THREE.Vector3();

// Burning wrecks and fire spots
const herds = [];
function stove(x, y, z, duration, strength = 1) { herds.push({ x, y, z, rest: duration, strength, tick: 0 }); }
function stoveStep(dt) {
  for (let k = herds.length - 1; k >= 0; k--) {
    const h = herds[k]; h.rest -= dt; h.tick -= dt;
    if (h.rest <= 0) { herds.splice(k, 1); continue; }
    if (h.tick <= 0) {
      h.tick = 0.06 / h.strength;
      const j = () => (Math.random() - 0.5) * 0.8 * h.strength;
      particles(1, h.x + j(), h.y + 0.3, h.z + j(), j() * 0.4, 1.5 + Math.random(), j() * 0.4, 0.35 + Math.random() * 0.3, 3 + Math.random() * 2);
      if (Math.random() < 0.6) particles(0, h.x + j(), h.y + 0.1, h.z + j(), 0, 1 + Math.random() * 1.5, 0, 0.25 + Math.random() * 0.2, 0.7 + Math.random() * 0.4);
    }
  }
}

// Druckwellen-Ringe
const rings = [];
function shockwave(p, radius, colorHex = 0xffd9a0) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, groundHeight(p.x, p.z) + 0.15, p.z); s.add(m);
  rings.push({ m, t: 0, radius });
}
function ringStep(dt) {
  for (let k = rings.length - 1; k >= 0; k--) {
    const g = rings[k]; g.t += dt;
    const f = g.t / 0.7;
    if (f >= 1) { s.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(k, 1); continue; }
    const rr = g.radius * (1 - Math.pow(1 - f, 3)); g.m.scale.setScalar(Math.max(0.01, rr));
    g.m.material.opacity = 0.8 * (1 - f);
  }
}

// ---------- Ton (synthetisch) ----------
let ac = null;
function soundOn() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ac && ac.state === 'suspended') ac.resume(); }
function bang(strength = 1) {
  if (!ac) return;
  const t0 = ac.currentTime, dur = 0.8 + strength * 0.9;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
  const src = ac.createBufferSource(); src.buffer = buf;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t0); lp.frequency.exponentialRampToValueAtTime(90, t0 + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(Math.min(1, 0.45 + strength * 0.2), t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(lp).connect(g).connect(ac.destination); src.start(t0);
  const o = ac.createOscillator(), og = ac.createGain();
  o.frequency.setValueAtTime(90, t0); o.frequency.exponentialRampToValueAtTime(28, t0 + dur * 0.8);
  og.gain.setValueAtTime(0.6, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.8);
  o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + dur);
}
function beep(up = 880) {
  if (!ac) return; const t0 = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = up; g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.3);
}

// ---------- Destruction ----------
let wobble = 0;
const vW = new THREE.Vector3(), vL = new THREE.Vector3();

function toDebris(o, k, vFn) {
  const kind = o.W.get(k); const [x, y, z] = D(k);
  vL.set(x * V, (y + 0.5) * V, z * V); o.mesh.localToWorld(vW.copy(vL));
  const v = vFn(vW, y);
  debris(vW.x, vW.y, vW.z, v[0], v[1], v[2], V, color(kind, x, y, z, o.team));
  o.W.delete(k);
}
function objectNew(o) {
  o.mesh.geometry.dispose();
  if (o.W.size === 0) { s.remove(o.mesh); o.dead = true; return; }
  o.mesh.geometry = constructGeo(o.W, o.W.keys(), V, o.team);
}
function center(o) { const c = o.mesh.geometry.boundingSphere; return o.mesh.localToWorld(c.center.clone()); }

function detonateTank(o) {
  if (o.dead) return;
  const c = center(o);
  explosion(c.clone().setY(c.y + 0.5), 2.0, 1.6, { crater: false, damage: false });
  for (const k of [...o.W.keys()]) toDebris(o, k, (p, y) => {
    const d = p.clone().sub(c); d.y = 0; d.normalize();
    const tower = y >= 4;
    return [d.x * (3 + Math.random() * 5) + (Math.random() - 0.5) * 3, (tower ? 9 : 4) + Math.random() * (tower ? 6 : 5), d.z * (3 + Math.random() * 5) + (Math.random() - 0.5) * 3];
  });
  objectNew(o);
  stove(c.x, groundHeight(c.x, c.z), c.z, 22, 1.3);
}
function fall(o, dustDa = true) {
  if (o.dead) return;
  const c = center(o);
  for (const k of [...o.W.keys()]) toDebris(o, k, (p, y) => [(p.x - c.x) * 0.25 + (Math.random() - 0.5) * 1.5, -Math.random() * 2 - y * 0.05, (p.z - c.z) * 0.25 + (Math.random() - 0.5) * 1.5]);
  objectNew(o);
  if (dustDa) {
    const radius = o.type === 'building' ? 6 : 1.2, n = o.type === 'building' ? 260 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, rr = Math.random() * radius;
      particles(2, c.x + Math.cos(a) * rr, 0.3 + Math.random() * 2, c.z + Math.sin(a) * rr, Math.cos(a) * 3, 0.5 + Math.random() * 1.5, Math.sin(a) * 3, 0.6 + Math.random() * 0.8, 3 + Math.random() * 3);
    }
    if (o.type === 'building') { bang(1.6); wobble += 0.5; for (let i = 0; i < 3; i++) stove(c.x + (Math.random() - 0.5) * 8, 0.3, c.z + (Math.random() - 0.5) * 5, 20, 1.1); }
  }
}
function losesFallenLet(o) {
  // Anything no longer connected to the bottom layer collapses
  let minY = Infinity; for (const k of o.W.keys()) minY = Math.min(minY, D(k)[1]);
  const seen = new Set(), stack = [];
  for (const k of o.W.keys()) if (D(k)[1] === minY) { seen.add(k); stack.push(k); }
  while (stack.length) {
    const [x, y, z] = D(stack.pop());
    for (const d of DIR) { const n = K(x + d[0], y + d[1], z + d[2]); if (o.W.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
  }
  let n = 0;
  for (const k of [...o.W.keys()]) if (!seen.has(k)) { toDebris(o, k, () => [(Math.random() - 0.5) * 1.2, -0.5, (Math.random() - 0.5) * 1.2]); n++; }
  return n;
}

function explosion(p, radius, strength, { crater = true, damage = true } = {}) {
  // Licht, Feuerball, Rauch, Funken, Druckwelle, Ton, Wackeln
  const b = flashes.reduce((a, c) => (c.t > a.t ? c : a)); b.l.position.set(p.x, p.y + 1.5, p.z); b.t = 0; b.i0 = 60 * strength * radius; b.l.distance = radius * 9;
  const nFire = Math.min(420, Math.round(22 * radius * strength));
  for (let i = 0; i < nFire; i++) {
    const a = Math.random() * 6.283, h = Math.random() * 1.2 - 0.1, sp = (0.5 + Math.random()) * radius * 2.2;
    particles(0, p.x, p.y + 0.3, p.z, Math.cos(a) * sp * Math.sqrt(1 - h * h), Math.abs(h) * sp * 1.4 + 1, Math.sin(a) * sp * Math.sqrt(1 - h * h), (0.25 + Math.random() * 0.45) * Math.sqrt(radius), 0.7 + Math.random() * 0.8);
  }
  for (let i = 0; i < Math.round(10 * radius); i++) {
    const a = Math.random() * 6.283, sp = Math.random() * radius;
    particles(1, p.x + Math.cos(a) * sp * 0.4, p.y + 0.5, p.z + Math.sin(a) * sp * 0.4, Math.cos(a) * sp, 2 + Math.random() * 2, Math.sin(a) * sp, 0.5 + Math.random() * 0.5 * radius, 3 + Math.random() * 3);
  }
  for (let i = 0; i < Math.round(14 * strength); i++) {
    const a = Math.random() * 6.283;
    particles(4, p.x, p.y + 0.3, p.z, Math.cos(a) * (4 + Math.random() * 8), 6 + Math.random() * 9, Math.sin(a) * (4 + Math.random() * 8), 0.08, 0.8 + Math.random() * 0.8);
  }
  shockwave(p, radius * 3.2);
  bang(strength); wobble += 0.12 * strength * radius;
  if (!damage) return;

  // Craters and soot in the ground
  const changed = new Set();
  if (crater) {
    const gr = Math.ceil(radius * 1.6 / V), cx = Math.round(p.x / V), cz = Math.round(p.z / V);
    let earthChunk = 0;
    for (let gx = cx - gr; gx <= cx + gr; gx++) for (let gz = cz - gr; gz <= cz + gr; gz++) {
      if (Math.abs(gx) > N || Math.abs(gz) > N) continue;
      const dxz = Math.hypot(gx * V - p.x, gz * V - p.z);
      let top = hmap[hi(gx, gz)];
      for (let gy = top + 1; gy >= GROUND_MIN + 1; gy--) {
        const k = K(gx, gy, gz); if (!G.has(k)) continue;
        const dd = Math.hypot(dxz, (gy - 0.5) * V - p.y);
        if (dd < radius * 0.8) {
          const kind = G.get(k); G.delete(k); changed.add(k);
          if (earthChunk < 160 && Math.random() < 0.45) {
            earthChunk++;
            const dx = gx * V - p.x, dz = gz * V - p.z, l = Math.hypot(dx, dz) + 0.1;
            debris(gx * V, (gy - 0.5) * V, gz * V, dx / l * (2 + Math.random() * 4), 5 + Math.random() * 7 * strength, dz / l * (2 + Math.random() * 4), V, color(kind, gx, gy, gz, 0));
          }
        }
      }
      // neue Oberkante suchen
      top = GROUND_MIN; for (let gy = 8; gy >= GROUND_MIN; gy--) { const a = G.get(K(gx, gy, gz)); if (a && a !== 'flower' && a !== 'grassBrightness') { top = gy; break; } }
      hmap[hi(gx, gz)] = top;
      if (dxz < radius * 1.7 && Math.random() < 1.25 - dxz / (radius * 1.7)) {
        const kt = K(gx, top, gz); if (G.has(kt)) { G.set(kt, 'soot'); changed.add(kt); }
        for (const yy of [top + 1, top + 2]) { const ko = K(gx, yy, gz); if (G.has(ko)) { G.delete(ko); changed.add(ko); } }
      }
    }
    const ids = new Set();
    for (const k of changed) { const [x, , z] = D(k); for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) ids.add(bid(x + dx, z + dz)); const b = chunk.get(bid(x, z)); if (b && !G.has(k)) b.keys.delete(k); }
    groundNew(ids);
  }

  // Objekte treffen
  for (const o of objects) {
    if (o.dead) continue;
    const c = center(o), rr = o.mesh.geometry.boundingSphere.radius;
    if (c.distanceTo(p) > rr + radius) continue;
    o.mesh.worldToLocal(vL.copy(p));
    let n = 0;
    for (const k of [...o.W.keys()]) {
      const [x, y, z] = D(k);
      const d = Math.hypot(x * V - vL.x, (y + 0.5) * V - vL.y, z * V - vL.z);
      if (d < radius) {
        const force = strength * 8 * (1 - d / radius) + 2;
        toDebris(o, k, w => { const dir = w.clone().sub(p); dir.y = Math.max(0.2, dir.y); dir.normalize(); return [dir.x * force, dir.y * force + 2 + Math.random() * 3, dir.z * force]; });
        n++;
      }
    }
    if (!n) continue;
    const loss = 1 - o.W.size / o.start;
    if (o.type === 'tank' && loss > 0.12) { objectNew(o); setTimeout(() => detonateTank(o), 220 + Math.random() * 200); continue; }
    if (o.type === 'tree' && loss > 0.1) { fall(o, false); continue; }
    if (o.type === 'small') { fall(o, false); continue; }
    if (o.type === 'building' && loss > 0.33) { objectNew(o); setTimeout(() => fall(o), 350); continue; }
    losesFallenLet(o);
    objectNew(o);
    if (o.type === 'building') stove(p.x, Math.max(0.3, p.y), p.z, 12, 0.8);
  }
}

// Superwaffe: Zielkreis, Countdown, Lichtblitz, Pilzwolke
let countdown = null;
const display = document.getElementById('countdown'), flashOverlay = document.getElementById('flash');
function superweapon(p) {
  if (countdown) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, groundHeight(p.x, p.z) + 0.2, p.z); ring.scale.setScalar(9); s.add(ring);
  countdown = { p: p.clone(), t: 3.2, ring, last: 4 };
}
function countdownStep(dt) {
  if (!countdown) return;
  const c = countdown; c.t -= dt;
  c.ring.material.opacity = 0.5 + 0.5 * Math.sin(c.t * 14);
  c.ring.scale.setScalar(9 - (3.2 - c.t) * 1.2);
  const number = Math.ceil(c.t);
  if (number < c.last && number > 0) { c.last = number; display.textContent = number; display.style.opacity = 1; beep(number === 1 ? 1320 : 880); }
  if (c.t <= 0) {
    display.style.opacity = 0; s.remove(c.ring);
    flashOverlay.style.transition = 'none'; flashOverlay.style.opacity = 1;
    requestAnimationFrame(() => { flashOverlay.style.transition = 'opacity 1.8s ease-out'; flashOverlay.style.opacity = 0; });
    const p = c.p; countdown = null;
    explosion(p, 6.5, 3.2);
    bang(4); wobble += 2.5;
    mushroomCenter.copy(p);
    for (const o of objects) if (!o.dead && center(o).distanceTo(p) < 15) {
      if (o.type === 'tank') setTimeout(() => detonateTank(o), 150 + Math.random() * 500);
      else { const c0 = center(o); for (const k of [...o.W.keys()]) toDebris(o, k, w => { const d = w.clone().sub(p); const l = d.length() + 0.5; return [d.x / l * (18 - l), 6 + Math.random() * 10, d.z / l * (18 - l)]; }); objectNew(o); }
    }
    let n = 0; const mushroom = setInterval(() => {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * 6.283, rr = Math.random() * 1.8;
        particles(3, p.x + Math.cos(a) * rr, 0.5, p.z + Math.sin(a) * rr, Math.cos(a) * 0.6, 13 + Math.random() * 6, Math.sin(a) * 0.6, 0.9 + Math.random() * 1.1, 6 + Math.random() * 4);
      }
      if (++n > 40) clearInterval(mushroom);
    }, 40);
    shockwave(p, 40, 0xffffff);
    for (let i = 0; i < 140; i++) { const a = Math.random() * 6.283, rr = 4 + Math.random() * 6; particles(2, p.x + Math.cos(a) * rr, 0.4, p.z + Math.sin(a) * rr, Math.cos(a) * 16, 0.8 + Math.random(), Math.sin(a) * 16, 0.7 + Math.random() * 0.6, 1.6 + Math.random() * 1.4); }
    stove(p.x, 0, p.z, 30, 2);
  }
}

// ---------- Kamera, Steuerung, Nachbearbeitung ----------
const cam = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 1, 600);
cam.position.set(40, 44, 52);
const ctl = new OrbitControls(cam, r.domElement);
ctl.target.set(0, 0, 5); ctl.enableDamping = true; ctl.dampingFactor = 0.08;
ctl.minDistance = 18; ctl.maxDistance = 140; ctl.minPolarAngle = 0.3; ctl.maxPolarAngle = 1.25;
ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
ctl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
ctl.update();

const comp = new EffectComposer(r);
comp.addPass(new RenderPass(s, cam));
const gtao = new GTAOPass(s, cam, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1.4, samples: 12 });
gtao.blendIntensity = 0.85; comp.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 0.9); comp.addPass(bloom);
const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.52; comp.addPass(tiltH); comp.addPass(tiltV);
comp.addPass(new OutputPass());
comp.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 u;
    void main(){ vec3 c = texture2D(tDiffuse, u).rgb; float g = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(g), c, 1.1); c = c * 0.96 + vec3(0.02, 0.025, 0.035);
      c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), smoothstep(0.4, 0.9, g));
      c *= mix(0.86, 1.0, smoothstep(1.05, 0.35, length(u - 0.5)));
      gl_FragColor = vec4(c, 1.0); }` }));
function size() {
  const w = innerWidth, h = innerHeight;
  r.setSize(w, h); comp.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
  tiltH.uniforms.h.value = 1.8 / w; tiltV.uniforms.v.value = 1.8 / h;
}
size(); addEventListener('resize', size);

let quality = 'up';
function setQuality(q) {
  quality = q; gtao.enabled = q === 'up'; tiltH.enabled = tiltV.enabled = q !== 'low';
  r.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.VSMShadowMap; r.shadowMap.needsUpdate = true;
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === q));
}

// ---------- Eingabe ----------
let mode = 'granate';
const MODI = { granate: [1.3, 1.0], rakete: [2.6, 1.8] };
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b)); });
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => setQuality(b.dataset.q));
document.getElementById('new').onclick = () => location.reload();

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null;
r.domElement.addEventListener('pointerdown', e => { soundOn(); down = { x: e.clientX, y: e.clientY, t: performance.now(), n: e.isPrimary }; });
r.domElement.addEventListener('pointerup', e => {
  if (!down || !e.isPrimary) return;
  const far = Math.hypot(e.clientX - down.x, e.clientY - down.y), long = performance.now() - down.t;
  down = null;
  if (far > 7 || long > 450 || e.button === 2) return;
  fire(e.clientX, e.clientY);
});
function hit(cx, cy) {
  mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, cam);
  const targets = [...chunk.values()].map(b => b.mesh).concat(objects.filter(o => !o.dead).map(o => o.mesh));
  const t = ray.intersectObjects(targets, false)[0];
  return t ? t.point : null;
}
function fire(cx, cy) {
  const p = hit(cx, cy); if (!p) return;
  if (mode === 'super') superweapon(p);
  else explosion(p, ...MODI[mode]);
}

// ---------- Hauptschleife ----------
const clock = new THREE.Clock();
let wobbleOffset = new THREE.Vector3();
function step() {
  const dt = Math.min(0.05, clock.getDelta());
  cam.position.sub(wobbleOffset);
  ctl.update();
  debrisStep(dt); particlesStep(dt); stoveStep(dt); ringStep(dt); countdownStep(dt);
  for (const b of flashes) { b.t += dt; b.l.intensity = b.i0 * Math.exp(-b.t * 7); }
  wobble = Math.min(3, wobble) * Math.exp(-dt * 5);
  wobbleOffset.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(wobble);
  cam.position.add(wobbleOffset);
  comp.render(dt);
}
r.setAnimationLoop(step);

// For tests without a screen
window.playground = {
  boom(x, z, m = 'granate') { const p = new THREE.Vector3(x, groundHeight(x, z), z); if (m === 'super') superweapon(p); else explosion(p, ...MODI[m]); },
  objects, cam, ctl, setQuality,
};
document.getElementById('load').remove();
