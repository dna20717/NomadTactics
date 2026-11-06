// NomadTactics – lively ground (Fidelity step 3, 06.11.): tracks in the ground, scattered objects, water, surface shader.
// Optics only: the simulation never sees any of this (it keeps its 2 m cells and ground ids).
// Everything is driven by data in data/world.json › terrains: `surface` (which pattern the ground shader paints)
// and `scatter` (how many tufts, stones, fences, lamps and wrecks stand on that ground, in % of the cells).
//
// Used by battle_3d.js:
//   const tfx = createTerrainFx(THREE, scene)
//   tfx.decorate(topsMaterial)            ground shader (patterns per surface, tracks, soot, rain)
//   tfx.attach(info)                      after a world was built: scatter, water, marks texture
//   tfx.move(id, x, z, yaw, drive, half)  every frame per ground unit: tracks, crushing, bow waves
//   tfx.scorch(x, z, r)                   impacts and wrecks blacken the ground
//   tfx.update(dt, now, { night, sky, wet, weather })
//   tfx.set(on) / tfx.quality(q) / tfx.stats()

// surfaces the ground shader knows (index = code in the alpha channel of the ground texture) and the scattered
// objects (% of the cells of a ground that get one; lamps and fences only at road edges) live with the world rules
import { SURFACES, SURFACE_NAMES, SCATTER, SCATTER_NAMES } from '../../engine/tactics/world.js';
export { SURFACES, SURFACE_NAMES, SCATTER, SCATTER_NAMES };
// fallback for grounds without data (older world.json)
const FALLBACK = {
  grass: { surface: 'grass', scatter: { tufts: 60, stones: 3, fences: 35 } },
  sand: { surface: 'sand', scatter: { stones: 10, tufts: 5 } },
  schlamm: { surface: 'mud', scatter: { tufts: 8, stones: 2 } },
  forest: { surface: 'forest', scatter: { tufts: 35, stones: 6 } },
  rubble: { surface: 'rubble', scatter: { stones: 35, wrecks: 6 } },
  strasse: { surface: 'asphalt', scatter: { lamps: 30, wrecks: 1 } },
  bebaut: { surface: 'asphalt' },
  furt: { surface: 'sand' },
};
export function surfaceOf(id, t) { return t?.surface || FALLBACK[id]?.surface || 'none'; }
export function scatterOf(id, t) { return t?.scatter || FALLBACK[id]?.scatter || {}; }

const WATER_Y = -0.15;
const hashf = (a, b) => ((Math.imul(a * 92837111 ^ b * 689287499, 2654435761) >>> 0) % 100000) / 100000;

