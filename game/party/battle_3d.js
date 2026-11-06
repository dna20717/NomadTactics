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
import { createTowers } from './towers.js';
import { createTerrainFx, SURFACES, surfaceOf } from './terrain_fx.js';
import { ROUND_MS } from '../../engine/net/protocol.js';
import { lifeOf, stageAt } from '../../engine/tactics/life.js';
import { bounds, muzzleOf, damagedModel, sootAt, spring, recoilCurve, DEG } from './unit_life.js';

const M = 1 / 1000;          // world units (mm) → metres
const LEVEL = 2.0;           // one map level = 2 m (5 voxels)
const SKY = 0xd6e4e8;
const TAU = Math.PI * 2;
const HOVER = 4.4;            // companion drones fly this high above the ground (m)
const yawOf = (h) => Math.PI / 2 - (h / 256) * TAU; // sim angle (0 = +x) → rotation about y (model front = +z)

// ---------- fine terrain: smooth ramps and diagonal edges (optics only) ----------
const FINE = 10;             // 10 × 10 columns per 2 m cell = 0.2 m (half a voxel)
const FSTEP = 0.2;           // height steps of the fine columns (half a voxel)
const stepped = (h) => Math.round(h / FSTEP) * FSTEP;
export function smoothCells(m, top, water) {
  const n = m.n, fine = new Map();
  const isWater = (k) => !!water[m.ground[k]];
  // ramps: each connected ramp is one even slope from the ground next to it below to the ground above
  // (direction = from the lower neighbours to the higher ones), cut into 0.2 m steps when drawn
  const seen = new Uint8Array(n * n);
  for (let k0 = 0; k0 < n * n; k0++) {
    if (!m.ramp[k0] || seen[k0] || isWater(k0)) continue;
    const region = [k0]; seen[k0] = 1;
    for (let q = 0; q < region.length; q++) {
      const k = region[q], i = k % n, j = (k - i) / n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, c = b * n + a;
        if (a >= 0 && b >= 0 && a < n && b < n && m.ramp[c] && !seen[c] && !isWater(c)) { seen[c] = 1; region.push(c); }
      }
    }
    // neighbours outside the ramp, by level
    const border = new Map();
    for (const k of region) {
      const i = k % n, j = (k - i) / n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, c = b * n + a;
        if (a < 0 || b < 0 || a >= n || b >= n || m.ramp[c] || isWater(c)) continue;
        if (!border.has(m.level[c])) border.set(m.level[c], []);
        border.get(m.level[c]).push([a + 0.5, b + 0.5]);
      }
    }
    const levels = [...border.keys()].sort((x, y) => x - y);
    const lo = levels[0] ?? m.level[k0], hi = levels[levels.length - 1] ?? lo;
    const mean = (l) => { const p = border.get(l) || [[0, 0]]; let x = 0, y = 0; for (const [a, b] of p) { x += a; y += b; } return [x / p.length, y / p.length]; };
    const [lx, ly] = mean(lo), [hx, hy] = mean(hi);
    let dx = hx - lx, dy = hy - ly; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const proj = (l) => { const p = border.get(l) || []; let s = 0; for (const [a, b] of p) s += a * dx + b * dy; return p.length ? s / p.length : 0; };
    const sLo = proj(lo), sHi = proj(hi), span = sHi - sLo;
    for (const k of region) {
      const i = k % n, j = (k - i) / n, f = new Float32Array(FINE * FINE);
      for (let sy = 0; sy < FINE; sy++) for (let sx = 0; sx < FINE; sx++) {
        const px = i + (sx + 0.5) / FINE, py = j + (sy + 0.5) / FINE;
        const t = hi === lo || span <= 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy - sLo) / span));
        f[sy * FINE + sx] = (lo + t * (hi - lo)) * LEVEL;
      }
      fine.set(k, f);
      top[k] = (lo + (hi - lo) * 0.5) * LEVEL;
    }
  }
  // inner corners of diagonal edges: two orthogonal neighbours and the diagonal one higher → fill a triangle
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (fine.has(k)) continue;
    const h = top[k];
    let f = null;
    for (const [di, dj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const A = j * n + a, B = b * n + i, C = b * n + a;
      if ((m.ramp[A] && !isWater(A)) || (m.ramp[B] && !isWater(B))) continue;
      if (!(top[A] > h + 0.1 && top[B] > h + 0.1 && top[C] > h + 0.1)) continue;
      const fill = Math.min(top[A], top[B]);
      if (!f) f = new Float32Array(FINE * FINE).fill(h);
      const cx = di > 0 ? FINE - 1 : 0, cy = dj > 0 ? FINE - 1 : 0;
      for (let sy = 0; sy < FINE; sy++) for (let sx = 0; sx < FINE; sx++) {
        if (Math.abs(sx - cx) + Math.abs(sy - cy) <= FINE - 2 && f[sy * FINE + sx] < fill) f[sy * FINE + sx] = fill; // corner half, on the diagonal
      }
    }
    if (f) fine.set(k, f);
  }
  return fine;
}

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
  // towers on the map (props, optics only; their ground „bebaut“ is what the simulation sees)
  const towers = createTowers(THREE, scene, { groundAt, puff, chip, jolt, light,
    onCrush: (x, z, r, pct) => api3d.onCrush?.(x, z, r, pct), onEvent: (t, what) => api3d.onTower?.(t, what) });
  const api3d = {};   // hooks the launcher sets (onCrush, onTower, onStrike)
  // lively ground (Fidelity step 3): tracks, scattered objects, water, ground shader (terrain_fx.js)
  const tfx = createTerrainFx(THREE, scene);
  let towersOf = null, dayNow = 1;
  // a rocket strike from beyond the board (launcher show): arcs in, explodes, hurts towers
  let strikes = [];
  // opt.y: height of the hit (a facade), opt.size: blast size, opt.radius: hole in towers (m)
  function strike(x, z, delay = 0, opt = {}) {
    const now = performance.now() + delay, a = Math.random() * TAU;
    const fx = x + Math.cos(a) * 160, fz = z + Math.sin(a) * 160;
    strikes.push({ x, z, y: opt.y ?? null, size: opt.size ?? 1, radius: opt.radius ?? 2.8, fx, fz, at: now, hit: now + (opt.flight ?? 2200), shot: false });
  }
  function boomAt(x, z, size = 1, yAt = null) {
    const y = yAt ?? groundAt(x, z), now = performance.now();
    effects.push({ kind: 'flash', x, y: y + 1, z, r: 4.5 * size, t0: now, dur: 900, big: true });
    for (let i = 0; i < Math.round(12 * size * boom); i++) puff(x + (Math.random() - 0.5) * 6, y + 1, z + (Math.random() - 0.5) * 6, 1.5 + Math.random() * 2.5, i % 3 ? 0x4a4540 : 0x6d665e);
    for (let i = 0; i < Math.round(16 * size); i++) chip(x, y + 0.5, z, i % 2 ? 0x5a4a36 : 0x6f6a60, 1.6);
    light(x, y + 4, z, 5 * size);
    jolt(x, z, 0.7 * size);
    tfx.scorch(x, z, 3.2 * size);
  }
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
    dayNow = day;
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
    lifeQ = q === 'fast' ? 0.35 : q === 'beautiful' ? 1 : 0.75;
    tfx.quality(q);
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
  let lifeData = null;       // data/life.json (profiles); liveliness on/off (switch old/new) and amount per quality
  let lifeOn = true, lifeQ = 0.75;
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
    // alpha of the ground texture = surface code for the ground shader (terrain_fx.js)
    const surf = m.grounds.map((id) => Math.max(0, SURFACES.indexOf(surfaceOf(id, terrains[id]))) * 32 + 16);
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
    // fine cells (06.11., Daniel: diagonal ramps and edges looked odd): ramps become a smooth slope and
    // inner corners of diagonal edges get a filled triangle, both in 0.4 m columns with 0.2 m steps.
    // Optics only: the simulation keeps its 2 m cells. fine: cell → 25 raw heights (row-major, sx + sy·5).
    const fine = smoothCells(m, top, water);
    // tops: one quad per cell, the 0.4 m voxel look comes from a texture (one texel per voxel column)
    const T = 5, tex = n * T;
    const data = new Uint8Array(tex * tex * 4);
    const hashf = (a, b) => ((Math.imul(a * 92837111 ^ b * 689287499, 2654435761) >>> 0) % 1000) / 1000;
    const c = new THREE.Color();
    // height per texel (fine columns where there are some) and ground per texel: diagonal borders between
    // two grounds on flat land get the same filled triangle as the edges, so roads and banks run straight
    const texH = (x, y) => {
      if (x < 0 || y < 0 || x >= tex || y >= tex) return -99;
      const i = Math.floor(x / T), j = Math.floor(y / T), f = fine.get(j * n + i);
      return f ? stepped(f[((y % T) * 2 + 1) * FINE + (x % T) * 2 + 1]) : top[j * n + i];
    };
    // ground of a column (lx, ly) of R × R in cell (i, j): a filled corner takes the higher neighbour's ground,
    // a flat diagonal border takes the other ground (only one side fills: the one with the lower ground index)
    const groundOf = (i, j, lx, ly, R = T) => {
      const k = j * n + i, own = m.ground[k], h = top[k];
      for (const [di, dj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const cx = di > 0 ? R - 1 : 0, cy = dj > 0 ? R - 1 : 0;
        if (Math.abs(lx - cx) + Math.abs(ly - cy) > R - 2) continue;
        const A = j * n + a, B = b * n + i, C = b * n + a, gA = m.ground[A];
        const rampAt = (q) => m.ramp[q] && !water[m.ground[q]];
        if (!rampAt(k) && !rampAt(A) && !rampAt(B) && top[A] > h + 0.1 && top[B] > h + 0.1 && top[C] > h + 0.1) return top[A] <= top[B] ? gA : m.ground[B];
        if (gA <= own || m.ground[B] !== gA || m.ground[C] !== gA) continue;
        if (Math.abs(top[A] - h) > 0.05 || Math.abs(top[B] - h) > 0.05 || Math.abs(top[C] - h) > 0.05) continue;
        return gA;
      }
      return own;
    };
    for (let y = 0; y < tex; y++) for (let x = 0; x < tex; x++) {
      const i = Math.floor(x / T), j = Math.floor(y / T), k = j * n + i;
      const lx = x % T, ly = y % T;
      const gi = groundOf(i, j, lx, ly), g = m.grounds[gi];
      let v = 0.9 + hashf(x, y) * 0.16;
      // darker ring at the foot of higher neighbours (soft contact shadow of cliffs)
      const h = texH(x, y);
      if (texH(x - 1, y) > h + 0.5 || texH(x + 1, y) > h + 0.5 || texH(x, y - 1) > h + 0.5 || texH(x, y + 1) > h + 0.5) v *= 0.72;
      if (g === 'forest') v *= 0.82;
      if (g === 'strasse' && (lx + ly * 3 + i) % 11 === 0) v *= 0.9;
      // the texture is sRGB: write the colour as authored, not three's linear working values
      const hx = hexes[gi], f = v * (1 + h * 0.02);
      const o = (y * tex + x) * 4;
      data[o] = Math.min(255, ((hx >> 16) & 255) * f); data[o + 1] = Math.min(255, ((hx >> 8) & 255) * f); data[o + 2] = Math.min(255, (hx & 255) * f); data[o + 3] = surf[gi];
    }
    const map = new THREE.DataTexture(data, tex, tex);
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.needsUpdate = true;
    const tp = [], tu = [], tn = [];
    const sc = cell / FINE;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = top[j * n + i], x0 = i * cell, z0 = j * cell, x1 = x0 + cell, z1 = z0 + cell;
      const f = fine.get(j * n + i);
      if (f) {
        // one quad per run of equal height in a row (uv is linear in the position, so runs map exactly)
        for (let sy = 0; sy < FINE; sy++) for (let sx = 0; sx < FINE;) {
          const y = stepped(f[sy * FINE + sx]);
          let ex = sx + 1;
          while (ex < FINE && stepped(f[sy * FINE + ex]) === y) ex++;
          const a = x0 + sx * sc, b = z0 + sy * sc, w = (ex - sx) * sc, u0 = (i + sx / FINE) / n, v0 = (j + sy / FINE) / n, u1 = (i + ex / FINE) / n, v1 = (j + (sy + 1) / FINE) / n;
          sx = ex;
          tp.push(a, y, b, a, y, b + sc, a + w, y, b + sc, a, y, b, a + w, y, b + sc, a + w, y, b);
          tu.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
          for (let q = 0; q < 6; q++) tn.push(0, 1, 0);
        }
        continue;
      }
      tp.push(x0, h, z0, x0, h, z1, x1, h, z1, x0, h, z0, x1, h, z1, x1, h, z0);
      tu.push(i / n, j / n, i / n, (j + 1) / n, (i + 1) / n, (j + 1) / n, i / n, j / n, (i + 1) / n, (j + 1) / n, (i + 1) / n, j / n);
      for (let q = 0; q < 6; q++) tn.push(0, 1, 0);
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    topGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
    fixWinding(topGeo);
    const topsMat = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    tfx.decorate(topsMat);
    const tops = new THREE.Mesh(topGeo, topsMat);
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
        if (fine.has(k) || (hn !== BASE && fine.has(b * n + a))) continue; // fine cells draw their own faces
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
    // faces of the fine columns: against each other and against coarse neighbours (both directions)
    const band = (x0, z0, x1, z1, lo, hi, nrm, baseHex, seed) => {
      // a step of one column: ground colour; higher: earth with a ground-coloured lip on top
      const lip = Math.max(lo, hi - FSTEP);
      if (lip > lo + 1e-4) { c.setHex(0x8c7a63).multiplyScalar(0.64 + hashf(seed, 3) * 0.1); quad([x0, lo, z0], [x0, lip, z0], [x1, lip, z1], [x1, lo, z1], nrm, c.r, c.g, c.b); }
      c.setHex(baseHex).multiplyScalar(0.7 + hashf(seed, 5) * 0.08);
      quad([x0, lip, z0], [x0, hi, z0], [x1, hi, z1], [x1, lip, z1], nrm, c.r, c.g, c.b);
    };
    const heightAt = (ci, cj, sx, sy) => {
      if (ci < 0 || cj < 0 || ci >= n || cj >= n) return BASE;
      const f = fine.get(cj * n + ci);
      return f ? stepped(f[sy * FINE + sx]) : top[cj * n + ci];
    };
    for (const [k, f] of fine) {
      const i = k % n, j = (k - i) / n;
      for (let sy = 0; sy < FINE; sy++) for (let sx = 0; sx < FINE; sx++) {
        const h = stepped(f[sy * FINE + sx]), a = i * cell + sx * sc, b = j * cell + sy * sc, baseHex = color[groundOf(i, j, sx, sy, FINE)].getHex();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nx = sx + dx, ny = sy + dy, ci = i, cj = j;
          if (nx < 0) { ci--; nx += FINE; } else if (nx >= FINE) { ci++; nx -= FINE; }
          if (ny < 0) { cj--; ny += FINE; } else if (ny >= FINE) { cj++; ny -= FINE; }
          const other = ci >= 0 && cj >= 0 && ci < n && cj < n ? cj * n + ci : -1;
          const hn = heightAt(ci, cj, nx, ny);
          const ex = dx > 0 ? a + sc : a, ez = dy > 0 ? b + sc : b;
          const [x0, z0, x1, z1] = dx !== 0 ? [ex, b, ex, b + sc] : [a, ez, a + sc, ez];
          if (hn < h) band(x0, z0, x1, z1, hn, h, [dx, 0, dy], baseHex, k + sx + sy * 7);
          else if (hn > h && other >= 0 && !fine.has(other)) band(x0, z0, x1, z1, h, hn, [-dx, 0, -dy], color[m.ground[other]].getHex(), other);
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

    // water surface over water cells (the old flat plane; terrain_fx.js draws the new water when it is on)
    let oldWater = null;
    const wp = [];
    for (let k = 0; k < n * n; k++) if (water[m.ground[k]]) {
      const i = k % n, j = (k - i) / n, y = -0.15;
      wp.push(i * cell, y, j * cell, i * cell, y, (j + 1) * cell, (i + 1) * cell, y, (j + 1) * cell, i * cell, y, j * cell, (i + 1) * cell, y, (j + 1) * cell, (i + 1) * cell, y, j * cell);
    }
    if (wp.length) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.computeVertexNormals();
      const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3f7fa6, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1 }));
      wm.receiveShadow = true;
      group.add(wm); oldWater = wm;
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
    world = { map: sim.map, group, top, fine, n, cell, size, climate: atm.climate };
    tfx.attach({ m, top, fine, groundAt, terrains, tex, cell, n, oldWater });
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
    const f = world.fine.get(j * world.n + i);
    if (f) {
      const sx = Math.max(0, Math.min(FINE - 1, Math.floor((x / world.cell - i) * FINE))), sy = Math.max(0, Math.min(FINE - 1, Math.floor((z / world.cell - j) * FINE)));
      return Math.max(-0.35, f[sy * FINE + sx]);
    }
    return Math.max(-0.35, world.top[j * world.n + i]);
  }

  // ---------- models ----------
  function sourceOf(sim, type, seat = null) {
    const t = sim.types[type];
    const key = t.building ? 'pad' : (t.model || (t.cls === 'infantry' ? 'soldat' : 'tank'));
    return app.swapModel?.(seat, key) || key;   // launcher: another model for one side (optics only)
  }
  function modelFor(key) {
    if (models[key]) return models[key];
    const def = modelSource?.[key] || null;
    const entry = { ready: false, pivot: null, hull: null, turret: null, scale: V, life: lifeOf(lifeData, def, key === 'pad' ? 'building' : null), variants: new Map() };
    models[key] = entry;
    const src = def?.source || (key === 'pad' ? 'prototype:pad' : `prototype:${key}`);
    if (src === 'prototype:pad') { entry.hull = landingPad(31); finish(entry, def); return entry; }
    if (src.startsWith('prototype:')) {
      const p = PROTOTYPES[src.slice(10)] || PROTOTYPES.tank;
      entry.hull = p.hull(); entry.turret = p.turret ? p.turret() : null; entry.pivot = p.pivot || null; entry.scale = p.scale || V; finish(entry, def);
    } else {
      // own .vox model (path relative to the project folder)
      const url = new URL(src, modelsBase).href;
      if (!voxCache.has(url)) voxCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => readVox(b, { forward: def?.forward || null }).model));
      voxCache.get(url).then((W) => { entry.hull = W; finish(entry, def); dropParts(key); })
        .catch(() => { const p = PROTOTYPES.tank; entry.hull = p.hull(); entry.turret = p.turret(); entry.pivot = p.pivot; finish(entry, def); dropParts(key); });
    }
    return entry;
  }
  // voxel size per model (models.json › scale, Daniel 05.11.), size for terrain tilt, muzzle for flash and smoke
  function finish(entry, def) {
    if (def?.scale) entry.scale = def.scale;
    const b = bounds(entry.hull), sc = entry.scale;
    entry.half = [(b.hi[0] - b.lo[0] + 1) * sc / 2, (b.hi[2] - b.lo[2] + 1) * sc / 2];
    entry.front = (b.hi[2] + 0.5) * sc; entry.back = (b.lo[2] - 0.5) * sc; entry.top = (b.hi[1] + 1) * sc;
    entry.muzzle = def?.muzzle ? def.muzzle.map((q) => q * sc) : muzzleOf(entry.turret || entry.hull, sc);
    entry.ready = true;
  }
  // model for a damage stage (0 = intact); cached per model
  function variant(e, which, stage) {
    const W = which === 'turret' ? e.turret : e.hull;
    if (!stage || !lifeOn) return { W, soot: null };
    const id = which + stage;
    if (!e.variants.has(id)) {
      const st = e.life.stages[stage - 1] || {};
      e.variants.set(id, { W: damagedModel(W, st, which === 'turret' ? 11 : 7), soot: sootAt((st.soot || 0) / 100, which === 'turret' ? 5 : 3) });
    }
    return e.variants.get(id);
  }
  function dropParts(key) { for (const [k, im] of parts) if (k.startsWith(key + '|')) { scene.remove(im); parts.delete(k); } }

  // one InstancedMesh per (model, part, colour, wreck?, damage stage); each with its own instance attribute
  // aLife (x = distance driven for running tracks, y = 1 if the model has tracks/wheels)
  const geoCache = new Map();
  function part(key, which, colour, wreck = false, stage = 0) {
    const id = `${key}|${which}|${colour}|${wreck ? 1 : 0}|${stage}`;
    let im = parts.get(id);
    if (im && im.userData.used < im.userData.cap) return im;
    const e = modelFor(key);
    if (!e.ready) return null;
    const v = variant(e, which, stage);
    if (!v.W) return null;
    const gk = `${key}|${which}|${colour}|${stage}`;
    if (!geoCache.has(gk)) geoCache.set(gk, voxelGeometry(v.W, { team: colour, scale: e.scale || V, soot: v.soot }));
    const cap = im ? im.userData.cap * 2 : 32;
    const base = geoCache.get(gk), g = new THREE.BufferGeometry();
    for (const [n, a] of Object.entries(base.attributes)) g.setAttribute(n, a);
    g.boundingSphere = base.boundingSphere;
    const lifeAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); lifeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLife', lifeAttr);
    const fresh = new THREE.InstancedMesh(g, wreck ? wreckMat : unitMat, cap);
    fresh.castShadow = true; fresh.receiveShadow = true; fresh.frustumCulled = false;
    fresh.userData.used = 0; fresh.userData.cap = cap; fresh.userData.life = lifeAttr;
    if (im) {
      for (let i = 0; i < im.userData.used; i++) { im.getMatrixAt(i, tmpM); fresh.setMatrixAt(i, tmpM); lifeAttr.setXY(i, im.userData.life.getX(i), im.userData.life.getY(i)); }
      fresh.userData.used = im.userData.used; scene.remove(im);
    }
    scene.add(fresh); parts.set(id, fresh);
    return fresh;
  }
  const tmpM = new THREE.Matrix4(), o3 = new THREE.Object3D();
  function put(im, x, y, z, yaw, extra = null, run = 0, runs = 0) {
    if (!im) return;
    o3.position.set(x, y, z); o3.rotation.set(0, yaw, 0, 'XYZ'); o3.scale.set(1, 1, 1);
    if (extra) extra(o3);
    o3.updateMatrix();
    putMatrix(im, o3.matrix, run, runs);
  }
  function putMatrix(im, m, run = 0, runs = 0) {
    if (!im) return;
    const i = im.userData.used++;
    im.setMatrixAt(i, m); im.userData.life.setXY(i, run, runs);
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
  // headlights at night (06.11.): the lamps glow in the vehicle shader; on the ground just a faint warm
  // patch in front of each vehicle (one additive quad, no real lights, no shadows)
  const beamTex = (() => {
    const w = 32, h = 64, d = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      const v = r / (h - 1), along = 1 - v, x = (q / (w - 1) - 0.5) * 2;
      const spread = 0.35 + along * 0.65;
      const a = Math.pow(v, 1.6) * Math.exp(-Math.pow(x / spread, 2) * 3) * Math.min(1, along * 8);
      const o = (r * w + q) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(d, w, h); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  })();
  const beamGeo = new THREE.PlaneGeometry(1, 1); beamGeo.rotateX(-Math.PI / 2); beamGeo.translate(0, 0, 0.5);
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: 0xffd8a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, 320); beams.frustumCulled = false; beams.count = 0; beams.renderOrder = 2; scene.add(beams);
  let lamps = 0;

  // ---------- events → effects ----------
  function drain(sim, skip) {
    const now = performance.now();
    if (skip || !shown) { sim.events.length = 0; return; }
    const me = meSeat();
    for (const e of sim.events) {
      if (e.kind === 'shot') {
        const airOf = (id) => { const q = sim.byId.get(id); return q && sim.types[q.type]?.air ? HOVER : 0; };
        const y0 = groundAt(e.x * M, e.y * M) + 1.6 + airOf(e.src), y1 = groundAt(e.tx * M, e.ty * M) + 0.8 + airOf(e.tgt);
        const sm = lifeOn ? smooth.get(e.src) : null;
        if (sm?.mz) {   // liveliness: the shot leaves the real muzzle; flash, smoke and recoil follow in lively()
          sm.shot = now; sm.fired = true; sm.firedP = e.projectile;
          effects.push({ kind: 'shot', p: e.projectile, x: sm.mz[0], y: sm.mz[1], z: sm.mz[2], tx: e.tx * M, ty: y1, tz: e.ty * M, t0: now, dur: Math.max(70, e.time * 50) });
        } else {
          effects.push({ kind: 'shot', p: e.projectile, x: e.x * M, y: y0, z: e.y * M, tx: e.tx * M, ty: y1, tz: e.ty * M, t0: now, dur: Math.max(70, e.time * 50) });
          if (e.projectile >= 2) effects.push({ kind: 'flash', x: e.x * M, y: y0, z: e.y * M, r: e.projectile === 3 ? 0.9 : 1.3, t0: now, dur: 110 });
        }
      } else if (e.kind === 'impact') {
        const x = e.x * M, z = e.y * M, y = groundAt(x, z);
        const big = e.splash > 0 || e.projectile === 2 || e.projectile === 3;
        const fr = (big ? Math.max(1.6, e.splash * M * 0.8) : 0.35) * (boom > 1 ? 1.3 : 1);
        effects.push({ kind: 'flash', x, y: y + 0.4, z, r: fr, t0: now, dur: big ? 320 * Math.min(1.5, boom) : 120 });
        towers.hit(x, z, big ? 6 : 1, e.x * M, e.y * M);
        if (big) tfx.scorch(x, z, Math.min(3.2, fr * 0.8));
        if (big) {
          for (let i = 0; i < Math.round(4 * boom); i++) puff(x, y + 0.5, z, 0.8 + Math.random() * 0.8 * boom, 0x6d665e);
          if (boom > 1) { for (let i = 0; i < 8; i++) chip(x, y + 0.3, z, Math.random() < 0.5 ? 0x5a4a36 : 0x6f5c42, 0.6); light(x, y + 2, z, 1.6); jolt(x, z, 0.25); }
        }
      } else if (e.kind === 'dead') {
        const t = sim.types[e.type];
        const x = e.x * M, z = e.y * M, y = groundAt(x, z) + (t?.air ? HOVER - 1 : 0);
        if (t?.air) { // a drone: small burst in the air, a few parts fall
          effects.push({ kind: 'flash', x, y: y + 1, z, r: 1.4, t0: now, dur: 420, big: true });
          for (let i = 0; i < 6; i++) chip(x, y + 1, z, 0x34342e, 0.8);
          puff(x, y + 1, z, 1.2, 0x3d3833); light(x, y + 1, z, 1.5);
          continue;
        }
        const r = t?.cls === 'infantry' ? 0.8 : t?.building ? 9 : 3.4;
        effects.push({ kind: 'flash', x, y: y + 1, z, r: r * (boom > 1 && t?.cls !== 'infantry' ? 1.5 : 1), t0: now, dur: (t?.building ? 1100 : 600) * Math.min(1.6, boom), big: true });
        for (let i = 0; i < Math.round((t?.cls === 'infantry' ? 2 : 14) * boom); i++) puff(x + (Math.random() - 0.5) * r, y + 1, z + (Math.random() - 0.5) * r, 1.2 + Math.random() * 1.6 * boom, 0x3d3833);
        light(x, y + 3, z, (t?.building ? 6 : 3) * boom);
        if (t?.cls !== 'infantry') { jolt(x, z, t?.building ? 1.2 : 0.6); towers.hit(x, z, t?.building ? 30 : 5); tfx.scorch(x, z, t?.building ? 7 : 2.6); }
        if (t && t.cls !== 'infantry') {
          const key = sourceOf(sim, e.type, e.seat);
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
  // ---------- liveliness (Fidelity step 2, 06.11.): everything from the model's profile in data/life.json ----------
  const hullM = new THREE.Matrix4(), turM = new THREE.Matrix4(), locM = new THREE.Matrix4(), mzV = new THREE.Vector3();
  const qY = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), oneV = new THREE.Vector3(1, 1, 1), posV = new THREE.Vector3();
  const rnd = (a) => (Math.random() - 0.5) * a;
  function groundInfo(sim, x, z) {
    const m = sim.map, i = Math.floor(x * 1000 / m.cell), j = Math.floor(z * 1000 / m.cell);
    if (i < 0 || j < 0 || i >= m.n || j >= m.n) return null;
    return sim.world.terrains?.[m.grounds[m.ground[j * m.n + i]]] || null;
  }
  const dustHex = new Map();
  function dustColour(t) {
    const c = t.dustColor || t.color || '#8a7a60';
    if (!dustHex.has(c)) dustHex.set(c, tmpC.set(c).lerp(cB.setHex(0xd8d0c0), t.dustColor ? 0 : 0.35).getHex());
    return dustHex.get(c);
  }
  function emit(n) {   // n per second → how many this frame (random rounding)
    const q = n; return Math.floor(q) + (Math.random() < q % 1 ? 1 : 0);
  }
  function lively(sim, u, ty, e, key, colour, s, wx, wz, dt, now) {
    const L = e.life, sc = e.scale || V;
    const stage = L.stages.length ? stageAt(L, Math.max(0, u.hp) / ty.hp) : 0;
    const DT = Math.max(dt, 1e-3);
    // motion: speed along the heading, acceleration, turning rate (from the smoothed positions)
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const dx = wx - (s.lx ?? wx), dz = wz - (s.lz ?? wz); s.lx = wx; s.lz = wz;
    const along = dx * fx + dz * fz, speed = Math.hypot(dx, dz) / DT;
    s.dist = (s.dist || 0) + along;
    const fwd = along / DT, vOld = s.v ?? fwd;
    s.v = vOld + (fwd - vOld) * Math.min(1, dt * 6);
    s.acc = (s.acc || 0) + ((s.v - vOld) / DT - (s.acc || 0)) * Math.min(1, dt * 4);
    s.turn = (s.turn || 0) + (angleStep(s.lyaw ?? s.yaw, s.yaw, 1) / DT - (s.turn || 0)) * Math.min(1, dt * 6); s.lyaw = s.yaw;
    let lift = 0, pt = 0, rl = 0;
    if (ty.air) {   // drones: lean into the flight (as before)
      s.tilt = (s.tilt || 0) + (Math.min(0.3, speed * 0.03) - (s.tilt || 0)) * (1 - Math.exp(-dt * 12));
      pt = s.tilt;
    } else if (L.drive !== 'none') {
      let tp = 0, tr = 0;
      if (L.tilt) {
        const f = e.half[1] * 0.85, w = e.half[0] * 0.85, hc = groundAt(wx, wz);
        // a sample on a ramp lies on a straight line through the half-way point; across a cliff edge it jumps → flat
        const probe = (ax, az, d) => {
          const hh = groundAt(wx + ax * d * 0.5, wz + az * d * 0.5), h = groundAt(wx + ax * d, wz + az * d);
          return Math.abs(hh - (hc + h) / 2) > 0.3 * Math.abs(h - hc) + 0.12 ? hc : h;
        };
        const hF = probe(fx, fz, f), hB = probe(-fx, -fz, f), hR = probe(fz, -fx, w), hL = probe(-fz, fx, w);
        const cap = 0.42; tp = Math.max(-cap, Math.min(cap, Math.atan2(hB - hF, 2 * f) * L.tilt / 100)); tr = Math.max(-cap, Math.min(cap, Math.atan2(hR - hL, 2 * w) * L.tilt / 100));
        lift = Math.max(0, (hF + hB) / 2 - hc) * L.tilt / 100;   // stays on top of a crest
      }
      const accP = -Math.max(-1, Math.min(1, s.acc / 4)) * L.pitch * DEG;
      const turnR = Math.max(-1, Math.min(1, s.turn * Math.abs(s.v) / 5)) * L.roll * DEG;
      if (s.shot && s.shot !== s.shotSeen) { s.shotSeen = s.shot; s.ptV = (s.ptV || 0) - L.kick * DEG * L.spring; }
      s.pt ??= tp; s.rl ??= tr;
      spring(s, 'pt', tp + accP, dt, L.spring, L.damping / 100);
      spring(s, 'rl', tr + turnR, dt, L.spring, L.damping / 100);
      pt = s.pt; rl = s.rl;
      if (L.bob) {
        if (L.drive === 'walk') lift += speed > 0.3 ? Math.abs(Math.sin(s.dist * Math.PI / 0.55)) * L.bob / 100 : 0;
        else if (speed > 0.5) lift += Math.sin(now * 0.06 + u.id) * L.bob / 100 * 0.6;
      }
    }
    // barrel / hull recoil
    const rc = s.shot ? recoilCurve(now - s.shot, L.recover) * L.barrel / 100 : 0;
    const runs = L.drive === 'track' || L.drive === 'wheel' ? 1 : 0;
    o3.position.set(wx, s.y + lift, wz); o3.rotation.set(pt, s.yaw, rl, 'YXZ'); o3.scale.set(1, 1, 1); o3.updateMatrix();
    hullM.copy(o3.matrix);
    if (!e.turret && rc) hullM.multiply(locM.makeTranslation(0, 0, -rc * 0.5));
    putMatrix(part(key, 'hull', colour, false, stage), hullM, s.dist, runs);
    let mzFrom = hullM;
    if (e.turret) {
      const tgt = u.tgt ? sim.byId.get(u.tgt) : null;
      const want = tgt ? Math.atan2(tgt.x * M - wx, tgt.y * M - wz) : s.yaw;
      s.tyaw += angleStep(s.tyaw, want, 1 - Math.exp(-dt * 5));
      const [px, py, pz] = e.pivot.map((q) => q * sc);
      qY.setFromAxisAngle(yAxis, s.tyaw - s.yaw);
      locM.compose(posV.set(px, py, pz), qY, oneV).multiply(turM.makeTranslation(0, 0, -rc));
      turM.multiplyMatrices(hullM, locM);
      putMatrix(part(key, 'turret', colour, false, stage), turM, 0, 0);
      mzFrom = turM;
    }
    // muzzle: flash, smoke, casings for each shot of this unit (queued in drain)
    mzV.set(...e.muzzle).applyMatrix4(mzFrom);
    s.mz = [mzV.x, mzV.y, mzV.z];
    if (s.fired) {
      const p = s.firedP, big = p === 2 || p === 3;
      const r = (big ? (p === 3 ? 0.9 : 1.3) : 0.32) * L.flash / 100;
      if (r > 0.05) effects.push({ kind: 'flash', x: mzV.x, y: mzV.y, z: mzV.z, r, t0: now, dur: big ? 120 : 70 });
      const dir = [Math.sin(s.tyaw ?? s.yaw), Math.cos(s.tyaw ?? s.yaw)];
      for (let i = 0; i < emit(L.smoke * (big ? 1 : 0.5) * lifeQ); i++)
        debris.push({ kind: 'smoke', x: mzV.x + dir[0] * 0.4, y: mzV.y, z: mzV.z + dir[1] * 0.4, vx: dir[0] * (1.5 + Math.random() * 2) + rnd(0.6), vy: 0.4 + Math.random() * 0.5, vz: dir[1] * (1.5 + Math.random() * 2) + rnd(0.6), s: (big ? 0.7 : 0.35) + Math.random() * 0.4, c: 0xb9b3a9, t0: now, dur: 900 + Math.random() * 700 });
      if (lifeQ > 0.5) for (let i = 0; i < Math.min(4, L.casings); i++) {
        const side = [dir[1], -dir[0]], v = 1.5 + Math.random() * 1.5;
        debris.push({ kind: 'chip', x: mzV.x - dir[0] * 0.6, y: mzV.y, z: mzV.z - dir[1] * 0.6, vx: side[0] * v + rnd(0.6), vy: 2 + Math.random() * 2, vz: side[1] * v + rnd(0.6), rx: 9, c: 0xd2a843, t0: now, dur: 900, sc: 0.22 });
      }
      s.fired = false;
    }
    // dust behind the vehicle (ground decides how much and which colour) and exhaust
    if (!ty.air && speed > 0.6 && L.dust) {
      const t = groundInfo(sim, wx, wz);
      const amount = (t?.dust ?? 0) / 100 * L.dust / 100 * Math.min(1, speed / 6) * 10 * lifeQ;
      for (let i = 0, n = emit(amount); i < n; i++) {
        const back = e.back * 0.9, side = rnd(e.half[0] * 1.6);
        const x = wx + fx * back + fz * side, z = wz + fz * back - fx * side;
        debris.push({ kind: 'smoke', x, y: groundAt(x, z) + 0.25, z, vx: -fx * speed * 0.15 + rnd(0.8), vy: 0.35 + Math.random() * 0.5, vz: -fz * speed * 0.15 + rnd(0.8), s: L.dustSize * (0.6 + Math.random() * 0.6), c: dustColour(t), t0: now, dur: 1000 + Math.random() * 900 });
      }
    }
    if (L.exhaust && !ty.air) {
      const rate = L.exhaust / 100 * (speed > 0.3 ? 2.2 + Math.max(0, Math.min(6, s.acc * 1.5)) : 0.6) * lifeQ;
      for (let i = 0, n = emit(rate * dt); i < n; i++) {
        mzV.set(e.half[0] * 0.5, e.top * 0.75, e.back + 0.1).applyMatrix4(hullM);
        debris.push({ kind: 'smoke', x: mzV.x, y: mzV.y, z: mzV.z, vx: -fx * 0.6 + rnd(0.3), vy: 0.9 + Math.random() * 0.5, vz: -fz * 0.6 + rnd(0.3), s: 0.28 + Math.random() * 0.2, c: 0x4f4c48, t0: now, dur: 900 + Math.random() * 500 });
      }
    }
    // damage: smoke and fire from the stage
    const st = stage ? L.stages[stage - 1] : null;
    if (st && (st.smoke || st.fire)) {
      const top = s.y + lift + (ty.air ? 0.3 : e.top * 0.85);
      for (let i = 0, n = emit((st.smoke || 0) * lifeQ * dt); i < n; i++)
        debris.push({ kind: 'smoke', x: wx + rnd(e.half[0]), y: top, z: wz + rnd(e.half[1]), vx: rnd(0.5), vy: 1.3 + Math.random(), vz: rnd(0.5), s: (ty.building ? 1.4 : 0.6) + Math.random() * 0.7, c: Math.random() < 0.5 ? 0x2b2826 : 0x3a3633, t0: now, dur: 1800 + Math.random() * 1400 });
      for (let i = 0, n = emit((st.fire || 0) * lifeQ * dt); i < n; i++) {
        const x = wx + rnd(e.half[0] * 1.2), z = wz + rnd(e.half[1] * 1.2);
        effects.push({ kind: 'flash', x, y: top, z, r: (ty.building ? 0.9 : 0.45) + Math.random() * 0.4, t0: now, dur: 240 + Math.random() * 200, big: true });
        debris.push({ kind: 'smoke', x, y: top + 0.3, z, vx: 0, vy: 2, vz: 0, s: 0.4, c: 0xff8a3a, t0: now, dur: 350 });
      }
    }
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
    if (towersOf !== sim) { towers.build(sim.map.props || [], sim.map.size); towersOf = sim; strikes = []; }
    for (const k of strikes) {
      if (!k.shot && now >= k.at) { k.shot = true; effects.push({ kind: 'shot', p: 3, x: k.fx, y: groundAt(k.fx, k.fz) + 30, z: k.fz, tx: k.x, ty: k.y ?? groundAt(k.x, k.z) + 1, tz: k.z, t0: now, dur: k.hit - k.at }); }
      if (now >= k.hit) {
        k.done = true; boomAt(k.x, k.z, k.size, k.y);
        towers.hitAt(k.x, k.y ?? groundAt(k.x, k.z) + 1.5, k.z, k.radius, [k.fx, k.fz]);
        api3d.onStrike?.(k.x, k.z, k.size);
      }
    }
    strikes = strikes.filter((k) => !k.done);
    towers.update(dt, now, atm.on ? 1 - dayNow : 0);
    { const night = atm.on ? 1 - dayNow : 0, t2 = Math.max(0, Math.min(1, (night - 0.3) / 0.45)); lamps = t2 * t2 * (3 - 2 * t2); }
    unitMat.userData.night.value = lamps; beamMat.opacity = lamps * 0.26;
    tfx.update(dt, now, { camDist: cam.dist, night: lamps, sky: now3.sky, wet: atm.on ? ({ rain: 1, storm: 1, snow: 0.25 }[atm.weather] || 0) : 0 });
    let beamN = 0;
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
      const key = sourceOf(sim, u.type, u.seat);
      const colour = colours[u.seat] ?? 0x999999;
      let s = smooth.get(u.id);
      const yaw = ty.building ? 0 : yawOf(u.h);
      const lift = ty.air ? HOVER + Math.sin(now / 420 + u.id) * 0.25 : 0;
      if (!s) { s = { y: groundAt(wx, wz) + lift, yaw, tyaw: yaw, px: wx, pz: wz, tilt: 0 }; smooth.set(u.id, s); }
      seen.add(u.id);
      s.y += (groundAt(wx, wz) + lift - s.y) * k;
      s.yaw += angleStep(s.yaw, yaw, k);
      const e = modelFor(key);
      if (lifeOn && e.ready) { lively(sim, u, ty, e, key, colour, s, wx, wz, dt, now); }
      else {   // switch „old“: exactly the look from before
        if (ty.air) { // lean into the flight a little
          const v = Math.hypot(wx - s.px, wz - s.pz) / Math.max(dt, 1e-3);
          s.tilt += (Math.min(0.3, v * 0.03) - s.tilt) * k; s.px = wx; s.pz = wz;
          put(part(key, 'hull', colour), wx, s.y, wz, s.yaw, (o) => { o.rotation.set(s.tilt, s.yaw, 0, 'YXZ'); });
        } else put(part(key, 'hull', colour), wx, s.y, wz, s.yaw);
        if (e.turret) {
          const tgt = u.tgt ? sim.byId.get(u.tgt) : null;
          const want = tgt ? Math.atan2(tgt.x * M - wx, tgt.y * M - wz) : s.yaw;
          s.tyaw += angleStep(s.tyaw, want, 1 - Math.exp(-dt * 5));
          const [px, py, pz] = e.pivot.map((q) => q * (e.scale || V));
          const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
          put(part(key, 'turret', colour), wx + px * cs + pz * sn, s.y + py, wz - px * sn + pz * cs, s.tyaw);
        }
      }
      if (!ty.building && !ty.air && e.ready) tfx.move(u.id, wx, wz, s.yaw, e.life?.drive || (ty.cls === 'infantry' ? 'walk' : 'track'), e.half, now);
      if (lamps > 0.02 && !ty.building && !ty.air && ty.cls !== 'infantry' && beamN < 320) {
        const f = (ty.body + ty.core) * M - 0.4;
        o3.position.set(wx + Math.sin(s.yaw) * f, s.y + 0.12, wz + Math.cos(s.yaw) * f); o3.rotation.set(0, s.yaw, 0, 'XYZ'); o3.scale.set(4.6, 1, 11);
        o3.updateMatrix(); beams.setMatrixAt(beamN++, o3.matrix);
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
    beams.count = beamN; beams.instanceMatrix.needsUpdate = true;

    // wrecks: dark, sinking slowly at the end
    for (const w of wrecks) {
      const age = (now - w.t0) / 1000, sink = age > 25 ? (age - 25) * 0.5 : 0;
      const ws = lifeOn ? (models[w.key]?.life?.stages.length || 0) : 0;
      put(part(w.key, 'hull', w.colour, true, ws), w.x, w.y - sink - (w.building ? 0.2 : 0), w.z, w.yaw, w.building ? null : (o) => { o.rotation.z = 0.06; });
      const e = models[w.key];
      if (e?.turret) put(part(w.key, 'turret', w.colour, true, ws), w.x + 0.8, w.y - sink + 0.2, w.z - 0.5, w.yaw + 0.9, (o) => { o.rotation.z = 0.5; });
    }
    for (const im of parts.values()) { im.count = im.userData.used; im.instanceMatrix.needsUpdate = true; im.userData.life.needsUpdate = true; }

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
        o3.position.set(b.x, b.y - (q > 0.8 ? (q - 0.8) * 2 : 0), b.z); o3.rotation.set(b.rx * q, b.rx * 0.7 * q, 0); o3.scale.setScalar(b.sc || 1); o3.updateMatrix();
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
  function setModels(src, life = lifeData) { modelSource = src || {}; lifeData = life || null; models = {}; for (const im of parts.values()) scene.remove(im); parts.clear(); geoCache.clear(); }
  // switch old/new for the liveliness (Fidelity step 2); without argument: current state
  // for tests: what the liveliness is doing right now
  function lifeStats() {
    const r = { on: lifeOn, maxTilt: 0, stages: 0, meshes: 0, tilted: 0, recoiling: 0, moving: 0, smoke: 0, chips: 0, casings: 0 };
    for (const [id, im] of parts) { r.meshes++; if (!id.endsWith('|0') && im.userData.used) r.stages += im.userData.used; }
    for (const s of smooth.values()) { if (Math.abs(s.pt || 0) + Math.abs(s.rl || 0) > 0.02) r.tilted++; r.maxTilt = Math.max(r.maxTilt, Math.round(Math.max(Math.abs(s.pt || 0), Math.abs(s.rl || 0)) * 57.3)); if (s.shot && performance.now() - s.shot < 400) r.recoiling++; if ((s.dist || 0) > 1) r.moving++; }
    for (const b of debris) { if (b.kind === 'smoke') r.smoke++; else if (b.sc) r.casings++; else r.chips++; }
    return r;
  }
  function lively_(on) { if (on != null && !!on !== lifeOn) { lifeOn = !!on; for (const im of parts.values()) scene.remove(im); parts.clear(); } return lifeOn; }
  function show(on) { shown = on; if (!on) canvas.style.display = 'none'; }
  // switch old/new for the lively ground (Fidelity step 3); without argument: current state
  function terrain(on) { if (on != null) { tfx.set(on); towers.surface(on); } return tfx.isOn(); }

  return { draw, drain, reset, project, unproject, pixelsPerMm, pan, zoom, rotate, centreOn, home, show, setModels, kind: '3d', renderer,
    scene, camera, projectWorld, target, groundAt, inset, yawOf, atmosphere, quality, cam, excite, imageFx, towers, strike, hooks: api3d, life: lively_, lifeStats,
    terrain, terrainStats: () => tfx.stats(), terrainFx: tfx };
}
