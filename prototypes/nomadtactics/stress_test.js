// NomadTactics – stress test: many voxel units in diorama look, with FPS measurement.
// Question behind it: does the style hold up in a real RTS battle (performance), and can you recognize the units from gameplay height?
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
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { kaserne } from './voxel2.js';
import { PAL as PAL3, tree, voxelMaterial } from './voxel3.js';

// ---------- Grundlagen ----------
// Hooks for add-ons like the HUD (game/tactics/hud): treffer, stirb, ereignis, eingabe
const hooks = { hudActive: false };
const PAL = {
  ...PAL3,
  grass: [0x6fa449, 0x77ad50, 0x669a43, 0x7fb556, 0x6b9f47], soot: [0x2e2b27, 0x3a352e, 0x45403a, 0x24221f],
  earth: [0x7d5f40, 0x866646, 0x735737], yellow: [0xe2b232, 0xe9bb3c, 0xdcab2c], yellowDark: [0xb98a22, 0xc09126], asphalt: [0x56585b, 0x5b5d60, 0x515356],
  tires: [0x2b2a27, 0x312f2b], oliv: [0x5f6a3e, 0x66714a, 0x5a653a],
};
const V = 0.4;
const TEAM_COLOR = [0x3a78d8, 0xd8473a];
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const hash = (x, y, z) => Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));
function color(kind, x, y, z, team) {
  const p = kind === 'team' ? [team] : (PAL[kind] || [0xff00ff]);
  return p[hash(x, y, z) % p.length];
}

const HEADINGS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const PAGE = [0.9, 0.9, 1.0, 0.6, 0.95, 0.82];
const AOW = [0.52, 0.68, 0.84, 1.0];
const CORNER = [[0, 0], [1, 0], [1, 1], [0, 1]];

// Quad with AO-correct diagonal and outward winding
function quadFace(P, e, n, basis, brightness) {
  const c = new THREE.Color();
  const quad = e[0].ao + e[2].ao >= e[1].ao + e[3].ao ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
  for (let [i0, i1, i2] of quad) {
    const A = e[i0].p, B = e[i1].p, C = e[i2].p;
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0) [i1, i2] = [i2, i1];
    for (const i of [i0, i1, i2]) {
      c.setHex(basis).multiplyScalar(brightness * AOW[e[i].ao]);
      P.pos.push(...e[i].p); P.nor.push(...n); P.col.push(c.r, c.g, c.b); P.chan.push(...e[i].k);
    }
  }
}
function geometry(P, dark = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(dark === 1 ? P.col : P.col.map(v => v * dark), 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(P.chan, 2));
  if (P.mat) { g.setAttribute('mat', new THREE.Float32BufferAttribute(P.mat, 1)); g.setAttribute('outer', new THREE.Float32BufferAttribute(P.border, 4)); }
  g.computeBoundingSphere();
  return g;
}

// Voxel-Modell (Map "x,y,z" -> Art) zu Geometrie
// Surface kind per voxel kind: 0 camo paint, 1 team paint, 2 metal, 3 rubber/fabric, 4 glass, 5 paint without camo
const UI = { oliv: 0, brown: 0, sand: 0, team: 1, metall: 2, black: 2, track: 3, tires: 3, pants: 3, skin: 3, glass: 4, pane: 4, yellow: 5, yellowDark: 5, red: 5,
  concrete: 5, concreteDark: 5, plaster: 5, plasterDark: 5, roofBorder: 5, door: 5, roof: 3, holz: 3, white: 5 };
function modelGeo(W, team, dark = 1, keys = null) {
  const P = { pos: [], nor: [], col: [], chan: [], mat: [], border: [] };
  const has = (x, y, z) => W.has(`${x},${y},${z}`);
  for (const k of (keys || W.keys())) {
    const kind = W.get(k); if (kind === undefined) continue;
    const [x, y, z] = k.split(',').map(Number);
    const basis = color(kind, x, y, z, team);
    for (let i = 0; i < 6; i++) {
      const d = HEADINGS[i];
      if (has(x + d[0], y + d[1], z + d[2])) continue;
      const [u, v] = [0, 1, 2].filter(q => d[q] === 0);
      const ox = x + d[0], oy = y + d[1], oz = z + d[2];
      const e = CORNER.map(([a, b]) => {
        const q = [x, y, z];
        for (let ax = 0; ax < 3; ax++) { if (d[ax]) q[ax] += d[ax] > 0 ? 1 : 0; else q[ax] += ax === u ? a : b; }
        const su = [0, 0, 0], sv = [0, 0, 0]; su[u] = a ? 1 : -1; sv[v] = b ? 1 : -1;
        const s1 = has(ox + su[0], oy + su[1], oz + su[2]), s2 = has(ox + sv[0], oy + sv[1], oz + sv[2]);
        const ck = has(ox + su[0] + sv[0], oy + su[1] + sv[1], oz + su[2] + sv[2]);
        return { p: [q[0] * V - V / 2, q[1] * V, q[2] * V - V / 2], ao: s1 && s2 ? 0 : 3 - (s1 + s2 + ck), k: [a, b] };
      });
      quadFace(P, e, d, basis, PAGE[i]);
      // Which edges of the face are true outer edges (neighbor missing at the side)? -> wear only there
      const nb = (ax, sg) => { const q = [x, y, z]; q[ax] += sg; return has(q[0], q[1], q[2]) ? 0 : 1; };
      const rd = [nb(u, -1), nb(u, 1), nb(v, -1), nb(v, 1)], mt = UI[kind] ?? 5;
      for (let n = 0; n < 6; n++) { P.mat.push(mt); P.border.push(...rd); }
    }
  }
  return geometry(P, dark);
}

// ---------- Einheiten-Modelle (x breit, y hoch, +z vorne) ----------
const new_ = () => { const W = new Map(); return [W, (x, y, z, a) => W.set(`${x},${y},${z}`, a)]; };
const box = (s, x0, x1, y0, y1, z0, z1, a) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) s(x, y, z, typeof a === 'function' ? a(x, y, z) : a); };

function tankWanne() {
  const [W, s] = new_();
  box(s, -4, -3, 0, 1, -9, 8, 'track'); box(s, 3, 4, 0, 1, -9, 8, 'track');
  box(s, -4, -4, 1, 1, -10, 9, 'oliv'); box(s, 4, 4, 1, 1, -10, 9, 'oliv');
  box(s, -2, 2, 1, 1, -9, 8, 'black');
  box(s, -4, 4, 2, 2, -10, 9, 'oliv');
  box(s, -4, 4, 3, 3, -10, 6, 'oliv');
  box(s, -3, 3, 4, 4, -10, -8, 'black');
  box(s, -5, -5, 2, 2, -6, 4, 'team'); box(s, 5, 5, 2, 2, -6, 4, 'team');
  return W;
}
function tankTower() {   // Drehpunkt (0,4,-3)
  const [W, s] = new_();
  box(s, -4, 4, 0, 1, -4, 4, 'oliv');
  box(s, -3, 3, 0, 1, 5, 5, 'oliv');
  for (const x of [-2, -1, 1, 2]) box(s, x, x, 0, 1, 6, 6, 'oliv');
  box(s, -3, 3, 0, 0, -5, -5, (x) => x % 2 ? 'black' : 'oliv');
  s(0, 0, 6, 'black'); s(0, 1, 6, 'black');
  for (let z = 7; z <= 19; z++) s(0, 1, z, z >= 18 ? 'metall' : 'oliv');
  box(s, -2, 2, 2, 2, -3, 1, 'team');
  s(2, 2, 3, 'black'); s(2, 3, 3, 'metall');
  return W;
}
function werferWanne() {
  const [W, s] = new_();
  box(s, -2, 2, 1, 1, -9, 8, 'black');
  for (const z of [-7, -6, -3, -2, 5, 6]) { box(s, -3, -3, 0, 1, z, z, 'tires'); box(s, 3, 3, 0, 1, z, z, 'tires'); }
  box(s, -3, 3, 2, 2, -9, 3, 'oliv');
  box(s, -3, 3, 2, 5, 4, 8, 'oliv');
  box(s, -2, 2, 4, 4, 8, 8, 'glass'); box(s, -3, -3, 4, 4, 5, 7, 'glass'); box(s, 3, 3, 4, 4, 5, 7, 'glass');
  box(s, -3, 3, 6, 6, 4, 7, 'team');
  box(s, -3, 3, 2, 2, 9, 9, 'black');
  return W;
}
function werferTower() {   // Drehpunkt (0,3,-3)
  const [W, s] = new_();
  box(s, -1, 1, 0, 0, -1, 1, 'metall');
  for (let z = -5; z <= 4; z++) {
    const y0 = 1 + Math.floor((z + 5) / 3);
    box(s, -3, 3, y0, y0 + 2, z, z, (x, y) => z === 4 ? ((x + y) % 2 ? 'black' : 'red') : (y === y0 + 2 && Math.abs(x) <= 1 ? 'team' : 'oliv'));
  }
  return W;
}
function spaeherWanne() {
  const [W, s] = new_();
  for (const z of [-4, -3, 3, 4]) { box(s, -3, -3, 0, 1, z, z, 'tires'); box(s, 3, 3, 0, 1, z, z, 'tires'); }
  box(s, -2, 2, 1, 1, -5, 5, 'black');
  box(s, -3, 3, 2, 2, -5, 5, 'oliv');
  box(s, -3, 3, 3, 3, -5, -5, 'oliv'); box(s, -3, -3, 3, 3, -5, 1, 'oliv'); box(s, 3, 3, 3, 3, -5, 1, 'oliv');
  box(s, -3, 3, 3, 3, 2, 5, (x) => Math.abs(x) <= 2 ? 'team' : 'oliv');
  box(s, -3, 3, 4, 4, 2, 2, 'glass');
  box(s, -2, -1, 3, 3, 0, 0, 'black'); box(s, 1, 2, 3, 3, 0, 0, 'black');
  return W;
}
function spaeherTower() {  // Drehpunkt (0,3,-2)
  const [W, s] = new_();
  box(s, 0, 0, 0, 1, 0, 0, 'metall');
  box(s, -1, 1, 2, 3, 1, 1, 'oliv');
  for (let z = 0; z <= 5; z++) s(0, 2, z, 'black');
  return W;
}
function dozerModel() {
  const [W, s] = new_();
  box(s, -4, -3, 0, 1, -5, 4, 'track'); box(s, 3, 4, 0, 1, -5, 4, 'track');
  box(s, -2, 2, 1, 4, -5, 2, 'yellow'); box(s, -2, 2, 1, 1, -5, 2, 'yellowDark');
  box(s, -2, 2, 5, 7, -5, -2, (x, y, z) => y === 6 && !(Math.abs(x) === 2 && (z === -5 || z === -2)) ? 'glass' : 'yellow');
  box(s, -2, 2, 8, 8, -5, -2, 'team');
  box(s, 1, 1, 5, 7, 0, 0, 'black');
  box(s, -3, -3, 2, 2, 3, 5, 'black'); box(s, 3, 3, 2, 2, 3, 5, 'black');
  box(s, -5, 5, 0, 3, 6, 6, 'metall'); box(s, -5, 5, 0, 0, 7, 7, 'metall'); box(s, -5, 5, 3, 3, 5, 5, 'metall');
  return W;
}
function soldat() {
  const [W, s] = new_();
  box(s, -1, -1, 0, 1, 0, 0, 'pants'); box(s, 0, 0, 0, 1, 0, 0, 'pants');
  box(s, -1, 0, 2, 3, 0, 0, 'team');
  box(s, -1, 0, 4, 4, 0, 0, 'skin');
  box(s, -1, 0, 5, 5, 0, 0, 'oliv');
  s(0, 3, 1, 'black'); s(0, 3, 2, 'black');
  return W;
}

const TYPES = {
  tank:  { name: 'Kampfpanzer', wanne: tankWanne, tower: tankTower, spin: [0, 4, -3], muzzle: [0, 1.5, 19.5], hp: 100, speed: 5.5, turn: 1.6, towerSpeed: 1.8,
             range: 26, reload: 2.4, damage: 22, weapon: 'granate', radius: 4.6, share: 0.4 },
  werfer:  { name: 'Raketenwerfer', wanne: werferWanne, tower: werferTower, spin: [0, 3, -3], muzzle: [0, 5, 4.5], hp: 55, speed: 6, turn: 1.4, towerSpeed: 1.2,
             range: 46, min: 12, reload: 7, damage: 12, weapon: 'rakete', salvo: 4, radius: 4.2, share: 0.2 },
  spaeher: { name: 'Spähwagen', wanne: spaeherWanne, tower: spaeherTower, spin: [0, 3, -2], muzzle: [0, 2.5, 5.5], hp: 45, speed: 10, turn: 3, towerSpeed: 5,
             range: 18, reload: 0.14, damage: 1.6, weapon: 'mg', radius: 2.8, share: 0.2 },
  squad:   { name: 'Infanterie', infantry: true, hp: 40, speed: 2.8, turn: 5, range: 15, reload: 0.9, damage: 2.2, weapon: 'gewehr', radius: 3.4, share: 0.15 },
  dozer:   { name: 'Dozer', wanne: dozerModel, hp: 80, speed: 4.5, turn: 2, weapon: null, radius: 3.4, share: 0.05 },
};
const MULT = {
  granate: { squad: 0.6 }, rakete: { squad: 1.3 },
  mg: { squad: 2.5, tank: 0.2, werfer: 0.6, dozer: 0.4 },
  gewehr: { tank: 0.15, werfer: 0.5, spaeher: 0.6, dozer: 0.4 },
};
const SQUAD_FORM = [[0, 0], [-1.4, -1.3], [1.4, -1.3], [-2.8, -2.6], [2.8, -2.6]];

// ---------- Renderer, Szene, Licht ----------
const SKY = 0xd8e6ea;
const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
r.setSize(innerWidth, innerHeight);
r.shadowMap.enabled = true; r.shadowMap.type = THREE.VSMShadowMap;
r.toneMapping = THREE.ACESFilmicToneMapping;
r.info.autoReset = false;
document.body.appendChild(r.domElement);

const s = new THREE.Scene();
s.background = new THREE.Color(SKY);
s.fog = new THREE.Fog(SKY, 160, 360);
const skyLight = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5a, 1.6); s.add(skyLight);
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 6; sun.shadow.blurSamples = 10; sun.shadow.bias = -0.0005;
sun.shadow.camera.far = 220;
s.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd6ff, 0.5); fill.position.set(20, 10, -15); s.add(fill);
const flashes = [0, 1, 2, 3, 4, 5].map(() => { const l = new THREE.PointLight(0xffa040, 0, 30, 1.6); s.add(l); return { l, t: 9, i0: 0 }; });
const material = voxelMaterial();
const environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;

// Surface shader for vehicles: paint, camo patches per cube, edge wear, dirt from below, metal and glass shine
function vehicleMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, envMap: environment, envMapIntensity: 0.28 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 edge; attribute float mat; attribute vec4 outer;
      varying vec2 vKante; varying float vMat; varying vec4 vRand; varying vec3 vLok;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vKante = edge; vMat = mat; vRand = outer; vLok = position - normal * 0.05;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vKante; varying float vMat; varying vec4 vRand; varying vec3 vLok;
      float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float rausch(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float gRau = 0.6; float gMet = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 kk = min(vKante, 1.0 - vKante);
        float rGitter = min(kk.x, kk.y);
        // Abstand zur nächsten echten Außenkante
        float rAus = 9.0;
        if (vRand.x > 0.5) rAus = min(rAus, vKante.x); if (vRand.y > 0.5) rAus = min(rAus, 1.0 - vKante.x);
        if (vRand.z > 0.5) rAus = min(rAus, vKante.y); if (vRand.w > 0.5) rAus = min(rAus, 1.0 - vKante.y);
        diffuseColor.rgb *= mix(0.93, 1.0, smoothstep(0.0, 0.04, rGitter));              // feine Fugen
        diffuseColor.rgb *= 1.0 + 0.16 * (1.0 - smoothstep(0.02, 0.2, rAus));               // Fase an Außenkanten
        int art = int(vMat + 0.5);
        vec3 vox = floor((vLok + vec3(0.2, 0.0, 0.2)) / 0.4);
        float fein = rausch(vLok * 9.0), grob = rausch(vLok * 1.3 + 7.0);
        if (art == 0 || art == 5) {
          if (art == 0) { float t = rausch(vox * 0.42 + 3.1);
            if (t > 0.62) diffuseColor.rgb *= vec3(0.8, 0.7, 0.56); else if (t < 0.32) diffuseColor.rgb *= vec3(0.62, 0.66, 0.56); }
          diffuseColor.rgb *= 0.94 + 0.12 * fein; gRau = 0.62 - 0.14 * grob;
        } else if (art == 1) { diffuseColor.rgb *= 0.97 + 0.06 * fein; gRau = 0.3 + 0.1 * fein; }
        else if (art == 2) { gRau = 0.34 + 0.25 * fein; gMet = 0.75; }
        else if (art == 3) { gRau = 0.95; diffuseColor.rgb *= 0.88 + 0.16 * fein; }
        else { gRau = 0.06; gMet = 0.25; diffuseColor.rgb *= 0.75; }
        if (art <= 1 || art == 5) {
          float abrieb = (1.0 - smoothstep(0.015, 0.09, rAus)) * step(0.5, rausch(vLok * 6.0 + 1.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.55), abrieb * 0.85);
          gMet = mix(gMet, 0.85, abrieb); gRau = mix(gRau, 0.32, abrieb);
        }
        float dreck = smoothstep(1.4, 0.05, vLok.y) * (0.4 + 0.6 * rausch(vLok * 2.2 + 4.0));
        if (art == 4) dreck *= 0.3;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.19, 0.13), dreck * 0.75);
        gRau = mix(gRau, 0.95, dreck); gMet *= 1.0 - dreck;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRau;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gMet;');
  };
  return m;
}
const vehicleMat = vehicleMaterial();

// ---------- Weather: cloud shadows, wetness, snow cover (injected into all lit materials) ----------
const WU = { wTime: { value: 0 }, wCover: { value: 0 }, wWind: { value: new THREE.Vector2(0.004, 0.002) }, wShadow: { value: 0.78 },
  wSun: { value: new THREE.Vector3(-0.6, 0.62, 0.45) }, wWet: { value: 0 }, wSnow: { value: 0 } };