export function createTerrainFx(THREE, scene) {
  let on = true, amount = 0.75, info = null;
  const uni = {
    uOn: { value: 1 }, uWet: { value: 0 }, uTexSize: { value: 1 }, uMarks: { value: null },
    uTime: { value: 0 }, uSky: { value: new THREE.Color(0xd6e4e8) }, uNight: { value: 0 },
  };
  const group = new THREE.Group(); scene.add(group);   // scatter + water + wakes (rebuilt per world)
  let marks = null, marksData = null, mtex = 0, dirty = false, lastUpload = 0, fadeRow = 0, fadeT = 0;
  const lastPos = new Map();   // unit id → [x, z] (tracks are stamped along the way)
  let crushGrid = new Map(), meshes = {}, waterMesh = null, oldWater = null, lampHeads = null, lampPools = null;
  const wakes = []; let wakeMesh = null;
  const stats = { tufts: 0, stones: 0, fences: 0, lamps: 0, wrecks: 0, crushed: 0, stamps: 0, scorches: 0, wakes: 0, waterCells: 0 };

  // ---------- ground shader ----------
  const GLSL_HEAD = /* glsl */`
uniform sampler2D uMarks; uniform float uOn, uWet, uTexSize;
float tH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tH(i), tH(i + vec2(1.0, 0.0)), f.x), mix(tH(i + vec2(0.0, 1.0)), tH(i + vec2(1.0, 1.0)), f.x), f.y); }
float crackOf(vec2 p) { vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y));
    vec2 r = g + vec2(tH(i + g), tH(i + g + 17.3)) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return sqrt(d2) - sqrt(d1); }
`;
  const GLSL_BODY = /* glsl */`
float tGloss = 0.0;
#ifdef USE_MAP
if (uOn > 0.5) {
  vec2 tc = vMapUv * uTexSize;                       // one unit = one 0.4 m voxel column
  float detail = 1.0 - smoothstep(0.35, 1.1, max(fwidth(tc.x), fwidth(tc.y)));
  float kind = floor(sampledDiffuseColor.a * 255.0 / 32.0 + 0.02);
  vec3 c = diffuseColor.rgb; float v = 1.0;
  if (kind == 1.0) {                                  // grass: blades in 0.1 m, light tips, soft patches
    float b = tH(floor(tc * 4.0)); v = 0.9 + b * 0.2;
    c = mix(c, c * vec3(1.15, 1.1, 0.62), step(0.9, b) * 0.6);
    c *= 0.92 + 0.14 * vN(tc * 0.35);
  } else if (kind == 2.0) {                           // asphalt: grain, cracks, patches
    v = 0.95 + tH(floor(tc * 6.0)) * 0.08;
    float cr = 1.0 - smoothstep(0.0, 0.035, crackOf(tc * 0.32));
    v *= 1.0 - cr * 0.42 * smoothstep(0.64, 0.78, vN(tc * 0.09 + 7.0));
    v *= 1.0 - 0.07 * step(0.84, tH(floor(tc / 5.0)));
  } else if (kind == 3.0) {                           // sand: wind ripples and grains
    v = 0.95 + 0.06 * sin(tc.x * 1.7 + tc.y * 0.6 + vN(tc * 0.3) * 4.0) + (tH(floor(tc * 5.0)) - 0.5) * 0.07;
  } else if (kind == 4.0) {                           // mud: puddles (dark, glossy)
    float pd = smoothstep(0.66, 0.72, vN(tc * 0.45 + 4.0));
    v = 0.92 + tH(floor(tc * 3.0)) * 0.1;
    c = mix(c, c * vec3(0.62, 0.66, 0.74), pd * 0.6); tGloss = pd;
  } else if (kind == 5.0) {                           // rubble: chunky stones
    float b = tH(floor(tc * 2.5)); v = 0.74 + b * 0.42;
    c = mix(c, vec3(0.42, 0.38, 0.34), step(0.86, b) * 0.35);
  } else if (kind == 6.0) {                           // forest floor: leaf litter
    float b = tH(floor(tc * 4.0)); v = 0.86 + b * 0.2;
    c = mix(c, vec3(0.3, 0.17, 0.06), step(0.85, b) * 0.55);
  }
  c = mix(diffuseColor.rgb, c * v, detail);
  vec4 mk = texture2D(uMarks, vMapUv);
  c = mix(c, c * vec3(0.5, 0.42, 0.32), mk.r);                   // tracks: pressed, darker earth
  c = mix(c, c * vec3(0.82, 0.78, 0.7), mk.b * 0.75);            // trodden paths
  float soot = mk.g * (0.7 + 0.3 * tH(floor(tc * 2.0)));
  c = mix(c, vec3(0.03, 0.027, 0.025), soot);                     // scorch marks
  c *= 1.0 - uWet * 0.22;                                         // rain makes everything darker …
  tGloss = max(tGloss, uWet * (kind == 4.0 || kind == 2.0 ? 0.85 : 0.35));   // … and wet
  diffuseColor.rgb = c;
}
diffuseColor.a = 1.0;
#endif
`;
  function decorate(mat) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_HEAD)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + GLSL_BODY)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, tGloss);');
    };
    mat.customProgramCacheKey = () => 'nt-ground';
    mat.needsUpdate = true;
  }

  // ---------- after a world was built ----------
  // info: { m, top, fine, groundAt, terrains, tex, cell, n, water (per ground index: flat|deep|null), oldWater }
  function attach(i) {
    info = i;
    clear();
    const { tex } = i;
    uni.uTexSize.value = tex;
    if (mtex !== tex) {
      marks?.dispose();
      mtex = tex; marksData = new Uint8Array(tex * tex * 4);
      for (let o = 3; o < marksData.length; o += 4) marksData[o] = 255;   // alpha 255: no premultiplying anywhere
      marks = new THREE.DataTexture(marksData, tex, tex);
      marks.magFilter = THREE.NearestFilter; marks.minFilter = THREE.LinearFilter; marks.generateMipmaps = false;
    } else for (let o = 0; o < marksData.length; o++) marksData[o] = (o & 3) === 3 ? 255 : 0;
    marks.needsUpdate = true; uni.uMarks.value = marks;
    oldWater = i.oldWater || null;
    buildScatter(); buildWater();
    set(on);
  }
  function clear() {
    for (const o of [...group.children]) { group.remove(o); o.geometry?.dispose?.(); }
    crushGrid = new Map(); meshes = {}; waterMesh = null; lampHeads = null; lampPools = null; wakeMesh = null; wakes.length = 0; lastPos.clear();
    for (const k of Object.keys(stats)) stats[k] = 0;
  }

  // ---------- scattered objects (instanced; placed by hash, so every load looks the same) ----------
  // small voxel-ish shapes from boxes with vertex colours (white = take the instance colour)
  function boxes(list) {
    const pos = [], nor = [], col = [];
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (const [x, y, z, w, h, d, hex = 0xffffff, skipBottom = true] of list) {
      const c = new THREE.Color(hex);
      for (let q = 0; q < P.length; q += 3) {
        if (skipBottom && N[q + 1] < -0.5) continue;
        pos.push(x + P[q] * w, y + (P[q + 1] + 0.5) * h, z + P[q + 2] * d); nor.push(N[q], N[q + 1], N[q + 2]);
        const sh = N[q + 1] > 0.5 ? 1 : 0.8;
        col.push(c.r * sh, c.g * sh, c.b * sh);
      }
    }
    g.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  const GEO = {
    tufts: () => boxes([[0, 0, 0, 0.1, 0.55, 0.1], [0.13, 0, 0.05, 0.09, 0.4, 0.09], [-0.1, 0, 0.1, 0.09, 0.45, 0.09], [0.03, 0, -0.13, 0.09, 0.34, 0.09], [-0.08, 0, -0.07, 0.08, 0.28, 0.08], [0.12, 0, -0.1, 0.08, 0.24, 0.08]]),
    stones: () => boxes([[0, 0, 0, 0.42, 0.24, 0.34], [0.1, 0.18, 0.04, 0.24, 0.12, 0.2]]),
    fences: () => boxes([[-0.95, 0, 0, 0.12, 1.05, 0.12, 0x6b5136], [0, 0, 0, 0.12, 1.05, 0.12, 0x6b5136], [0.95, 0, 0, 0.12, 1.05, 0.12, 0x6b5136],
      [0, 0.38, 0, 2.0, 0.09, 0.06, 0x8a6a46], [0, 0.78, 0, 2.0, 0.09, 0.06, 0x8a6a46]]),
    lamps: () => boxes([[0, 0, 0, 0.36, 0.3, 0.36, 0x3c3f44], [0, 0.3, 0, 0.16, 4.6, 0.16, 0x4a4e55], [0, 4.82, 0.45, 0.12, 0.12, 0.9, 0x4a4e55], [0, 4.62, 0.86, 0.34, 0.22, 0.4, 0x2e3136]]),
    wrecks: () => boxes([[0, 0.2, 0, 1.7, 0.75, 3.8, 0x5b4636], [0, 0.95, -0.2, 1.5, 0.55, 1.9, 0x40352d], [0, 0.95, 0.85, 1.4, 0.45, 0.3, 0x2a2b2e],
      [-0.86, 0, 1.2, 0.2, 0.5, 0.55, 0x1f1f1f], [0.86, 0, 1.2, 0.2, 0.5, 0.55, 0x1f1f1f], [-0.86, 0, -1.25, 0.2, 0.5, 0.55, 0x1f1f1f], [0.86, 0, -1.25, 0.2, 0.5, 0.55, 0x1f1f1f]]),
  };
  const SHADOW = { tufts: false, stones: false, fences: true, lamps: true, wrecks: true };
  const scatterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const wreckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 });
  const o3 = new THREE.Object3D(), tmpC = new THREE.Color(), TUFT = new THREE.Color(0xb7c95a);

  function buildScatter() {
    const { m, terrains, cell, n, groundAt } = info, cm = cell;
    const ids = m.grounds;
    const isRoad = (k) => surfaceOf(ids[m.ground[k]], terrains[ids[m.ground[k]]]) === 'asphalt' && ids[m.ground[k]] !== 'bebaut';
    const wet = (k) => !!terrains[ids[m.ground[k]]]?.water;
    const blocked = (k) => ids[m.ground[k]] === 'bebaut' || wet(k) || m.ramp[k];
    const lists = { tufts: [], stones: [], fences: [], lamps: [], wrecks: [] };
    const share = amount >= 1 ? 1 : amount > 0.5 ? 0.55 : 0.18;   // fewer tufts and stones on weaker devices
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, id = ids[m.ground[k]], t = terrains[id], sc = scatterOf(id, t);
      if (blocked(k)) continue;
      // road edge: a neighbour that is no road (lamps stand on the road side, fences on the other)
      let edge = null, fenceEdge = null;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const q = b * n + a;
        if (isRoad(k) && !isRoad(q) && !wet(q)) edge = [di, dj];
        if (!isRoad(k) && isRoad(q)) fenceEdge = [di, dj];
      }
      const roll = (what, salt) => (sc[what] || 0) > 0 && hashf(k, salt) * 100 < sc[what];
      if (roll('tufts', 11) && hashf(k, 12) < share) for (let q = 0, c = 1 + Math.floor(hashf(k, 13) * 3); q < c; q++)
        lists.tufts.push({ x: (i + 0.1 + hashf(k, 20 + q) * 0.8) * cm, z: (j + 0.1 + hashf(k, 30 + q) * 0.8) * cm, yaw: hashf(k, 40 + q) * 6.28, s: 0.8 + hashf(k, 50 + q) * 0.6, c: t?.color || '#6f9a4a', lift: 1.25 });
      if (roll('stones', 14) && hashf(k, 15) < Math.max(share, 0.5))
        lists.stones.push({ x: (i + 0.2 + hashf(k, 16) * 0.6) * cm, z: (j + 0.2 + hashf(k, 17) * 0.6) * cm, yaw: hashf(k, 18) * 6.28, s: 0.6 + hashf(k, 19) * 1.1, c: hashf(k, 21) < 0.5 ? '#8a857c' : '#6e675d' });
      if (fenceEdge && roll('fences', 22)) {
        const [di, dj] = fenceEdge;   // along the edge facing the road, set back 0.4 m
        lists.fences.push({ x: (i + 0.5 + di * 0.3) * cm, z: (j + 0.5 + dj * 0.3) * cm, yaw: di ? Math.PI / 2 : 0, s: 1, c: '#ffffff', tilt: (hashf(k, 23) - 0.5) * 0.12 });
      }
      if (edge && roll('lamps', 24) && (i * 7 + j * 13) % 3 === 0) {
        const [di, dj] = edge;   // at the outer edge of the road, the arm reaches over the road
        lists.lamps.push({ x: (i + 0.5 + di * 0.38) * cm, z: (j + 0.5 + dj * 0.38) * cm, yaw: Math.atan2(-di, -dj), s: 1, c: '#ffffff' });
      }
      if (roll('wrecks', 25)) lists.wrecks.push({ x: (i + 0.5) * cm, z: (j + 0.5) * cm, yaw: hashf(k, 26) * 6.28, s: 1, c: '#ffffff', tilt: (hashf(k, 27) - 0.5) * 0.15 });
    }
    // lamps: keep a little distance from each other (a row every ~8 m reads as a street)
    lists.lamps = spaced(lists.lamps, 7.5); lists.wrecks = spaced(lists.wrecks, 12);
    for (const what of SCATTER) {
      const L = lists[what]; stats[what] = L.length;
      if (!L.length) continue;
      const im = new THREE.InstancedMesh(GEO[what](), what === 'wrecks' ? wreckMat : scatterMat, L.length);
      im.castShadow = SHADOW[what]; im.receiveShadow = true;
      L.forEach((it, idx) => {
        it.y = groundAt(it.x, it.z); it.mesh = im; it.idx = idx; it.kind = what; it.crushed = 0;
        place(it);
        tmpC.set(it.c); if (what === 'tufts') tmpC.lerp(TUFT, 0.15 + hashf(idx, 4) * 0.3).multiplyScalar(it.lift * (0.95 + hashf(idx, 3) * 0.3)); im.setColorAt(idx, tmpC);
        const key = Math.floor(it.x / cm) + Math.floor(it.z / cm) * n;
        if (!crushGrid.has(key)) crushGrid.set(key, []);
        crushGrid.get(key).push(it);
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      meshes[what] = im; group.add(im);
    }
    // lamp heads glow at night (bloom picks them up), with a warm pool of light on the road below
    if (lists.lamps.length) {
      const head = new THREE.BoxGeometry(0.3, 0.08, 0.36);
      lampHeads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: 0x222222 }), lists.lamps.length);
      const poolTex = radialTexture();
      lampPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc88a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), lists.lamps.length);
      lampPools.renderOrder = 2;
      lists.lamps.forEach((it, idx) => { it.head = idx; place(it); });
      group.add(lampHeads, lampPools);
    }
  }
  function spaced(list, d) {
    const out = [];
    for (const it of list) if (!out.some((o) => Math.abs(o.x - it.x) < d && Math.abs(o.z - it.z) < d)) out.push(it);
    return out;
  }
  function radialTexture() {
    const s = 64, d = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const r = Math.hypot(x - s / 2 + 0.5, y - s / 2 + 0.5) / (s / 2), a = Math.max(0, 1 - r) ** 2;
      const o = (y * s + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(d, s, s); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  // matrix of one item: standing, or crushed (flat on the ground, fallen over, pressed in)
  function place(it) {
    const c = it.crushed;
    o3.position.set(it.x, it.y, it.z);
    o3.rotation.set(it.tilt || 0, it.yaw, 0, 'YXZ');
    o3.scale.setScalar(it.s);
    if (c) {
      if (it.kind === 'tufts') o3.scale.set(it.s * 1.3, it.s * 0.18, it.s * 1.3);
      else if (it.kind === 'stones') { o3.scale.set(it.s, it.s * 0.4, it.s); o3.position.y -= 0.06; }
      else if (it.kind === 'fences') { o3.rotation.set(1.45 * it.side, it.yaw, 0, 'YXZ'); o3.position.y += 0.06; }
      else if (it.kind === 'lamps') o3.rotation.set(1.5 * it.side, it.yaw, 0.2, 'YXZ');
      else if (it.kind === 'wrecks') o3.scale.set(it.s * 1.05, it.s * 0.38, it.s * 1.04);
    }
    o3.updateMatrix(); it.mesh.setMatrixAt(it.idx, o3.matrix);
    if (it.head != null) placeHead(it);
  }
  function placeHead(it) {   // right after place(it): o3 still holds the pole's matrix
    const m = o3.matrix.clone();
    const local = new THREE.Matrix4().makeTranslation(0, 4.52, 0.86);
    lampHeads.setMatrixAt(it.head, m.multiply(local));
    lampHeads.instanceMatrix.needsUpdate = true;
    o3.position.set(it.x + Math.sin(it.yaw) * 0.86 * (it.crushed ? 0 : 1), it.y + 0.08, it.z + Math.cos(it.yaw) * 0.86 * (it.crushed ? 0 : 1));
    o3.rotation.set(0, 0, 0); o3.scale.setScalar(it.crushed ? 0.001 : 9); o3.updateMatrix();
    lampPools.setMatrixAt(it.head, o3.matrix); lampPools.instanceMatrix.needsUpdate = true;
  }
  // a vehicle runs over everything within r (m): tufts and stones are pressed flat, fences and lamps fall over
  function crush(x, z, r, fx, fz) {
    if (!info) return;
    const cm = info.cell, n = info.n, i0 = Math.floor((x - r) / cm), i1 = Math.floor((x + r) / cm), j0 = Math.floor((z - r) / cm), j1 = Math.floor((z + r) / cm);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const L = crushGrid.get(i + j * n); if (!L) continue;
      for (const it of L) {
        if (it.crushed) continue;
        const pad = it.kind === 'wrecks' ? 1.4 : it.kind === 'fences' ? 0.9 : 0.2;
        if (Math.abs(it.x - x) > r + pad || Math.abs(it.z - z) > r + pad) continue;
        it.crushed = 1;
        // fall away from the vehicle (along its direction of travel)
        it.side = (Math.cos(it.yaw) * fz + Math.sin(it.yaw) * fx) >= 0 ? 1 : -1;
        place(it); it.mesh.instanceMatrix.needsUpdate = true;
        stats.crushed++;
        if (it.kind === 'lamps' && lampHeads) lampHeads.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------- water: waves, sky reflection, foam at the banks, depth tint ----------
  function buildWater() {
    const { m, terrains, cell, n } = info;
    const water = m.grounds.map((id) => terrains[id]?.water || null);
    const isW = (i, j) => i >= 0 && j >= 0 && i < n && j < n && !!water[m.ground[j * n + i]];
    const deepAt = (i, j) => i >= 0 && j >= 0 && i < n && j < n && water[m.ground[j * n + i]] === 'deep';
    // per corner: foam if one of the four cells around it is land; depth = share of deep cells around it
    const corner = (ci, cj) => {
      let land = 0, deep = 0;
      for (const [a, b] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) { if (!isW(a, b)) land++; if (deepAt(a, b)) deep++; }
      return [land ? 1 : 0, deep / 4];
    };
    const pos = [], shore = [], depth = [];
    const S = 2;   // 2 × 2 quads per cell, so the foam band is about 1 m wide
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!isW(i, j)) continue;
      stats.waterCells++;
      const c00 = corner(i, j), c10 = corner(i + 1, j), c01 = corner(i, j + 1), c11 = corner(i + 1, j + 1);
      const at = (u, v) => [0, 1].map((q) => (c00[q] * (1 - u) + c10[q] * u) * (1 - v) + (c01[q] * (1 - u) + c11[q] * u) * v);
      for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) {
        const u0 = a / S, u1 = (a + 1) / S, v0 = b / S, v1 = (b + 1) / S;
        const P = [[u0, v0], [u0, v1], [u1, v1], [u0, v0], [u1, v1], [u1, v0]];
        for (const [u, v] of P) {
          const [s, d] = at(u, v);
          pos.push((i + u) * cell, WATER_Y, (j + v) * cell); shore.push(s); depth.push(d);
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    g.setAttribute('aDeep', new THREE.Float32BufferAttribute(depth, 1));
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f7fa6, transparent: true, opacity: 0.78, roughness: 0.3, metalness: 0, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aShore; attribute float aDeep; varying float vShore; varying float vDeep; varying vec3 vW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShore = aShore; vDeep = aDeep; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime, uNight, uWet; uniform vec3 uSky; varying float vShore; varying float vDeep; varying vec3 vW;
float wH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wH(i), wH(i + vec2(1.0, 0.0)), f.x), mix(wH(i + vec2(0.0, 1.0)), wH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 shallowC = vec3(0.07, 0.24, 0.27), deepC = vec3(0.02, 0.09, 0.17);
diffuseColor.rgb = mix(shallowC, deepC, smoothstep(0.0, 0.8, vDeep));
float band = vShore + 0.18 * sin(uTime * 1.6 - vShore * 9.0) * vShore;
float foam = smoothstep(0.45, 0.8, band) * (0.65 + 0.35 * wN(vW.xz * 2.2 + uTime * 0.35));
foam *= step(0.5, wN(floor(vW.xz / 0.4) * 0.9 + floor(uTime * 1.3)) + vShore * 0.4);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.95), foam);
diffuseColor.a = mix(mix(0.55, 0.88, vDeep), 0.97, foam);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec2 p = vW.xz; float t = uTime;
  float dx = 0.5 * cos(p.x * 0.9 + t * 1.3) + 0.35 * cos((p.x + p.y) * 1.7 - t * 1.9) + 0.25 * cos(p.x * 3.1 - p.y * 1.3 + t * 2.6);
  float dz = 0.5 * cos(p.y * 0.8 + t * 1.1) + 0.35 * cos((p.x + p.y) * 1.7 - t * 1.9) + 0.25 * cos(p.y * 2.9 + p.x * 1.1 - t * 2.3);
  float k = 0.04 + uWet * 0.04;
  normal = normalize(normal + (viewMatrix * vec4(-dx * k, 0.0, -dz * k, 0.0)).xyz); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uSky * fres * 0.28 * (1.0 - uNight * 0.6); }`);
    };
    mat.customProgramCacheKey = () => 'nt-water';
    waterMesh = new THREE.Mesh(g, mat); waterMesh.receiveShadow = true; waterMesh.renderOrder = 1;
    group.add(waterMesh);
    // bow waves: flat rings that grow and fade
    wakeMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.75, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xeaf4f6, transparent: true, opacity: 0.5, depthWrite: false }), 240);
    wakeMesh.count = 0; wakeMesh.frustumCulled = false; wakeMesh.renderOrder = 2;
    group.add(wakeMesh);
  }

  // ---------- marks: tracks (R), soot (G), trodden paths (B); one texel per 0.4 m voxel column ----------
  function stamp(x, z, r, ch, val, rough = 0) {
    if (!marksData) return;
    const t = info.cell / 5, cx = x / t, cz = z / t, R = r / t;
    for (let y = Math.floor(cz - R); y <= Math.ceil(cz + R); y++) for (let q = Math.floor(cx - R); q <= Math.ceil(cx + R); q++) {
      if (q < 0 || y < 0 || q >= mtex || y >= mtex) continue;
      const d = Math.hypot(q + 0.5 - cx, y + 0.5 - cz) / Math.max(0.5, R);
      if (d > 1) continue;
      let v = val * (rough ? Math.pow(Math.min(1, (1 - d) * 2.2), 0.7) * (1 - rough + rough * Math.random()) : 1);
      const o = (y * mtex + q) * 4 + ch;
      if (v > marksData[o]) { marksData[o] = Math.min(255, v); dirty = true; }
    }
  }
  function groundOk(x, z) {
    const { m, terrains, cell, n } = info, i = Math.floor(x / cell), j = Math.floor(z / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    const id = m.grounds[m.ground[j * n + i]];
    return { id, t: terrains[id] };
  }
  // per ground unit and frame: tracks behind it, crushing what it runs over, bow waves in water
  function move(id, x, z, yaw, drive, half, now) {
    if (!on || !info) return;
    const p = lastPos.get(id);
    if (!p) { lastPos.set(id, [x, z, now, 0]); return; }
    p[2] = now;
    const dx = x - p[0], dz = z - p[1], d = Math.hypot(dx, dz);
    if (d < 0.25) return;
    if (d > 6) { p[0] = x; p[1] = z; return; }   // jumped (new unit, wrap): no line across the map
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = fz, sz = -fx;
    const steps = Math.ceil(d / 0.3);
    for (let s = 1; s <= steps; s++) {
      const ax = p[0] + dx * s / steps, az = p[1] + dz * s / steps;
      const g = groundOk(ax, az);
      if (!g) continue;
      if (g.t?.water) continue;
      if (g.t?.tracks) {
        if (drive === 'track') { const w = half[0] * 0.72; stamp(ax + sx * w, az + sz * w, 0.32, 0, 200); stamp(ax - sx * w, az - sz * w, 0.32, 0, 200); }
        else if (drive === 'wheel') { const w = half[0] * 0.7; stamp(ax + sx * w, az + sz * w, 0.2, 0, 140); stamp(ax - sx * w, az - sz * w, 0.2, 0, 140); }
        else if (drive === 'walk') stamp(ax, az, 0.25, 2, 46);
        stats.stamps++;
      }
    }
    if (drive === 'track' || drive === 'wheel') crush(x, z, Math.max(half[0], 0.9) * 0.9, fx, fz);
    // in water: rings at the bow every ~0.6 m
    const g = groundOk(x, z);
    if (g?.t?.water && wakeMesh) {
      p[3] += d;
      if (p[3] > 0.6) { p[3] = 0; wakes.push({ x: x + fx * half[1] * 0.9, z: z + fz * half[1] * 0.9, t0: now, r: Math.max(0.6, half[0]) }); stats.wakes++; }
    }
    p[0] = x; p[1] = z;
  }
  // impacts and wrecks: black soot, rough edge
  function scorch(x, z, r) {
    if (!on || !info) return;
    const g = groundOk(x, z); if (!g || g.t?.water) return;
    stamp(x, z, r, 1, 255, 0.3); stats.scorches++;
  }

  // ---------- every frame ----------
  function update(dt, now, o = {}) {
    if (!info) return;
    uni.uTime.value = now / 1000;
    uni.uNight.value = o.night || 0;
    if (o.sky) uni.uSky.value.copy(o.sky);
    uni.uWet.value += ((o.wet || 0) - uni.uWet.value) * Math.min(1, dt * 0.4);
    if (!on) return;
    // forget units that are gone
    if (Math.random() < dt) for (const [id, p] of lastPos) if (now - p[2] > 2000) lastPos.delete(id);
    // lamps: dark by day, warm at night
    if (lampHeads) {
      const n = o.night || 0;
      lampHeads.material.color.setRGB(0.13 + n * 3.4, 0.12 + n * 2.6, 0.11 + n * 1.5);
      lampPools.material.opacity = n * 0.32;
    }
    // marks fade slowly: tracks ~4 min, paths ~2 min, soot ~12 min (a band of rows per frame)
    if (marksData) {
      fadeT += dt;
      const rows = Math.min(mtex, Math.ceil(mtex * dt / 1.2));
      const sootTurn = (Math.floor(fadeT / 1.2) % 3) === 0;
      for (let r = 0; r < rows; r++) {
        const y = fadeRow; fadeRow = (fadeRow + 1) % mtex;
        let o = y * mtex * 4;
        for (let q = 0; q < mtex; q++, o += 4) {
          if (marksData[o]) { marksData[o]--; dirty = true; }
          if (marksData[o + 2]) { marksData[o + 2] = Math.max(0, marksData[o + 2] - 2); dirty = true; }
          if (sootTurn && marksData[o + 1]) { marksData[o + 1]--; dirty = true; }
        }
      }
      if (dirty && now - lastUpload > (amount < 0.5 ? 600 : 220)) { marks.needsUpdate = true; dirty = false; lastUpload = now; }
    }
    // bow waves
    if (wakeMesh) {
      let w = 0;
      for (let q = wakes.length - 1; q >= 0; q--) {
        const k = (now - wakes[q].t0) / 1600;
        if (k >= 1) { wakes.splice(q, 1); continue; }
        if (w >= 240) continue;
        const it = wakes[q], r = it.r * (0.6 + k * 2.4);
        o3.position.set(it.x, WATER_Y + 0.03, it.z); o3.rotation.set(0, 0, 0); o3.scale.set(r, 1, r); o3.updateMatrix();
        wakeMesh.setMatrixAt(w++, o3.matrix);
      }
      wakeMesh.count = w; wakeMesh.instanceMatrix.needsUpdate = true;
      wakeMesh.material.opacity = 0.42;
    }
  }

  // switch old/new: the ground shader, scatter, the new water (the old water plane comes back when off)
  function set(v) {
    on = !!v;
    uni.uOn.value = on ? 1 : 0;
    group.visible = on;
    if (oldWater) oldWater.visible = !on || !waterMesh;
    return on;
  }
  // quality: how many tufts and stones (rebuilt with the next world), how often the marks are uploaded
  function quality(q) {
    const a = q === 'fast' ? 0.35 : q === 'beautiful' ? 1 : 0.75;
    if (a !== amount) { amount = a; if (info) attach(info); }
  }
  // for tests: centre (m) of the texel with the strongest mark in a channel (0 tracks, 1 soot, 2 paths)
  function strongest(ch = 0) {
    if (!marksData) return null;
    let best = 0, at = -1;
    for (let o = ch; o < marksData.length; o += 4) if (marksData[o] > best) { best = marksData[o]; at = (o - ch) / 4; }
    if (at < 0) return null;
    const t = info.cell / 5;
    return { x: (at % mtex + 0.5) * t, z: (Math.floor(at / mtex) + 0.5) * t, value: best };
  }
  return { strongest, decorate, attach, move, scorch, crush, update, set, quality, isOn: () => on, stats: () => ({ ...stats, on }), uniforms: uni, group };
}
