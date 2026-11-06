// NomadTactics – destructible voxel towers in the 3D view (Daniel 06.11.: „Gerne mit Hochhäusern, die
// zusammenbrechen“, then: „die Gebäude müssen detaillierter zerstört werden, wir hatten die Mechanik schon im
// Härtetest“). Port of the collapse lab from prototypes/nomadtactics/stress_test.js, slimmer for 16 towers:
// - Towers are voxels (0.8 m, twice the unit voxel). Structure + filling: corner columns, floor slabs, inner
//   columns and the core belong to parts (floor quarter q0–q3 or core k per floor); facade voxels are filling.
// - Hits punch spherical holes, voxels fly off as debris. Parts below 60 % (core 50 %) are broken.
// - Rules per floor (from the lab): core or 3 quarters broken → pancake; two quarters of one side → topple
//   (snap off if high up) towards that side; one quarter → dollhouse (that corner above breaks away).
// - Every collapse starts with a warning (dust trickling, slight lean), detached parts become falling bodies
//   (tip over an edge, fall freely, or sink floor by floor), shatter on the ground into debris and leave rubble.
// - Falling bodies crush what is below (`onCrush` callback; the launcher damages units there).
// Optics only: the simulation sees the footprint as ground „bebaut“.

const VT = 0.8;               // voxel size of towers (m)
const L = 4;                  // layers per floor (3.2 m)
const S = 64, O = 32;         // key packing
const key = (x, y, z) => (y * S + (x + O)) * S + (z + O);
const kx = (k) => Math.floor(k / S) % S - O, ky = (k) => Math.floor(k / (S * S)), kz = (k) => k % S - O;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SLICE = 10;             // layers per mesh slice (only hit slices are rebuilt)

// colours: 0 slab, 1 frame, 2 glass, 3 wall, 4 roof, 5 roof border, 6 pane, 7 red light, 8 soot
const STYLES = {
  glass: { colours: [0x5d6166, 0x9aa3a8, 0x4d7fa3, 0x46525c, 0x6d7276, 0x8a9094, 0x4d7fa3, 0xd23a2e, 0x2b2a28], lit: 0.32 },
  panel: { colours: [0x6f6b64, 0x8f8a80, 0x3b4652, 0xb8b2a4, 0x77736b, 0x8f8a80, 0x3b4652, 0xd23a2e, 0x2b2a28], lit: 0.45 },
  brick: { colours: [0x6b5a4c, 0xcfc4ad, 0x2f3a44, 0x8a4f3a, 0x5a4a3e, 0x6e3e2e, 0x2f3a44, 0xd23a2e, 0x2b2a28], lit: 0.55 },
};
const isGlass = (c) => c === 2 || c === 6;