function weatherMaterial(m, snowShare = 1) {
  const old = m.onBeforeCompile;
  m.onBeforeCompile = (sh, rr) => {
    old?.(sh, rr);
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWeltPos;\nvarying float vOben;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wwp = instanceMatrix * wwp;
        #endif
        vWeltPos = (modelMatrix * wwp).xyz;
        vOben = objectNormal.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWeltPos; varying float vOben;
        uniform float wZeit, wDeckung, wSchatten, wNass, wSchnee; uniform vec2 wWind; uniform vec3 wSonne;
        float wHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
        float wWolke(vec3 P){
          vec2 xz = P.xz + wSonne.xz * (90.0 - P.y) / max(0.2, wSonne.y);      // Schatten der Wolkenschicht in 90 m Höhe entlang der Sonne
          vec2 q = xz / 52.0 + wWind * wZeit;
          float n = wNoise(q) * 0.55 + wNoise(q * 2.13 + 3.7) * 0.3 + wNoise(q * 4.37 + 9.1) * 0.15;
          return smoothstep(1.0 - wDeckung - 0.05, 1.0 - wDeckung + 0.07, n);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wOben = smoothstep(0.5, 0.9, vOben);
        float wFleck = wNoise(vWeltPos.xz * 0.9) * 0.5 + wNoise(vWeltPos.xz * 3.1) * 0.5;
        diffuseColor.rgb *= 1.0 - wNass * 0.22;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), wSchnee * ${snowShare.toFixed(2)} * wOben * smoothstep(0.25, 0.6, wFleck + wSchnee * 0.5));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.3, wNass * smoothstep(0.5, 0.9, vOben) * 0.85);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float wLicht = 1.0 - wWolke(vWeltPos) * wSchatten;
        reflectedLight.directDiffuse *= wLicht; reflectedLight.directSpecular *= wLicht;`);
  };
  const oldKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (oldKey ? oldKey() : '') + '|wetter' + snowShare;
  return m;
}
weatherMaterial(material); weatherMaterial(vehicleMat);
// Units drive: little snow stays on them (team color remains recognizable)
const unitMat = weatherMaterial(vehicleMaterial(), 0.2), unitMatPlain = weatherMaterial(voxelMaterial(), 0.2);

// ---------- Terrain: height field in cubes (2.5D) ----------
// ---------- Town on the west edge and houses along the path ----------
// Scale of the river town (04.11., Daniel: „Brücken und Gebäude dürfen gerne etwas größer sein“). ?scale=small = old state for comparison
const SCALE = (() => { try { return new URLSearchParams(location.search).get('scale') === 'small' ? 'small' : 'big'; } catch { return 'big'; } })();
const BIG = SCALE === 'big';
const STADT = BIG ? { x1: -33, z0: -48, z1: 48 } : { x1: -41, z0: -42, z1: 42 };
const inStadt = (x, z) => x < STADT.x1 && z > STADT.z0 && z < STADT.z1;
// River town (04.11., collapse lab): river separates the banks, towers with structural frame, five bridge types
const RIVER = BIG ? { x: -54, half: 5.8, bank: 7.6, bett: -6, water: -0.5 } : { x: -57, half: 4.6, bank: 6.4, bett: -5, water: -0.5 };
const imRiver = x => Math.abs(x - RIVER.x) < RIVER.bank;
const TOWER_X = BIG ? { w: -66.8, o: -40.6 } : { w: -67.6, o: -46.6 };
const tower = (kind, bank, z, bx, bz, h) => ({ kind, x: TOWER_X[bank], z, bx, bz, h, tower: true });
const BUILDING_PLAN = [
  ...(BIG ? [
    tower('glass', 'w', -30, 10, 10, 96), tower('brick', 'w', -10, 10, 11, 34), tower('concrete', 'w', 10, 10, 10, 70), tower('glass', 'w', 30, 10, 10, 58),
    tower('concrete', 'o', -30, 11, 10, 80), tower('glass', 'o', -10, 11, 11, 110), tower('brick', 'o', 10, 11, 11, 38), tower('concrete', 'o', 30, 11, 10, 64),
  ] : [
    tower('glass', 'w', -27, 8, 8, 60), tower('brick', 'w', -9, 8, 9, 22), tower('concrete', 'w', 9, 8, 8, 48), tower('glass', 'w', 27, 8, 8, 40),
    tower('concrete', 'o', -27, 9, 8, 56), tower('glass', 'o', -9, 9, 9, 66), tower('brick', 'o', 9, 9, 9, 26), tower('concrete', 'o', 27, 9, 8, 44),
  ]),
  { kind: 'brick', x: 17, z: -7, bx: 6, bz: 5, h: 10 },
  { kind: 'concrete', x: -15, z: 10, bx: 5, bz: 6, h: 15 },
];
const BZ_ = BIG ? 40 : 36;
const BRIDGES_PLAN = [
  { type: 'gauge', z: -BZ_, name: 'Balkenbrücke' }, { type: 'arc', z: -BZ_ / 2, name: 'Steinbogen' }, { type: 'hang', z: 0, name: 'Hängebrücke' },
  { type: 'truss', z: BZ_ / 2, name: 'Fachwerkbrücke' }, { type: 'pontoon', z: BZ_, name: 'Pontonbrücke' },
];
const lot = (x, z, border = 2) => BUILDING_PLAN.some(g => Math.abs(x - g.x) < g.bx * V + border && Math.abs(z - g.z) < g.bz * V + border);
const N = 180, CH = 32, GROUND = -7, W2 = 2 * N + 1;
const H = new Int8Array(W2 * W2), A = new Uint8Array(W2 * W2);
const KINDS = ['grass', 'plate', 'soot', 'earth', 'grassBrightness', 'asphalt', 'sand'];
const ix = (gx, gz) => (gx + N) * W2 + (gz + N);
const inside = (gx, gz) => gx >= -N && gx <= N && gz >= -N && gz <= N;
const height = (gx, gz) => inside(gx, gz) ? H[ix(gx, gz)] : GROUND;
const BASIS_Z = 58;
const strasse = (x, z) => Math.abs(x - 4 * Math.sin(z * 0.035)) < 2.4 || (Math.abs(Math.abs(z) - 44) < 2.2 && Math.abs(x) < 40);
for (let gx = -N; gx <= N; gx++) for (let gz = -N; gz <= N; gz++) {
  const x = gx * V, z = gz * V;
  let h = 1.1 * Math.sin(x * 0.045 + 0.7) + 1.0 * Math.cos(z * 0.05 + 1.3) + 0.7 * Math.sin((x - z) * 0.03) + 0.4;
  h *= Math.min(1, Math.max(0, (BASIS_Z - 6 - Math.abs(z)) / 10));
  if (Math.abs(x) > 42) h += (Math.abs(x) - 42) * 0.12;
  h = Math.max(0, Math.round(h));
  if (inStadt(x, z) || lot(x, z, 3)) h = 0;
  const fd = Math.abs(x - RIVER.x);
  if (fd < RIVER.bank) h = fd < RIVER.half ? RIVER.bett : Math.min(h, Math.round(RIVER.bett * (RIVER.bank - fd) / (RIVER.bank - RIVER.half)));
  H[ix(gx, gz)] = h;
  A[ix(gx, gz)] = fd < RIVER.half ? 3 : fd < RIVER.bank ? 6 : lot(x, z) ? 1 : inStadt(x, z) ? 5 : strasse(x, z) ? 1 : (hash(gx, 7, gz) % 100 < 3 ? 4 : 0);
}
function constructGround(cx, cz) {
  const P = { pos: [], nor: [], col: [], chan: [] };
  const x0 = -N + cx * CH, z0 = -N + cz * CH;
  for (let gx = x0; gx < Math.min(N + 1, x0 + CH); gx++) for (let gz = z0; gz < Math.min(N + 1, z0 + CH); gz++) {
    const h = height(gx, gz), kind = KINDS[A[ix(gx, gz)]];
    const e = CORNER.map(([a, b]) => {
      const su = a ? 1 : -1, sv = b ? 1 : -1;
      const s1 = height(gx + su, gz) > h, s2 = height(gx, gz + sv) > h, ck = height(gx + su, gz + sv) > h;
      return { p: [(gx + a - 0.5) * V, h * V, (gz + b - 0.5) * V], ao: s1 && s2 ? 0 : 3 - (s1 + s2 + ck), k: [a, b] };
    });
    quadFace(P, e, [0, 1, 0], color(kind, gx, h, gz), 1);
    for (const [dx, dz, si] of [[1, 0, 0], [-1, 0, 1], [0, 1, 4], [0, -1, 5]]) {
      const nh = height(gx + dx, gz + dz); if (nh >= h) continue;
      for (let y = Math.max(nh, GROUND); y < h; y++) {
        const a2 = y === h - 1 && kind !== 'soot' ? kind : 'earth';
        const ee = CORNER.map(([a, b]) => ({
          p: dx ? [(gx + dx * 0.5) * V, (y + b) * V, (gz + a - 0.5) * V] : [(gx + a - 0.5) * V, (y + b) * V, (gz + dz * 0.5) * V],
          ao: b === 0 && y === nh ? 2 : 3, k: [a, b],
        }));
        quadFace(P, ee, [dx, 0, dz], color(a2, gx, y, gz), PAGE[si]);
      }
    }
  }
  return geometry(P);
}
const NB = Math.ceil(W2 / CH);
const chunk = [];
for (let cx = 0; cx < NB; cx++) for (let cz = 0; cz < NB; cz++) {
  const m = new THREE.Mesh(constructGround(cx, cz), material);
  m.receiveShadow = true; chunk.push(m); s.add(m);
}
const chunkFrom = (gx, gz) => Math.floor((gx + N) / CH) * NB + Math.floor((gz + N) / CH);
const groundHeight = (wx, wz) => height(Math.round(wx / V), Math.round(wz / V)) * V;
const BORDER = N * V - 4;
// River: water surface above the bed (visuals only)
const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * RIVER.half + 1.6, 2 * N * V + 1), weatherMaterial(new THREE.MeshStandardMaterial({ color: 0x3f7393, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.84 }), 0));
water.rotation.x = -Math.PI / 2; water.position.set(RIVER.x, RIVER.water * V, 0); water.receiveShadow = true; s.add(water);

let craterBudget = 6;
function crater(p, radius, compulsion = false, depth = 2) {
  if (!compulsion && (!craterOn || craterBudget < 1)) return; if (!compulsion) craterBudget--;
  const gr = Math.ceil(radius * 1.6 / V), cx = Math.round(p.x / V), cz = Math.round(p.z / V);
  const ids = new Set();
  for (let gx = cx - gr; gx <= cx + gr; gx++) for (let gz = cz - gr; gz <= cz + gr; gz++) {
    if (!inside(gx, gz)) continue;
    const d = Math.hypot(gx * V - p.x, gz * V - p.z), i = ix(gx, gz);
    if (d < radius) {
      const old = H[i]; H[i] = Math.max(GROUND + 1, old - Math.max(1, Math.round(depth * (1 - (d / radius) ** 2))));
      if (Math.random() < 0.35) debris(gx * V, old * V, gz * V, (gx * V - p.x) * 3, rnd(4, 9), (gz * V - p.z) * 3, V * 0.8, color(KINDS[A[i]], gx, old, gz));
      A[i] = 2;
    } else if (d < radius * 1.6 && Math.random() < 1.4 - d / radius * 0.8) A[i] = 2;
    else continue;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(gx + dx, gz + dz)) ids.add(chunkFrom(gx + dx, gz + dz));
  }
  for (const id of ids) { const m = chunk[id]; m.geometry.dispose(); m.geometry = constructGround(Math.floor(id / NB), id % NB); }
}

// ---------- Static decor: barracks and trees ----------
const treeGeo = [0, 1, 2].map(g => modelGeo(tree(g, g * 5), 0));
const treeSlots = [[], [], []];
for (let i = 0; i < 2600 && treeSlots.flat().length < 220; i++) {
  const x = rnd(-BORDER, BORDER), z = rnd(-BORDER + 2, BORDER - 2);
  const forest = Math.sin(x * 0.07) + Math.cos(z * 0.06 + 2) + (Math.abs(x) > 40 ? 1.4 : -0.6);
  if (forest < 1.2 || strasse(x, z) || inStadt(x, z) || imRiver(x) || lot(x, z, 4) || Math.abs(Math.abs(z) - BASIS_Z) < 14 && Math.abs(x) < 30) continue;
  treeSlots[i % 3].push([x, z, rnd(6.28)]);
}
treeSlots.forEach((list, g) => {
  const im = new THREE.InstancedMesh(treeGeo[g], material, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3(), sk = new THREE.Vector3(1, 1, 1);
  list.forEach(([x, z, rr], i) => im.setMatrixAt(i, m.compose(e.set(x, groundHeight(x, z), z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr), sk)));
  im.castShadow = im.receiveShadow = true; s.add(im);
});

// ---------- Unit graphics: InstancedMesh per type, part and team ----------
const CAP = 320;
const buildingMeshes = [];   // Building slices: full snow cover, separate from the units
const char = {}, unitsMeshes = [];
function instance(geo, cap) {
  const im = new THREE.InstancedMesh(geo, unitMat, cap); unitsMeshes.push(im);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = im.receiveShadow = true; im.count = 0;
  s.add(im); return im;
}
let trianglesUnit = {};
for (const [id, T] of Object.entries(TYPES)) {
  const wanneW = T.infantry ? soldat() : T.wanne();
  T.wanneVox = [...wanneW.keys()].map(k => k.split(',').map(Number));
  T.towerVox = T.tower ? [...T.tower()].map(([k, a]) => [...k.split(',').map(Number), a]) : [];
  char[id] = [0, 1].map(t => ({
    wanne: instance(modelGeo(wanneW, TEAM_COLOR[t]), T.infantry ? CAP * 5 : CAP),
    tower: T.tower ? instance(modelGeo(T.tower(), TEAM_COLOR[t]), CAP) : null,
  }));
  if (!T.infantry) char[id].wreck = instance(modelGeo(wanneW, 0x333333, 0.32), CAP);
  trianglesUnit[id] = char[id][0].wanne.geometry.attributes.position.count / 3 + (char[id][0].tower ? char[id][0].tower.geometry.attributes.position.count / 3 : 0);
}
const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
const rings = [0, 1].map(t => {
  const im = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: TEAM_COLOR[t], transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }), CAP);
  im.frustumCulled = false; im.count = 0; im.renderOrder = 2; im.visible = false; s.add(im); return im;
});

// ---------- Debris (cubes with physics) ----------
const MAXT = 12000;
const tr = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), weatherMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 })), MAXT);
tr.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tr.castShadow = true; tr.frustumCulled = false;
const TP = new Float32Array(MAXT * 3), TV = new Float32Array(MAXT * 3), TR = new Float32Array(MAXT * 3), TW = new Float32Array(MAXT * 3);
const TS = new Float32Array(MAXT), TL = new Float32Array(MAXT), TRest = new Uint8Array(MAXT);
let tNext = 0; const tActive = new Set();
const m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), m6 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(), col4 = new THREE.Color();
const ONE = new THREE.Vector3(1, 1, 1), TOP = new THREE.Vector3(0, 1, 0), FRONT = new THREE.Vector3(0, 0, 1);
for (let i = 0; i < MAXT; i++) { tr.setMatrixAt(i, m4.makeScale(0, 0, 0)); tr.setColorAt(i, col4.set(0xffffff)); }
s.add(tr);
function debris(x, y, z, vx, vy, vz, size, colorHex, health = 5 + Math.random() * 4) {
  const i = tNext; tNext = (tNext + 1) % MAXT;
  TP[i * 3] = x; TP[i * 3 + 1] = y; TP[i * 3 + 2] = z; TV[i * 3] = vx; TV[i * 3 + 1] = vy; TV[i * 3 + 2] = vz;
  TR[i * 3] = rnd(6); TR[i * 3 + 1] = rnd(6); TR[i * 3 + 2] = rnd(6);
  const sp = Math.hypot(vx, vy, vz) * 0.8 + 1;
  TW[i * 3] = rnd(-0.5, 0.5) * sp; TW[i * 3 + 1] = rnd(-0.5, 0.5) * sp; TW[i * 3 + 2] = rnd(-0.5, 0.5) * sp;
  TS[i] = size * rnd(0.75, 1); TL[i] = health; TRest[i] = 0;
  tr.setColorAt(i, col4.setHex(colorHex).multiplyScalar(0.9));
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
          TV[j + 1] = 0; TV[j] *= 0.8; TV[j + 2] *= 0.8;
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

// ---------- Partikel: Feuer, Rauch, Staub, Funken ----------
const MAXF = 8000;
const fx = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: true }), MAXF);
fx.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fx.frustumCulled = false;
const FP = new Float32Array(MAXF * 3), FV = new Float32Array(MAXF * 3), FL = new Float32Array(MAXF), FM = new Float32Array(MAXF), FS = new Float32Array(MAXF), FA = new Uint8Array(MAXF), FR = new Float32Array(MAXF);
let fNext = 0; const fActive = new Set();
for (let i = 0; i < MAXF; i++) { fx.setMatrixAt(i, m4.makeScale(0, 0, 0)); fx.setColorAt(i, col4.set(0)); }
s.add(fx);
// Arten: 0 Feuerball, 1 Rauch, 2 Staub, 4 Funken
function particles(kind, x, y, z, vx, vy, vz, size, health) {
  const i = fNext; fNext = (fNext + 1) % MAXF;
  FP[i * 3] = x; FP[i * 3 + 1] = y; FP[i * 3 + 2] = z; FV[i * 3] = vx; FV[i * 3 + 1] = vy; FV[i * 3 + 2] = vz;
  FL[i] = FM[i] = health; FS[i] = size; FA[i] = kind; FR[i] = Math.random() * 3;
  fActive.add(i);
}
const COL = {
  hot: new THREE.Color(7, 5.5, 3.6), orange: new THREE.Color(4.2, 1.5, 0.3), red: new THREE.Color(1.3, 0.3, 0.08),
  smoke: new THREE.Color(0.2, 0.19, 0.18), smokeBrightness: new THREE.Color(0.55, 0.54, 0.53), dust: new THREE.Color(0.78, 0.7, 0.56),
};
const cTmp = new THREE.Color();
function colorHistory(t, stops) {
  for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { const [t0, c0] = stops[k - 1], [t1, c1] = stops[k]; return cTmp.copy(c0).lerp(c1, (t - t0) / (t1 - t0)); }
  return cTmp.copy(stops[stops.length - 1][1]);
}
const HISTORY = {
  0: [[0, COL.hot], [0.12, COL.hot], [0.35, COL.orange], [0.6, COL.red], [0.75, COL.smoke], [1, COL.smoke]],
  3: [[0, COL.hot], [0.1, COL.orange], [0.3, COL.red], [0.5, new THREE.Color(0.42, 0.33, 0.28)], [1, COL.smokeBrightness]],
  1: [[0, COL.smoke], [1, COL.smokeBrightness]], 2: [[0, COL.dust], [1, COL.dust]], 4: [[0, COL.hot], [0.5, COL.orange], [1, COL.red]],
};
function particlesStep(dt) {
  for (const i of fActive) {
    const j = i * 3, kind = FA[i];
    FL[i] -= dt;
    if (FL[i] <= 0) { fActive.delete(i); fx.setMatrixAt(i, m4.makeScale(0, 0, 0)); continue; }
    const t = 1 - FL[i] / FM[i];
    const move = kind === 4 ? 0.4 : kind === 3 ? 1.1 : 2.6;
    FV[j] *= 1 - move * dt; FV[j + 1] *= 1 - move * dt; FV[j + 2] *= 1 - move * dt;
    if (kind === 4) FV[j + 1] -= 18 * dt; else FV[j + 1] += (kind === 1 ? 1.4 : kind === 0 ? (t > 0.4 ? 2.2 : 0.6) : kind === 3 ? 0.9 : 0.3) * dt;
    if (kind === 3 && FV[j + 1] < 2.5) { const dx = FP[j] - mushroomCenter.x, dz = FP[j + 2] - mushroomCenter.z, l = Math.hypot(dx, dz) + 0.01; FV[j] += dx / l * 3.2 * dt; FV[j + 2] += dz / l * 3.2 * dt; }
    FP[j] += FV[j] * dt; FP[j + 1] += FV[j + 1] * dt; FP[j + 2] += FV[j + 2] * dt;
    const b = groundHeight(FP[j], FP[j + 2]);
    if (FP[j + 1] < b) { FP[j + 1] = b; if (kind === 4) FV[j + 1] *= -0.3; }
    const grow = kind === 0 ? (t < 0.15 ? 0.5 + t * 4 : 1.1 + t * 0.6) : kind === 1 ? 0.6 + t * 1.8 : kind === 2 ? 0.7 + t * 1.4 : kind === 3 ? 0.7 + t * 0.9 : 1;
    const sc = FS[i] * grow * (t > 0.82 ? (1 - t) / 0.18 : 1);
    q4.setFromEuler(e4.set(FR[i], FR[i] * 1.7, FR[i] * 0.6));
    fx.setMatrixAt(i, m4.compose(v4.set(FP[j], FP[j + 1], FP[j + 2]), q4, s4.set(sc, sc, sc)));
    fx.setColorAt(i, colorHistory(t, HISTORY[kind]));
  }
  fx.instanceMatrix.needsUpdate = true; if (fx.instanceColor) fx.instanceColor.needsUpdate = true;
}
const herds = [];
function stove(x, y, z, duration, strength = 1) { herds.push({ x, y, z, rest: duration, strength, tick: 0 }); }
function stoveStep(dt) {
  for (let k = herds.length - 1; k >= 0; k--) {
    const h = herds[k]; h.rest -= dt; h.tick -= dt;
    if (h.rest <= 0) { herds.splice(k, 1); continue; }
    if (h.tick <= 0) {
      h.tick = 0.09 / h.strength;
      const j = () => (Math.random() - 0.5) * 0.8 * h.strength;
      particles(1, h.x + j(), h.y + 0.6, h.z + j(), j() * 0.4, 1.5 + Math.random(), j() * 0.4, 0.35 + Math.random() * 0.3, 2.5 + Math.random() * 2);
      if (Math.random() < 0.5) particles(0, h.x + j(), h.y + 0.4, h.z + j(), 0, 1 + Math.random() * 1.5, 0, 0.25 + Math.random() * 0.2, 0.6 + Math.random() * 0.4);
    }
  }
}

// ---------- Sound (synthetic, with budget) ----------
let ac = null, soundOff = false, soundBudget = 10, noise = null;
function soundOn() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (ac && ac.state === 'suspended') ac.resume();
  if (ac && !noise) { noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
}
function loud(p) { const d = Math.hypot(p.x - ctl.target.x, p.z - ctl.target.z); return Math.max(0, 1 - d / (camSpacing() * 1.3)); }
function sound(kind, p) {
  if (!ac || soundOff || !noise || soundBudget < 1) return;
  const L = loud(p) * ({ mg: 0.08, gewehr: 0.06, granate: 0.28, rakete: 0.16, bang: 0.7, small: 0.3 }[kind]);
  if (L < 0.015) return; soundBudget--;
  const t0 = ac.currentTime, dur = { mg: 0.07, gewehr: 0.09, granate: 0.35, rakete: 0.6, bang: 1.4, small: 0.6 }[kind];
  const src = ac.createBufferSource(); src.buffer = noise;
  const f = ac.createBiquadFilter(); f.type = 'lowpass';
  const f0 = { mg: 3000, gewehr: 4000, granate: 1400, rakete: 2200, bang: 2000, small: 1600 }[kind];
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * 0.06), t0 + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(L, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(ac.destination); src.start(t0, Math.random() * 0.3); src.stop(t0 + dur);
  if (kind === 'bang' || kind === 'granate') {
    const o = ac.createOscillator(), og = ac.createGain();
    o.frequency.setValueAtTime(kind === 'bang' ? 80 : 120, t0); o.frequency.exponentialRampToValueAtTime(30, t0 + dur * 0.7);
    og.gain.setValueAtTime(L * 0.9, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.7);
    o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + dur);
  }
}

function radioNoise(duration = 0.5, loud0 = 0.12) {
  if (!ac || soundOff || !noise) return;
  const t0 = ac.currentTime, src = ac.createBufferSource(); src.buffer = noise;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
  const g = ac.createGain(); g.gain.setValueAtTime(loud0, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(f).connect(g).connect(ac.destination); src.start(t0, Math.random() * 0.4); src.stop(t0 + duration);
}

// ---------- Effekte ----------
let wobble = 0;
function spawnFx(p, radius, strength) {
  if (radius > 0.9) {
    const b = flashes.reduce((a, c) => (c.t > a.t ? c : a)); b.l.position.set(p.x, p.y + 1.5, p.z); b.t = 0; b.i0 = 40 * strength * radius; b.l.distance = radius * 9;
  }
  const n = Math.min(140, Math.round(16 * radius * strength));
  for (let i = 0; i < n; i++) {
    const a = rnd(6.283), h = rnd(-0.1, 1.1), sp = rnd(0.5, 1.5) * radius * 2.2, w = Math.sqrt(Math.max(0, 1 - h * h));
    particles(0, p.x, p.y + 0.3, p.z, Math.cos(a) * sp * w, Math.abs(h) * sp * 1.4 + 1, Math.sin(a) * sp * w, rnd(0.25, 0.7) * Math.sqrt(radius), rnd(0.6, 1.3));
  }
  for (let i = 0; i < Math.round(6 * radius); i++) {
    const a = rnd(6.283), sp = rnd(radius);
    particles(1, p.x + Math.cos(a) * sp * 0.4, p.y + 0.5, p.z + Math.sin(a) * sp * 0.4, Math.cos(a) * sp, rnd(2, 4), Math.sin(a) * sp, 0.5 + rnd(0.5) * radius, rnd(2.5, 5));
  }
  for (let i = 0; i < Math.round(8 * strength); i++) {
    const a = rnd(6.283);
    particles(4, p.x, p.y + 0.3, p.z, Math.cos(a) * rnd(3, 9), rnd(5, 12), Math.sin(a) * rnd(3, 9), 0.08, rnd(0.6, 1.3));
  }
}
function dust(x, y, z, n = 3) { for (let i = 0; i < n; i++) particles(2, x + rnd(-0.3, 0.3), y + 0.1, z + rnd(-0.3, 0.3), rnd(-1, 1), rnd(1, 2.5), rnd(-1, 1), rnd(0.2, 0.4), rnd(0.6, 1.2)); }

// ---------- Buildings: destructible voxel objects (high-rises, houses, barracks) ----------
const SEG = 10;                     // Buildings in slices of 10 layers, only hit slices are rebuilt
const building = [];
const vL = new THREE.Vector3(), vW = new THREE.Vector3(), vD = new THREE.Vector3();
function highriseModel(kind, bx, bz, h, seed) {
  const [W, s] = new_();
  const facade = (x, y, z) => {
    const corner = Math.abs(x) === bx && Math.abs(z) === bz, c = Math.abs(z) === bz ? x : z, situation = y % 5;
    if (y <= 3 && z === bz && Math.abs(x) <= 1) return y <= 3 ? (kind === 'glass' ? 'glass' : 'door') : 'concrete';
    if (kind === 'glass') return corner || situation === 0 ? 'metall' : (c % 3 === 0 ? 'metall' : 'glass');
    if (kind === 'concrete') return corner ? 'concreteDark' : situation === 0 ? 'concrete' : (situation >= 2 && situation <= 3 && Math.abs(c) % 3 !== 0 ? 'pane' : 'concrete');
    return corner || situation === 0 ? 'roofBorder' : (situation >= 2 && situation <= 3 && Math.abs(c) % 2 === 0 ? 'pane' : 'plasterDark');
  };
  for (let y = 0; y < h; y++) for (let x = -bx; x <= bx; x++) for (let z = -bz; z <= bz; z++) {
    const border = Math.abs(x) === bx || Math.abs(z) === bz;
    if (border) s(x, y, z, y === 0 ? 'concreteDark' : facade(x, y, z));
    else if (y % 5 === 0) s(x, y, z, 'concreteDark');          // Floor slabs (visible from inside where there are holes)
  }
  for (let x = -bx; x <= bx; x++) for (let z = -bz; z <= bz; z++) {
    const border = Math.abs(x) === bx || Math.abs(z) === bz;
    s(x, h, z, border ? 'roofBorder' : 'roof'); if (border) s(x, h + 1, z, 'roofBorder');
  }
  // Dachaufbauten
  box(s, -3, 0, h + 1, h + 3, -2, 1, 'metall'); box(s, 2, 4, h + 1, h + 2, 2, 4, 'metall');
  if (h > 50) { for (let y = h + 1; y <= h + 14; y++) s(bx - 2, y, -bz + 2, 'metall'); s(bx - 2, h + 15, -bz + 2, 'red'); }
  if (kind === 'brick') for (let x = -bx + 2; x <= bx - 2; x += 5) box(s, x, x, h + 1, h + 3, -bz + 2, -bz + 2, 'plasterDark');   // Schornsteine
  return W;
}
function buildingAssign(W, x, z, red, team, kind) {
  const grp = new THREE.Group(); grp.position.set(x, groundHeight(x, z), z); grp.rotation.y = red; s.add(grp);
  const g = { W, grp, segs: new Map(), start: W.size, team, kind, dead: false, sinks: null, basis0: 0, height: 0 };
  for (const k of W.keys()) {
    const y = +k.split(',')[1], si = Math.floor(y / SEG);
    if (!g.segs.has(si)) g.segs.set(si, { keys: new Set() });
    g.segs.get(si).keys.add(k);
    if (y < 5) g.basis0++; g.height = Math.max(g.height, y + 1);
  }
  for (const seg of g.segs.values()) {
    seg.mesh = new THREE.Mesh(modelGeo(W, team, 1, seg.keys), vehicleMat);
    seg.mesh.castShadow = seg.mesh.receiveShadow = true; grp.add(seg.mesh); buildingMeshes.push(seg.mesh);
  }
  grp.updateMatrixWorld(true);
  g.box = new THREE.Box3().setFromObject(grp);
  building.push(g); return g;
}
function slicesNew(g, which) {
  for (const si of which) {
    const seg = g.segs.get(si); if (!seg) continue;
    seg.mesh.geometry.dispose();
    if (seg.keys.size === 0) { g.grp.remove(seg.mesh); g.segs.delete(si); continue; }
    seg.mesh.geometry = modelGeo(g.W, g.team, 1, seg.keys);
  }
}
function voxelWay(g, k, y, which) {
  if (g.tw && g.W.has(k)) { const t = g.tw.partFrom.get(k); if (t) g.tw.parts.get(t).n--; }
  g.W.delete(k); const si = Math.floor(y / SEG); g.segs.get(si)?.keys.delete(k);
  which.add(si); if (y % SEG === 0) which.add(si - 1); if (y % SEG === SEG - 1) which.add(si + 1);
}
function voxelWorld(g, x, y, z, out) { return g.grp.localToWorld(out.set(x * V, (y + 0.5) * V, z * V)); }
function loseParts(g) {           // Anything no longer connected to the ground (layer 0)
  const seen = new Set(), stack = [];
  const anchor = g.anchorY ?? 0;
  for (const k of g.W.keys()) if (+k.split(',')[1] <= anchor) { seen.add(k); stack.push(k); }
  while (stack.length) {
    const [x, y, z] = stack.pop().split(',').map(Number);
    for (const d of HEADINGS) { const n = `${x + d[0]},${y + d[1]},${z + d[2]}`; if (g.W.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
  }
  return [...g.W.keys()].filter(k => !seen.has(k));
}
function buildingHit(p, radius0, strength) {
  for (const g of [...building]) {
    if (g.dead || g.sinks || g.box.distanceToPoint(p) > radius0) continue;
    g.grp.updateMatrixWorld(true); g.grp.worldToLocal(vL.copy(p));
    const radius = radius0 * (g.tw?.tough || 1);
    const cx = Math.round(vL.x / V), cy = Math.floor(vL.y / V), cz = Math.round(vL.z / V), r0 = Math.ceil(radius / V);
    const which = new Set(); let n = 0, deb = 0;
    for (let x = cx - r0; x <= cx + r0; x++) for (let y = Math.max(0, cy - r0); y <= cy + r0; y++) for (let z = cz - r0; z <= cz + r0; z++) {
      const k = `${x},${y},${z}`, kind = g.W.get(k); if (kind === undefined) continue;
      const d = Math.hypot(x * V - vL.x, (y + 0.5) * V - vL.y, z * V - vL.z); if (d >= radius) continue;
      voxelWay(g, k, y, which); n++;
      if (deb < 450 && Math.random() < 0.75) {
        deb++; voxelWorld(g, x, y, z, vW);
        const force = strength * 8 * (1 - d / radius) + 2; vD.copy(vW).sub(p); vD.y = Math.max(0.2, vD.y); vD.normalize();
        debris(vW.x, vW.y, vW.z, vD.x * force, vD.y * force + rnd(2, 5), vD.z * force, V, color(kind, x, y, z, g.team));
      }
    }
    if (!n) continue;
    if (g.tw) { slicesNew(g, which); twAfterHit(g, p); if (g.kind !== 'rubble') stove(p.x, Math.max(0.5, p.y), p.z, 8, 0.6); continue; }
    const lose = loseParts(g);
    if (lose.length > 500 && g.kind !== 'rubble') { slicesNew(g, which); collapse(g); continue; }
    for (const k of lose) {
      const [x, y, z] = k.split(',').map(Number), kind = g.W.get(k);
      voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-1, 1), -0.5, rnd(-1, 1), V, color(kind, x, y, z, g.team));
      voxelWay(g, k, y, which);
    }
    slicesNew(g, which);
    let basis = 0; for (const k of g.W.keys()) if (+k.split(',')[1] < 5) basis++;
    if (g.kind !== 'rubble' && (1 - g.W.size / g.start > 0.33 || basis < g.basis0 * 0.6)) collapse(g);
    else if (g.kind !== 'rubble') stove(p.x, Math.max(0.5, p.y), p.z, 10, 0.7);
  }
}
// Collapse: the building sinks into the ground in a dust cloud, leaving a rubble pile
function collapse(g) {
  if (g.tw) return twWhole(g);
  if (g.sinks || g.dead) return;
  if (g.kind === 'rubble') return;
  g.sinks = { v: 0, tip: rnd(-0.05, 0.05), axis: Math.random() < 0.5 ? 'x' : 'z', keys: [...g.W.entries()] };
  const c = g.box.getCenter(vW.clone()); c.y = groundHeight(c.x, c.z);
  sound('bang', c); setTimeout(() => sound('bang', c), 300); wobble += 0.6 * loud(c);
  event(c, 'Einsturz', (g.kind === 'kaserne' ? 'Kaserne' : 'Gebäude') + ' stürzt ein');
  for (let i = 0; i < 3; i++) stove(rnd(g.box.min.x, g.box.max.x), c.y + 0.5, rnd(g.box.min.z, g.box.max.z), 16, 1.2);
}
function buildingStep(dt) {
  for (const g of building) {
    const S = g.sinks; if (!S || g.dead) continue;
    S.v = Math.min(9, S.v + 7 * dt);
    g.grp.position.y -= S.v * dt; g.grp.rotation[S.axis] += S.tip * dt;
    const b = g.box, y0 = groundHeight((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    for (let i = 0; i < 10; i++) {            // Dust at the breaking edge
      const page = Math.random() < 0.5, t = Math.random();
      const x = page ? b.min.x + t * (b.max.x - b.min.x) : (Math.random() < 0.5 ? b.min.x : b.max.x);
      const z = page ? (Math.random() < 0.5 ? b.min.z : b.max.z) : b.min.z + t * (b.max.z - b.min.z);
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) + 0.1;
      particles(2, x, y0 + rnd(0, 2), z, dx / l * rnd(3, 7), rnd(1, 3), dz / l * rnd(3, 7), rnd(0.8, 1.6), rnd(3, 6));
    }
    for (let i = 0; i < 6; i++) {             // Brocken springen heraus
      const [k, kind] = S.keys[Math.floor(rnd(S.keys.length))], [x, y, z] = k.split(',').map(Number);
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const px = rnd(b.min.x, b.max.x), pz = rnd(b.min.z, b.max.z);
      debris(px, y0 + rnd(0.3, 2), pz, (px - cx) * 0.8 + rnd(-2, 2), rnd(3, 8), (pz - cz) * 0.8 + rnd(-2, 2), V * rnd(1, 1.6), color(kind, x, y, z, g.team));
    }
    if (g.grp.position.y < y0 - (g.height + 4) * V) {
      g.dead = true; s.remove(g.grp); for (const seg of g.segs.values()) seg.mesh.geometry.dispose();
      rubble(g);
    }
  }
}
function rubble(g) {
  const [W, sz] = new_(), facade = g.sinks.keys.map(e => e[1]).filter(a => a !== 'glass' && a !== 'pane' && a !== 'metall');
  const colors = [...facade.slice(0, 400), ...Array(Math.max(200, facade.length)).fill(0).map((_, i) => ['concreteDark', 'concrete', 'concreteDark', 'soot'][i % 4])];
  const b = g.box, bx = Math.round((b.max.x - b.min.x) / 2 / V) + 1, bz = Math.round((b.max.z - b.min.z) / 2 / V) + 1;
  const up = Math.min(9, 3 + g.height / 10);
  for (let x = -bx; x <= bx; x++) for (let z = -bz; z <= bz; z++) {
    const r = Math.max(Math.abs(x) / bx, Math.abs(z) / bz), hh = Math.round((1 - r * r) * up * rnd(0.6, 1.2));
    for (let y = 0; y < hh; y++) sz(x, y, z, colors[Math.floor(rnd(colors.length))] || 'concrete');
    if (hh === 0 && Math.random() < 0.3) sz(x, 0, z, colors[Math.floor(rnd(colors.length))] || 'concrete');
  }
  buildingAssign(W, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, 0, g.team, 'rubble');
}

// ---------- Structural frame (collapse lab, 04.11.): skeleton of parts, collapse rules, falling bodies ----------
// Every structure is structural frame + filling. Only load-bearing voxels belong to a part (floor quarter, core, pillar, span, cable …).
// If a part falls below its threshold, the rules of the structure type decide WHAT happens (pancake, tipping over, buckling,
// dollhouse, span tips into the water …). Later exactly this skeleton runs in lockstep; voxel splinters remain visuals.
const twNew = (type, extra = {}) => ({ type, parts: new Map(), partFrom: new Map(), deckX: new Map(), done: new Set(), state: 'frei', ...extra });
function twPart(tw, id, k) { tw.partFrom.set(k, id); if (!tw.parts.has(id)) tw.parts.set(id, { n0: 0, n: 0 }); const t = tw.parts.get(id); t.n0++; t.n++; }
function twCreate(g, tw) {
  g.tw = tw;
  for (const [k, id] of [...tw.partFrom]) if (!g.W.has(k)) tw.partFrom.delete(k);
  for (const t of tw.parts.values()) t.n = t.n0 = 0;
  for (const [k, id] of tw.partFrom) { const t = tw.parts.get(id); t.n0++; t.n++; }
  g.orig = new Map(g.W);
}
const broken = (g, id, threshold = 0.6) => { const t = g.tw.parts.get(id); return !t || t.way || t.n < t.n0 * threshold; };
const keysFrom = (g, f) => [...g.W.keys()].filter(k => { const [x, y, z] = k.split(',').map(Number); return f(x, y, z, k); });

// ---------- High-rise with columns, floors and core ----------
function towerModel(kind, bx, bz, h) {
  const [W, s] = new_(), tw = twNew('tower', { bx, bz, h, floors: Math.ceil(h / 5), filling: new Map(), kind });
  const q = (x, z) => (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0), core = (x, z) => Math.abs(x) <= 2 && Math.abs(z) <= 2;
  const T = (x, y, z, a) => { s(x, y, z, a); twPart(tw, (core(x, z) ? 'k' : 'q' + q(x, z)) + ':' + Math.floor(y / 5), `${x},${y},${z}`); };
  const F = (x, y, z, a) => { s(x, y, z, a); const st = Math.floor(y / 5); if (!tw.filling.has(st)) tw.filling.set(st, []); tw.filling.get(st).push(`${x},${y},${z}`); };
  const facade = (x, y, z) => {
    const corner = Math.abs(x) === bx && Math.abs(z) === bz, c = Math.abs(z) === bz ? x : z, situation = y % 5;
    if (y <= 3 && z === bz && Math.abs(x) <= 1) return kind === 'glass' ? 'glass' : 'door';
    if (kind === 'glass') return corner || situation === 0 ? 'metall' : (c % 3 === 0 ? 'metall' : 'glass');
    if (kind === 'concrete') return corner ? 'concreteDark' : situation === 0 ? 'concrete' : (situation >= 2 && situation <= 3 && Math.abs(c) % 3 !== 0 ? 'pane' : 'concrete');
    return corner || situation === 0 ? 'roofBorder' : (situation >= 2 && situation <= 3 && Math.abs(c) % 2 === 0 ? 'pane' : 'plasterDark');
  };
  for (let y = 0; y < h; y++) for (let x = -bx; x <= bx; x++) for (let z = -bz; z <= bz; z++) {
    const border = Math.abs(x) === bx || Math.abs(z) === bz, corner = Math.abs(x) === bx && Math.abs(z) === bz;
    if (border) { if (corner || y % 5 === 0 || y === 0) T(x, y, z, y === 0 ? 'concreteDark' : corner ? (kind === 'glass' ? 'metall' : 'concreteDark') : facade(x, y, z)); else F(x, y, z, facade(x, y, z)); }
    else if (y % 5 === 0) T(x, y, z, 'concreteDark');                                      // Geschossdecke
    else if (x % 4 === 0 && z % 4 === 0) T(x, y, z, kind === 'glass' ? 'metall' : 'concreteDark');   // Columns
    else if (Math.max(Math.abs(x), Math.abs(z)) === 2) T(x, y, z, 'concrete');               // Kern (Treppenhaus)
  }
  for (let x = -bx; x <= bx; x++) for (let z = -bz; z <= bz; z++) {
    const border = Math.abs(x) === bx || Math.abs(z) === bz;
    F(x, h, z, border ? 'roofBorder' : 'roof'); if (border) F(x, h + 1, z, 'roofBorder');
  }
  box(F, -3, 0, h + 1, h + 3, -2, 1, 'metall'); box(F, 2, 4, h + 1, h + 2, 2, 4, 'metall');
  if (h > 50) { for (let y = h + 1; y <= h + 14; y++) F(bx - 2, y, -bz + 2, 'metall'); F(bx - 2, h + 15, -bz + 2, 'red'); }
  if (kind === 'brick') for (let x = -bx + 2; x <= bx - 2; x += 5) box(F, x, x, h + 1, h + 3, -bz + 2, -bz + 2, 'plasterDark');
  return { W, tw };
}
function towerAssign(p) {
  const { W, tw } = towerModel(p.kind, p.bx, p.bz, p.h);
  const g = buildingAssign(W, p.x, p.z, 0, 0, 'haus');
  twCreate(g, tw); g.name = { glass: 'Glasturm', concrete: 'Plattenbau', brick: 'Altbau' }[p.kind];
  return g;
}

// ---------- Bridges (local: x along, z across, y from riverbed; roadway from y = DECK = bank) ----------
const BZ = BIG ? 7 : 5, DECK = -RIVER.bett, BL = BIG ? 28 : 21, SK = BL / 21;
const rs = v => Math.round(v * SK);
function bridgesModel(type) {
  const [W, s] = new_(), tw = twNew(type), E = BL - 4;
  const T = (x, y, z, a, id) => { s(x, y, z, a); twPart(tw, id, `${x},${y},${z}`); };
  const D = (x, y, z, a, id) => { T(x, y, z, a, id); if (!tw.deckX.has(x)) tw.deckX.set(x, []); tw.deckX.get(x).push(`${x},${y},${z}`); };
  const deck = (x0, x1, id, a = 'asphalt', b = 'concreteDark') => { for (let x = x0; x <= x1; x++) for (let z = -BZ; z <= BZ; z++) { D(x, DECK, z, b, id(x)); D(x, DECK + 1, z, Math.abs(z) === BZ ? 'concrete' : a, id(x)); } };
  const abutment = () => { for (const sg of [-1, 1]) for (let x = E; x <= BL; x++) for (let y = 0; y < DECK; y++) for (let z = -BZ; z <= BZ; z++) T(sg * x, y, z, 'concreteDark', sg < 0 ? 'aW' : 'aO'); };
  const gelaender = (x0, x1, a = 'metall') => { for (let x = x0; x <= x1; x++) for (const z of [-BZ, BZ]) s(x, DECK + 2, z, a); };
  tw.E = E;
  if (type === 'gauge') {
    abutment(); const P = rs(7), hw = BIG ? 2 : 1; tw.P = P; tw.hw = hw;
    for (const [px, id] of [[-P, 'p1'], [P, 'p2']]) for (let x = px - hw; x <= px + hw; x++) for (let y = 0; y < DECK; y++) for (let z = -BZ + 1; z <= BZ - 1; z++) T(x, y, z, 'concrete', id);
    deck(-E, E, x => x < -P ? 'f0' : x <= P ? 'f1' : 'f2'); gelaender(-E, E);
    tw.bearing = { f0: ['aW', 'p1', -E, -P], f1: ['p1', 'p2', -P, P], f2: ['p2', 'aO', P, E] };
  } else if (type === 'arc') {
    abutment(); tw.tough = 0.6;
    const t1 = Math.round(E * 0.56), t2 = Math.round(E * 0.19), piece = x => x < -t1 ? 'b0' : x < -t2 ? 'b1' : x <= t2 ? 's' : x <= t1 ? 'b3' : 'b4';
    for (let x = -E; x <= E; x++) {
      const u = Math.round((DECK - 0.8) * (1 - (x / E) ** 2));
      for (let y = Math.max(0, u); y < DECK; y++) for (let z = -BZ; z <= BZ; z++) T(x, y, z, (x + y) % 3 ? 'concrete' : 'concreteDark', piece(x));
    }
    deck(-E, E, piece, 'plate', 'concrete');
    for (let x = -E; x <= E; x++) for (const z of [-BZ, BZ]) s(x, DECK + 2, z, x % 2 ? 'concrete' : 'concreteDark');
    const h = Math.round(E / 2); tw.pieces = [[-E - 1, -h - 1], [-h, -1], [0, h], [h + 1, E + 1]];
  } else if (type === 'hang') {
    abutment(); const Y = rs(10), top = DECK + rs(17); tw.Y = Y;
    for (const [px, id] of [[-Y, 'pyW'], [Y, 'pyO']]) {
      for (const pz of [-BZ, BZ]) for (let x = px - 1; x <= px + 1; x++) for (let y = 0; y <= top; y++) T(x, y, pz, 'red', id);
      for (let z = -BZ; z <= BZ; z++) for (const y of [DECK - 1, top - 2, top - 1]) T(px, y, z, 'red', id);
    }
    const ropeY = x => Math.abs(x) <= Y ? Math.round(DECK + 3 + (top - DECK - 3) * (x / Y) ** 2) : Math.round(top - (Math.abs(x) - Y) * (top - DECK - 2) / (BL - 1 - Y));
    for (const [pz, id] of [[-BZ - 1, 'ropeS'], [BZ + 1, 'ropeN']]) for (let x = -BL + 1; x <= BL - 1; x++) {
      const y = ropeY(x); T(x, y, pz, 'black', id);
      const yn = ropeY(x + 1); for (let yy = Math.min(y, yn); yy <= Math.max(y, yn); yy++) T(x, yy, pz, 'black', id);
      if (Math.abs(x) < Y && x % 3 === 0) for (let yy = DECK + 1; yy < y; yy++) T(x, yy, pz, 'metall', id);
    }
    deck(-E, E, x => x < -Y ? 'd0' : x < 0 ? 'd1' : x <= Y ? 'd2' : 'd3');
  } else if (type === 'truss') {
    abutment(); const w = rs(4), half = 4 * w, top = DECK + rs(8); tw.w = w; tw.half = half;
    const fi = x => Math.max(0, Math.min(7, Math.floor((x + half) / w))), field = x => 'f' + fi(x);
    deck(-E, E, x => 'd' + fi(x), 'asphalt', 'metall');
    for (const pz of [-BZ, BZ]) for (let x = -half; x <= half; x++) {
      T(x, top, pz, 'metall', field(x));                                                      // Obergurt
      const k = ((x + half) % w + w) % w;
      if (k === 0) for (let y = DECK + 2; y < top; y++) T(x, y, pz, 'metall', field(x));        // Pfosten
      const yd = DECK + 2 + Math.round((fi(x) % 2 ? w - k : k) * (top - DECK - 2) / w);           // Streben
      if (k && yd < top) { T(x, yd, pz, 'metall', field(x)); if (yd + 1 < top) T(x, yd + 1, pz, 'metall', field(x)); }
    }
    for (let x = -half; x <= half; x += w) for (let z = -BZ; z <= BZ; z++) T(x, top, z, 'metall', field(x));
  } else if (type === 'pontoon') {
    abutment(); const n = BIG ? 9 : 7, x0 = -Math.floor(n * 5 / 2); tw.n = n;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * 5, id = 'p' + i;
      for (let x = xa; x <= xa + 3; x++) for (let y = DECK - 3; y <= DECK - 1; y++) for (let z = -BZ - 1; z <= BZ + 1; z++) T(x, y, z, y === DECK - 1 ? 'oliv' : 'black', id);
    }
    for (let x = -E; x <= E; x++) { const id = 'p' + Math.max(0, Math.min(n - 1, Math.round((x - x0 - 1.5) / 5))); for (let z = -BZ; z <= BZ; z++) D(x, DECK, z, 'holz', id); }
  }
  return { W, tw };
}
function bridgeAssign(p) {
  const { W, tw } = bridgesModel(p.type);
  const g = buildingAssign(W, RIVER.x, p.z, 0, 0, 'bridge');
  g.grp.position.y = RIVER.bett * V; g.grp.updateMatrixWorld(true); g.box.setFromObject(g.grp);
  if (p.type === 'pontoon') g.anchorY = DECK - 1;
  const lose = loseParts(g), which = new Set();            // Modell-Reste ohne Halt gleich weglassen
  for (const k of lose) voxelWay(g, k, +k.split(',')[1], which);
  slicesNew(g, which);
  twCreate(g, tw); g.name = p.name; g.isBridge = true;
  return g;
}

// ---------- Falling bodies: detached parts tip, fall, sink or remain as wreckage ----------
const faller = [];
const vF = new THREE.Vector3(), qF = new THREE.Quaternion(), qF2 = new THREE.Quaternion();
function detach(g, keys) {
  const sub = new Map(), which = new Set();
  for (const k of keys) { const a = g.W.get(k); if (a === undefined) continue; sub.set(k, a); voxelWay(g, k, +k.split(',')[1], which); }
  slicesNew(g, which);
  return sub;
}
// opt: kind 'topple' (pivot + axis, local), 'free', 'sink'; bleibt = leave lying as wreckage; max = angle limit (rad)
function fallen(g, keys, opt) {
  const sub = detach(g, keys); if (!sub.size) return null;
  const pivot = opt.pivot || (() => { let x = 0, y = 0, z = 0; for (const k of sub.keys()) { const q = k.split(',').map(Number); x += q[0]; y += q[1]; z += q[2]; } return new THREE.Vector3(x / sub.size, y / sub.size, z / sub.size); })();
  const grp = new THREE.Group(); s.add(grp);
  g.grp.updateMatrixWorld(true);
  grp.position.copy(g.grp.localToWorld(new THREE.Vector3(pivot.x * V, pivot.y * V, pivot.z * V)));
  grp.quaternion.copy(g.grp.quaternion);
  const mesh = new THREE.Mesh(modelGeo(sub, g.team, 1), buildingMaterial(g));
  mesh.position.set(-pivot.x * V, -pivot.y * V, -pivot.z * V); mesh.castShadow = mesh.receiveShadow = true;
  grp.add(mesh); unitsMeshes.push(mesh);
  const all = [...sub.keys()], samples = [];
  const step = Math.max(1, Math.floor(all.length / 60));
  for (let i = 0; i < all.length; i += step) { const [x, y, z] = all[i].split(',').map(Number); samples.push(new THREE.Vector3((x - pivot.x) * V, (y - pivot.y + 0.5) * V, (z - pivot.z) * V)); }
  samples.sort((a, b) => b.lengthSq() - a.lengthSq());
  let length = samples.length ? samples[0].length() : 1;
  const fk = { g, grp, mesh, sub, samples, kind: opt.kind, axis: opt.axis || new THREE.Vector3(0, 0, 1), basis: grp.quaternion.clone(), theta: 0, omega: opt.omega || 0,
    alpha: opt.alpha ?? 1.5 * 9.81 / Math.max(2, length), max: opt.max, stays: !!opt.stays, v: opt.v || new THREE.Vector3(rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5)),
    spin: opt.spin || new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.2, 0.2), rnd(-0.4, 0.4)), age: 0, splash: false, cd: new Map(), rubble: opt.rubble !== false, rotated: new THREE.Euler() };
  faller.push(fk);
  return fk;
}
const buildingMaterial = g => [...g.segs.values()][0]?.mesh.material ?? vehicleMat;
function waterAt(x, z) { return Math.abs(x - RIVER.x) < RIVER.half + 0.8; }
function fkStep(dt) {
  for (let i = faller.length - 1; i >= 0; i--) {
    const f = faller[i]; if (f.rests || f.kind === 'vertical') continue;
    f.age += dt;
    if (f.age > 12 && f.kind !== 'sink') { if (f.stays) f.rests = true; else shatter(f, i); continue; }   // Notbremse
    if (f.kind === 'topple') {
      f.omega += f.alpha * (0.25 + Math.sin(Math.min(1.4, f.theta + 0.05))) * dt; f.theta += f.omega * dt;
      if (f.max && f.theta >= f.max) { f.theta = f.max; f.rests = true; dust(f.grp.position.x, f.grp.position.y, f.grp.position.z, 12); sound('small', f.grp.position); }
      f.grp.quaternion.copy(f.basis).multiply(qF.setFromAxisAngle(f.axis, f.theta));
      // Shorter than the height of the pivot (e.g. buckled tip): release after ~65°, otherwise it rotates forever around the edge
      if (!f.max && !f.stays && f.theta > 1.15) release(f);
    } else if (f.kind === 'sink') {
      f.grp.position.y -= 0.45 * dt; f.grp.rotateX(0.04 * dt); f.grp.rotateZ(0.03 * dt);
      if (f.age < 2.5 && Math.random() < 0.6) particles(2, f.grp.position.x + rnd(-1.5, 1.5), RIVER.water * V + 0.1, f.grp.position.z + rnd(-2, 2), rnd(-0.5, 0.5), rnd(0.5, 1.5), rnd(-0.5, 0.5), rnd(0.2, 0.5), rnd(0.6, 1.2));
      if (f.age > 5) { removeFk(f, i); continue; }
      continue;
    } else {
      f.v.y -= 9.81 * dt; f.grp.position.addScaledVector(f.v, dt);
      f.grp.rotation.x += f.spin.x * dt; f.grp.rotation.y += f.spin.y * dt; f.grp.rotation.z += f.spin.z * dt;
    }
    f.grp.updateMatrixWorld(true);
    // Aufprall, Wasser, Domino
    let deep = null, nWater = 0;
    for (let k = 0; k < f.samples.length; k++) {
      const p = vF.copy(f.samples[k]).applyMatrix4(f.grp.matrixWorld);
      const ground = groundHeight(p.x, p.z);
      if (waterAt(p.x, p.z) && p.y < RIVER.water) nWater++;
      if (p.y < ground + 0.05 && !deep) deep = p.clone();
      if (k < 14) for (const g2 of building) {
        if (g2 === f.g || g2.dead || g2.sinks || g2.kind === 'rubble' || !g2.box.containsPoint(p)) continue;
        if ((f.cd.get(g2) || 0) > f.age) continue;
        f.cd.set(g2, f.age + 0.12); buildingHit(p.clone(), 1.9, 1.3);
      }
      if (k < 20 && f.age > 0.2) withinRadius(p.x, p.z, 2, o => { if (o.alive && Math.abs(o.y - p.y) < 3 && Math.hypot(o.x - p.x, o.z - p.z) < 2) hitTest(o, 400, 'player'); });
    }
    if (nWater && !f.splash) { f.splash = true; splashing(f.grp.position.x, f.grp.position.z, Math.min(3, f.sub.size / 300)); }
    if (!deep) continue;
    if (f.stays) { f.rests = true; dust(deep.x, deep.y, deep.z, 16); sound('granate', deep); continue; }
    shatter(f, i);
  }
}
// Tipping → free fall: put the pivot in the middle, carry over the momentum (ω × r)
function release(f) {
  f.grp.updateMatrixWorld(true);
  const c = new THREE.Vector3(); for (const p of f.samples) c.add(p); c.divideScalar(Math.max(1, f.samples.length));
  const edge = f.grp.position.clone(), center = c.clone().applyMatrix4(f.grp.matrixWorld);
  const axisW = f.axis.clone().applyQuaternion(f.basis);
  f.v.copy(axisW.clone().multiplyScalar(f.omega).cross(center.clone().sub(edge)));
  f.mesh.position.sub(c); for (const p of f.samples) p.sub(c);
  f.grp.position.copy(center); f.spin.copy(axisW.multiplyScalar(f.omega * 0.7)); f.kind = 'free';
}
function splashing(x, z, amount = 1) {
  sound('granate', vF.set(x, 0, z));
  for (let i = 0; i < 40 * amount; i++) { const a = rnd(6.283), sp = rnd(1, 4); particles(2, x + rnd(-2, 2), RIVER.water * V + 0.1, z + rnd(-3, 3), Math.cos(a) * sp, rnd(4, 9), Math.sin(a) * sp, rnd(0.25, 0.6), rnd(0.8, 1.6)); }
}
function removeFk(f, i) { s.remove(f.grp); f.mesh.geometry.dispose(); const j = unitsMeshes.indexOf(f.mesh); if (j >= 0) unitsMeshes.splice(j, 1); faller.splice(i, 1); }
function shatter(f, i) {
  const points = [], all = [...f.sub.entries()], step = Math.max(1, Math.floor(all.length / 450));
  const pos = new THREE.Vector3();
  for (let k = 0; k < all.length; k++) {
    const [key, kind] = all[k], [x, y, z] = key.split(',').map(Number);
    pos.set(x * V, (y + 0.5) * V, z * V).applyMatrix4(f.mesh.matrixWorld);
    if (k % 4 === 0) points.push([pos.x, pos.z, kind]);
    if (k % step === 0) debris(pos.x, pos.y + 0.2, pos.z, rnd(-3, 3), rnd(2, 7), rnd(-3, 3), V * rnd(1, 1.5), color(kind, x, y, z, f.g.team));
    if (k % (step * 6) === 0) particles(2, pos.x, Math.max(pos.y, 0.3), pos.z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), rnd(0.9, 1.8), rnd(3, 6));
  }
  const c = f.grp.position; sound('bang', c); setTimeout(() => sound('bang', c), 250); wobble += 0.8 * loud(c);
  for (const [x, z] of points.filter((_, k) => k % 40 === 0)) withinRadius(x, z, 2.5, o => { if (o.alive && Math.hypot(o.x - x, o.z - z) < 2.5) hitTest(o, 400, 'player'); });
  removeFk(f, i);
  if (f.rubble) rubbleStrip(points, f.g.team);
}
// Rubble where the parts landed (not in the water): becomes an obstacle like a building
function rubbleStrip(points, team) {
  const cells = new Map();
  for (const [x, z, kind] of points) {
    if (waterAt(x, z) || groundHeight(x, z) < -0.3) continue;
    const k = `${Math.round(x / V)},${Math.round(z / V)}`;
    const e = cells.get(k) || { n: 0, kind }; e.n++; if (kind !== 'glass' && kind !== 'pane') e.kind = kind; cells.set(k, e);
  }
  if (cells.size < 4) return;
  const [W, sz] = new_(); let sx = 0, szz = 0;
  for (const k of cells.keys()) { const [a, b] = k.split(',').map(Number); sx += a; szz += b; }
  const cx = Math.round(sx / cells.size), cz = Math.round(szz / cells.size);
  const colors = ['concreteDark', 'concrete', 'concreteDark', 'soot'];
  for (const [k, e] of cells) {
    const [a, b] = k.split(',').map(Number), hh = Math.min(6, 1 + Math.floor(e.n / 3 * rnd(0.6, 1.3)));
    for (let y = 0; y < hh; y++) sz(a - cx, y, b - cz, y === hh - 1 && e.kind !== 'glass' ? e.kind : colors[(a * 7 + b + y) % 4]);
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!cells.has(`${a + da},${b + db}`) && Math.random() < 0.4) sz(a + da - cx, 0, b + db - cz, colors[(a + b) % 4]);
  }
  buildingAssign(W, cx * V, cz * V, 0, team, 'rubble');
}

// ---------- After every hit: loose parts and rules ----------
function twAfterHit(g, p) {
  const lose = loseParts(g);
  if (lose.length > 150) fallen(g, lose, { kind: 'free', stays: !!g.isBridge, rubble: !g.isBridge });
  else if (lose.length) {
    const which = new Set();
    for (const k of lose) { const [x, y, z] = k.split(',').map(Number), kind = g.W.get(k); voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-1, 1), -0.5, rnd(-1, 1), V, color(kind, x, y, z, g.team)); voxelWay(g, k, y, which); }
    slicesNew(g, which);
  }
  twRules(g, p);
}
function twRules(g, p) {
  if (g.kind === 'rubble' || g.dead) return;
  if (g.tw.type === 'tower') towerRules(g, p); else bridgesRules(g);
  if (g.isBridge) bridgesState(g);
}
const DIR = { '0,1': [0, -1], '2,3': [0, 1], '0,2': [-1, 0], '1,3': [1, 0] };
function towerRules(g, p) {
  const t = g.tw; if (t.implode || t.warning) return;
  t.doll = t.doll || new Set();
  for (let k = 0; k < t.floors; k++) {
    const F = [0, 1, 2, 3].filter(i => broken(g, `q${i}:${k}`));
    const newF = F.filter(i => !t.doll.has(i));
    if (!F.length && !broken(g, `k:${k}`, 0.5)) continue;
    if (broken(g, `k:${k}`, 0.5) || F.length >= 3) return towerWarning(g, k, 'pancake', Math.random() < 0.5 ? rnd(4, 9) : 0.6);
    if (F.length === 2) {
      const d = DIR[F.join(',')];
      if (!d) return towerWarning(g, k, 'pancake', rnd(3, 7));
      return towerWarning(g, k, k >= t.floors * 0.6 ? 'snapOff' : 'topple', rnd(1.5, 3), d);
    }
    if (newF.length === 1 && F.length === 1) { dollhouse(g, k, newF[0]); return; }
  }
}
function dollhouse(g, k, q) {
  const t = g.tw; t.doll.add(q);
  const keys = keysFrom(g, (x, y, z) => y >= k * 5 && ((x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)) === q && !(Math.abs(x) <= 2 && Math.abs(z) <= 2));
  for (let s2 = k; s2 < t.floors; s2++) { const tt = t.parts.get(`q${q}:${s2}`); if (tt) tt.way = true; }
  const outer = new THREE.Vector3(q & 1 ? 1 : -1, 0, q & 2 ? 1 : -1).applyQuaternion(g.grp.quaternion).multiplyScalar(2.2);
  const f = fallen(g, keys, { kind: 'free', v: new THREE.Vector3(outer.x, 0.5, outer.z) });
  if (f) { sound('bang', f.grp.position); event(f.grp.position, 'Puppenhaus', `${g.name}: eine Ecke bricht weg`); }
}
// Warning: creaking, dust trickling, slight tilt – then the actual collapse
function towerWarning(g, k, kind, duration, d = null) {
  const t = g.tw;
  t.warning = { k, kind, d, t: 0, duration, creak: 0, tilt: 0 };
  const c = g.box.getCenter(new THREE.Vector3());
  if (duration > 2) event(c, 'Es knarzt …', `${g.name} hält nicht mehr lange`, Math.min(12, duration + 4));
}
function warningStep(dt) {
  for (const g of building) {
    const w = g.tw?.warning; if (!w || g.tw.implode) continue;
    w.t += dt; w.creak -= dt;
    const y0 = w.k * 5 * V, b = g.box;
    if (w.creak <= 0) { w.creak = rnd(0.8, 1.6); groan(b.getCenter(vW)); }
    for (let i = 0; i < 3; i++) particles(2, rnd(b.min.x, b.max.x), y0 + rnd(0, 2), Math.random() < 0.5 ? b.min.z : b.max.z, rnd(-0.3, 0.3), rnd(-1.5, -0.3), rnd(-0.3, 0.3), rnd(0.15, 0.35), rnd(1, 2));
    if (Math.random() < dt * 3) { const keys = g.tw.filling.get(w.k + 1) || []; const k = keys[Math.floor(rnd(keys.length))]; if (k && g.W.has(k)) { const [x, y, z] = k.split(',').map(Number); voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-1, 1), 0, rnd(-1, 1), V, color(g.W.get(k), x, y, z, 0)); } }
    if (w.d) { const target = Math.min(1, w.t / w.duration) * 0.025; g.grp.rotation.z = -w.d[0] * target; g.grp.rotation.x = w.d[1] * target; }
    if (w.t >= w.duration) { g.tw.warning = null; g.grp.rotation.set(0, 0, 0); g.grp.updateMatrixWorld(true); towerCollapse(g, w.k, w.kind, w.d); }
  }
}
function groan(p) {
  if (!ac || soundOff) return; const L = loud(p) * 0.5; if (L < 0.02) return;
  const t0 = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), gn = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(38, 55), t0); o.frequency.linearRampToValueAtTime(rnd(60, 95), t0 + 0.5); o.frequency.linearRampToValueAtTime(rnd(30, 45), t0 + 1.1);
  f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 3;
  gn.gain.setValueAtTime(0.001, t0); gn.gain.exponentialRampToValueAtTime(L, t0 + 0.15); gn.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);
  o.connect(f).connect(gn).connect(ac.destination); o.start(t0); o.stop(t0 + 1.25);
}
function towerCollapse(g, k, kind, d) {
  const t = g.tw; if (t.implode) return; t.implode = true;
  const c = g.box.getCenter(new THREE.Vector3());
  if (kind === 'pancake') return pancake(g, k);
  // Tipping/buckling: everything from floor k tips over the edge toward the destroyed side, slightly slanted
  const greed = rnd(-0.35, 0.35), dx = d[0] * Math.cos(greed) - d[1] * Math.sin(greed), dz = d[0] * Math.sin(greed) + d[1] * Math.cos(greed);
  const pivot = new THREE.Vector3(d[0] * (t.bx + 0.5), k * 5, d[1] * (t.bz + 0.5));
  const axis = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(dx, 0, dz)).normalize();
  const keys = keysFrom(g, (x, y) => y >= k * 5);
  const f = fallen(g, keys, { kind: 'topple', pivot, axis, omega: 0.05 });
  event(c, kind === 'snapOff' ? 'Abgeknickt' : 'Turm kippt', `${g.name} ${kind === 'snapOff' ? 'verliert die Spitze' : 'stürzt um'}`);
  sound('bang', c); wobble += 0.4 * loud(c);
  return f;
}
// Pancake: the upper block sinks floor by floor through the rest
function pancake(g, k) {
  const keys = keysFrom(g, (x, y) => y >= k * 5);
  const f = fallen(g, keys, { kind: 'vertical', pivot: new THREE.Vector3(0, k * 5, 0) });
  if (!f) return;
  f.kind = 'vertical'; f.vertical = { v: 0, bottom: k * 5, start: k * 5 };
  event(f.grp.position, 'Pfannkuchen', `${g.name} sackt Etage für Etage zusammen`);
}
function verticalStep(dt) {
  for (let i = faller.length - 1; i >= 0; i--) {
    const f = faller[i]; if (f.kind !== 'vertical') continue;
    const S = f.vertical; S.v = Math.min(10, S.v + 9.81 * dt * 0.7);
    f.grp.position.y -= S.v * dt; f.grp.rotation.z += rnd(-0.002, 0.002);
    const bottom = S.start - Math.floor((g0(f) - f.grp.position.y) / V);
    if (bottom < S.bottom) {
      // Etagen darunter zerquetschen
      const g = f.g, keys = keysFrom(g, (x, y) => y >= bottom && y < S.bottom);
      if (keys.length) {
        const which = new Set(); let n = 0;
        for (const kk of keys) { const [x, y, z] = kk.split(',').map(Number), kind = g.W.get(kk); if (n++ % 9 === 0) { voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-4, 4), rnd(0, 3), rnd(-4, 4), V, color(kind, x, y, z, g.team)); } voxelWay(g, kk, y, which); }
        slicesNew(g, which); S.v *= 0.86;
        const b = g.box; for (let j = 0; j < 30; j++) { const a = rnd(6.283); particles(2, (b.min.x + b.max.x) / 2 + Math.cos(a) * 4, bottom * V, (b.min.z + b.max.z) / 2 + Math.sin(a) * 4, Math.cos(a) * rnd(3, 8), rnd(0.5, 2), Math.sin(a) * rnd(3, 8), rnd(0.8, 1.6), rnd(3, 6)); }
        if (S.bottom % 5 === 0) { sound('granate', f.grp.position); wobble += 0.15 * loud(f.grp.position); }
      }
      S.bottom = bottom;
    }
    if (bottom <= 0) {
      const g = f.g, rest = [...g.W.keys()]; if (rest.length) detach(g, rest);
      const b = g.box, points = [];
      for (let x = b.min.x - 2; x <= b.max.x + 2; x += V) for (let z = b.min.z - 2; z <= b.max.z + 2; z += V) for (let n = 0; n < 9; n++) points.push([x, z, 'concreteDark']);
      f.rubble = false; shatter(f, i);
      rubbleStrip(points, g.team); g.dead = true; s.remove(g.grp);
    }
  }
}
const g0 = f => f.g.grp.position.y + f.vertical.start * V;

// ---------- Bridge rules ----------
function toppleMin(g, keys, xSupport, freeRight, opt = {}) {
  return fallen(g, keys, { kind: 'topple', pivot: new THREE.Vector3(xSupport, DECK, 0), axis: new THREE.Vector3(0, 0, freeRight ? -1 : 1), stays: true, alpha: 3, ...opt });
}
const deckKeys = (g, f) => keysFrom(g, (x, y, z) => y >= DECK - 1 && f(x, y, z));
function bridgesRules(g) {
  const t = g.tw, E = t.done, c = g.box.getCenter(new THREE.Vector3());
  const report = text => { event(c, g.name, text); sound('bang', c); };
  if (t.type === 'gauge') {
    for (const p of ['p1', 'p2']) if (broken(g, p, 0.5) && !E.has(p)) {
      E.add(p); const px = p === 'p1' ? -t.P : t.P;
      fallen(g, keysFrom(g, (x, y) => Math.abs(x - px) <= t.hw && y < DECK), { kind: 'free', stays: true, rubble: false });
      for (const [fid, [a, b, x0, x1]] of Object.entries(t.bearing)) {
        if (E.has(fid) || (a !== p && b !== p)) continue; E.add(fid);
        const otherThing = a === p ? b : a, xOther = a === p ? x1 : x0, keys = deckKeys(g, x => x >= x0 && x <= x1);
        if (!broken(g, otherThing, 0.5)) toppleMin(g, keys, xOther, xOther < (a === p ? x0 : x1) ? true : false);
        else fallen(g, keys, { kind: 'free', stays: true, rubble: false });
      }
      report('Pfeiler weg, Felder stürzen ins Wasser');
    }
    for (const [fid, [a, b, x0, x1]] of Object.entries(t.bearing)) if (!E.has(fid) && broken(g, fid, 0.55)) {
      E.add(fid); const m = Math.round((x0 + x1) / 2);
      toppleMin(g, deckKeys(g, x => x >= x0 && x < m), x0, true); toppleMin(g, deckKeys(g, x => x >= m && x <= x1), x1, false);
      report('Feld bricht in der Mitte');
    }
  } else if (t.type === 'arc') {
    if (broken(g, 's', 0.55) && !E.has('s')) {
      E.add('s');
      for (const [a, b] of t.pieces) fallen(g, keysFrom(g, x => x >= a && x <= b), { kind: 'free', stays: true, rubble: false, spin: new THREE.Vector3(0, 0, (a < 0 ? 1 : -1) * rnd(0.3, 0.7)) });
      report('Scheitel getroffen, der ganze Bogen bricht');
    }
  } else if (t.type === 'hang') {
    const sN = broken(g, 'ropeN', 0.85), sS = broken(g, 'ropeS', 0.85), py = ['pyW', 'pyO'].filter(p => broken(g, p, 0.6));
    for (const [sid, yes] of [['ropeN', sN], ['ropeS', sS]]) if (yes && !E.has(sid)) {
      E.add(sid);
      fallen(g, keysFrom(g, (x, y, z, k) => t.partFrom.get(k) === sid && x < 0), { kind: 'free', stays: true, rubble: false });
      fallen(g, keysFrom(g, (x, y, z, k) => t.partFrom.get(k) === sid && x >= 0), { kind: 'free', stays: true, rubble: false });
    }
    if ((sN || sS) && !(sN && sS) && !py.length && !E.has('tip')) {
      E.add('tip'); const plus = sN;
      t.tipFk = fallen(g, keysFrom(g, (x, y) => Math.abs(x) < t.Y && y >= DECK && y <= DECK + 1), { kind: 'topple', pivot: new THREE.Vector3(0, DECK, plus ? -BZ - 0.5 : BZ + 0.5), axis: new THREE.Vector3(plus ? 1 : -1, 0, 0), max: 0.22, stays: true, alpha: 2 });
      t.over = 'nur Infanterie'; report('Ein Seil reißt, die Fahrbahn hängt schief');
    }
    if (((sN && sS) || py.length) && !E.has('breach')) {
      E.add('breach'); t.over = 'gesperrt';
      if (t.tipFk && !t.tipFk.g.dead) { const f = t.tipFk; f.rests = false; f.kind = 'free'; f.v.set(0, 0, 0); f.spin.set(rnd(-0.3, 0.3), 0, rnd(-0.2, 0.2)); }
      else { toppleMin(g, keysFrom(g, (x, y) => x > -t.Y && x < 0 && y >= DECK && y <= DECK + 1), -t.Y, true); toppleMin(g, keysFrom(g, (x, y) => x >= 0 && x < t.Y && y >= DECK && y <= DECK + 1), t.Y, false); }
      for (const p of py) { const px = p === 'pyW' ? -t.Y : t.Y; fallen(g, keysFrom(g, (x, y, z, k) => t.partFrom.get(k) === p), { kind: 'topple', pivot: new THREE.Vector3(px, 0, 0), axis: new THREE.Vector3(0, 0, px < 0 ? -1 : 1), rubble: false }); }
      report(py.length ? 'Pylon knickt um' : 'Beide Seile gerissen');
    }
  } else if (t.type === 'truss') {
    t.snapped = t.snapped || new Set();
    for (let i = 0; i < 8; i++) { const id = 'f' + i; if (broken(g, id, 0.6) && !t.snapped.has(i)) {
      t.snapped.add(i);
      fallen(g, keysFrom(g, (x, y, z, k) => y > DECK + 1 && t.partFrom.get(k) === id), { kind: 'free', stays: true, rubble: false });
      report('Träger knickt weg');
    } }
    const deckHole = [0, 1, 2, 3, 4, 5, 6, 7].find(i => broken(g, 'd' + i, 0.5));
    if ((t.snapped.size >= 2 || deckHole !== undefined) && !E.has('breach')) {
      E.add('breach'); const i = deckHole ?? [...t.snapped].sort((a, b) => Math.abs(a - 3.5) - Math.abs(b - 3.5))[0], m = -t.half + t.w * i + Math.round(t.w / 2);
      toppleMin(g, keysFrom(g, x => x > -t.E - 1 && x < m), -t.E - 1, true); toppleMin(g, keysFrom(g, x => x >= m && x < t.E + 1), t.E + 1, false);
      report('Das Fachwerk gibt nach, die Brücke bricht');
    }
  } else if (t.type === 'pontoon') {
    for (let i = 0; i < t.n; i++) { const id = 'p' + i; if (broken(g, id, 0.6) && !E.has(id)) { E.add(id); fallen(g, keysFrom(g, (x, y, z, k) => t.partFrom.get(k) === id), { kind: 'sink' }); report('Ponton sinkt'); } }
  }
}
// Passable? From the remaining roadway per cross-section
function bridgesState(g) {
  const t = g.tw; let min = 1;
  for (const keys of t.deckX.values()) { let da = 0; for (const k of keys) if (g.W.has(k)) da++; min = Math.min(min, da / keys.length); }
  const damaged = g.W.size < g.start * 0.97;
  const z = t.over || (min < 0.3 ? 'gesperrt' : min < 0.7 ? 'nur Infanterie' : damaged ? 'beschädigt' : 'frei');
  if (z !== t.state) { t.state = z; bridgesDisplay(); if (z === 'gesperrt') event(g.box.getCenter(new THREE.Vector3()), g.name, 'ist gesperrt'); }
}
function twWhole(g) {
  if (g.tw.type === 'tower') { if (!g.tw.implode) { g.tw.warning = null; towerCollapse(g, 0, 'pancake'); } return; }
  for (const id of g.tw.parts.keys()) if (!/^a/.test(id)) g.tw.parts.get(id).n = 0;
  bridgesRules(g); g.tw.over = 'gesperrt'; bridgesState(g);
}

// ---------- Werkzeuge: Sprengladung, Brand, Reparieren ----------
const charges = [];
function buildingAt(p) { return building.find(g => !g.dead && !g.sinks && g.tw && g.box.distanceToPoint(p) < 0.6); }
function nextPart(g, p) {
  g.grp.updateMatrixWorld(true); g.grp.worldToLocal(vL.copy(p));
  let best = null, bd = 1e9;
  for (const [k, id] of g.tw.partFrom) { if (!g.W.has(k)) continue; const [x, y, z] = k.split(',').map(Number); const d = (x * V - vL.x) ** 2 + ((y + 0.5) * V - vL.y) ** 2 + (z * V - vL.z) ** 2; if (d < bd) { bd = d; best = id; } }
  return bd < 9 ? best : null;
}
function chargeAssign(p) {
  const g = buildingAt(p); if (!g) return false;
  const part = nextPart(g, p); if (!part) return false;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
  m.position.copy(p); s.add(m);
  charges.push({ g, part, t: 4, m, last: 5 }); beep(1200);
  return true;
}
function chargeStep(dt) {
  for (let i = charges.length - 1; i >= 0; i--) {
    const L = charges[i]; L.t -= dt; L.m.visible = Math.sin(L.t * 18) > 0;
    const z = Math.ceil(L.t); if (z < L.last && z > 0) { L.last = z; beep(z === 1 ? 1500 : 1000); }
    if (L.t > 0) continue;
    s.remove(L.m); charges.splice(i, 1);
    const g = L.g; if (g.dead || !g.tw) continue;
    const keys = [...g.tw.partFrom].filter(([k, id]) => id === L.part && g.W.has(k)).map(([k]) => k), which = new Set();
    keys.forEach((k, n) => { if (n % 7 === 6) return; const [x, y, z] = k.split(',').map(Number), kind = g.W.get(k); if (n % 3 === 0) { voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-6, 6), rnd(2, 9), rnd(-6, 6), V, color(kind, x, y, z, g.team)); } voxelWay(g, k, y, which); });
    slicesNew(g, which);
    spawnFx(L.m.position, 1.2, 1.4); shockwave(L.m.position, 5); sound('bang', L.m.position); wobble += 0.3 * loud(L.m.position);
    twAfterHit(g, L.m.position);
  }
}
function blazeLay(p) {
  const g = buildingAt(p); if (!g || g.tw.type !== 'tower' || g.tw.implode) return false;
  g.grp.updateMatrixWorld(true); g.grp.worldToLocal(vL.copy(p));
  const st = Math.max(0, Math.min(g.tw.floors - 1, Math.floor(vL.y / V / 5)));
  g.blaze = g.blaze || new Map();
  for (const s2 of [st, st + 1]) if (s2 < g.tw.floors && !g.blaze.has(s2)) g.blaze.set(s2, { t: 0, tick: 0, next: false });
  event(p, 'Brand', `${g.name} brennt`); return true;
}
function blazeStep(dt) {
  for (const g of building) {
    if (!g.blaze || g.dead || g.tw.implode) continue;
    for (const [st, b] of g.blaze) {
      if (b.t > 40) continue;
      b.t += dt; b.tick -= dt;
      const keys = g.tw.filling.get(st) || [];
      for (let n = 0; n < 3; n++) {
        const k = keys[Math.floor(rnd(keys.length))]; if (!k) break;
        const [x, y, z] = k.split(',').map(Number); voxelWorld(g, x, y, z, vW);
        if (b.t < 34) particles(0, vW.x, vW.y, vW.z, rnd(-0.3, 0.3), rnd(1, 2.5), rnd(-0.3, 0.3), rnd(0.25, 0.6), rnd(0.4, 0.9));
        if (Math.random() < 0.4) particles(1, vW.x, vW.y + 0.5, vW.z, rnd(-0.3, 0.3), rnd(2, 4), rnd(-0.3, 0.3), rnd(0.6, 1.4), rnd(3, 6));
      }
      if (b.tick <= 0 && b.t < 34) {
        b.tick = 0.18; const which = new Set();
        for (let n = 0; n < 4; n++) { const k = keys[Math.floor(rnd(keys.length))]; const kind = g.W.get(k); if (!k || kind === undefined || kind === 'metall' || kind === 'red') continue; const [x, y, z] = k.split(',').map(Number); voxelWorld(g, x, y, z, vW); debris(vW.x, vW.y, vW.z, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), V, color(kind, x, y, z, g.team)); voxelWay(g, k, y, which); }
        slicesNew(g, which);
      }
      if (b.t > 6 && !b.next) { b.next = true; for (const s2 of [st + 1, Math.random() < 0.25 ? st - 1 : -1]) if (s2 >= 0 && s2 < g.tw.floors && !g.blaze.has(s2)) g.blaze.set(s2, { t: 0, tick: 0, next: false }); }
      // Steel gets soft: glass towers don't withstand fire for long
      if (g.tw.kind === 'glass' && b.t > 16 && !g.tw.warning && !g.tw.implode) towerWarning(g, st, 'pancake', rnd(6, 9));
    }
  }
}
function repair(p) {
  const g = building.find(x => x.isBridge && Math.abs(x.box.getCenter(vW).z - p.z) < BZ * V + 3 && Math.abs(p.x - RIVER.x) < BL * V + 2); if (!g) return false;
  for (let i = faller.length - 1; i >= 0; i--) if (faller[i].g === g) removeFk(faller[i], i);
  const missing = [...g.orig.keys()].filter(k => !g.W.has(k)).sort((a, b) => +a.split(',')[1] - +b.split(',')[1]);
  g.repairing = { missing, i: 0, t: 0 };
  for (const t of g.tw.parts.values()) t.way = false;
  g.tw.done.clear(); g.tw.over = null; g.tw.snapped?.clear(); g.tw.tipFk = null;
  event(p, g.name, 'Pioniere reparieren'); return true;
}
function repairingStep(dt) {
  for (const g of building) {
    const R = g.repairing; if (!R) continue;
    R.t += dt; const until = Math.min(R.missing.length, Math.floor(R.t / 5 * R.missing.length)), which = new Set();
    for (; R.i < until; R.i++) {
      const k = R.missing[R.i], [x, y, z] = k.split(',').map(Number), si = Math.floor(y / SEG);
      g.W.set(k, g.orig.get(k)); const id = g.tw.partFrom.get(k); if (id) g.tw.parts.get(id).n++;
      if (!g.segs.has(si)) { const mesh = new THREE.Mesh(new THREE.BufferGeometry(), buildingMaterial(g)); mesh.castShadow = mesh.receiveShadow = true; g.grp.add(mesh); unitsMeshes.push(mesh); g.segs.set(si, { keys: new Set(), mesh }); }
      g.segs.get(si).keys.add(k); which.add(si);
      if (R.i % 6 === 0) { voxelWorld(g, x, y, z, vW); particles(4, vW.x, vW.y, vW.z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), 0.08, rnd(0.3, 0.7)); }
    }
    slicesNew(g, which);
    if (R.i >= R.missing.length) { g.repairing = null; bridgesState(g); }
  }
}
function structureStep(dt) { fkStep(dt); verticalStep(dt); warningStep(dt); chargeStep(dt); blazeStep(dt); repairingStep(dt); }

for (const p of BUILDING_PLAN) if (p.tower) towerAssign(p); else buildingAssign(highriseModel(p.kind, p.bx, p.bz, p.h), p.x, p.z, 0, 0, 'haus');
for (const p of BRIDGES_PLAN) bridgeAssign(p);
for (let t = 0; t < 2; t++) buildingAssign(kaserne(), 0, t ? BASIS_Z + 4 : -BASIS_Z - 4, t ? Math.PI : 0, TEAM_COLOR[t], 'kaserne');

// ---------- Player weapons (from the playground) ----------
let weapon = 'off';
const PLAYER_WEAPONS = { granate: [1.3, 1.0], rakete: [2.6, 1.8] };
const mushroomCenter = new THREE.Vector3();
const waves = [];
function shockwave(p, radius, colorHex = 0xffd9a0) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, groundHeight(p.x, p.z) + 0.15, p.z); s.add(m);
  waves.push({ m, t: 0, radius });
}
function wavesStep(dt) {
  for (let k = waves.length - 1; k >= 0; k--) {
    const g = waves[k]; g.t += dt; const f = g.t / 0.7;
    if (f >= 1) { s.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); waves.splice(k, 1); continue; }
    g.m.scale.setScalar(Math.max(0.01, g.radius * (1 - Math.pow(1 - f, 3)))); g.m.material.opacity = 0.8 * (1 - f);
  }
}
function playerExplosion(p, radius, strength) {
  spawnFx(p, radius, strength); if (radius > 2) spawnFx(p, radius * 0.7, strength);
  shockwave(p, radius * 3.2);
  sound('bang', p); wobble += 0.12 * strength * radius * Math.max(0.3, loud(p));
  crater(p, radius * 1.1, true, Math.round(radius * 1.6));
  withinRadius(p.x, p.z, radius * 1.8, o => { const d = Math.hypot(o.x - p.x, o.z - p.z); if (o.alive && d < radius * 1.8) hitTest(o, strength * 90 * (1 - d / (radius * 1.8)) + 10, 'player'); });
  buildingHit(p, radius, strength);
}
function beep(up = 880) {
  if (!ac || soundOff) return; const t0 = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = up; g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.3);
}
let countdown = null;
function superweapon(p) {
  if (countdown) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, groundHeight(p.x, p.z) + 0.2, p.z); ring.scale.setScalar(16); s.add(ring);
  countdown = { p: p.clone(), t: 3.2, ring, last: 4 };
  event(p, 'Superwaffe', 'Einschlag in 3 s', 10);
}
function countdownStep(dt) {
  if (!countdown) return;
  const c = countdown, display = document.getElementById('countdown'), flashOverlay = document.getElementById('flash');
  c.t -= dt;
  c.ring.material.opacity = 0.5 + 0.5 * Math.sin(c.t * 14); c.ring.scale.setScalar(16 - (3.2 - c.t) * 2.5);
  const number = Math.ceil(c.t);
  if (number < c.last && number > 0) { c.last = number; display.textContent = number; display.style.opacity = 1; beep(number === 1 ? 1320 : 880); }
  if (c.t > 0) return;
  display.style.opacity = 0; s.remove(c.ring);
  flashOverlay.style.transition = 'none'; flashOverlay.style.opacity = 1;
  requestAnimationFrame(() => { flashOverlay.style.transition = 'opacity 1.8s ease-out'; flashOverlay.style.opacity = 0; });
  const p = c.p; countdown = null;
  playerExplosion(p, 6.5, 3.2);
  sound('bang', p); wobble += 2.5; mushroomCenter.copy(p);
  for (const u of units) if (u.alive && Math.hypot(u.x - p.x, u.z - p.z) < 18) setTimeout(() => hitTest(u, 999, 'player'), rnd(100, 600));
  for (const g of building) if (!g.dead && g.box.distanceToPoint(p) < 16) setTimeout(() => collapse(g), rnd(150, 900));
  let n = 0; const mushroom = setInterval(() => {
    for (let i = 0; i < 26; i++) {
      const a = rnd(6.283), rr = rnd(1.8);
      particles(3, p.x + Math.cos(a) * rr, p.y + 0.5, p.z + Math.sin(a) * rr, Math.cos(a) * 0.6, rnd(13, 19), Math.sin(a) * 0.6, rnd(0.9, 2), rnd(6, 10));
    }
    if (++n > 40) clearInterval(mushroom);
  }, 40);
  shockwave(p, 60, 0xffffff);
  for (let i = 0; i < 220; i++) { const a = rnd(6.283), rr = rnd(4, 10); particles(2, p.x + Math.cos(a) * rr, p.y + 0.4, p.z + Math.sin(a) * rr, Math.cos(a) * 18, rnd(0.8, 1.8), Math.sin(a) * 18, rnd(0.7, 1.3), rnd(1.6, 3)); }
  stove(p.x, p.y, p.z, 30, 2);
}
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function targetPoint(cx, cy, camera = mainCam, rect = null) {
  if (rect) mouse.set((cx - rect.left) / rect.width * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  else mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = [...chunk];
  for (const g of building) if (!g.dead && !g.sinks) for (const seg of g.segs.values()) targets.push(seg.mesh);
  return ray.intersectObjects(targets, false)[0]?.point || null;
}
function fire(cx, cy, camera = mainCam, rect = null, f = null) {
  const p = targetPoint(cx, cy, camera, rect); if (!p) return;
  if (weapon === 'off') { const u = unitAt(p); if (u) { if (f) sequenceIn(f, u); else openFollow(u); } return; }
  if (weapon === 'post') { if (f) { f.kind = 'post'; f.u = null; f.target.copy(p); paneHead(f); } else openPost(p); return; }
  if (weapon === 'charge') { if (!chargeAssign(p)) hintShort('Sprengladung an eine Brücke oder ein Hochhaus setzen'); return; }
  if (weapon === 'blaze') { if (!blazeLay(p)) hintShort('Brand nur an Hochhäusern'); return; }
  if (weapon === 'repair') { if (!repair(p)) hintShort('Reparieren: auf eine Brücke tippen'); return; }
  if (weapon === 'super') superweapon(p); else playerExplosion(p, ...PLAYER_WEAPONS[weapon]);
}
let timeFactor = 1;
function hintShort(t) { const h = document.getElementById('hint'); h.textContent = t; h.classList.add('da'); clearTimeout(h.time); h.time = setTimeout(() => h.classList.remove('da'), 2200); }
function toCity() { ctl.target.set(RIVER.x + 3, 0, -4); camera('near', 0.9); }
function bridgesDisplay() {
  const el = document.getElementById('bridges'); if (!el) return;
  const COLOR = { frei: '#5fd38d', 'beschädigt': '#e8c547', 'nur Infanterie': '#f08a3c', gesperrt: '#ff5a4a' };
  el.innerHTML = '<b>Brücken</b>' + building.filter(g => g.isBridge).map((g, i) => `<button data-br="${i}"><i style="background:${COLOR[g.tw.state] || '#888'}"></i>${g.name}<small>${g.tw.state}</small></button>`).join('');
  el.querySelectorAll('[data-br]').forEach(b => b.onclick = () => { const g = building.filter(x => x.isBridge)[+b.dataset.br]; ctl.target.copy(g.box.getCenter(new THREE.Vector3())); ctl.target.y = 0; camera('near', 0.85); });
}

// ---------- Simulation ----------
let units = [], wrecks = [], projectiles = [], count = 80, pause = false, craterOn = true, simTime = 0, lastLoss = -99;
function spawnSlot(u) {
  const ahead = u.team ? -1 : 1;
  u.x = rnd(-44, 44); u.z = -ahead * (BASIS_Z - 18 + rnd(-6, 6));
  if (u.type === 'dozer') { u.x = rnd(-24, 24); u.z = -ahead * (BASIS_Z - 10); }
  u.y = groundHeight(u.x, u.z); u.red = u.team ? Math.PI : 0; u.tower = 0;
  u.command = null; u.hold = false; u.xp = 0; u.tier = 0; u.mDamage = 1; u.mTank = 1; u.mSpeed = 1;
  u.hp = TYPES[u.type].hp; u.alive = true; u.target = null; u.cd = rnd(2); u.search = rnd(0.3); u.salvo = 0; u.salvoT = 0; u.step = rnd(6);
  newerWaypoint(u);
}
function newerWaypoint(u) {
  const ahead = u.team ? -1 : 1;
  if (u.type === 'dozer') { u.wx = rnd(-30, 30); u.wz = -ahead * (BASIS_Z - rnd(8, 22)); return; }
  u.wx = rnd(-46, 46); u.wz = ahead * rnd(-6, 34);
}
function newUnit(type, team, x, z) {
  const u = { type, team, id: units.length }; spawnSlot(u);
  u.x = x; u.z = z; u.y = groundHeight(x, z); u.produces = true; u.hold = true; u.wx = x; u.wz = z;
  units.push(u); return u;
}
function deploy(n) {
  units = []; wrecks = []; projectiles = [];
  const perTeam = Math.round(n / 2);
  for (let t = 0; t < 2; t++) {
    let sum = 0; const types = Object.keys(TYPES);
    types.forEach((type, k) => {
      const target = k === types.length - 1 ? perTeam - sum : Math.max(1, Math.round(perTeam * TYPES[type].share));
      for (let i = 0; i < target && sum < perTeam; i++, sum++) { const u = { type, team: t, id: units.length }; spawnSlot(u); units.push(u); }
    });
  }
  count = n;
}

// Grid for neighbors and target search
const CELL = 10, grid = new Map();
const zk = (x, z) => (Math.floor(x / CELL) + 100) * 1000 + Math.floor(z / CELL) + 100;
function gridNew() {
  grid.clear();
  for (const u of units) if (u.alive) { const k = zk(u.x, u.z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(u); }
}
function withinRadius(x, z, wheel, f) {
  const r0 = Math.ceil(wheel / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let a = cx - r0; a <= cx + r0; a++) for (let b = cz - r0; b <= cz + r0; b++) { const l = grid.get((a + 100) * 1000 + b + 100); if (l) for (const u of l) f(u); }
}
function nextFoe(u, wheel) {
  let best = null, bd = wheel * wheel;
  withinRadius(u.x, u.z, wheel, o => { if (o.team === u.team || !o.alive) return; const d = (o.x - u.x) ** 2 + (o.z - u.z) ** 2; if (d < bd) { bd = d; best = o; } });
  return best;
}
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const spinTo = (is, should, max) => { const d = angle(should - is); return is + Math.max(-max, Math.min(max, d)); };

// Point in the model (voxel units, in the turret if withTower) -> world
function world(u, lx, ly, lz, withTower, out = new THREE.Vector3()) {
  const T = TYPES[u.type];
  if (withTower && T.spin) {
    const c = Math.cos(u.tower), sn = Math.sin(u.tower);
    const x = lx * c + lz * sn, z = -lx * sn + lz * c;
    lx = x + T.spin[0]; ly = ly + T.spin[1]; lz = z + T.spin[2];
  }
  const c = Math.cos(u.red), sn = Math.sin(u.red);
  return out.set(u.x + (lx * c + lz * sn) * V, u.y + ly * V, u.z + (-lx * sn + lz * c) * V);
}
function manPos(u, i, out = new THREE.Vector3()) {
  const [ox, oz] = SQUAD_FORM[i], c = Math.cos(u.red), sn = Math.sin(u.red);
  const x = u.x + ox * c + oz * sn, z = u.z - ox * sn + oz * c;
  return out.set(x, groundHeight(x, z), z);
}
const men = u => Math.ceil(5 * u.hp / TYPES.squad.hp);
const vM = new THREE.Vector3(), vZ = new THREE.Vector3();

function shoot(u, target) {
  const T = TYPES[u.type];
  if (T.infantry) manPos(u, Math.floor(rnd(men(u))), vM).y += 1.3;
  else world(u, ...T.muzzle, true, vM);
  const targetY = target.y + (TYPES[target.type].infantry ? 0.9 : 1.2);
  const d = Math.hypot(target.x - vM.x, target.z - vM.z);
  if (T.weapon === 'rakete') {
    const ex = target.x + rnd(-2.5, 2.5), ez = target.z + rnd(-2.5, 2.5);
    projectiles.push({ kind: 'rakete', s: vM.clone(), e: new THREE.Vector3(ex, groundHeight(ex, ez) + 0.3, ez), T: 1.2 + d / 55, t: 0, up: d * 0.28, team: u.team, damage: T.damage * (u.mDamage || 1), from: u });
    for (let i = 0; i < 4; i++) particles(1, vM.x, vM.y, vM.z, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), 0.5, rnd(1, 2));
    sound('rakete', vM); return;
  }
  const hits = Math.random() < ({ granate: TYPES[target.type].infantry ? 0.5 : 0.8, mg: 0.6, gewehr: 0.45 }[T.weapon]);
  let ex = target.x, ez = target.z, ey = targetY;
  if (!hits) { ex += rnd(-3, 3); ez += rnd(-3, 3); ey = groundHeight(ex, ez); }
  if (TYPES[target.type].infantry && hits) { const p = manPos(target, Math.floor(rnd(men(target))), vZ); ex = p.x; ez = p.z; ey = p.y + 1; }
  const speed = T.weapon === 'granate' ? 85 : 140;
  projectiles.push({ kind: T.weapon, s: vM.clone(), e: new THREE.Vector3(ex, ey, ez), T: Math.max(0.05, d / speed), t: 0, up: 0, team: u.team, damage: T.damage * (u.mDamage || 1) * (T.infantry ? men(u) / 5 : 1), target: hits ? target : null, from: u });
  if (T.weapon === 'granate') {
    for (let i = 0; i < 5; i++) particles(0, vM.x, vM.y, vM.z, rnd(-1, 1) + Math.sin(u.red + u.tower) * 6, rnd(0, 1), rnd(-1, 1) + Math.cos(u.red + u.tower) * 6, rnd(0.25, 0.45), 0.18);
    particles(1, vM.x, vM.y, vM.z, 0, 1, 0, 0.6, 1.5);
  } else particles(0, vM.x, vM.y, vM.z, 0, 0, 0, 0.18, 0.06);
  sound(T.weapon, vM);
}
function hitTest(target, damage, weapon, from = null) {
  if (!target.alive) return;
  const real = damage * ((MULT[weapon] || {})[target.type] ?? 1) / (target.mTank || 1);
  target.hp -= real;
  const dead = target.hp <= 0;
  if (dead) die(target);
  hooks.hit?.(from, target, real, dead);
}
function die(u) {
  u.alive = false; u.respawn = rnd(6, 10); u.command = null;
  hooks.die?.(u);
  const T = TYPES[u.type];
  if (T.infantry) { for (let i = 0; i < 5; i++) { const p = manPos(u, i, vM); dust(p.x, p.y, p.z, 4); } return; }
  world(u, 0, 3, 0, false, vM);
  spawnFx(vM, 1.8, 1.4); sound('bang', vM);
  wobble += 0.25 * loud(vM);
  for (const [x, y, z, kind] of T.towerVox) {                       // Turm fliegt
    world(u, x, y + 0.5, z, true, vZ);
    debris(vZ.x, vZ.y, vZ.z, rnd(-3, 3), rnd(8, 14), rnd(-3, 3), V, color(kind, x, y, z, TEAM_COLOR[u.team]));
  }
  for (const [x, y, z] of T.wanneVox) if (Math.random() < 0.12) {
    world(u, x, y + 0.5, z, false, vZ);
    const dx = vZ.x - vM.x, dz = vZ.z - vM.z, l = Math.hypot(dx, dz) + 0.1;
    debris(vZ.x, vZ.y, vZ.z, dx / l * rnd(2, 7), rnd(3, 9), dz / l * rnd(2, 7), V, 0x3a3a33);
  }
  wrecks.push({ type: u.type, x: u.x, y: u.y, z: u.z, red: u.red, t: 14 });
  if (u.team === 0 && u.type === 'tank' && simTime - lastLoss > 25) { lastLoss = simTime; event(vM, 'Verlust', 'Kampfpanzer Blau zerstört'); }
  stove(u.x, u.y + 1, u.z, 10, 1.1);
  if (Math.random() < 0.5) crater(vM, 1.2);
}
function impact(g) {
  const p = g.e;
  if (g.kind === 'rakete') {
    spawnFx(p, 1.2, 1.0); sound('small', p);
    withinRadius(p.x, p.z, 4, o => { if (o.team !== g.team && o.alive) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < 4) hitTest(o, g.damage * (1 - d / 5), 'rakete', g.from); } });
    if (Math.random() < 0.6) crater(p, 1.3);
    buildingHit(p, 1.1, 0.8);
    return;
  }
  if (g.kind === 'granate') {
    if (g.target) { hitTest(g.target, g.damage, 'granate', g.from); spawnFx(p, 0.6, 0.7); }
    else { spawnFx(p, 0.8, 0.7); dust(p.x, p.y, p.z, 6); if (Math.random() < 0.5) crater(p, 1.0); buildingHit(p, 0.8, 0.6); }
    return;
  }
  if (g.target) { hitTest(g.target, g.damage, g.kind, g.from); if (!TYPES[g.target.type].infantry) particles(4, p.x, p.y, p.z, rnd(-3, 3), rnd(2, 5), rnd(-3, 3), 0.06, 0.4); }
  else dust(p.x, p.y, p.z, 1);
}

function simStep(dt) {
  simTime += dt;
  gridNew();
  for (const u of units) {
    if (!u.alive) { if (u.produces) continue; u.respawn -= dt; if (u.respawn <= 0) { spawnSlot(u); hooks.new?.(u); } continue; }
    const T = TYPES[u.type];
    u.search -= dt;
    if (T.weapon && u.search <= 0 && !u.command) { u.search = rnd(0.25, 0.45); u.target = nextFoe(u, T.range + (u.hold ? 2 : 16)); }
    if (u.target && !u.target.alive) u.target = null;
    let zx = u.wx, zz = u.wz, drive = true, dist = 0;
    const B = u.command;
    if (B && B.kind === 'attack' && !B.target.alive) u.command = null;
    if (u.command) {                       // Player command takes priority (driving ignores enemies, attacking chases the target)
      if (B.kind === 'attack') { u.target = B.target; dist = Math.hypot(B.target.x - u.x, B.target.z - u.z); if (dist <= T.range) drive = false; else { zx = B.target.x; zz = B.target.z; } }
      else { u.target = null; zx = B.x; zz = B.z; if (Math.hypot(B.x - u.x, B.z - u.z) < 2.2) { u.wx = B.x; u.wz = B.z; u.command = null; u.hold = true; drive = false; } }
    } else if (u.target) {
      dist = Math.hypot(u.target.x - u.x, u.target.z - u.z);
      if (dist <= T.range && dist >= (T.min || 0)) drive = false;
      else if (dist < (T.min || 0)) { zx = u.x - (u.target.x - u.x); zz = u.z - (u.target.z - u.z); }
      else { zx = u.target.x; zz = u.target.z; }
    } else if (Math.hypot(u.wx - u.x, u.wz - u.z) < 4) { if (u.hold) drive = false; else newerWaypoint(u); }
    // Drive while keeping distance
    let vx = 0, vz = 0;
    if (drive) {
      const should = Math.atan2(zx - u.x, zz - u.z);
      u.red = spinTo(u.red, should, T.turn * dt);
      const speed = Math.min(T.speed * (u.mSpeed || 1), u.command?.speed || 99) * Math.max(0, Math.cos(angle(should - u.red))) ** 2;
      vx = Math.sin(u.red) * speed; vz = Math.cos(u.red) * speed;
      u.step += dt * speed;
    } else if (!T.spin && u.target) u.red = spinTo(u.red, Math.atan2(u.target.x - u.x, u.target.z - u.z), T.turn * dt);
    withinRadius(u.x, u.z, 8, o => {
      if (o === u || !o.alive) return;
      const dx = u.x - o.x, dz = u.z - o.z, d = Math.hypot(dx, dz) + 0.01, min = (T.radius + TYPES[o.type].radius) * 0.95;
      if (d < min) { const k = (min - d) / d * 4; vx += dx * k; vz += dz * k; }
    });
    u.x = Math.max(-BORDER, Math.min(BORDER, u.x + vx * dt)); u.z = Math.max(-BORDER, Math.min(BORDER, u.z + vz * dt));
    for (const g of building) {
      if (g.dead) continue;
      const b = g.box, m = T.radius * 0.55;
      if (u.x > b.min.x - m && u.x < b.max.x + m && u.z > b.min.z - m && u.z < b.max.z + m) {
        const l = u.x - b.min.x + m, rr = b.max.x + m - u.x, o = u.z - b.min.z + m, un = b.max.z + m - u.z, k = Math.min(l, rr, o, un);
        if (k === l) u.x = b.min.x - m; else if (k === rr) u.x = b.max.x + m; else if (k === o) u.z = b.min.z - m; else u.z = b.max.z + m;
      }
    }
    u.y += (groundHeight(u.x, u.z) - u.y) * Math.min(1, dt * 8);
    // Turret and fire
    if (T.spin) u.tower = spinTo(u.tower, u.target ? angle(Math.atan2(u.target.x - u.x, u.target.z - u.z) - u.red) : 0, T.towerSpeed * dt);
    if (!T.weapon) continue;
    u.cd -= dt;
    if (u.salvo > 0) { u.salvoT -= dt; if (u.salvoT <= 0 && u.target) { u.salvo--; u.salvoT = 0.2; shoot(u, u.target); } else if (!u.target) u.salvo = 0; }
    if (u.target && !drive && u.cd <= 0) {
      const facing = T.spin ? u.red + u.tower : u.red;
      if (Math.abs(angle(Math.atan2(u.target.x - u.x, u.target.z - u.z) - facing)) < 0.15) {
        u.cd = T.reload * rnd(0.85, 1.15);
        if (T.salvo) { u.salvo = T.salvo; u.salvoT = 0; } else shoot(u, u.target);
      }
    }
  }
  for (let k = projectiles.length - 1; k >= 0; k--) {
    const g = projectiles[k]; g.t += dt;
    if (g.kind === 'rakete' && Math.random() < 0.7) { const p = projectilePos(g, vM); particles(1, p.x, p.y, p.z, 0, 0.3, 0, 0.3, rnd(0.8, 1.4)); }
    if (g.t >= g.T) { impact(g); projectiles.splice(k, 1); }
  }
  for (let k = wrecks.length - 1; k >= 0; k--) { wrecks[k].t -= dt; if (wrecks[k].t <= 0) wrecks.splice(k, 1); }
}
function projectilePos(g, out) {
  const f = Math.min(1, g.t / g.T);
  return out.copy(g.s).lerp(g.e, f).addScaledVector(TOP, 4 * g.up * f * (1 - f));
}

// ---------- Geschoss-Grafik ----------
const MAXG = 3000;
const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), MAXG);
gm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); gm.frustumCulled = false; gm.count = 0;
for (let i = 0; i < MAXG; i++) gm.setColorAt(i, col4.set(0xffffff));
s.add(gm);
const GCOLOR = { granate: new THREE.Color(2.4, 1.1, 0.35), mg: new THREE.Color(2.2, 1.7, 0.5), gewehr: new THREE.Color(1.6, 1.4, 0.7), rakete: new THREE.Color(2.2, 2.1, 1.8) };
const GSIZE = { granate: [0.14, 1.1], mg: [0.06, 0.8], gewehr: [0.05, 0.6], rakete: [0.22, 0.9] };
const vR = new THREE.Vector3(), vR2 = new THREE.Vector3(), vS1 = new THREE.Vector3(), vS2 = new THREE.Vector3();

// ---------- Grafik pro Bild aktualisieren ----------
function draw() {
  for (const id in char) for (const t of [0, 1]) { char[id][t].wanne.count = 0; if (char[id][t].tower) char[id][t].tower.count = 0; }
  rings[0].count = rings[1].count = 0;
  for (const u of units) {
    if (!u.alive) continue;
    const T = TYPES[u.type], Z = char[u.type][u.team];
    if (T.infantry) {
      const n = men(u);
      for (let i = 0; i < n; i++) {
        const p = manPos(u, i, vM); p.y += Math.abs(Math.sin(u.step * 2.4 + i * 1.3)) * 0.12;
        Z.wanne.setMatrixAt(Z.wanne.count++, m4.compose(p, q4.setFromAxisAngle(TOP, u.red), ONE));
      }
    } else {
      m4.compose(v4.set(u.x, u.y, u.z), q4.setFromAxisAngle(TOP, u.red), ONE);
      Z.wanne.setMatrixAt(Z.wanne.count++, m4);
      if (Z.tower) { m5.makeRotationY(u.tower).setPosition(T.spin[0] * V, T.spin[1] * V, T.spin[2] * V); Z.tower.setMatrixAt(Z.tower.count++, m6.multiplyMatrices(m4, m5)); }
    }
    if (rings[0].visible) { const R = rings[u.team]; R.setMatrixAt(R.count++, m4.compose(v4.set(u.x, u.y + 0.06, u.z), q4.identity(), s4.setScalar(T.radius * 0.9))); }
  }
  for (const id in char) {
    for (const t of [0, 1]) { char[id][t].wanne.instanceMatrix.needsUpdate = true; if (char[id][t].tower) char[id][t].tower.instanceMatrix.needsUpdate = true; }
    if (char[id].wreck) char[id].wreck.count = 0;
  }
  for (const w of wrecks) {
    const W = char[w.type].wreck, sink = Math.max(0, 2 - w.t) * 0.9;
    W.setMatrixAt(W.count++, m4.compose(v4.set(w.x, w.y - sink, w.z), q4.setFromAxisAngle(TOP, w.red), ONE));
  }
  for (const id in char) if (char[id].wreck) char[id].wreck.instanceMatrix.needsUpdate = true;
  rings.forEach(R => R.instanceMatrix.needsUpdate = true);
  gm.count = 0;
  for (const g of projectiles) {
    if (gm.count >= MAXG) break;
    const p = projectilePos(g, vR), f = Math.min(1, g.t / g.T);
    vR2.copy(g.e).sub(g.s).addScaledVector(TOP, 4 * g.up * (1 - 2 * f)).normalize();
    const [b, l] = GSIZE[g.kind];
    gm.setMatrixAt(gm.count, m4.compose(p, q4.setFromUnitVectors(FRONT, vR2), s4.set(b, b, l)));
    gm.setColorAt(gm.count++, GCOLOR[g.kind]);
  }
  gm.instanceMatrix.needsUpdate = true; if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
}

// ---------- Kamera, Steuerung, Nachbearbeitung ----------
const mainCam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 2, 900);
const ctl = new OrbitControls(mainCam, r.domElement);
ctl.enableDamping = true; ctl.dampingFactor = 0.1; ctl.screenSpacePanning = false;
ctl.minDistance = 25; ctl.maxDistance = 260; ctl.minPolarAngle = 0.35; ctl.maxPolarAngle = 1.1;
ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
ctl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
const camSpacing = () => mainCam.position.distanceTo(ctl.target);
const TIERS = { detail: 30, near: 60, game: 125, far: 190 };
function camera(tier, polar = 0.72) {
  const az = Math.atan2(mainCam.position.x - ctl.target.x, mainCam.position.z - ctl.target.z) || 0.6;
  const d = TIERS[tier];
  mainCam.position.set(ctl.target.x + Math.sin(az) * Math.sin(polar) * d, ctl.target.y + Math.cos(polar) * d, ctl.target.z + Math.cos(az) * Math.sin(polar) * d);
  ctl.update();
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.mainCam === tier));
}
ctl.target.set(0, 0, -6); mainCam.position.set(40, 70, 60); camera('game');

const comp = new EffectComposer(r);
comp.addPass(new RenderPass(s, mainCam));
const gtao = new GTAOPass(s, mainCam, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.5, thickness: 2, scale: 1.3, samples: 10 });
gtao.blendIntensity = 0.8; comp.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 0.9); comp.addPass(bloom);
const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.5; comp.addPass(tiltH); comp.addPass(tiltV);
comp.addPass(new OutputPass());
comp.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 u;
    void main(){ vec3 c = texture2D(tDiffuse, u).rgb; float g = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(g), c, 1.1); c = c * 0.96 + vec3(0.02, 0.025, 0.035);
      c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), smoothstep(0.4, 0.9, g));
      c *= mix(0.86, 1.0, smoothstep(1.05, 0.35, length(u - 0.5)));
      gl_FragColor = vec4(c, 1.0); }` }));
