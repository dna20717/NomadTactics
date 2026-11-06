// NomadTactics – Party: the battle as a voxel diorama (three.js). Same simulation as the 2D view.
// Draws only: reads units/projectiles/events from the simulation, never writes. Input is battle_input.js,
// which talks to this view through project/unproject/pan/zoom/rotate/centreOn.
//
// Models come from the workshop data: unit.model → data/models.json › source
//   "prototype:<name>" = built-in model from game/tactics/voxel/models.js (with turret if it has one)
//   path to a .vox file = Daniel's own model from Voxel Max (pink = team colour)

import * as THREE from 'three';
import { V, PROTOTYPES, landingPad, tree } from '../tactics/voxel/models.js';
import { voxelGeometry, voxelMaterial, vehicleMaterial } from '../tactics/voxel/mesh.js';
import { readVox } from '../tactics/voxel/vox.js';
import { ROUND_MS } from '../../engine/net/protocol.js';

const M = 1 / 1000;          // world units (mm) → metres
const LEVEL = 2.0;           // one map level = 2 m (5 voxels)
const SKY = 0xd6e4e8;
const TAU = Math.PI * 2;
const yawOf = (h) => Math.PI / 2 - (h / 256) * TAU; // sim angle (0 = +x) → rotation about y (model front = +z)