export function createTowers(THREE, scene, { groundAt, puff, chip, jolt, light, onCrush = null, onEvent = null }) {
  // ---------- material: vertex colours, night windows through an extra attribute ----------
  const night = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit; varying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * vLit * uNight * 1.6;');
  };
  const col = new THREE.Color();

  // geometry of a voxel set (only faces without a neighbour), centred on the tower origin (metres)
  function mesh(W, pal, keys, shift = [0, 0, 0]) {
    const pos = [], nor = [], cl = [], lit = [];
    for (const k of keys) {
      const v = W.get(k); if (v === undefined) continue;
      const x = kx(k), y = ky(k), z = kz(k), c = v & 15, on = (v >> 4) & 1;
      col.setHex(pal[c]);
      const j = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 7;   // a little variation per voxel
      col.multiplyScalar(0.94 + j * 0.017);
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = DIRS[d];
        if (W.has(key(x + dx, y + dy, z + dz))) continue;
        const shade = dy > 0 ? 1 : dy < 0 ? 0.55 : dx ? 0.82 : 0.9;
        face(pos, nor, x - shift[0], y - shift[1], z - shift[2], dx, dy, dz);
        for (let i = 0; i < 6; i++) { cl.push(col.r * shade, col.g * shade, col.b * shade); lit.push(on && dy === 0 ? 1 : 0); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
    return g;
  }
  function face(pos, nor, x, y, z, dx, dy, dz) {
    // voxel (x, y, z) spans x±0.5, y..y+1, z±0.5 (in voxels) → metres
    const h = 0.5, cx = x, cy = y + 0.5, cz = z;
    let q;
    if (dx) q = [[dx * h, -h, -h], [dx * h, h, -h], [dx * h, h, h], [dx * h, -h, h]];
    else if (dy) q = [[-h, dy * h, -h], [h, dy * h, -h], [h, dy * h, h], [-h, dy * h, h]];
    else q = [[-h, -h, dz * h], [h, -h, dz * h], [h, h, dz * h], [-h, h, dz * h]];
    const order = (dx > 0 || dy < 0 || dz < 0) ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) { const p = q[i]; pos.push((cx + p[0]) * VT, (cy + p[1]) * VT, (cz + p[2]) * VT); nor.push(dx, dy, dz); }
  }

  // ---------- debris (flying voxels) and rubble (lying voxels): two instanced pools ----------
  const cube = new THREE.BoxGeometry(VT * 0.92, VT * 0.92, VT * 0.92);
  const debrisMesh = new THREE.InstancedMesh(cube, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 3500);
  debrisMesh.castShadow = true; debrisMesh.frustumCulled = false; debrisMesh.count = 0; scene.add(debrisMesh);
  const rubbleMesh = new THREE.InstancedMesh(cube, new THREE.MeshStandardMaterial({ roughness: 1 }), 9000);
  rubbleMesh.castShadow = true; rubbleMesh.receiveShadow = true; rubbleMesh.frustumCulled = false; rubbleMesh.count = 0; scene.add(rubbleMesh);
  const o = new THREE.Object3D(), v3 = new THREE.Vector3(), q4 = new THREE.Quaternion();
  let debris = [], rubble = [], rubbleDirty = true;
  function fling(x, y, z, vx, vy, vz, c, pal) {
    if (debris.length >= 3500) debris.shift();
    debris.push({ x, y, z, vx, vy, vz, c: pal ? pal[c] : c, r: Math.random() * 6, w: (Math.random() - 0.5) * 12, t0: performance.now(), rest: 0 });
  }
  function settle(x, z, c, height = 0) {
    if (rubble.length >= 9000) return;
    const gy = groundAt(x, z);
    rubble.push({ x, y: gy + VT * 0.45 + height, z, c, r: Math.random() * 0.6 }); rubbleDirty = true;
  }
  // a mound of rubble over a footprint (radius in m), higher in the middle
  function mound(cx, cz, rx, rz, up, pal, dir = null, length = 0) {
    const n = Math.round((rx * rz) / (VT * VT) * 0.9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      let x = cx + Math.cos(a) * r * rx, z = cz + Math.sin(a) * r * rz;
      if (dir && length) { const s = Math.random() * length; x += dir[0] * s; z += dir[1] * s; }
      const h = Math.floor((1 - r * r) * up * (0.6 + Math.random() * 0.6) / VT);
      for (let j = 0; j <= h; j++) settle(x, z, pal[[0, 3, 0, 8, 5][(i + j) % 5]], j * VT);
    }
  }

  // ---------- towers ----------
  let towers = [], fallers = [];

  function model(t) {
    const B = t.B, H = t.H, W = new Map(), part = new Map(), parts = [];
    const pid = new Map();
    const P = (name) => { if (!pid.has(name)) { pid.set(name, parts.length); parts.push({ name, n0: 0, n: 0, gone: false }); } return pid.get(name); };
    const lit = t.lit;
    const put = (x, y, z, c, structural) => {
      const k = key(x, y, z);
      const on = isGlass(c) && Math.random() < lit ? 1 : 0;
      W.set(k, c | (on << 4));
      if (structural) {
        const core = Math.abs(x) <= 1 && Math.abs(z) <= 1;
        const p = P((core ? 'k' : 'q' + ((x > 0 ? 1 : 0) + (z > 0 ? 2 : 0))) + ':' + Math.floor(y / L));
        part.set(k, p); parts[p].n0++; parts[p].n++;
      }
    };
    const facade = (x, y, z) => {
      const side = Math.abs(z) === B ? x : z, m = y % L;
      if (t.style === 'glass') return side % 3 === 0 ? 1 : 2;
      if (t.style === 'panel') return m >= 1 && m <= 2 && Math.abs(side) % 3 !== 0 ? 6 : 3;
      return m >= 1 && m <= 2 && Math.abs(side) % 2 === 0 ? 6 : 3;
    };
    for (let y = 0; y < H; y++) for (let x = -B; x <= B; x++) for (let z = -B; z <= B; z++) {
      const border = Math.abs(x) === B || Math.abs(z) === B, corner = Math.abs(x) === B && Math.abs(z) === B, slab = y % L === 0;
      if (border) { if (corner || slab) put(x, y, z, slab ? 0 : 1, true); else put(x, y, z, facade(x, y, z), false); }
      else if (slab) put(x, y, z, 0, true);
      else if (x % 3 === 0 && z % 3 === 0) put(x, y, z, 1, true);                 // columns
      else if (Math.max(Math.abs(x), Math.abs(z)) === 1) put(x, y, z, 0, true);   // core (stairs)
    }
    for (let x = -B; x <= B; x++) for (let z = -B; z <= B; z++) {
      const border = Math.abs(x) === B || Math.abs(z) === B;
      put(x, H, z, border ? 5 : 4, false); if (border) put(x, H + 1, z, 5, false);
    }
    for (let x = -2; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = H + 1; y <= H + 2; y++) put(x, y, z, 1, false);   // roof box
    if (t.floors >= 16) { for (let y = H + 1; y <= H + 8; y++) put(B - 1, y, -B + 1, 1, false); put(B - 1, H + 9, -B + 1, 7, false); }
    if (t.style === 'brick') for (let x = -B + 1; x <= B - 1; x += 3) for (let y = H + 1; y <= H + 2; y++) put(x, y, -B + 1, 3, false);
    return { W, part, parts };
  }

  function build(props) {
    for (const t of towers) scene.remove(t.grp);
    for (const f of fallers) scene.remove(f.grp);
    towers = []; fallers = []; debris = []; rubble = []; rubbleDirty = true;
    const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    props.filter((p) => p.kind === 'tower').forEach((p, i) => {
      const x = p.x / 1000, z = p.y / 1000, size = p.size || 10;
      const floors = Math.max(3, (p.floors || 12) + Math.round((rnd(i) - 0.5) * 4));
      const style = STYLES[p.style] ? p.style : 'panel';
      const t = { id: p.id, x, z, y0: groundAt(x, z), size, floors, B: Math.round(size / 2 / VT), H: floors * L, style, pal: STYLES[style].colours, lit: STYLES[style].lit,
        state: 'up', mode: '', dir: [1, 0], warn: null, slices: new Map(), grp: new THREE.Group(), lastFrom: null, done: new Set(), doll: new Set() };
      Object.assign(t, model(t));
      t.start = t.W.size;
      t.grp.position.set(x, t.y0, z); scene.add(t.grp);
      for (const k of t.W.keys()) { const s = Math.floor(ky(k) / SLICE); if (!t.slices.has(s)) t.slices.set(s, { keys: new Set(), mesh: null }); t.slices.get(s).keys.add(k); }
      for (const s of t.slices.values()) { s.mesh = new THREE.Mesh(mesh(t.W, t.pal, s.keys), mat); s.mesh.castShadow = s.mesh.receiveShadow = true; t.grp.add(s.mesh); }
      towers.push(t);
    });
  }
  function rebuild(t, which) {
    for (const s of which) {
      const sl = t.slices.get(s); if (!sl) continue;
      sl.mesh.geometry.dispose();
      if (!sl.keys.size) { t.grp.remove(sl.mesh); t.slices.delete(s); continue; }
      sl.mesh.geometry = mesh(t.W, t.pal, sl.keys);
    }
  }
  function remove(t, k, which) {
    const p = t.part.get(k);
    if (p !== undefined) { t.parts[p].n--; t.part.delete(k); }
    t.W.delete(k);
    const y = ky(k), s = Math.floor(y / SLICE);
    t.slices.get(s)?.keys.delete(k);
    which.add(s); if (y % SLICE === 0) which.add(s - 1); if (y % SLICE === SLICE - 1) which.add(s + 1);
  }
  const broken = (t, name, limit = 0.6) => { const p = t.parts.find((q) => q.name === name); return !p || p.gone || p.n < p.n0 * limit; };

  // ---------- hits ----------
  // A blast at (x, y, z) in metres with radius r punches a hole; voxels fly away from the centre
  function hitAt(x, y, z, r, from = null) {
    let any = null;
    for (const t of towers) {
      if (t.state === 'down' || t.state === 'fall') continue;
      const reach = (t.B + 0.5) * VT + r;
      if (Math.abs(x - t.x) > reach || Math.abs(z - t.z) > reach || y > t.y0 + (t.H + 12) * VT + r) continue;
      const lx = (x - t.x) / VT, ly = (y - t.y0) / VT, lz = (z - t.z) / VT, R = r / VT, R0 = Math.ceil(R);
      const which = new Set(); let n = 0;
      for (let ix = Math.round(lx) - R0; ix <= Math.round(lx) + R0; ix++) for (let iy = Math.max(0, Math.floor(ly) - R0); iy <= Math.floor(ly) + R0; iy++) for (let iz = Math.round(lz) - R0; iz <= Math.round(lz) + R0; iz++) {
        const k = key(ix, iy, iz), v = t.W.get(k); if (v === undefined) continue;
        const d = Math.hypot(ix - lx, iy + 0.5 - ly, iz - lz); if (d >= R) continue;
        remove(t, k, which); n++;
        if (Math.random() < 0.7) {
          const wx = t.x + ix * VT, wy = t.y0 + (iy + 0.5) * VT, wz = t.z + iz * VT;
          const f = 4 + 9 * (1 - d / R), dx = wx - x, dy = Math.max(0.3, wy - y), dz = wz - z, l = Math.hypot(dx, dy, dz) || 1;
          fling(wx, wy, wz, dx / l * f, dy / l * f + 2 + Math.random() * 3, dz / l * f, v & 15, t.pal);
        }
      }
      if (!n) continue;
      rebuild(t, which);
      t.lastFrom = from || [x, z];
      for (let i = 0; i < 3; i++) puff(x + (Math.random() - 0.5) * 2, y, z + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, 0x8a857c);
      rules(t);
      any = t;
    }
    return any;
  }
  // damage from the battle (impacts and blasts on the ground near a tower)
  function hit(x, z, power, fromX, fromZ) {
    if (power < 3) return null;
    return hitAt(x, groundAt(x, z) + 1 + Math.random() * 2.5, z, 0.7 + power * 0.13, [fromX ?? x, fromZ ?? z]);
  }

  // ---------- rules (from the collapse lab) ----------
  const DIR = { '0,1': [0, -1], '2,3': [0, 1], '0,2': [-1, 0], '1,3': [1, 0] };
  function rules(t) {
    if (t.state !== 'up') return;
    const floors = t.floors;
    for (let k = 0; k < floors; k++) {
      const F = [0, 1, 2, 3].filter((i) => broken(t, `q${i}:${k}`));
      const fresh = F.filter((i) => !t.doll.has(i));
      if (!F.length && !broken(t, `k:${k}`, 0.5)) continue;
      if (broken(t, `k:${k}`, 0.5) || F.length >= 3) return warn(t, k, 'pancake', Math.random() < 0.5 ? 2 + Math.random() * 4 : 0.6);
      if (F.length === 2) {
        const d = DIR[F.join(',')];
        if (!d) return warn(t, k, 'pancake', 1.5 + Math.random() * 3);
        return warn(t, k, k >= floors * 0.55 ? 'snap' : 'topple', 1.2 + Math.random() * 1.6, d);
      }
      if (fresh.length === 1 && F.length === 1) { dollhouse(t, k, fresh[0]); return; }
    }
  }
  function warn(t, k, mode, duration, d = null) {
    t.state = 'warn'; t.mode = mode; t.warn = { k, d, t: 0, duration };
    if (d) t.dir = [d[0], d[1]];
    else if (t.lastFrom) { const dx = t.x - t.lastFrom[0], dz = t.z - t.lastFrom[1], l = Math.hypot(dx, dz) || 1; t.dir = [dx / l, dz / l]; }
    onEvent?.(t, 'warn');
  }
  // keys of the tower that match f(x, y, z)
  const keysWhere = (t, f) => [...t.W.keys()].filter((k) => f(kx(k), ky(k), kz(k)));
  // take voxels out of the tower into a falling body (own mesh, pivot in tower voxels)
  function detach(t, keys, pivot, opt) {
    const sub = new Map(), which = new Set();
    for (const k of keys) { const v = t.W.get(k); if (v === undefined) continue; sub.set(k, v); remove(t, k, which); }
    rebuild(t, which);
    if (!sub.size) return null;
    const grp = new THREE.Group();
    grp.position.set(t.x + pivot[0] * VT, t.y0 + pivot[1] * VT, t.z + pivot[2] * VT);
    const m = new THREE.Mesh(mesh(sub, t.pal, sub.keys(), pivot), mat);
    m.castShadow = m.receiveShadow = true; grp.add(m); scene.add(grp);
    // samples for ground contact and crushing (the outermost first)
    const all = [...sub.keys()], step = Math.max(1, Math.floor(all.length / 70)), samples = [];
    for (let i = 0; i < all.length; i += step) samples.push(new THREE.Vector3((kx(all[i]) - pivot[0]) * VT, (ky(all[i]) - pivot[1] + 0.5) * VT, (kz(all[i]) - pivot[2]) * VT));
    samples.sort((a, b) => b.lengthSq() - a.lengthSq());
    const f = { t, grp, mesh: m, sub, pivot, samples, kind: opt.kind, axis: opt.axis || new THREE.Vector3(0, 0, 1), theta: 0, omega: opt.omega || 0,
      alpha: 1.5 * 9.81 / Math.max(2, samples[0]?.length() || 2), v: opt.v || new THREE.Vector3(), spin: opt.spin || new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6),
      age: 0, crush: 0, vertical: opt.vertical || null };
    fallers.push(f);
    return f;
  }
  function dollhouse(t, k, q) {
    t.doll.add(q);
    for (let s = k; s < t.floors; s++) { const p = t.parts.find((x) => x.name === `q${q}:${s}`); if (p) p.gone = true; }
    const keys = keysWhere(t, (x, y, z) => y >= k * L && ((x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)) === q && !(Math.abs(x) <= 1 && Math.abs(z) <= 1));
    const ox = q & 1 ? 1 : -1, oz = q & 2 ? 1 : -1;
    const f = detach(t, keys, [ox * t.B / 2, k * L + (t.H - k * L) / 2, oz * t.B / 2], { kind: 'free', v: new THREE.Vector3(ox * 2.5, 0.5, oz * 2.5) });
    if (f) { jolt(t.x, t.z, 0.5); onEvent?.(t, 'dollhouse'); }
  }
  function collapse(t) {
    const { k, d } = t.warn;
    t.state = 'fall'; t.grp.rotation.set(0, 0, 0);
    jolt(t.x, t.z, 0.8); light(t.x, t.y0 + 6, t.z, 3);
    if (t.mode === 'pancake') {
      const keys = keysWhere(t, (x, y) => y >= k * L);
      const f = detach(t, keys, [0, k * L, 0], { kind: 'vertical', vertical: { v: 0, bottom: k * L } });
      if (!f) { finish(t); return; }
      onEvent?.(t, 'pancake');
      return;
    }
    const dd = d || t.dir, sk = (Math.random() - 0.5) * 0.7;
    const dx = dd[0] * Math.cos(sk) - dd[1] * Math.sin(sk), dz = dd[0] * Math.sin(sk) + dd[1] * Math.cos(sk);
    t.dir = [dx, dz];
    const axis = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(dx, 0, dz)).normalize();
    const keys = keysWhere(t, (x, y) => y >= k * L);
    const f = detach(t, keys, [dd[0] * (t.B + 0.5), k * L, dd[1] * (t.B + 0.5)], { kind: 'topple', axis, omega: 0.05 });
    onEvent?.(t, t.mode);
    if (!f) finish(t);
    t.snapK = k;
  }
  function finish(t) {
    // what is left standing below a pancake/topple: a stump if high enough, otherwise rubble
    t.state = 'down';
    if (t.W.size < t.start * 0.12) {
      for (const k of t.W.keys()) if (Math.random() < 0.5) settle(t.x + kx(k) * VT, t.z + kz(k) * VT, t.pal[t.W.get(k) & 15], Math.min(ky(k), 3) * VT);
      scene.remove(t.grp); t.W.clear();
    }
  }
  // shatter a falling body: voxels become debris (some) and rubble (the rest) where they are
  function shatter(f, i) {
    const t = f.t;
    f.grp.updateMatrixWorld(true);
    let n = 0;
    const len = f.sub.size;
    for (const [k, val] of f.sub) {
      v3.set((kx(k) - f.pivot[0]) * VT, (ky(k) - f.pivot[1] + 0.5) * VT, (kz(k) - f.pivot[2]) * VT).applyMatrix4(f.grp.matrixWorld);
      const c = t.pal[val & 15];
      if (n++ % Math.max(1, Math.floor(len / 260)) === 0) fling(v3.x, Math.max(v3.y, groundAt(v3.x, v3.z) + 0.5), v3.z, (Math.random() - 0.5) * 9 + f.v.x * 0.5, 3 + Math.random() * 6, (Math.random() - 0.5) * 9 + f.v.z * 0.5, c);
      else if (Math.random() < 0.22) settle(v3.x + (Math.random() - 0.5) * 2, v3.z + (Math.random() - 0.5) * 2, c, Math.random() * 1.6);
    }
    for (let j = 0; j < 30; j++) {
      const s = f.samples[(Math.random() * f.samples.length) | 0]; if (!s) break;
      v3.copy(s).applyMatrix4(f.grp.matrixWorld);
      puff(v3.x, groundAt(v3.x, v3.z) + 1, v3.z, 2 + Math.random() * 3.5, 0x9c968a);
    }
    jolt(f.grp.position.x, f.grp.position.z, Math.min(1.6, 0.3 + len / 4000));
    scene.remove(f.grp); f.mesh.geometry.dispose(); fallers.splice(i, 1);
    if (t.state === 'fall' && !fallers.some((x) => x.t === t)) finish(t);
  }

  // ---------- update ----------
  function update(dt, now, nightFactor) {
    night.value += (nightFactor - night.value) * Math.min(1, dt * 2);
    for (const t of towers) {
      if (t.state !== 'warn') continue;
      const w = t.warn; w.t += dt;
      if (Math.random() < dt * 16) puff(t.x + (Math.random() - 0.5) * t.size, t.y0 + w.k * L * VT + Math.random() * 3, t.z + (Math.random() < 0.5 ? -1 : 1) * t.size / 2, 0.7 + Math.random(), 0xb0aa9e);
      if (Math.random() < dt * 4) { const ks = keysWhere(t, (x, y, z) => y >= (w.k + 1) * L && y < (w.k + 2) * L && (Math.abs(x) === t.B || Math.abs(z) === t.B)); const k = ks[(Math.random() * ks.length) | 0]; if (k !== undefined) { const which = new Set(); const v = t.W.get(k); remove(t, k, which); rebuild(t, which); fling(t.x + kx(k) * VT, t.y0 + ky(k) * VT, t.z + kz(k) * VT, (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2, v & 15, t.pal); } }
      if (w.d) { const lean = Math.min(1, w.t / w.duration) * 0.025; t.grp.rotation.z = -w.d[0] * lean; t.grp.rotation.x = w.d[1] * lean; }
      else t.grp.rotation.z = Math.sin(now * 0.05) * 0.003 * w.t;
      if (w.t >= w.duration) collapse(t);
    }
    // falling bodies
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i]; f.age += dt;
      if (f.kind === 'vertical') { if (stepVertical(f, i, dt)) continue; continue; }
      if (f.age > 12) { shatter(f, i); continue; }
      if (f.kind === 'topple') {
        f.omega += f.alpha * (0.25 + Math.sin(Math.min(1.4, f.theta + 0.05))) * dt; f.theta += f.omega * dt;
        f.grp.quaternion.setFromAxisAngle(f.axis, f.theta);
        if (Math.random() < dt * 8) puff(f.grp.position.x, f.grp.position.y + 0.5, f.grp.position.z, 1.5 + Math.random() * 2, 0xa39d90);
        if (f.theta > 1.15 && f.pivot[1] > 0) release(f);          // a snapped top: let go and tumble
      } else {
        f.v.y -= 9.81 * dt; f.grp.position.addScaledVector(f.v, dt);
        f.grp.rotation.x += f.spin.x * dt; f.grp.rotation.z += f.spin.z * dt;
      }
      f.grp.updateMatrixWorld(true);
      let ground = false;
      for (let s = 0; s < f.samples.length; s++) {
        v3.copy(f.samples[s]).applyMatrix4(f.grp.matrixWorld);
        const gy = groundAt(v3.x, v3.z);
        if (v3.y < gy + 0.1) { ground = true; break; }
        // crushing: pieces passing low over units
        if (onCrush && s < 24 && v3.y < gy + 4 && f.age - f.crush > 0.15) { f.crush = f.age; onCrush(v3.x, v3.z, 3.5, 40); }
        // domino: hits another tower
        if (s < 10) for (const t2 of towers) {
          if (t2 === f.t || t2.state !== 'up') continue;
          if (Math.abs(v3.x - t2.x) < (t2.B + 0.5) * VT && Math.abs(v3.z - t2.z) < (t2.B + 0.5) * VT && v3.y < t2.y0 + (t2.H + 2) * VT && (f.domino ?? 0) < f.age) {
            f.domino = f.age + 0.15; hitAt(v3.x, v3.y, v3.z, 2, [f.t.x, f.t.z]);
          }
        }
      }
      if (ground) {
        if (onCrush) { v3.copy(f.samples[0] || v3).applyMatrix4(f.grp.matrixWorld); onCrush(f.grp.position.x, f.grp.position.z, 6, 80); }
        shatter(f, i);
      }
    }
    // debris
    debris = debris.filter((b) => now - b.t0 < 9000);
    let n = 0;
    for (const b of debris) {
      if (!b.rest) {
        b.vy -= 9.81 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.r += b.w * dt;
        const gy = groundAt(b.x, b.z) + VT * 0.45;
        if (b.y < gy) { b.y = gy; b.vy *= -0.3; b.vx *= 0.55; b.vz *= 0.55; b.w *= 0.5; if (Math.abs(b.vy) < 0.8) b.rest = now; }
      }
      const sink = b.rest && now - b.rest > 4000 ? (now - b.rest - 4000) / 1000 * 0.4 : 0;
      o.position.set(b.x, b.y - sink, b.z); o.rotation.set(b.r, b.r * 0.6, 0); o.scale.setScalar(1); o.updateMatrix();
      debrisMesh.setMatrixAt(n, o.matrix); debrisMesh.setColorAt(n++, col.setHex(b.c));
    }
    debrisMesh.count = n; debrisMesh.instanceMatrix.needsUpdate = true; if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
    if (rubbleDirty) {
      rubbleDirty = false;
      let m = 0;
      for (const r of rubble) {
        o.position.set(r.x, r.y, r.z); o.rotation.set(0, r.r, 0); o.scale.setScalar(1); o.updateMatrix();
        rubbleMesh.setMatrixAt(m, o.matrix); rubbleMesh.setColorAt(m++, col.setHex(r.c));
      }
      rubbleMesh.count = m; rubbleMesh.instanceMatrix.needsUpdate = true; if (rubbleMesh.instanceColor) rubbleMesh.instanceColor.needsUpdate = true;
    }
  }
  // tipping → free fall: centre of the samples becomes the pivot, the rotation turns into velocity
  function release(f) {
    f.grp.updateMatrixWorld(true);
    const c = new THREE.Vector3(); for (const p of f.samples) c.add(p); c.divideScalar(Math.max(1, f.samples.length));
    const edge = f.grp.position.clone(), centre = c.clone().applyMatrix4(f.grp.matrixWorld);
    f.v.copy(f.axis.clone().multiplyScalar(f.omega).cross(centre.clone().sub(edge)));
    f.mesh.position.sub(c); for (const p of f.samples) p.sub(c);
    f.pivot = [f.pivot[0] + c.x / VT, f.pivot[1] + c.y / VT, f.pivot[2] + c.z / VT];
    f.grp.position.copy(centre); f.spin.set(f.axis.x * f.omega * 0.7, 0, f.axis.z * f.omega * 0.7);
    f.kind = 'free';
  }
  // pancake: the upper block sinks through the floors below, crushing them
  function stepVertical(f, i, dt) {
    const t = f.t, S2 = f.vertical;
    S2.v = Math.min(10, S2.v + 9.81 * dt * 0.7);
    f.grp.position.y -= S2.v * dt;
    f.grp.rotation.z += (Math.random() - 0.5) * 0.004;
    const bottom = Math.floor((f.grp.position.y - t.y0) / VT);
    if (bottom < S2.bottom) {
      const keys = keysWhere(t, (x, y) => y >= Math.max(0, bottom) && y < S2.bottom);
      if (keys.length) {
        const which = new Set(); let n = 0;
        for (const k of keys) {
          const v = t.W.get(k);
          if (n++ % 6 === 0) fling(t.x + kx(k) * VT, t.y0 + ky(k) * VT, t.z + kz(k) * VT, (Math.random() - 0.5) * 9, Math.random() * 3, (Math.random() - 0.5) * 9, v & 15, t.pal);
          remove(t, k, which);
        }
        rebuild(t, which); S2.v *= 0.86;
        for (let j = 0; j < 8; j++) { const a = Math.random() * Math.PI * 2; puff(t.x + Math.cos(a) * t.size * 0.6, t.y0 + Math.max(0, bottom) * VT, t.z + Math.sin(a) * t.size * 0.6, 1.5 + Math.random() * 2.5, 0xa39d90); }
        if (S2.bottom % L === 0) { jolt(t.x, t.z, 0.25); onCrush?.(t.x, t.z, t.size * 0.8, 30); }
      }
      S2.bottom = bottom;
    }
    if (bottom <= 0) {
      mound(t.x, t.z, t.size * 0.65, t.size * 0.65, Math.min(6, 1.5 + t.floors * 0.25), t.pal);
      shatter(f, i);
      for (const k of [...t.W.keys()]) { const which = new Set(); remove(t, k, which); }
      scene.remove(t.grp); t.state = 'down';
      return true;
    }
    return false;
  }

  // start a collapse from outside (tests): pancake, topple or snap at a fitting floor
  function start(t, mode = 'topple') {
    if (t.state !== 'up') return;
    const k = mode === 'snap' ? Math.floor(t.floors * 0.6) : mode === 'pancake' ? Math.floor(t.floors * 0.4) : 0;
    const d = Math.abs(t.dir[0]) >= Math.abs(t.dir[1]) ? [Math.sign(t.dir[0]) || 1, 0] : [0, Math.sign(t.dir[1]) || 1];
    warn(t, k, mode, 1.2, mode === 'pancake' ? null : d);
  }

  return {
    build, hit, hitAt, update, start,
    get list() { return towers; },
    standing() { return towers.filter((t) => t.state === 'up'); },
    // a point on the facade (for strikes): side, height
    facadePoint(t) {
      const side = (Math.random() * 4) | 0, along = (Math.random() - 0.5) * t.size * 0.8, half = t.size / 2;
      const h = t.y0 + (0.15 + Math.random() * 0.8) * t.H * VT;
      return [[half, along], [-half, along], [along, half], [along, -half]][side].map((v, i) => (i ? t.z : t.x) + v).concat([h]);
    },
    height(t) { return t.H * VT; },
  };
}