let pixelRatio = 1.5;
function size() {
  const w = innerWidth, h = innerHeight;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio));
  r.setSize(w, h); comp.setPixelRatio(r.getPixelRatio()); comp.setSize(w, h); mainCam.aspect = w / h; mainCam.updateProjectionMatrix();
  tiltH.uniforms.h.value = 1.6 / w; tiltV.uniforms.v.value = 1.6 / h;
}
size(); addEventListener('resize', size);

let quality = 'up', light = 'hard', ui = true;
// Light: soft (VSM, lots of sky) or hard (PCF, strong low sun, strong contrasts)
const SUN_DIRECTION = { soft: new THREE.Vector3(-40, 70, 30).normalize(), hard: new THREE.Vector3(-48, 50, 36).normalize() };
function shadowAdjust() {
  const hard = light === 'hard';
  r.shadowMap.type = hard ? THREE.PCFSoftShadowMap : (quality === 'up' ? THREE.VSMShadowMap : THREE.PCFShadowMap);
  const ms = quality === 'low' ? 1024 : hard && quality === 'up' ? 4096 : 2048;
  sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); sun.shadow.map = null;
  sun.shadow.radius = hard ? 1 : 6; sun.shadow.bias = hard ? -0.0002 : -0.0005; sun.shadow.normalBias = hard ? 0.02 : 0;
  sun.intensity = hard ? 3.0 : 2.4; skyLight.intensity = hard ? 0.85 : 1.6; fill.intensity = hard ? 0.2 : 0.5;
  lightBasis.sun = sun.intensity; lightBasis.sky = skyLight.intensity; lightBasis.exposure = hard ? 0.92 : 1.0;
  r.toneMappingExposure = hard ? 0.92 : 1.0;
  sun.color.setHex(hard ? 0xffdcae : 0xffe2b8);
  r.shadowMap.needsUpdate = true;
  document.querySelectorAll('[data-light]').forEach(b => b.classList.toggle('on', b.dataset.light === light));
}
function setLight(l) { light = l; shadowAdjust(); }
function setUi(on) {
  ui = on;
  for (const im of unitsMeshes) im.material = on ? unitMat : unitMatPlain;
  for (const m of buildingMeshes) m.material = on ? vehicleMat : material;
  document.querySelectorAll('[data-ofl]').forEach(b => b.classList.toggle('on', (b.dataset.ofl === 'on') === on));
}
function setQuality(q) {
  quality = q;
  gtao.enabled = q === 'up'; tiltH.enabled = tiltV.enabled = q !== 'low'; bloom.enabled = q !== 'low';
  shadowAdjust();
  for (const b of chunk) b.castShadow = q !== 'low';
  r.shadowMap.needsUpdate = true;
  pixelRatio = q === 'up' ? 1.5 : q === 'middle' ? 1.25 : 1; size();
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === q));
}