export function battleView3d({ host, overlay, app, meSeat, playerList, toast, modelsBase }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const g2 = overlay.getContext('2d');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 260, 620);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5a, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xbfd6ff, 0.45); fill.position.set(-60, 40, 80); scene.add(fill);
  const flashes = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffa040, 0, 40, 1.6); scene.add(l); return { l, t0: -1e9 }; });

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 1500);
  const cam = { tx: 128, tz: 128, yaw: 0.6, pitch: 0.92, dist: 150 };

  // ---------- atmosphere: time of day, weather, climate (optics only, the simulation never sees this) ----------
  // Standard = noon, clear, temperate: exactly the look the battle had before.
  const atm = { hour: 12, weather: 'clear', climate: 'gemaessigt', on: false };
  // boom: how much it crashes (launcher 1.8, battle 1 = unchanged): bigger flashes, more smoke and chips,
  // earth thrown up, burning wrecks, the camera shakes with nearby blasts
  let boom = 1, shake = 0;
  const excite = (b) => { boom = Math.max(1, b); };
  function jolt(x, z, amount) {
    if (boom <= 1) return;
    const d = Math.hypot(x - cam.tx, z - cam.tz);
    shake = Math.min(1.4, shake + amount * Math.max(0, 1 - d / 90) * (boom - 0.6));
  }
  const SKY_STOPS = [[0, 0x070d1a], [4.6, 0x0d1730], [5.6, 0x5a5a7a], [6.4, 0xeaa27a], [7.6, 0xd6e4e8], [16.6, 0xd6e4e8], [17.8, 0xf3a06a], [18.6, 0x7a5a78], [19.6, 0x0f1830], [24, 0x070d1a]];
  // per weather: share of direct light, how much the sky turns grey (and to which colour), fog distance, particles
  const WEATHER = {
    clear: { sun: 1, grey: 0, greyTo: 0xb8c2c8, fogNear: 260, fogFar: 620 },
    cloudy: { sun: 0.42, grey: 0.5, greyTo: 0xa3acb3, fogNear: 220, fogFar: 560 },
    rain: { sun: 0.26, grey: 0.68, greyTo: 0x7b858d, fogNear: 120, fogFar: 420, fall: 'rain', amount: 1 },
    fog: { sun: 0.4, grey: 0.75, greyTo: 0xc5cacd, fogNear: 20, fogFar: 200 },
    snow: { sun: 0.38, grey: 0.62, greyTo: 0xd5dbe0, fogNear: 90, fogFar: 380, fall: 'snow', amount: 1 },
    storm: { sun: 0.12, grey: 0.85, greyTo: 0x4a535b, fogNear: 80, fogFar: 330, fall: 'rain', amount: 1.6, lightning: true, wind: 1 },
    wind: { sun: 0.9, grey: 0.15, greyTo: 0xc9c0a8, fogNear: 200, fogFar: 560, fall: 'dust', amount: 0.7, wind: 1 },
  };
  // climate: ground colours pulled towards a tint (share per ground id, '*' = all others)
  const CLIMATE = {
    gemaessigt: null,
    steppe: { to: 0xb0a465, share: { grass: 0.5, forest: 0.25, schlamm: 0.3, '*': 0 } },
    wueste: { to: 0xd2b47c, share: { grass: 0.72, forest: 0.45, schlamm: 0.55, rubble: 0.25, strasse: 0.12, '*': 0 } },
    winter: { to: 0xeaf0f4, share: { grass: 0.8, sand: 0.7, forest: 0.55, schlamm: 0.6, rubble: 0.55, strasse: 0.3, furt: 0.35, '*': 0 } },
  };
  const now3 = { sky: new THREE.Color(SKY), sun: 1, hemi: 1.5, fogNear: 260, fogFar: 620, fall: 0, flash: 0 };
  const cA = new THREE.Color(), cB = new THREE.Color(), sunDir = new THREE.Vector3(-70, 120, -45).normalize();
  const lerpStops = (stops, h, out) => {
    for (let i = 1; i < stops.length; i++) if (h <= stops[i][0]) {
      const [h0, a] = stops[i - 1], [h1, b] = stops[i], f = (h - h0) / (h1 - h0 || 1);
      return out.setHex(a).lerp(cB.setHex(b), f);
    }
    return out.setHex(stops[stops.length - 1][1]);
  };
  function atmosphere(o = {}) {
    if (o.hour != null) atm.hour = ((o.hour % 24) + 24) % 24;
    if (o.weather && WEATHER[o.weather]) atm.weather = o.weather;
    if (o.climate && o.climate in CLIMATE && o.climate !== atm.climate) { atm.climate = o.climate; if (world) world.climate = null; }
    atm.on = true;
    return { ...atm };
  }
  // called every frame: eases towards the wanted look (weather changes over ~2 s)
  function applyAtmosphere(dt) {
    if (!atm.on) return;
    const w = WEATHER[atm.weather], h = atm.hour;
    const angle = (h - 6) / 12 * Math.PI;            // 0 at sunrise, π at sunset
    const elev = Math.sin(angle);
    const day = Math.max(0, Math.min(1, (elev + 0.08) / 0.3));
    const k = 1 - Math.exp(-dt * 1.6);
    lerpStops(SKY_STOPS, h, cA);
    cA.lerp(cB.setHex(w.greyTo).multiplyScalar(0.25 + 0.75 * day), w.grey);
    now3.sky.lerp(cA, k);
    scene.background.copy(now3.sky); scene.fog.color.copy(now3.sky);
    // fog distances are made for the battle camera (~150 m away); further out (launcher) they grow along
    const reach = Math.max(1, cam.dist / 150);
    now3.fogNear += (w.fogNear * reach - now3.fogNear) * k; now3.fogFar += (w.fogFar * reach - now3.fogFar) * k;
    scene.fog.near = now3.fogNear; scene.fog.far = now3.fogFar;
    // sun by day, moon by night (same light, other direction and colour)
    if (day > 0) {
      sunDir.set(-Math.cos(angle) * 0.9, Math.max(0.12, elev), -0.45).normalize();
      sun.color.setHex(0xff9a5a).lerp(cB.setHex(0xffe2b8), Math.min(1, elev * 2.2));
    } else {
      const ma = angle - Math.PI;
      sunDir.set(-Math.cos(ma) * 0.9, Math.max(0.25, Math.sin(ma)), -0.3).normalize();
      sun.color.setHex(0x9db4e6);
    }
    const wantSun = (day > 0 ? 2.6 * Math.min(1, day * 1.4) : 0.8) * w.sun;
    now3.sun += (wantSun - now3.sun) * k;
    now3.flash = Math.max(0, now3.flash - dt * 4);
    if (w.lightning && Math.random() < dt * 0.12) now3.flash = 1;
    sun.intensity = now3.sun + now3.flash * 6;
    const wantHemi = (0.45 + 1.05 * day) * (0.75 + 0.25 * w.sun);
    now3.hemi += (wantHemi - now3.hemi) * k;
    hemi.intensity = now3.hemi + now3.flash * 2;
    hemi.color.setHex(day > 0 ? 0xcfe3ff : 0x5c6f9c);
    fill.intensity = 0.45 * (0.3 + 0.7 * day);
    now3.fall += ((w.amount || 0) - now3.fall) * k;
    gradeStep(dt, day, elev);
  }
  // rain, snow or dust: boxes falling in a box around the camera target
  const FALL_MAX = 2400;
  const fallMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const fall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), fallMat, FALL_MAX); fall.frustumCulled = false; fall.count = 0; scene.add(fall);
  const fallP = new Float32Array(FALL_MAX * 4);
  for (let i = 0; i < FALL_MAX; i++) { fallP[i * 4] = Math.random(); fallP[i * 4 + 1] = Math.random(); fallP[i * 4 + 2] = Math.random(); fallP[i * 4 + 3] = Math.random(); }
  function drawFall(dt) {
    const w = WEATHER[atm.weather];
    const n = Math.round(Math.min(FALL_MAX, 1500 * now3.fall));
    if (!w.fall || n < 1) { fall.count = 0; return; }
    const R = Math.min(130, Math.max(45, cam.dist * 0.7)), H = 40;
    const big = Math.max(1, cam.dist / 90);   // far away (launcher) drops must stay visible
    const kind = w.fall, wind = w.wind || 0;
    const speed = kind === 'rain' ? 26 : kind === 'snow' ? 2.2 : 1.2;
    fallMat.color.setHex(kind === 'rain' ? 0xa9b8c6 : kind === 'snow' ? 0xffffff : 0xcbb48a);
    fallMat.opacity = kind === 'rain' ? 0.45 : kind === 'snow' ? 0.9 : 0.5;
    const t = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      const b = i * 4;
      fallP[b + 1] -= dt * speed * (0.8 + fallP[b + 3] * 0.4) / H;
      if (kind === 'dust') { fallP[b] += dt * (0.12 + fallP[b + 3] * 0.1); fallP[b + 1] += dt * speed / H * 0.9; }
      if (fallP[b + 1] < 0) { fallP[b + 1] += 1; fallP[b] = Math.random(); fallP[b + 2] = Math.random(); }
      if (fallP[b] > 1) fallP[b] -= 1;
      const x = cam.tx + (fallP[b] - 0.5) * 2 * R + (kind === 'snow' ? Math.sin(t * 0.7 + i) * 0.6 : 0) + wind * fallP[b + 1] * 8;
      const z = cam.tz + (fallP[b + 2] - 0.5) * 2 * R;
      const y = (kind === 'dust' ? 0.3 + fallP[b + 1] * 6 : fallP[b + 1] * H) + groundAt(cam.tx, cam.tz);
      o3.position.set(x, y, z);
      o3.rotation.set(0, 0, kind === 'rain' ? -wind * 0.35 : 0);
      if (kind === 'rain') o3.scale.set(0.035 * big, 0.9 * big, 0.035 * big); else if (kind === 'snow') o3.scale.setScalar(0.11 * big); else o3.scale.set(0.5 * big, 0.08 * big, 0.08 * big);
      o3.updateMatrix(); fall.setMatrixAt(i, o3.matrix);
    }
    fall.count = n; fall.instanceMatrix.needsUpdate = true;
  }
  // ---------- image effects (Fidelity step 1, battle_fx.js): bloom, AO on „Schön“, colour grade ----------
  // Switched on by the launcher (dial „Effekte“); off = the old look. Loaded only when wanted.
  let fx = null, fxOn = false, fxToken = 0, quality_ = 'medium';
  const gradeNow = { gain: [1, 1, 1], lift: [0, 0, 0], saturation: 1.08, contrast: 1.05, vignette: 0.3, bloom: 0.75 };
  async function imageFx(on) {
    fxOn = !!on;
    const token = ++fxToken;
    if (fx && (!on || fx.quality !== quality_)) { fx.dispose(); fx = null; glow(1); }
    if (!on || fx) return !!fx;
    try {
      const { createFx } = await import('./battle_fx.js');
      const made = await createFx({ renderer, scene, camera, quality: quality_ });
      if (token !== fxToken) { made.dispose(); return !!fx; }
      fx = made; glow(7); canvas.width = 0;   // setSize on the next frame
    } catch (e) { console.warn('Effekte nicht verfügbar:', e); fx = null; }
    return !!fx;
  }
  // fire and tracers above 1.0 so only they bloom
  function glow(f) { fire.material.color.setScalar(f); bolts.material.color.setHex(0xffe7a0).multiplyScalar(f > 1 ? f * 0.8 : 1); }
  // grade from climate, time of day and weather (eased like the rest of the atmosphere)
  const GRADE_CLIMATE = {
    gemaessigt: { gain: [1.08, 1.07, 1.05], lift: [0.01, 0.01, 0.012], saturation: 1.12, contrast: 1.06 },
    steppe: { gain: [1.1, 1.06, 0.96], lift: [0.015, 0.01, 0], saturation: 0.98, contrast: 1.06 },
    wueste: { gain: [1.12, 1.05, 0.9], lift: [0.03, 0.015, 0], saturation: 0.95, contrast: 1.1 },
    winter: { gain: [1.0, 1.04, 1.1], lift: [0, 0.008, 0.025], saturation: 0.86, contrast: 1.04 },
  };
  const GRADE_WEATHER = { clear: [1, 1, 0.75], cloudy: [0.9, 0.98, 0.55], rain: [0.78, 0.95, 0.5], fog: [0.75, 0.9, 0.35], snow: [0.85, 0.96, 0.55], storm: [0.7, 1.04, 0.45], wind: [0.95, 1.02, 0.7] };
  function gradeStep(dt, day, elev) {
    const c = GRADE_CLIMATE[atm.climate] || GRADE_CLIMATE.gemaessigt, [ws, wc, wb] = GRADE_WEATHER[atm.weather] || GRADE_WEATHER.clear;
    const golden = day > 0 ? Math.max(0, 1 - elev / 0.35) * day : 0, night = 1 - day;
    const want = {
      gain: c.gain.map((g, i) => g * (1 + golden * [0.1, 0.02, -0.08][i]) * (1 + night * [-0.08, 0, 0.12][i])),
      lift: c.lift.map((l, i) => l + night * [0, 0.008, 0.03][i]),
      saturation: c.saturation * ws * (1 - night * 0.3),
      contrast: c.contrast * wc,
      vignette: 0.22 + night * 0.12,
      bloom: wb * (1 + night * 0.5),
    };
    const k = 1 - Math.exp(-dt * 1.6);
    for (const key of ['gain', 'lift']) gradeNow[key] = gradeNow[key].map((v, i) => v + (want[key][i] - v) * k);
    for (const key of ['saturation', 'contrast', 'vignette', 'bloom']) gradeNow[key] += (want[key] - gradeNow[key]) * k;
    fx?.grade(gradeNow);
  }

  // quality (Schön / Mittel / Schnell): pixel ratio and shadows. Mittel = the look the battle always had.
  function quality(q) {
    quality_ = q;
    if (fx && fx.quality !== q) imageFx(fxOn);   // AO only on „Schön“: rebuild the chain
    const ratio = q === 'fast' ? 1 : q === 'beautiful' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    sun.castShadow = q !== 'fast';
    const size = q === 'beautiful' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    canvas.width = 0;   // forces setSize on the next frame
  }

  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const treeMat = voxelMaterial();
  const unitMats = {}; // per tint: normal / wreck
  const unitMat = vehicleMaterial(null);
  const wreckMat = vehicleMaterial(null, { tint: 0x3a3632 });

  let world = null;          // everything built for one map: { group, heights, size }
  let models = {};           // model key → { hull: geo per colour, turret, pivot } (filled lazily)
  let modelSource = null;    // data/models.json
  const voxCache = new Map(); // url → Promise<model map>
  const parts = new Map();   // key → InstancedMesh (grows)
  let effects = [], wrecks = [], debris = [];
  const smooth = new Map();  // unit id → { y, yaw, tyaw }
  let shown = false;

  // ---------- terrain ----------
  function buildWorld(sim) {
    if (world?.map === sim.map && world.climate === atm.climate) return;
    if (world) { scene.remove(world.group); world.group.traverse((o) => o.geometry?.dispose?.()); }
    const m = sim.map, n = m.n, cell = m.cell * M, size = n * cell;
    const group = new THREE.Group();
    const terrains = sim.world.terrains || {};
    const water = m.grounds.map((id) => terrains[id]?.water || null);
    const color = m.grounds.map((id) => new THREE.Color(terrains[id]?.color || '#6f9a4a'));
    const tint = CLIMATE[atm.climate];
    const tinted = (id, hex) => { const f = tint ? (tint.share[id] ?? tint.share['*']) : 0; return f ? cA.setHex(hex).lerp(cB.setHex(tint.to), f).getHex() : hex; };
    const hexes = m.grounds.map((id) => tinted(id, parseInt((terrains[id]?.color || '#6f9a4a').slice(1), 16)));
    for (let q = 0; q < color.length; q++) color[q].setHex(hexes[q]);
    // top height per cell (m): levels, half step on ramps next to the higher level, water lowered
    const top = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, l = m.level[k];
      let h = l * LEVEL;
      if (m.ramp[k]) {
        let up = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < n && b < n && m.level[b * n + a] > l) up = true;
        }
        if (up) h += LEVEL / 2;
      }
      const w = water[m.ground[k]];
      if (w === 'deep') h -= 1.2; else if (w === 'flat') h -= 0.4;
      top[k] = h;
    }
    // tops: one quad per cell, the 0.4 m voxel look comes from a texture (one texel per voxel column)
    const T = 5, tex = n * T;
    const data = new Uint8Array(tex * tex * 4);
    const hashf = (a, b) => ((Math.imul(a * 92837111 ^ b * 689287499, 2654435761) >>> 0) % 1000) / 1000;
    const c = new THREE.Color();
    for (let y = 0; y < tex; y++) for (let x = 0; x < tex; x++) {
      const i = Math.floor(x / T), j = Math.floor(y / T), k = j * n + i;
      const g = m.grounds[m.ground[k]];
      let v = 0.9 + hashf(x, y) * 0.16;
      // darker ring at the foot of higher neighbours (soft contact shadow of cliffs)
      const lx = x % T, ly = y % T;
      const higher = (di, dj) => { const a = i + di, b = j + dj; return a >= 0 && b >= 0 && a < n && b < n && top[b * n + a] > top[k] + 0.5; };
      if ((lx === 0 && higher(-1, 0)) || (lx === T - 1 && higher(1, 0)) || (ly === 0 && higher(0, -1)) || (ly === T - 1 && higher(0, 1))) v *= 0.72;
      if (g === 'forest') v *= 0.82;
      if (g === 'strasse' && (lx + ly * 3 + i) % 11 === 0) v *= 0.9;
      // the texture is sRGB: write the colour as authored, not three's linear working values
      const hx = hexes[m.ground[k]], f = v * (1 + top[k] * 0.02);
      const o = (y * tex + x) * 4;
      data[o] = Math.min(255, ((hx >> 16) & 255) * f); data[o + 1] = Math.min(255, ((hx >> 8) & 255) * f); data[o + 2] = Math.min(255, (hx & 255) * f); data[o + 3] = 255;
    }
    const map = new THREE.DataTexture(data, tex, tex);
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.needsUpdate = true;
    const tp = [], tu = [], tn = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = top[j * n + i], x0 = i * cell, z0 = j * cell, x1 = x0 + cell, z1 = z0 + cell;
      tp.push(x0, h, z0, x0, h, z1, x1, h, z1, x0, h, z0, x1, h, z1, x1, h, z0);
      tu.push(i / n, j / n, i / n, (j + 1) / n, (i + 1) / n, (j + 1) / n, i / n, j / n, (i + 1) / n, (j + 1) / n, (i + 1) / n, j / n);
      for (let q = 0; q < 6; q++) tn.push(0, 1, 0);
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    topGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
    fixWinding(topGeo);
    const tops = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }));
    tops.receiveShadow = true; tops.castShadow = true;
    group.add(tops);

    // cliff faces and the board edge: stone/earth bands per voxel layer
    const pos = [], col = [], nor = [];
    const BASE = -4;
    const quad = (a, b, cc, d, nrm, r, gg, bb) => {
      for (const p of [a, b, cc, a, cc, d]) { pos.push(...p); nor.push(...nrm); col.push(r, gg, bb); }
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, h = top[k], base = color[m.ground[k]];
      for (const [di, dj, nx, nz] of [[1, 0, 1, 0], [-1, 0, -1, 0], [0, 1, 0, 1], [0, -1, 0, -1]]) {
        const a = i + di, b = j + dj;
        const hn = a < 0 || b < 0 || a >= n || b >= n ? BASE : top[b * n + a];
        if (hn >= h) continue;
        const x0 = di > 0 ? (i + 1) * cell : i * cell, z0 = dj > 0 ? (j + 1) * cell : j * cell;
        const outside = hn === BASE;
        for (let y = hn; y < h - 1e-4; y += V) {
          const y1 = Math.min(h, y + V);
          const sh = outside ? 0.55 + hashf(i + j, Math.floor(y * 9)) * 0.08 : 0.62 + hashf(i * 3 + j, Math.floor(y * 7)) * 0.12;
          c.setHex(outside ? (y1 > h - 0.45 ? base.getHex() : 0x6b5238) : y1 >= h - 0.01 ? base.getHex() : 0x8c7a63).multiplyScalar(sh);
          if (di !== 0) quad([x0, y, z0], [x0, y1, z0], [x0, y1, z0 + cell], [x0, y, z0 + cell], [nx, 0, nz], c.r, c.g, c.b);
          else quad([x0, y, z0], [x0, y1, z0], [x0 + cell, y1, z0], [x0 + cell, y, z0], [nx, 0, nz], c.r, c.g, c.b);
        }
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    fixWinding(tg);
    const terrain = new THREE.Mesh(tg, terrainMat);
    terrain.receiveShadow = true; terrain.castShadow = true;
    group.add(terrain);

    // water surface over water cells
    const wp = [];
    for (let k = 0; k < n * n; k++) if (water[m.ground[k]]) {
      const i = k % n, j = (k - i) / n, y = -0.15;
      wp.push(i * cell, y, j * cell, i * cell, y, (j + 1) * cell, (i + 1) * cell, y, (j + 1) * cell, i * cell, y, j * cell, (i + 1) * cell, y, (j + 1) * cell, (i + 1) * cell, y, j * cell);
    }
    if (wp.length) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.computeVertexNormals();
      const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3f7fa6, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1 }));
      wm.receiveShadow = true;
      group.add(wm);
    }

    // diorama plinth: wooden frame under the board
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(size + 6, 3, size + 6), new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.8 }));
    plinth.position.set(size / 2, BASE - 1.5, size / 2); plinth.receiveShadow = true;
    group.add(plinth);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 1 }));
    table.rotation.x = -Math.PI / 2; table.position.set(size / 2, BASE - 3, size / 2); table.receiveShadow = true;
    group.add(table);

    // trees on forest cells
    const forestId = m.grounds.indexOf('forest');
    const spots = [];
    for (let k = 0; k < n * n; k++) if (m.ground[k] === forestId && hashf(k, 7) < 0.42) spots.push(k);
    const kinds = [0, 1, 2].map((s) => voxelGeometry(tree(s, s * 5)));
    kinds.forEach((geo, q) => {
      const mine = spots.filter((k) => k % 3 === q);
      const im = new THREE.InstancedMesh(geo, treeMat, Math.max(1, mine.length));
      const o = new THREE.Object3D();
      mine.forEach((k, idx) => {
        const i = k % n, j = (k - i) / n;
        o.position.set((i + 0.2 + hashf(k, 1) * 0.6) * cell, top[k], (j + 0.2 + hashf(k, 2) * 0.6) * cell);
        o.rotation.y = Math.floor(hashf(k, 3) * 4) * Math.PI / 2;
        const sc = 0.85 + hashf(k, 4) * 0.35; o.scale.set(sc, sc, sc);
        o.updateMatrix(); im.setMatrixAt(idx, o.matrix);
      });
      im.count = mine.length; im.castShadow = true; im.receiveShadow = true;
      group.add(im);
    });
    scene.add(group);
    world = { map: sim.map, group, top, n, cell, size, climate: atm.climate };
  }

  // flat-shaded quads were pushed in a fixed corner order; flip triangles whose winding disagrees with the normal
  function fixWinding(g) {
    const p = g.attributes.position.array, nr = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * nr[i] + cy * nr[i + 1] + cz * nr[i + 2] < 0) for (let q = 0; q < 3; q++) { const a = p[i + 3 + q]; p[i + 3 + q] = p[i + 6 + q]; p[i + 6 + q] = a; }
    }
  }

  function groundAt(x, z) {
    if (!world) return 0;
    const i = Math.max(0, Math.min(world.n - 1, Math.floor(x / world.cell))), j = Math.max(0, Math.min(world.n - 1, Math.floor(z / world.cell)));
    return Math.max(-0.35, world.top[j * world.n + i]);
  }

  // ---------- models ----------
  function sourceOf(sim, type) {
    const t = sim.types[type];
    const key = t.building ? 'pad' : (t.model || (t.cls === 'infantry' ? 'soldat' : 'tank'));
    return key;
  }
  function modelFor(key) {
    if (models[key]) return models[key];
    const entry = { ready: false, pivot: null, hull: null, turret: null, scale: 1 };
    models[key] = entry;
    if (key === 'pad') { entry.hull = landingPad(31); entry.ready = true; return entry; }
    const src = modelSource?.[key]?.source || `prototype:${key}`;
    if (src.startsWith('prototype:')) {
      const p = PROTOTYPES[src.slice(10)] || PROTOTYPES.tank;
      entry.hull = p.hull(); entry.turret = p.turret ? p.turret() : null; entry.pivot = p.pivot || null; entry.ready = true;
    } else {
      // own .vox model (path relative to the project folder)
      const url = new URL(src, modelsBase).href;
      if (!voxCache.has(url)) voxCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => readVox(b, { forward: modelSource?.[key]?.forward || null }).model));
      voxCache.get(url).then((W) => { entry.hull = W; entry.ready = true; dropParts(key); })
        .catch(() => { const p = PROTOTYPES.tank; entry.hull = p.hull(); entry.turret = p.turret(); entry.pivot = p.pivot; entry.ready = true; dropParts(key); });
    }
    return entry;
  }
  function dropParts(key) { for (const [k, im] of parts) if (k.startsWith(key + '|')) { scene.remove(im); parts.delete(k); } }

  // one InstancedMesh per (model, part, colour, wreck?)
  const geoCache = new Map();
  function part(key, which, colour, wreck = false) {
    const id = `${key}|${which}|${colour}|${wreck ? 1 : 0}`;
    let im = parts.get(id);
    if (im && im.userData.used < im.userData.cap) return im;
    const e = modelFor(key);
    if (!e.ready) return null;
    const W = which === 'turret' ? e.turret : e.hull;
    if (!W) return null;
    const gk = `${key}|${which}|${colour}`;
    if (!geoCache.has(gk)) geoCache.set(gk, voxelGeometry(W, { team: colour }));
    const cap = im ? im.userData.cap * 2 : 32;
    const fresh = new THREE.InstancedMesh(geoCache.get(gk), wreck ? wreckMat : unitMat, cap);
    fresh.castShadow = true; fresh.receiveShadow = true; fresh.frustumCulled = false;
    fresh.userData.used = 0; fresh.userData.cap = cap;
    if (im) { for (let i = 0; i < im.userData.used; i++) { im.getMatrixAt(i, tmpM); fresh.setMatrixAt(i, tmpM); } fresh.userData.used = im.userData.used; scene.remove(im); }
    scene.add(fresh); parts.set(id, fresh);
    return fresh;
  }
  const tmpM = new THREE.Matrix4(), o3 = new THREE.Object3D();
  function put(im, x, y, z, yaw, extra = null) {
    if (!im) return;
    o3.position.set(x, y, z); o3.rotation.set(0, yaw, 0); o3.scale.set(1, 1, 1);
    if (extra) extra(o3);
    o3.updateMatrix();
    im.setMatrixAt(im.userData.used++, o3.matrix);
  }

  // selection rings, markers
  const ringGeo = new THREE.RingGeometry(0.86, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, 256); rings.frustumCulled = false; scene.add(rings);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 1, depthWrite: false, depthTest: false, fog: false });
  const mark = new THREE.Mesh(ringGeo, markMat); mark.renderOrder = 5; scene.add(mark);

  // projectiles, tracers, explosions, smoke, debris
  const boltGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
  const bolts = new THREE.InstancedMesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xffe7a0, fog: false }), 400); bolts.frustumCulled = false; scene.add(bolts);
  const lineMax = 600;
  const linePos = new Float32Array(lineMax * 6), lineCol = new Float32Array(lineMax * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3)); lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  lines.frustumCulled = false; scene.add(lines);
  const orderMax = 256;
  const orderPos = new Float32Array(orderMax * 6), orderCol = new Float32Array(orderMax * 6);
  const orderGeo = new THREE.BufferGeometry();
  orderGeo.setAttribute('position', new THREE.BufferAttribute(orderPos, 3)); orderGeo.setAttribute('color', new THREE.BufferAttribute(orderCol, 3));
  const orderLines = new THREE.LineSegments(orderGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthTest: false, fog: false }));
  orderLines.frustumCulled = false; orderLines.renderOrder = 4; scene.add(orderLines);
  const fireGeo = new THREE.IcosahedronGeometry(1, 1);
  const fire = new THREE.InstancedMesh(fireGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 300);
  fire.frustumCulled = false; scene.add(fire);
  const smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 1000);
  smoke.frustumCulled = false; smoke.castShadow = false; scene.add(smoke);
  const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V, V), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 800);
  chips.frustumCulled = false; chips.castShadow = true; scene.add(chips);
  const tmpC = new THREE.Color();

  // ---------- events → effects ----------
  function drain(sim, skip) {
    const now = performance.now();
    if (skip || !shown) { sim.events.length = 0; return; }
    const me = meSeat();
    for (const e of sim.events) {
      if (e.kind === 'shot') {
        const y0 = groundAt(e.x * M, e.y * M) + 1.6, y1 = groundAt(e.tx * M, e.ty * M) + 0.8;
        effects.push({ kind: 'shot', p: e.projectile, x: e.x * M, y: y0, z: e.y * M, tx: e.tx * M, ty: y1, tz: e.ty * M, t0: now, dur: Math.max(70, e.time * 50) });
        if (e.projectile >= 2) effects.push({ kind: 'flash', x: e.x * M, y: y0, z: e.y * M, r: e.projectile === 3 ? 0.9 : 1.3, t0: now, dur: 110 });
      } else if (e.kind === 'impact') {
        const x = e.x * M, z = e.y * M, y = groundAt(x, z);
        const big = e.splash > 0 || e.projectile === 2 || e.projectile === 3;
        const fr = (big ? Math.max(1.6, e.splash * M * 0.8) : 0.35) * (boom > 1 ? 1.3 : 1);
        effects.push({ kind: 'flash', x, y: y + 0.4, z, r: fr, t0: now, dur: big ? 320 * Math.min(1.5, boom) : 120 });
        if (big) {
          for (let i = 0; i < Math.round(4 * boom); i++) puff(x, y + 0.5, z, 0.8 + Math.random() * 0.8 * boom, 0x6d665e);
          if (boom > 1) { for (let i = 0; i < 8; i++) chip(x, y + 0.3, z, Math.random() < 0.5 ? 0x5a4a36 : 0x6f5c42, 0.6); light(x, y + 2, z, 1.6); jolt(x, z, 0.25); }
        }
      } else if (e.kind === 'dead') {
        const t = sim.types[e.type];
        const x = e.x * M, z = e.y * M, y = groundAt(x, z);
        const r = t?.cls === 'infantry' ? 0.8 : t?.building ? 9 : 3.4;
        effects.push({ kind: 'flash', x, y: y + 1, z, r: r * (boom > 1 && t?.cls !== 'infantry' ? 1.5 : 1), t0: now, dur: (t?.building ? 1100 : 600) * Math.min(1.6, boom), big: true });
        for (let i = 0; i < Math.round((t?.cls === 'infantry' ? 2 : 14) * boom); i++) puff(x + (Math.random() - 0.5) * r, y + 1, z + (Math.random() - 0.5) * r, 1.2 + Math.random() * 1.6 * boom, 0x3d3833);
        light(x, y + 3, z, (t?.building ? 6 : 3) * boom);
        if (t?.cls !== 'infantry') jolt(x, z, t?.building ? 1.2 : 0.6);
        if (t && t.cls !== 'infantry') {
          const key = sourceOf(sim, e.type);
          const seat = playerList().find((p) => p.seat === e.seat);
          wrecks.push({ key, x, y, z, yaw: yawOf(e.h), t0: now, colour: colourOf(seat), building: !!t.building });
          for (let i = 0; i < Math.round((t.building ? 50 : 26) * boom); i++) chip(x, y + 1.2, z, t.building ? 0x9a968c : 0x4e5236, boom);
        }
      } else if (e.kind === 'wave') {
        effects.push({ kind: 'ring', x: e.x * M, y: groundAt(e.x * M, e.y * M) + 0.6, z: e.y * M, r: 16, t0: now, dur: 1200 });
        if (e.seat === me) toast(`Welle ${e.n}: Verstärkung ist gelandet`);
      } else if (e.kind === 'out') {
        const p = playerList().find((x) => x.seat === e.seat);
        toast(e.seat === me ? 'Du bist raus.' : `${p?.name ?? 'Jemand'} ist raus.`);
      }
    }
    sim.events.length = 0;
    if (effects.length > 700) effects = effects.slice(-700);
    if (debris.length > 1800) debris = debris.slice(-1800);
    wrecks = wrecks.filter((w) => now - w.t0 < 30000);
  }
  function puff(x, y, z, s, colour) { debris.push({ kind: 'smoke', x, y, z, vx: (Math.random() - 0.5) * 0.8, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 0.8, s, c: colour, t0: performance.now(), dur: 1800 + Math.random() * 1400 }); }
  function chip(x, y, z, colour, power = 1) {
    const a = Math.random() * TAU, v = (3 + Math.random() * 6) * Math.sqrt(power);
    debris.push({ kind: 'chip', x, y, z, vx: Math.cos(a) * v, vy: (4 + Math.random() * 7) * Math.sqrt(power), vz: Math.sin(a) * v, rx: Math.random() * 6, c: colour, t0: performance.now(), dur: 2600 + Math.random() * 1500 });
  }
  function light(x, y, z, s) { const f = flashes.reduce((a, b) => (a.t0 < b.t0 ? a : b)); f.l.position.set(x, y, z); f.t0 = performance.now(); f.s = s; }
  function colourOf(p) { return p?.color ? parseInt(p.color.slice(1), 16) : 0x999999; }

  // ---------- camera ----------
  function placeCamera() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, groundAt(cam.tx, cam.tz) + sp * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, groundAt(cam.tx, cam.tz), cam.tz);
    if (shake > 0.01) {
      const a = shake * shake * 0.9;
      camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a * 0.6; camera.position.z += (Math.random() - 0.5) * a;
    }
    camera.updateMatrixWorld();
    // the shadow follows the view; snap to texels so it does not shimmer while panning
    const ext = Math.min(140, Math.max(60, cam.dist * 0.9));
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    sun.shadow.camera.updateProjectionMatrix();
    const texel = (2 * ext) / 2048;
    const sx = Math.round(cam.tx / texel) * texel, sz = Math.round(cam.tz / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + sunDir.x * 150, sunDir.y * 150, sz + sunDir.z * 150);
  }
  function clampCam() {
    const size = world?.size ?? 256;
    cam.tx = Math.max(-10, Math.min(size + 10, cam.tx)); cam.tz = Math.max(-10, Math.min(size + 10, cam.tz));
    cam.dist = Math.max(22, Math.min(320, cam.dist));
  }
  const vec = new THREE.Vector3();
  function project(x, y, u = null) {
    const wx = x * M, wz = y * M;
    const s = u ? smooth.get(u.id) : null;
    vec.set(wx, (s ? s.y : groundAt(wx, wz)) + (u ? 1 : 0), wz).project(camera);
    return [(vec.x + 1) / 2 * overlay.clientWidth, (1 - vec.y) / 2 * overlay.clientHeight];
  }
  const ray = new THREE.Raycaster();
  function unproject(px, py) {
    ray.setFromCamera(new THREE.Vector2(px / overlay.clientWidth * 2 - 1, -(py / overlay.clientHeight * 2 - 1)), camera);
    // intersect the ground plane, then refine once on the height found there
    let h = 0, hit = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
      if (!ray.ray.intersectPlane(plane, hit)) break;
      h = groundAt(hit.x, hit.z);
    }
    return [hit.x / M, hit.z / M];
  }
  function pixelsPerMm(x, y) {
    const [ax, ay] = project(x, y), [bx, by] = project(x + 1000, y);
    return Math.hypot(bx - ax, by - ay) / 1000;
  }
  function pan(dx, dy) {
    const k = cam.dist / overlay.clientHeight * 1.25;
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    cam.tx += (-dx * rx + dy * fx) * k; cam.tz += (-dx * rz + dy * fz) * k;
    clampCam();
  }
  function zoom(f, px, py) {
    const [ax, ay] = unproject(px, py);
    cam.dist /= f; clampCam(); placeCamera();
    const [bx, by] = unproject(px, py);
    cam.tx += (ax - bx) * M; cam.tz += (ay - by) * M; clampCam();
  }
  function rotate(d) { cam.yaw += d; }
  function centreOn(x, y, keepZoom = false) { cam.tx = x * M; cam.tz = y * M; if (!keepZoom && cam.dist > 120) cam.dist = 95; clampCam(); }
  // behind the own landing pad, looking towards the middle of the map
  function home() {
    const sim = app.ls?.sim; if (!sim) return;
    const p = sim.units.find((u) => u.seat === meSeat() && sim.types[u.type].building);
    if (!p) return;
    const c = sim.map.size / 2;
    cam.yaw = Math.atan2(p.x - c, p.y - c);
    centreOn(p.x + (c - p.x) * 0.25, p.y + (c - p.y) * 0.25);
    cam.dist = 120;
  }

  // world point in metres (y = height) → screen; null behind the camera
  function projectWorld(x, y, z) {
    vec.set(x, y, z).project(camera);
    if (vec.z > 1 || vec.z < -1) return null;
    return { x: (vec.x + 1) / 2 * overlay.clientWidth, y: (1 - vec.y) / 2 * overlay.clientHeight };
  }
  const targetV = new THREE.Vector3();
  function target() { return targetV.set(cam.tx, groundAt(cam.tx, cam.tz), cam.tz); }

  // ---------- small live pictures (portrait in the selection, live windows) ----------
  // Like the stress test: right after the main image, the follow camera renders into the main canvas exactly where
  // the slot sits on screen (the HUD window covers that spot anyway), and the pixels are copied into the slot canvas
  // in the same task. No readPixels, so the GPU does not stall.
  const insetList = new Map(); // key → { canvas, id, last }
  const insetCam = new THREE.PerspectiveCamera(40, 1.6, 0.5, 600);
  function inset(key, canvas, unitId) {
    if (!canvas) { insetList.delete(key); return; }
    const o = insetList.get(key);
    if (o) { o.canvas = canvas; o.id = unitId; } else insetList.set(key, { canvas, id: unitId, last: 0 });
  }
  function insets(sim, now) {
    if (!insetList.size) return;
    const pr = renderer.getPixelRatio(), W = overlay.clientWidth, H = overlay.clientHeight;
    let used = false;
    for (const [key, o] of insetList) {
      const cv = o.canvas;
      if (!cv.isConnected) { insetList.delete(key); continue; }
      if (now - o.last < 90) continue;
      o.last = now;
      const u = sim.byId.get(o.id);
      cv.classList.toggle('lost', !u);
      if (!u) continue;
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
      const w = Math.min(W - x, Math.floor(r.width)), h = Math.min(H - y, Math.floor(r.height));
      if (w < 16 || h < 12 || cv.closest('[hidden]')) continue;
      const cw = Math.round(w * pr), ch = Math.round(h * pr);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      const sm = smooth.get(u.id), ty = sim.types[u.type];
      const ux = u.x * M, uz = u.y * M, uy = sm ? sm.y : groundAt(ux, uz), yaw = sm ? sm.yaw : yawOf(u.h);
      const back = ty.cls === 'infantry' ? 6 : 13, up = ty.cls === 'infantry' ? 3.5 : 6;
      insetCam.position.set(ux - Math.sin(yaw) * back, uy + up, uz - Math.cos(yaw) * back);
      insetCam.lookAt(ux + Math.sin(yaw) * 4, uy + 1, uz + Math.cos(yaw) * 4);
      insetCam.aspect = w / h; insetCam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
      renderer.render(scene, insetCam);
      used = true;
      try { cv.getContext('2d').drawImage(renderer.domElement, x * pr, y * pr, cw, ch, 0, 0, cw, ch); } catch { /* canvas not ready */ }
    }
    if (used) { renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); }
  }
  // ---------- draw ----------
  let last = performance.now();
  function draw(before, beforeTime) {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    const sim = app.ls?.sim;
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const d = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(W * d) || overlay.height !== Math.round(H * d)) { overlay.width = Math.round(W * d); overlay.height = Math.round(H * d); }
    g2.setTransform(d, 0, 0, d, 0, 0); g2.clearRect(0, 0, W, H);
    if (app.view !== 'game' || !sim || !shown) { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';
    if (canvas.width !== Math.round(W * renderer.getPixelRatio())) { renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); fx?.setSize(W, H); }
    applyAtmosphere(dt);
    shake = Math.max(0, shake - dt * 2.2);
    // burning wrecks (boom > 1): black smoke column and a few sparks for 15 s
    if (boom > 1) for (const w of wrecks) {
      const age = (performance.now() - w.t0) / 1000;
      if (age > 15 || Math.random() > dt * (w.building ? 14 : 7)) continue;
      puff(w.x + (Math.random() - 0.5) * 1.5, w.y + 1.5, w.z + (Math.random() - 0.5) * 1.5, 0.9 + Math.random() * 1.2, age < 4 && Math.random() < 0.35 ? 0xff8a3a : 0x2a2724);
    }
    buildWorld(sim);
    placeCamera();
    drawFall(dt);
    const t = Math.min(1, (now - beforeTime) / ROUND_MS);
    const pos = (u) => { const v = before?.get(u.id); return v ? [v[0] + (u.x - v[0]) * t, v[1] + (u.y - v[1]) * t] : [u.x, u.y]; };
    const colours = Object.fromEntries(playerList().map((x) => [x.seat, colourOf(x)]));
    const sel = app.selection;
    for (const id of [...sel]) if (!sim.byId.has(id)) sel.delete(id);
    for (const im of parts.values()) im.userData.used = 0;
    const k = 1 - Math.exp(-dt * 12);

    // units
    let ringN = 0;
    const seen = new Set();
    const bars = [];
    for (const u of sim.units) {
      const ty = sim.types[u.type];
      const [x, y] = pos(u);
      const wx = x * M, wz = y * M;
      const key = sourceOf(sim, u.type);
      const colour = colours[u.seat] ?? 0x999999;
      let s = smooth.get(u.id);
      const yaw = ty.building ? 0 : yawOf(u.h);
      if (!s) { s = { y: groundAt(wx, wz), yaw, tyaw: yaw }; smooth.set(u.id, s); }
      seen.add(u.id);
      s.y += (groundAt(wx, wz) - s.y) * k;
      s.yaw += angleStep(s.yaw, yaw, k);
      const e = modelFor(key);
      put(part(key, 'hull', colour), wx, s.y, wz, s.yaw);
      if (e.turret) {
        const tgt = u.tgt ? sim.byId.get(u.tgt) : null;
        const want = tgt ? Math.atan2(tgt.x * M - wx, tgt.y * M - wz) : s.yaw;
        s.tyaw += angleStep(s.tyaw, want, 1 - Math.exp(-dt * 5));
        const [px, py, pz] = e.pivot.map((q) => q * V);
        const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
        put(part(key, 'turret', colour), wx + px * cs + pz * sn, s.y + py, wz - px * sn + pz * cs, s.tyaw);
      }
      if (((sel.has(u.id) && !app.hud) || app.marked === u.id) && ringN < 256) {   // marked: the launcher's hero
        o3.position.set(wx, s.y + 0.12, wz); o3.rotation.set(0, 0, 0); const r = (ty.radius + 500) * M; o3.scale.set(r, 1, r); o3.updateMatrix();
        rings.setMatrixAt(ringN++, o3.matrix);
      }
      if (ty.building || app.marked === u.id || (!app.hud && (u.hp < ty.hp || sel.has(u.id)))) bars.push([u, ty, wx, s.y, wz]);
      u.view = s; // for the HUD adapter: smoothed height and heading
    }
    for (const id of smooth.keys()) if (!seen.has(id)) smooth.delete(id);
    rings.count = ringN; rings.instanceMatrix.needsUpdate = true;

    // wrecks: dark, sinking slowly at the end
    for (const w of wrecks) {
      const age = (now - w.t0) / 1000, sink = age > 25 ? (age - 25) * 0.5 : 0;
      put(part(w.key, 'hull', w.colour, true), w.x, w.y - sink - (w.building ? 0.2 : 0), w.z, w.yaw, w.building ? null : (o) => { o.rotation.z = 0.06; });
      const e = models[w.key];
      if (e?.turret) put(part(w.key, 'turret', w.colour, true), w.x + 0.8, w.y - sink + 0.2, w.z - 0.5, w.yaw + 0.9, (o) => { o.rotation.z = 0.5; });
    }
    for (const im of parts.values()) { im.count = im.userData.used; im.instanceMatrix.needsUpdate = true; }

    // order lines of the own selection
    let on = 0;
    const me = meSeat();
    for (const u of sim.units) {
      if (app.hud || !sel.has(u.id) || u.seat !== me || on >= orderMax) continue;
      const s = smooth.get(u.id); if (!s) continue;
      const [x, y] = pos(u);
      let gx, gy, col;
      if (u.order === 1) { gx = u.gx; gy = u.gy; col = [0.9, 0.9, 0.9]; }
      else if (u.order === 2) { const e = sim.byId.get(u.tgt); if (!e) continue; gx = e.x; gy = e.y; col = [1, 0.35, 0.3]; }
      else continue;
      orderPos.set([x * M, s.y + 0.3, y * M, gx * M, groundAt(gx * M, gy * M) + 0.3, gy * M], on * 6);
      orderCol.set([...col, ...col], on * 6); on++;
    }
    orderGeo.setDrawRange(0, on * 2); orderGeo.attributes.position.needsUpdate = true; orderGeo.attributes.color.needsUpdate = true;

    // pending command marker (instant local feedback)
    const p = app.pending;
    if (p && now - p.time < 700 && !app.hud) {
      const a = (now - p.time) / 700;
      mark.visible = true; markMat.color.setHex(p.attack ? 0xff5a50 : 0xf2c14e); markMat.opacity = 1 - a;
      mark.position.set(p.x * M, groundAt(p.x * M, p.y * M) + 0.2, p.y * M); const r = 1.2 + a * 2.5; mark.scale.set(r, 1, r);
    } else mark.visible = false;

    // effects
    effects = effects.filter((f) => now - f.t0 < f.dur);
    let bn = 0, ln = 0, fn = 0;
    for (const f of effects) {
      const q = (now - f.t0) / f.dur;
      if (f.kind === 'shot') {
        const x = f.x + (f.tx - f.x) * q, z = f.z + (f.tz - f.z) * q;
        let y = f.y + (f.ty - f.y) * q;
        if (f.p === 3) y += Math.sin(q * Math.PI) * Math.hypot(f.tx - f.x, f.tz - f.z) * 0.22;
        if (f.p <= 1 || f.p === 4) {
          if (ln < lineMax) {
            const q0 = Math.max(0, q - 0.35), b = (1 - q) * (f.p === 4 ? 1 : 0.9);
            linePos.set([f.x + (f.tx - f.x) * q0, f.y + (f.ty - f.y) * q0, f.z + (f.tz - f.z) * q0, x, y, z], ln * 6);
            const c = f.p === 4 ? [0.4 * b, 0.9 * b, 1 * b] : [1 * b, 0.85 * b, 0.45 * b];
            lineCol.set([...c, ...c], ln * 6); ln++;
          }
        } else if (bn < 400) {
          o3.position.set(x, y, z); o3.rotation.set(0, 0, 0); o3.scale.setScalar(f.p === 3 ? 1.2 : 1); o3.updateMatrix(); bolts.setMatrixAt(bn++, o3.matrix);
          if (f.p === 3 && Math.random() < 0.5) debris.push({ kind: 'smoke', x, y, z, vx: 0, vy: 0.3, vz: 0, s: 0.35, c: 0xd9d4cc, t0: now, dur: 700 });
        }
      } else if ((f.kind === 'flash' || f.kind === 'ring') && fn < 300) {
        const r = f.kind === 'ring' ? f.r * (0.3 + q) : f.r * (0.5 + q * 0.9);
        o3.position.set(f.x, f.y, f.z); o3.rotation.set(0, 0, 0);
        if (f.kind === 'ring') o3.scale.set(r, 0.05, r); else o3.scale.setScalar(r);
        o3.updateMatrix(); fire.setMatrixAt(fn, o3.matrix);
        const fade = 1 - q;
        tmpC.setRGB(1 * fade, (f.big ? 0.55 : 0.8) * fade, (f.big ? 0.2 : 0.45) * fade);
        if (f.kind === 'ring') tmpC.setRGB(0.6 * fade, 0.8 * fade, 1 * fade);
        fire.setColorAt(fn++, tmpC);
      }
    }
    bolts.count = bn; bolts.instanceMatrix.needsUpdate = true;
    lineGeo.setDrawRange(0, ln * 2); lineGeo.attributes.position.needsUpdate = true; lineGeo.attributes.color.needsUpdate = true;
    fire.count = fn; fire.instanceMatrix.needsUpdate = true; if (fire.instanceColor) fire.instanceColor.needsUpdate = true;

    // smoke and chips (local optics, never in the simulation)
    debris = debris.filter((b) => now - b.t0 < b.dur);
    let sn = 0, cn = 0;
    for (const b of debris) {
      const q = (now - b.t0) / b.dur;
      if (b.kind === 'smoke' && sn < 1000) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vy *= 0.985;
        const s = b.s * (0.6 + q * 1.6) * (q > 0.75 ? (1 - q) * 4 : 1);
        o3.position.set(b.x, b.y, b.z); o3.rotation.set(q, q * 1.3, 0); o3.scale.setScalar(Math.max(0.01, s)); o3.updateMatrix();
        smoke.setMatrixAt(sn, o3.matrix); smoke.setColorAt(sn++, tmpC.setHex(b.c));
      } else if (b.kind === 'chip' && cn < 800) {
        const gy = groundAt(b.x, b.z) + V / 2;
        b.vy -= 22 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.y < gy) { b.y = gy; b.vy *= -0.3; b.vx *= 0.6; b.vz *= 0.6; }
        o3.position.set(b.x, b.y - (q > 0.8 ? (q - 0.8) * 2 : 0), b.z); o3.rotation.set(b.rx * q, b.rx * 0.7 * q, 0); o3.scale.setScalar(1); o3.updateMatrix();
        chips.setMatrixAt(cn, o3.matrix); chips.setColorAt(cn++, tmpC.setHex(b.c));
      }
    }
    smoke.count = sn; smoke.instanceMatrix.needsUpdate = true; if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true;
    chips.count = cn; chips.instanceMatrix.needsUpdate = true; if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
    for (const f of flashes) { const a = (now - f.t0) / 500; f.l.intensity = a < 1 ? (1 - a) * 260 * (f.s || 1) : 0; }

    if (fx) fx.render(dt); else renderer.render(scene, camera);
    insets(sim, now);

    // overlay: health bars, selection frame
    for (const [u, ty, wx, wy, wz] of bars) {
      vec.set(wx, wy + (ty.building ? 2.2 : ty.cls === 'infantry' ? 2.4 : 3.6), wz).project(camera);
      if (vec.z > 1) continue;
      const sx = (vec.x + 1) / 2 * W, sy = (1 - vec.y) / 2 * H;
      const w = Math.max(16, Math.min(70, pixelsPerMm(u.x, u.y) * ty.radius * 2));
      const f = u.hp / ty.hp;
      g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
      g2.fillStyle = f > 0.6 ? '#5ad16a' : f > 0.3 ? '#f2c14e' : '#e2524a'; g2.fillRect(sx - w / 2, sy, w * Math.max(0, f), 3);
    }
    const z = app.drag;
    if (z?.frame) {
      g2.strokeStyle = '#f2c14e'; g2.fillStyle = 'rgba(242,193,78,.08)'; g2.lineWidth = 1;
      g2.fillRect(z.x0, z.y0, z.x - z.x0, z.y - z.y0); g2.strokeRect(z.x0 + 0.5, z.y0 + 0.5, z.x - z.x0, z.y - z.y0);
    }
  }
  function angleStep(a, b, k) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d * k; }

  function reset() {
    effects = []; wrecks = []; debris = []; smooth.clear();
    for (const im of parts.values()) scene.remove(im);
    parts.clear(); geoCache.forEach((g) => g.dispose()); geoCache.clear(); models = {};
  }
  function setModels(src) { modelSource = src || {}; models = {}; for (const im of parts.values()) scene.remove(im); parts.clear(); geoCache.clear(); }
  function show(on) { shown = on; if (!on) canvas.style.display = 'none'; }

  return { draw, drain, reset, project, unproject, pixelsPerMm, pan, zoom, rotate, centreOn, home, show, setModels, kind: '3d', renderer,
    scene, camera, projectWorld, target, groundAt, inset, yawOf, atmosphere, quality, cam, excite, imageFx };
}