// Tastatur: WASD/Pfeile schieben, Q/E drehen
const pressedKeys = new Set();
addEventListener('keydown', e => { soundOn(); if (hooks.hudActive && 'wasdqe'.includes(e.key.toLowerCase())) return; if (e.ctrlKey || e.metaKey) return; pressedKeys.add(e.key.toLowerCase()); });
addEventListener('keyup', e => pressedKeys.delete(e.key.toLowerCase()));
function keysCamera(dt) {
  const az = Math.atan2(mainCam.position.x - ctl.target.x, mainCam.position.z - ctl.target.z);
  const fx = -Math.sin(az), fz = -Math.cos(az), sp = camSpacing() * 0.9 * dt;
  let mx = 0, mz = 0, spin = 0;
  if (pressedKeys.has('w') || pressedKeys.has('arrowup')) { mx += fx; mz += fz; }
  if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) { mx -= fx; mz -= fz; }
  if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) { mx += fz; mz -= fx; }
  if (pressedKeys.has('d') || pressedKeys.has('arrowright')) { mx -= fz; mz += fx; }
  if (pressedKeys.has('q')) spin += 1.4 * dt; if (pressedKeys.has('e')) spin -= 1.4 * dt;
  if (mx || mz) { const d = new THREE.Vector3(mx * sp, 0, mz * sp); mainCam.position.add(d); ctl.target.add(d); }
  if (spin) { const o = mainCam.position.clone().sub(ctl.target).applyAxisAngle(TOP, spin); mainCam.position.copy(ctl.target).add(o); }
  const cx = Math.max(-BORDER, Math.min(BORDER, ctl.target.x)), cz = Math.max(-BORDER, Math.min(BORDER, ctl.target.z));
  if (cx !== ctl.target.x || cz !== ctl.target.z) { mainCam.position.x += cx - ctl.target.x; mainCam.position.z += cz - ctl.target.z; ctl.target.x = cx; ctl.target.z = cz; }
  ctl.target.y = 0;
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
const choice = (sel, f) => document.querySelectorAll(sel).forEach(b => b.onclick = () => f(b));
choice('[data-n]', b => { deploy(+b.dataset.n); document.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x === b)); });
choice('[data-q]', b => setQuality(b.dataset.q));
choice('[data-light]', b => setLight(b.dataset.light));
choice('[data-ofl]', b => setUi(b.dataset.ofl === 'on'));
choice('[data-weather]', b => setWeather(b.dataset.weather));
choice('[data-cam]', b => camera(b.dataset.mainCam));
$('rings').onclick = () => { const on = !rings[0].visible; rings.forEach(R => R.visible = on); $('rings').classList.toggle('on', on); };
$('pause').onclick = () => { pause = !pause; $('pause').classList.toggle('on', pause); $('pause').textContent = pause ? 'Weiter' : 'Pause'; };
$('sound').onclick = () => { soundOn(); soundOff = !soundOff; $('sound').classList.toggle('on', !soundOff); };
$('crater').onclick = () => { craterOn = !craterOn; $('crater').classList.toggle('on', craterOn); };
$('legendButton').onclick = () => $('legend').classList.toggle('to');
$('measure').onclick = () => measureStart();
$('to').onclick = () => $('result').classList.remove('da');
let down = null;
r.domElement.addEventListener('pointerdown', e => { soundOn(); down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
r.domElement.addEventListener('pointerup', e => {
  if (!down || !e.isPrimary || hooks.hudActive) { down = null; return; }
  const far = Math.hypot(e.clientX - down.x, e.clientY - down.y), long = performance.now() - down.t, b = down.b;
  down = null;
  if (far > 7 || long > 450 || b !== 0) return;
  fire(e.clientX, e.clientY);
});
choice('[data-weapon]', b => { weapon = b.dataset.weapon; document.querySelectorAll('[data-weapon]').forEach(x => x.classList.toggle('on', x === b)); });
$('new').onclick = () => location.reload();
$('slowmo').onclick = () => { timeFactor = timeFactor < 1 ? 1 : 0.25; $('slowmo').classList.toggle('on', timeFactor < 1); };
$('zurStadt').onclick = () => toCity();
$('scale').textContent = BIG ? 'Maßstab: Groß' : 'Maßstab: Klein';
$('scale').onclick = () => { const u = new URL(location.href); if (BIG) u.searchParams.set('scale', 'small'); else u.searchParams.delete('scale'); location.href = u.toString(); };
bridgesDisplay();
r.domElement.addEventListener('contextmenu', e => e.preventDefault());



// ---------- Weather (taste test 04.11.): kinds as in world.json, transition 3 s ----------
const lightBasis = { sun: 3.0, sky: 0.85, exposure: 0.92 };
const WEATHER = {
  clear:     { name: 'Klar',    cover: 0,    sun: 1,    sky: 1,    color: 0xd8e6ea, fog: 1,    rain: 0,   snow: 0, wind: 0.3 },
  cloudy: { name: 'Bewölkt', cover: 0.5,  sun: 0.95, sky: 1,    color: 0xcfdae0, fog: 0.95, rain: 0,   snow: 0, wind: 0.6 },
  rain:    { name: 'Regen',   cover: 0.82, sun: 0.5,  sky: 0.85, color: 0xa7b2b8, fog: 0.62, rain: 1,   snow: 0, wind: 0.9, wet: 1 },
  fog:    { name: 'Nebel',   cover: 0.3,  sun: 0.55, sky: 1.1,  color: 0xc8cfd2, fog: 0.3,  rain: 0,   snow: 0, wind: 0.15 },
  snow:   { name: 'Schnee',  cover: 0.7,  sun: 0.6,  sky: 1.15, color: 0xdfe5ea, fog: 0.55, rain: 0,   snow: 1, wind: 0.5, ceiling: 1 },
  storm:    { name: 'Sturm',   cover: 0.95, sun: 0.28, sky: 0.7,  color: 0x7e888f, fog: 0.5,  rain: 1.6, snow: 0, wind: 2.4, wet: 1, flashes: true },
  wind:     { name: 'Wind',    cover: 0.4,  sun: 0.95, sky: 1,    color: 0xd2dde2, fog: 0.9,  rain: 0,   snow: 0, wind: 2.2 },
};
const W = { kind: 'clear', cover: 0, sun: 1, sky: 1, color: new THREE.Color(SKY), fog: 1, rain: 0, snow: 0, wind: 0.3, wet: 0, ceiling: 0, flashT: 8, flash: 0 };
const WIND_DIRECTION = new THREE.Vector2(0.8, 0.6);
let cloudsTime = 0;
function setWeather(kind, instant = false) {
  W.kind = kind;
  if (instant) { const Z = WEATHER[kind]; for (const f of ['cover', 'sun', 'sky', 'fog', 'rain', 'snow', 'wind']) W[f] = Z[f]; W.color.setHex(Z.color); W.wet = Z.wet || 0; W.ceiling = Z.ceiling || 0; }
  document.querySelectorAll('[data-weather]').forEach(b => b.classList.toggle('on', b.dataset.weather === kind));
}
// Precipitation: particles in a box around the focus point of the camera currently drawing (also in live windows), tiled fixed to the world
const NRAIN = 7000, NSNOW = 6000;
function precipitation(n, lines) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * (lines ? 6 : 3)), end = new Float32Array(n * (lines ? 2 : 1));
  for (let i = 0; i < n; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    if (lines) { pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; }
    else pos.set([x, y, z], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('endShare', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, size: { value: 80 }, speed: { value: lines ? 26 : 2.6 }, wind: { value: new THREE.Vector2() }, strength: { value: 0 }, pr: { value: 1 } },
    vertexShader: `attribute float endShare; uniform float zeit, groesse, tempo, pr; uniform vec3 mitte; uniform vec2 wind; varying float vA;
      void main(){
        vec3 S = vec3(groesse, groesse * 0.55, groesse);
        vec3 v = vec3(wind.x, -tempo, wind.y);
        vec3 q = position * S + v * zeit;
        ${lines ? '' : 'q.x += sin(zeit * 1.3 + position.y * 40.0) * 0.8; q.z += cos(zeit * 1.1 + position.x * 37.0) * 0.8;'}
        vec3 lo = mitte - vec3(S.x * 0.5, 0.0, S.z * 0.5);
        vec3 w = lo + mod(q - lo, S);
        ${lines ? 'w -= normalize(v) * endShare * 1.0;' : ''}
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = smoothstep(4.0, 10.0, d) * (1.0 - smoothstep(groesse * 0.9, groesse * 1.3, d));
        ${lines ? '' : 'gl_PointSize = clamp(pr * 90.0 / d, 1.0, 7.0);'}
      }`,
    fragmentShader: `uniform float staerke; varying float vA;
      void main(){
        ${lines ? 'gl_FragColor = vec4(0.74, 0.79, 0.86, 0.2 * vA * min(1.0, staerke));'
                 : 'vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(0.97, 0.98, 1.0, 0.9 * vA * staerke);'}
      }` });
  const o = lines ? new THREE.LineSegments(g, m) : new THREE.Points(g, m);
  o.frustumCulled = false; o.renderOrder = 5; o.visible = false;
  o.onBeforeRender = (rr, sc, cam) => {   // Focus point on the ground of the camera currently drawing
    const dir = vR.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const t = dir.y < -0.05 ? -cam.position.y / dir.y : 60;
    m.uniforms.center.value.copy(cam.position).addScaledVector(dir, Math.min(t, 300) * 0.8); m.uniforms.center.value.y = -4;
    m.uniforms.size.value = Math.max(30, Math.min(150, cam.position.y * 1.1));
    m.uniformsNeedUpdate = true;
  };
  s.add(o);
  return o;
}
const rainObj = precipitation(NRAIN, true), snowObj = precipitation(NSNOW, false);
let rainSound = null;
function weatherSound(strength) {
  if (!ac || !noise) return;
  if (!rainSound) {
    const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(ac.destination); src.start();
    rainSound = { g, f };
  }
  rainSound.g.gain.setTargetAtTime(soundOff ? 0 : strength, ac.currentTime, 0.4);
}
function weatherStep(dt) {
  const Z = WEATHER[W.kind], k = 1 - Math.exp(-dt / 1.2);          // ~3 s until the new weather
  for (const f of ['cover', 'sun', 'sky', 'fog', 'rain', 'snow', 'wind']) W[f] += (Z[f] - W[f]) * k;
  W.color.lerp(cTmp.setHex(Z.color), k);
  // Ground slowly gets wet/dry, snow stays and slowly melts
  W.wet += ((Z.wet || 0) > W.wet ? 0.12 : -0.025) * dt; W.wet = Math.max(0, Math.min(Z.wet ? 1 : W.wet, W.wet));
  W.ceiling += ((Z.ceiling || 0) > W.ceiling ? 0.06 : -0.02) * dt; W.ceiling = Math.max(0, Math.min(1, W.ceiling));
  cloudsTime += dt * (0.4 + W.wind);
  WU.wTime.value = cloudsTime; WU.wCover.value = W.cover; WU.wWet.value = W.wet; WU.wSnow.value = W.ceiling;
  WU.wWind.value.copy(WIND_DIRECTION).multiplyScalar(0.012);
  WU.wSun.value.copy(SUN_DIRECTION[light]);
  // Blitze im Sturm
  W.flash = Math.max(0, W.flash - dt * 5);
  if (Z.flashes) { W.flashT -= dt; if (W.flashT <= 0) { W.flashT = rnd(5, 13); W.flash = 1; const p = ctl.target.clone(); setTimeout(() => sound('bang', p), rnd(300, 1400)); } }
  const flick = W.flash > 0 ? W.flash * (0.6 + 0.4 * Math.sin(performance.now() * 0.05)) : 0;
  sun.intensity = lightBasis.sun * W.sun;
  skyLight.intensity = lightBasis.sky * W.sky + flick * 2.5;
  fill.intensity = (light === 'hard' ? 0.2 : 0.5) * W.sky;
  s.background.copy(W.color).lerp(cTmp.setHex(0xf4f6ff), flick * 0.7); s.fog.color.copy(s.background);
  const timeParticle = performance.now() / 1000;
  for (const [o, st] of [[rainObj, W.rain], [snowObj, W.snow]]) {
    o.visible = st > 0.02;
    const u = o.material.uniforms;
    u.strength.value = st; u.time.value = timeParticle; u.pr.value = r.getPixelRatio();
    u.wind.value.copy(WIND_DIRECTION).multiplyScalar(W.wind * (o === rainObj ? 3.5 : 2.2));
    o.geometry.setDrawRange(0, Math.round((o === rainObj ? NRAIN * 2 : NSNOW) * Math.min(1, st)));
  }
  weatherSound(Math.min(0.09, W.rain * 0.055 + Math.max(0, W.wind - 1) * 0.02));
}

// ---------- Live-Fenster (Geschmackstest 04.11.: Transport-Tycoon-Idee) ----------
// Each window is its own camera on the same world, drawn via scissor into its region.
// Visuals only: cameras never belong in the simulation. In the window, everything works as in the main view.
const pane = [], MAX_PANE = 4;
let paneNr = 0;
const SVG = {
  to: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  there: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
};
const ic = n => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[n]}</svg>`;
const markGeo = new THREE.RingGeometry(0.92, 1.08, 48).rotateX(-Math.PI / 2);
const markMat = new THREE.MeshBasicMaterial({ color: 0xffd060, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false });

// Windows render into a small target (half resolution, every 2nd frame) and are scaled up with scanlines.
const PANE_TIER = { up: 0.6, middle: 0.5, low: 0.4 };
const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, time: { value: 0 }, hiss: { value: 0 } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tex; uniform float zeit, rausch; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float zeile = floor(gl_FragCoord.y / 3.0);
      uv.x += rausch * (h(vec2(zeile, floor(zeit * 24.0))) - 0.5) * 0.05;     // Zeilen verrutschen bei Störung
      vec3 c = texture2D(tex, uv).rgb;
      c *= mod(floor(gl_FragCoord.y), 3.0) < 1.0 ? 0.8 : 1.0;                  // Scanlines (jede 3. Zeile dunkler)
      c *= 1.0 + 0.035 * sin(vUv.y * 5.0 - zeit * 1.7);                        // langsam laufender Helligkeitsbalken
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.45;                         // Vignette
      float n = h(floor(gl_FragCoord.xy / 2.0) + fract(zeit * 7.13) * 91.0);
      float g = dot(c, vec3(0.3, 0.59, 0.11));
      c = mix(c, vec3(g) * 0.5, rausch * 0.8);
      c = mix(c, vec3(n * 0.9), rausch * 0.75);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
blitMat.toneMapped = true;
blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));
let paneImage = 0;

function unitAt(p) {
  let best = null, bd = 1e9;
  for (const u of units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - p.x, u.z - p.z), R = TYPES[u.type].radius + 1;
    if (d < R && d < bd) { bd = d; best = u; }
  }
  return best;
}
const mainAz = () => Math.atan2(mainCam.position.x - ctl.target.x, mainCam.position.z - ctl.target.z) || 0.6;

function newPane(kind) {
  if (pane.length >= MAX_PANE) {
    const old = pane.find(f => f.kind === 'event') || pane.find(f => !f.pinned) || pane[0];
    close(old);
  }
  const el = document.createElement('div');
  el.className = 'lf';
  el.innerHTML = `<div class="lf-head glass"><span class="lf-point"></span><span class="lf-title"></span><span class="lf-sub"></span>
      <button data-a="there" title="Hauptkamera hierhin">${ic('there')}</button><button data-a="pin" title="Anheften: bleibt offen, wird zum Wachposten">${ic('pin')}</button><button data-a="to" title="Schließen">${ic('to')}</button></div>
    <div class="lf-image"><div class="lf-jam"><b>VERBINDUNG VERLOREN</b><span></span></div></div><div class="lf-foot glass"><span class="lf-info"></span><span class="lf-bar"><i></i></span></div><div class="lf-corner"></div>`;
  document.body.appendChild(el);
  const f = { nr: ++paneNr, kind, el, image: el.querySelector('.lf-image'), mainCam: new THREE.PerspectiveCamera(32, 1.5, 1, 600),
    target: new THREE.Vector3(), az: mainAz(), polar: 0.95, dist: 34, u: null, rest: 0, pinned: false, mark: null, lost: false, title: '', subtitle: '', rt: null, fresh: true, jam: 0.7, lostT: 0 };
  f.jamEl = el.querySelector('.lf-jam');
  // Find a slot: right column below the stats, then one column further left
  const free = [0, 1, 2, 3, 4, 5].find(i => !pane.some(o => o.slot === i)) ?? 0;
  f.slot = free;
  const B = Math.min(320, innerWidth * 0.42), Hh = Math.round(B * 0.62);
  el.style.width = B + 'px'; f.image.style.height = Hh + 'px';
  const up = Hh + 72, perColumn = Math.max(1, Math.floor((innerHeight - 110 - 70) / up));
  el.style.left = Math.max(8, innerWidth - 12 - (Math.floor(free / perColumn) + 1) * (B + 10)) + 'px';
  el.style.top = (110 + (free % perColumn) * up) + 'px';
  pane.push(f);
  paneOperation(f);
  requestAnimationFrame(() => el.classList.add('da'));
  return f;
}
function close(f) {
  const i = pane.indexOf(f); if (i < 0) return;
  pane.splice(i, 1); f.el.remove(); f.rt?.dispose();
  if (f.mark) { s.remove(f.mark); f.mark = null; }
}
function sequenceIn(f, u) {
  f.kind = 'follow'; f.u = u; f.lost = false; f.jam = 0.6; f.fresh = true; f.el.classList.remove('way'); f.dist = TYPES[u.type].infantry ? 24 : 30;
  f.target.set(u.x, u.y + 1, u.z);
  if (!f.mark) { f.mark = new THREE.Mesh(markGeo, markMat); s.add(f.mark); }
  paneHead(f);
}
function openFollow(u) {
  const da = pane.find(f => f.u === u && f.kind === 'follow');
  if (da) { da.el.classList.remove('blink'); void da.el.offsetWidth; da.el.classList.add('blink'); return da; }
  const f = newPane('follow'); sequenceIn(f, u); return f;
}
function openPost(p) {
  const f = newPane('post'); f.target.copy(p); f.dist = 48; f.polar = 0.85; f.pinned = true; paneHead(f); return f;
}
function event(p, title, subtitle, duration = 8) {
  hooks.event?.(p, title, subtitle);
  if (hooks.noneEventPane) return;
  // Only report if the main camera is looking elsewhere
  if (Math.hypot(p.x - ctl.target.x, p.z - ctl.target.z) < camSpacing() * 0.45) return;
  let f = pane.find(o => o.kind === 'event');
  if (!f) f = newPane('event');
  f.target.copy(p); f.dist = 42; f.polar = 0.8; f.rest = duration; f.title = title; f.subtitle = subtitle;
  paneHead(f);
  f.el.classList.remove('blink'); void f.el.offsetWidth; f.el.classList.add('blink');
  beep(660);
}
function paneHead(f) {
  const k = f.el.querySelector('.lf-title'), un = f.el.querySelector('.lf-sub'), pt = f.el.querySelector('.lf-point');
  f.el.dataset.kind = f.kind;
  if (f.kind === 'follow' && f.u) {
    k.textContent = TYPES[f.u.type].name; un.textContent = f.u.team ? 'Rot' : 'Blau';
    pt.style.background = '#' + TEAM_COLOR[f.u.team].toString(16).padStart(6, '0');
  } else if (f.kind === 'lost') {
    k.textContent = f.title; un.textContent = 'zerstört'; pt.style.background = '#ff6a5a';
  } else if (f.kind === 'post') {
    k.textContent = 'Wachposten ' + f.nr; un.textContent = f.title ? 'bei ' + f.title : 'solid';
    pt.style.background = '#c9c2ad';
  } else { k.textContent = f.title; un.textContent = f.subtitle; pt.style.background = '#ff8a3a'; }
  f.el.querySelector('[data-a=pin]').classList.toggle('on', f.pinned);
  if (f.mark && f.kind !== 'follow') { s.remove(f.mark); f.mark = null; }
}
function paneOperation(f) {
  const el = f.el, head = el.querySelector('.lf-head');
  el.addEventListener('pointerdown', () => { el.parentNode.appendChild(el); }); // bring to front
  el.querySelector('[data-a=to]').onclick = () => close(f);
  el.querySelector('[data-a=there]').onclick = () => {
    const d = vS1.copy(f.target).sub(ctl.target); d.y = 0;
    ctl.target.add(d); mainCam.position.add(d); ctl.update();
  };
  el.querySelector('[data-a=pin]').onclick = () => {
    f.pinned = !f.pinned;
    if (f.kind === 'event' && f.pinned) { f.kind = 'post'; f.title = ''; }
    if (f.kind === 'lost' && f.pinned) { f.kind = 'post'; f.title = 'Wrack'; f.jam = 0.8; f.fresh = true; f.el.classList.remove('way'); radioNoise(0.3, 0.06); }
    paneHead(f);
  };
  // Fenster verschieben
  let move = null;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    move = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop }; head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => { if (!move) return;
    el.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - move.x)) + 'px';
    el.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - move.y)) + 'px'; });
  head.addEventListener('pointerup', () => move = null);
  // Resize
  const corner = el.querySelector('.lf-corner'); let gr = null;
  corner.addEventListener('pointerdown', e => { e.stopPropagation(); gr = { x: e.clientX, y: e.clientY, b: el.offsetWidth, h: f.image.offsetHeight }; corner.setPointerCapture(e.pointerId); });
  corner.addEventListener('pointermove', e => { if (!gr) return;
    el.style.width = Math.max(200, Math.min(innerWidth * 0.8, gr.b + e.clientX - gr.x)) + 'px';
    f.image.style.height = Math.max(110, Math.min(innerHeight * 0.75, gr.h + e.clientY - gr.y)) + 'px'; });
  corner.addEventListener('pointerup', () => gr = null);
  // In the image: as in the main view. Drag = pan (sentry) or rotate (chaser), right = rotate, wheel = zoom, tap = click into the world
  const image = f.image; let p0 = null;
  image.addEventListener('pointerdown', e => { soundOn(); p0 = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), b: e.button, far: 0 }; image.setPointerCapture(e.pointerId); });
  image.addEventListener('pointermove', e => {
    if (!p0) return;
    const dx = e.clientX - p0.lx, dy = e.clientY - p0.ly; p0.lx = e.clientX; p0.ly = e.clientY;
    p0.far = Math.max(p0.far, Math.hypot(e.clientX - p0.x, e.clientY - p0.y));
    if (p0.far < 6) return;
    const rotate = p0.b === 2 || f.kind === 'follow';
    if (rotate) { f.az -= dx * 0.009; f.polar = Math.max(0.3, Math.min(1.25, f.polar - dy * 0.006)); }
    else {
      const k = 0.55 * f.dist / image.clientHeight, ca = Math.cos(f.az), sa = Math.sin(f.az);
      f.target.x += -ca * dx * k - sa * dy * k; f.target.z += sa * dx * k - ca * dy * k;
      f.target.x = Math.max(-BORDER, Math.min(BORDER, f.target.x)); f.target.z = Math.max(-BORDER, Math.min(BORDER, f.target.z));
      if (f.kind === 'event') { f.kind = 'post'; f.pinned = true; paneHead(f); }
    }
  });
  image.addEventListener('pointerup', e => {
    if (!p0) return; const short = p0.far < 6 && performance.now() - p0.t < 450 && p0.b === 0; p0 = null;
    if (short) { paneCamera(f); fire(e.clientX, e.clientY, f.mainCam, image.getBoundingClientRect(), f); }
  });
  image.addEventListener('wheel', e => { e.preventDefault(); f.dist = Math.max(10, Math.min(140, f.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  image.addEventListener('contextmenu', e => e.preventDefault());
}
function paneCamera(f) {
  const t = f.target, sp = Math.sin(f.polar);
  f.mainCam.position.set(t.x + Math.sin(f.az) * sp * f.dist, t.y + Math.cos(f.polar) * f.dist, t.z + Math.cos(f.az) * sp * f.dist);
  f.mainCam.lookAt(t);
}
function paneStep(dt) {
  for (const f of [...pane]) {
    if (f.kind === 'follow') {
      const u = f.u;
      if (!u.alive) {   // Target destroyed: last frame freezes, noise, „Verbindung verloren“
        f.kind = 'lost'; f.lost = true; f.lostT = 0; f.title = TYPES[u.type].name; f.u = null;
        f.el.classList.add('way'); paneHead(f); radioNoise(0.9, 0.14);
      } else {
        f.target.lerp(vS1.set(u.x, u.y + 1, u.z), 1 - Math.exp(-dt * 10));
        f.mark.position.set(u.x, u.y + 0.08, u.z); f.mark.scale.setScalar(TYPES[u.type].radius * 1.05);
        const T = TYPES[u.type], share = Math.max(0, u.hp / T.hp);
        f.el.querySelector('.lf-info').textContent = !T.weapon ? 'baut' : u.target?.alive ? 'im Gefecht' : 'rückt vor';
        const i = f.el.querySelector('.lf-bar i'); i.style.width = (share * 100).toFixed(0) + '%';
        i.style.background = share > 0.6 ? '#8fe08a' : share > 0.3 ? '#ffd36a' : '#ff7a6a';
      }
    }
    if (f.kind === 'event') {
      if (!pause) f.rest -= dt;
      f.el.querySelector('.lf-info').textContent = `schließt in ${Math.max(0, Math.ceil(f.rest))} s · Anheften behält es`;
      f.el.querySelector('.lf-bar i').style.width = Math.max(0, f.rest / 10 * 100) + '%';
      f.el.querySelector('.lf-bar i').style.background = '#ff8a3a';
      if (f.rest <= 0) { close(f); continue; }
    }
    if (f.kind === 'lost') {
      f.lostT += dt;
      const rest = 7 - f.lostT;
      f.jamEl.querySelector('span').textContent = `${f.title} zerstört`;
      f.el.querySelector('.lf-info').textContent = `Funkstille · schließt in ${Math.max(0, Math.ceil(rest))} s · Anheften behält es`;
      f.el.querySelector('.lf-bar i').style.width = '0';
      if (rest <= 0) { close(f); continue; }
    }
    if (f.kind === 'post') {
      f.el.querySelector('.lf-info').textContent = 'Ziehen = schieben · rechts = drehen';
      f.el.querySelector('.lf-bar i').style.width = '0';
    }
    f.jam = f.kind === 'lost' ? Math.min(0.7, 0.35 + f.lostT * 1.4 + Math.random() * 0.08) : Math.max(0, f.jam - dt * 2.2);
    paneCamera(f);
  }
}
function paneDraw() {
  if (!pane.length) return;
  paneImage++;
  const H = innerHeight, fn = s.fog.near, ff = s.fog.far, auto = r.shadowMap.autoUpdate, pr = r.getPixelRatio();
  const tier = PANE_TIER[quality] || 0.5;
  r.shadowMap.autoUpdate = false;   // Reuse the shadow map of the main view
  // 1. World into the small targets (each window only every 2nd frame, staggered; frozen when the connection is lost)
  for (const f of pane) {
    const b = f.image.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) continue;
    const w = Math.max(32, Math.round(b.width * pr * tier)), h = Math.max(24, Math.round(b.height * pr * tier));
    if (!f.rt) f.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    if (f.rt.width !== w || f.rt.height !== h) { f.rt.setSize(w, h); f.fresh = true; }
    if (f.kind === 'lost' && !f.fresh) continue;
    if (!f.fresh && (paneImage + f.nr) % 2) continue;
    f.fresh = false;
    f.mainCam.aspect = b.width / b.height; f.mainCam.updateProjectionMatrix();
    s.fog.near = f.dist * 1.6; s.fog.far = f.dist * 4;
    r.setRenderTarget(f.rt); r.render(s, f.mainCam);
  }
  r.setRenderTarget(null);
  s.fog.near = fn; s.fog.far = ff; r.shadowMap.autoUpdate = auto;
  // 2. Scale up with scanlines, vignette and interference
  r.setScissorTest(true);
  blitMat.uniforms.time.value = performance.now() / 1000;
  for (const f of pane) {
    if (!f.rt) continue;
    const b = f.image.getBoundingClientRect();
    if (b.width < 8 || b.height < 8 || b.bottom < 0 || b.top > H) continue;
    r.setViewport(b.left, H - b.bottom, b.width, b.height); r.setScissor(b.left, H - b.bottom, b.width, b.height);
    blitMat.uniforms.tex.value = f.rt.texture; blitMat.uniforms.hiss.value = f.jam;
    r.render(blitScene, blitCam);
  }
  r.setScissorTest(false); r.setViewport(0, 0, innerWidth, innerHeight);
}

// ---------- Messung ----------
const times = [];             // letzte Bildzeiten (ms)
let measurement = null, last = performance.now(), displayT = 0, simMs = 0;
function measureStart() {
  if (measurement) return;
  camera('game'); ctl.target.set(0, 0, -6); camera('game');
  measurement = { t: 0, duration: 20, images: [], sim: [], q: quality, n: count };
  $('measure').textContent = 'Misst … 20'; $('measure').classList.add('on');
}
function measureEnd() {
  const b = measurement.images.slice().sort((a, b) => a - b);
  const sum = b.reduce((a, c) => a + c, 0);
  const p = q => b[Math.min(b.length - 1, Math.floor(b.length * q))];
  const res = {
    fps: +(1000 * b.length / sum).toFixed(1), deep5: +(1000 / p(0.95)).toFixed(1), deep1: +(1000 / p(0.99)).toFixed(1),
    worst_ms: +b[b.length - 1].toFixed(1), sim_ms: +(measurement.sim.reduce((a, c) => a + c, 0) / measurement.sim.length).toFixed(2),
    units: measurement.n, quality: measurement.q, images: b.length,
    resolution: `${r.domElement.width}×${r.domElement.height}`, device: navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || '',
  };
  window.stressTest.result = res; console.log('Messung', JSON.stringify(res));
  $('resultText').innerHTML = `
    <div class="big">${res.fps} <small>fps im Schnitt</small></div>
    <table>
      <tr><td>Schlechteste 5 %</td><td>${res.deep5} fps</td></tr>
      <tr><td>Schlechteste 1 %</td><td>${res.deep1} fps</td></tr>
      <tr><td>Längstes Bild</td><td>${res.worst_ms} ms</td></tr>
      <tr><td>Simulation je Bild</td><td>${res.sim_ms} ms</td></tr>
      <tr><td>Einheiten · Qualität</td><td>${res.units} · ${{ up: 'Schön', middle: 'Mittel', low: 'Schnell' }[res.quality]}</td></tr>
      <tr><td>Auflösung</td><td>${res.resolution}</td></tr>
      <tr><td>Gerät</td><td>${res.device}</td></tr>
    </table>
    <p>${res.fps >= 55 ? 'Butterweich. Da ist noch Luft.' : res.fps >= 40 ? 'Gut spielbar. RTS braucht keine 60, solange es nicht stockt.' : res.fps >= 28 ? 'Spielbar, aber knapp. Mittel oder Schnell probieren.' : 'Zu zäh. Hier müssen wir optimieren.'}</p>`;
  $('result').classList.add('da');
  $('measure').textContent = 'Messen (20 s)'; $('measure').classList.remove('on');
  measurement = null;
}
function display() {
  const z = times.slice(-60), cut = z.reduce((a, c) => a + c, 0) / z.length;
  const max = Math.max(...times.slice(-120));
  const living = units.filter(u => u.alive).length;
  const fps = 1000 / cut;
  $('fps').textContent = fps.toFixed(0);
  $('fps').className = fps >= 50 ? 'good' : fps >= 30 ? 'middle' : 'bad';
  $('details').innerHTML = `Tiefpunkt ${(1000 / max).toFixed(0)} fps · Sim ${simMs.toFixed(1)} ms<br>${living} Einheiten · ${wrecks.length} Wracks · ${tActive.size} Trümmer<br>${pane.length} Live-Fenster · ${r.info.render.calls} Draw Calls · ${(r.info.render.triangles / 1000).toFixed(0)}k Dreiecke`;
}

// ---------- Hauptschleife ----------
function step() {
  const now = performance.now(), raw = now - last; last = now;
  times.push(raw); if (times.length > 240) times.shift();
  const dt = Math.min(0.05, raw / 1000);
  r.info.reset();
  soundBudget = Math.min(10, soundBudget + dt * 16); craterBudget = Math.min(6, craterBudget + dt * 5);
  keysCamera(dt); ctl.update();
  const t0 = performance.now();
  const dtS = dt * timeFactor;
  if (!pause) { simStep(dtS); debrisStep(dtS); stoveStep(dtS); buildingStep(dtS); wavesStep(dtS); countdownStep(dtS); structureStep(dtS); }
  particlesStep(pause ? 0 : dtS);
  draw();
  const simDuration = performance.now() - t0;
  simMs = simMs * 0.9 + simDuration * 0.1;
  for (const b of flashes) { b.t += dt; b.l.intensity = b.i0 * Math.exp(-b.t * 7); }
  // Sun and shadows follow the view
  const d = camSpacing(), ext = Math.round(Math.min(110, Math.max(25, d * 0.6)) / 5) * 5;
  {
    // Snap shadow camera to texels so hard shadows don't flicker when panning
    const L = SUN_DIRECTION[light], ax = vS1.crossVectors(TOP, L).normalize(), ay = vS2.crossVectors(L, ax);
    const texel = 2 * ext / sun.shadow.mapSize.x, t = ctl.target;
    const u = Math.round(t.dot(ax) / texel) * texel, v = Math.round(t.dot(ay) / texel) * texel, w = t.dot(L);
    sun.target.position.set(0, 0, 0).addScaledVector(ax, u).addScaledVector(ay, v).addScaledVector(L, w);
    sun.position.copy(sun.target.position).addScaledVector(L, 100);
  }
  const sc = sun.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
  s.fog.near = d * 1.5 * W.fog; s.fog.far = d * 3.6 * W.fog;
  weatherStep(pause ? 0 : dt);
  // Wackeln
  wobble = Math.min(1.5, wobble) * Math.exp(-dt * 6);
  const w = new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)).multiplyScalar(wobble);
  mainCam.position.add(w);
  comp.render(dt);
  mainCam.position.sub(w);
  paneStep(dt); paneDraw();
  if (measurement) {
    measurement.t += raw / 1000; measurement.images.push(raw); measurement.sim.push(simDuration);
    $('measure').textContent = `Misst … ${Math.max(0, Math.ceil(measurement.duration - measurement.t))}`;
    if (measurement.t >= measurement.duration) measureEnd();
  }
  displayT -= raw; if (displayT <= 0) { displayT = 400; display(); }
  hooks.afterImage?.(dt);
}

deploy(80);
setQuality('up');
r.setAnimationLoop(step);
window.stressTest = { fastForward(sec) { for (let t = 0; t < sec; t += 0.05) { simStep(0.05); debrisStep(0.05); stoveStep(0.05); buildingStep(0.05); structureStep(0.05); wavesStep(0.05); countdownStep(0.05); particlesStep(0.05); } }, boom: (x, z, w = 'granate') => { const p = new THREE.Vector3(x, groundHeight(x, z), z); if (w === 'super') superweapon(p); else playerExplosion(p, ...PLAYER_WEAPONS[w]); }, building, deploy, setQuality, setLight, setUi, camera, measureStart, units: () => units, ctl, mainCam, pane, die, hooks, THREE, s, r, buildingAssign, kaserne, groundHeight, targetPoint, unitAt, newUnit, TYPES, TEAM_COLOR, superweapon, playerExplosion, close, BORDER, ground: (gx, gz) => inside(gx, gz) ? [H[ix(gx, gz)], A[ix(gx, gz)]] : null, N, V, KINDS, isPause: () => pause, simTime: () => simTime, W, setWeather, WEATHER, WU, openFollow, openPost, event: (x, z, t = 'Test', u = 'Ereignis') => event(new THREE.Vector3(x, groundHeight(x, z), z), t, u), closeAll: () => [...pane].forEach(close), trianglesUnit, result: null, rings, faller, loseParts, SCALE, chargeAssign, blazeLay, repair, toCity, bridges: () => building.filter(g => g.isBridge && !g.dead).map(g => [g.name, g.tw.state]), towers: () => building.filter(g => g.tw?.type === 'tower').map(g => [g.name, g.dead ? 'way' : g.tw.implode ? 'eingestürzt' : g.tw.warning ? 'creaks' : g.tw.doll?.size ? 'Puppenhaus' : 'stands', g.W.size]), blast(gi, part) { const g = building[gi]; const k = [...g.tw.partFrom].find(([k, id]) => id === part && g.W.has(k))[0]; const [x, y, z] = k.split(',').map(Number); chargeAssign(voxelWorld(g, x, y, z, new THREE.Vector3())); }, point: (gi, x, y, z) => voxelWorld(building[gi], x, y, z, new THREE.Vector3()), slowmo: on => { timeFactor = on ? 0.25 : 1; } };
$('load').remove();
