// NomadTactics – towers in the 3D view (Daniel 06.11.: „Gerne mit Hochhäusern, die zusammenbrechen“).
// Optics only: the simulation sees the footprint as ground „bebaut“ (impassable), never the building.
// A tower is a stack of floors, each floor four quarter blocks (instanced boxes with a window texture,
// lit windows at night). Damage comes from impacts and blasts nearby; at 0 it collapses in one of three ways,
// chosen from where it was hit and a little chance:
//   sink   – Generals style: the whole tower slides into the ground in a dust cloud, slightly tilting
//   topple – falls over around the base edge away from the last hit, breaks apart on the ground
//   snap   – the top breaks off above a floor and tumbles down, a stump stays
// Every collapse starts with a warning (dust trickling, a shiver) and ends as a rubble heap.

const FLOOR = 3.2;            // m per floor
const STYLES = {
  glass: { wall: '#2e4a5e', frame: '#c9d6de', glass: '#5d8fb0', lit: 0.35, rough: 0.25, metal: 0.35, rubble: [0x8d969c, 0x6f7a82, 0x4f6575] },
  panel: { wall: '#b9b4a8', frame: '#9e988b', glass: '#3b4652', lit: 0.45, rough: 0.9, metal: 0, rubble: [0xb3ad9f, 0x9a9488, 0x7d786e] },
  brick: { wall: '#8a4f3a', frame: '#d8cdb8', glass: '#2f3a44', lit: 0.55, rough: 0.95, metal: 0, rubble: [0x8a4f3a, 0x6e3e2e, 0xa59a88] },
};

function facadeTexture(THREE, st, lit) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = lit ? '#000' : st.wall; g.fillRect(0, 0, 64, 32);
  // two windows per quarter face (5 m), one row per floor
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 16;
    if (lit) { g.fillStyle = Math.random() < st.lit ? (Math.random() < 0.7 ? '#ffd38a' : '#cfe4ff') : '#000'; g.fillRect(x + 1, 9, 10, 15); continue; }
    g.fillStyle = st.frame; g.fillRect(x, 8, 12, 17);
    g.fillStyle = st.glass; g.fillRect(x + 1, 9, 10, 15);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 1, 9, 4, 15);
  }
  g.fillStyle = lit ? '#000' : 'rgba(0,0,0,.25)'; g.fillRect(0, 30, 64, 2);   // floor slab line
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = lit ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.generateMipmaps = true;
  return t;
}

export function createTowers(THREE, scene, { groundAt, puff, chip, jolt, light }) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mats = {}, meshes = {};
  for (const [name, st] of Object.entries(STYLES)) {
    mats[name] = new THREE.MeshStandardMaterial({ map: facadeTexture(THREE, st, false), emissiveMap: facadeTexture(THREE, st, true), emissive: 0xffffff, emissiveIntensity: 0, roughness: st.rough, metalness: st.metal });
    const m = new THREE.InstancedMesh(box, mats[name], 1600);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    scene.add(m); meshes[name] = m;
  }
  const rubbleMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 1 }), 3000);
  rubbleMesh.castShadow = true; rubbleMesh.receiveShadow = true; rubbleMesh.frustumCulled = false; rubbleMesh.count = 0; scene.add(rubbleMesh);
  const o = new THREE.Object3D(), q = new THREE.Quaternion(), v = new THREE.Vector3(), col = new THREE.Color();
  const AXIS_Y = new THREE.Vector3(0, 1, 0);

  let towers = [], rubble = [], pieces = [];
  let night = 0;

  function build(props, mapSize) {
    towers = []; rubble = []; pieces = [];
    const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    props.filter((p) => p.kind === 'tower').forEach((p, i) => {
      const x = p.x / 1000, z = p.y / 1000, size = p.size || 10;
      const floors = Math.max(3, (p.floors || 12) + Math.round((rnd(i) - 0.5) * 4));
      towers.push({ id: p.id, x, z, y0: groundAt(x, z), size, floors, style: STYLES[p.style] ? p.style : 'panel', hp: 100,
        state: 'up', t0: 0, mode: '', dir: [1, 0], tilt: 0, sink: 0, snapAt: 0, warn: 0, hitFrom: null, yaw: Math.floor(rnd(i + 9) * 4) * Math.PI / 2 });
    });
    void mapSize;
  }

  // damage from the battle: impacts, blasts; returns the tower if it started to collapse
  function hit(x, z, power, fromX, fromZ) {
    let fell = null;
    for (const t of towers) {
      if (t.state !== 'up') continue;
      const dx = x - t.x, dz = z - t.z, reach = t.size * 0.5 + 7;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      t.hp -= power * (1 - d / reach * 0.6);
      t.hitFrom = [fromX ?? x, fromZ ?? z];
      if (t.hp <= 0) { start(t); fell = t; }
      else if (power > 3) for (let i = 0; i < 2; i++) puff(t.x + dx * 0.5, t.y0 + 2 + Math.random() * t.floors * FLOOR * 0.5, t.z + dz * 0.5, 1 + Math.random(), 0x8a857c);
    }
    return fell;
  }
  function start(t, mode) {
    t.state = 'warn'; t.t0 = performance.now();
    const away = t.hitFrom ? [t.x - t.hitFrom[0], t.z - t.hitFrom[1]] : [Math.random() - 0.5, Math.random() - 0.5];
    const len = Math.hypot(away[0], away[1]) || 1;
    t.dir = [away[0] / len, away[1] / len];
    const r = Math.random();
    t.mode = mode || (t.floors < 9 ? (r < 0.6 ? 'sink' : 'topple') : r < 0.38 ? 'sink' : r < 0.72 ? 'topple' : 'snap');
    t.snapAt = Math.max(3, Math.floor(t.floors * (0.45 + Math.random() * 0.25)));
  }

  // pieces of a standing tower: [floor, quarter] → local offset
  const QUARTERS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
  function pieceMatrix(t, f, qi, height, extra) {
    const s = t.size, [qx, qz] = QUARTERS[qi];
    // local position relative to the pivot at ground level
    v.set(qx * s, f * FLOOR + FLOOR / 2, qz * s);
    o.position.copy(v); o.quaternion.identity(); o.scale.set(s / 2 - 0.08, FLOOR - 0.06, s / 2 - 0.08);
    if (extra) extra(o);
    o.position.x += t.x; o.position.z += t.z; o.position.y += t.y0 - height;
    o.updateMatrix();
    return o.matrix;
  }
  // rotate a local point/orientation about a horizontal pivot line (topple, snap)
  function tipAbout(obj, px, py, pz, axis, angle) {
    q.setFromAxisAngle(axis, angle);
    obj.position.sub(v.set(px, py, pz)).applyQuaternion(q).add(v.set(px, py, pz));
    obj.quaternion.premultiply(q);
  }
  const axis = new THREE.Vector3();

  function breakApart(t, fromFloor, toFloor, angle, pivotY) {
    // turn the falling floors into loose pieces that keep the rotation's momentum
    const [dx, dz] = t.dir;
    axis.set(dz, 0, -dx).normalize();
    for (let f = fromFloor; f < toFloor; f++) for (let qi = 0; qi < 4; qi++) {
      const m = pieceMatrix(t, f, qi, 0, (ob) => tipAbout(ob, t.dir[0] * t.size / 2, pivotY, t.dir[1] * t.size / 2, axis, angle));
      const p = new THREE.Vector3(), r = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(p, r, sc);
      const up = (f - fromFloor + 1) * FLOOR;
      pieces.push({ style: t.style, p, r, sc, vx: dx * up * 0.9 + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: dz * up * 0.9 + (Math.random() - 0.5) * 3,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), w: 1 + Math.random() * 3, t0: performance.now(), rest: false });
    }
    jolt(t.x + dx * t.size, t.z + dz * t.size, 1.4);
    for (let i = 0; i < 40; i++) {
      const k = Math.random() * (toFloor - fromFloor) * FLOOR;
      puff(t.x + dx * (t.size / 2 + k) + (Math.random() - 0.5) * 6, t.y0 + 1, t.z + dz * (t.size / 2 + k) + (Math.random() - 0.5) * 6, 2 + Math.random() * 3, 0x9c968a);
    }
  }
  function heap(t, lengthFloors) {
    // rubble heap at the base (and along the fall line for topple/snap)
    const st = STYLES[t.style];
    const n = 26 + lengthFloors * 3;
    for (let i = 0; i < n; i++) {
      const along = t.mode === 'sink' ? 0 : Math.random() * lengthFloors * FLOOR;
      const spread = t.size * (0.7 - along / (lengthFloors * FLOOR + 1) * 0.3);
      const x = t.x + t.dir[0] * along + (Math.random() - 0.5) * spread, z = t.z + t.dir[1] * along + (Math.random() - 0.5) * spread;
      const s = 0.8 + Math.random() * 2.2;
      rubble.push({ x, z, y: groundAt(x, z) + s * 0.3 + Math.random() * (t.mode === 'sink' ? 3 : 1.2), s, ry: Math.random() * 3, c: st.rubble[i % 3] });
    }
  }

  function update(dt, now, nightFactor) {
    night += (nightFactor - night) * Math.min(1, dt * 2);
    for (const m of Object.values(mats)) m.emissiveIntensity = night * 1.6;
    const used = { glass: 0, panel: 0, brick: 0 };
    const put = (style, matrix) => { const m = meshes[style]; if (used[style] < 1600) m.setMatrixAt(used[style]++, matrix); };
    for (const t of towers) {
      const age = (now - t.t0) / 1000;
      if (t.state === 'warn') {
        // warning: dust trickles from the facade, a slight shiver, then it goes
        if (Math.random() < dt * 14) puff(t.x + (Math.random() - 0.5) * t.size, t.y0 + Math.random() * t.floors * FLOOR, t.z + (Math.random() - 0.5) * t.size, 0.7 + Math.random(), 0xb0aa9e);
        if (age > 1.6) { t.state = 'fall'; t.t0 = now; jolt(t.x, t.z, 0.6); light(t.x, t.y0 + 4, t.z, 3); }
      }
      const shiver = t.state === 'warn' ? Math.sin(now * 0.07) * 0.025 * age : 0;
      if (t.state === 'up' || t.state === 'warn') {
        for (let f = 0; f < t.floors; f++) for (let qi = 0; qi < 4; qi++) put(t.style, pieceMatrix(t, f, qi, 0, shiver ? (ob) => { ob.rotation.z = shiver; ob.position.x += shiver * f * FLOOR; ob.updateMatrix(); ob.quaternion.setFromEuler(ob.rotation); } : null));
        continue;
      }
      if (t.state === 'fall') {
        const [dx, dz] = t.dir;
        axis.set(dz, 0, -dx).normalize();
        if (t.mode === 'sink') {
          // slides into the ground, accelerating, a little tilt; dust billows at the base
          const sink = Math.min(t.floors * FLOOR, 1.2 * age * age * 6);
          const tilt = Math.min(0.12, age * 0.03);
          for (let f = 0; f < t.floors; f++) {
            if (f * FLOOR + FLOOR < sink) continue;
            for (let qi = 0; qi < 4; qi++) put(t.style, pieceMatrix(t, f, qi, sink, (ob) => tipAbout(ob, dx * t.size / 2, 0, dz * t.size / 2, axis, tilt)));
          }
          if (Math.random() < dt * 40) puff(t.x + (Math.random() - 0.5) * t.size * 1.6, t.y0 + 0.5, t.z + (Math.random() - 0.5) * t.size * 1.6, 2 + Math.random() * 3, 0xa39d90);
          if (Math.random() < dt * 20) chip(t.x + (Math.random() - 0.5) * t.size, t.y0 + 1, t.z + (Math.random() - 0.5) * t.size, STYLES[t.style].rubble[0], 1.5);
          if (Math.random() < dt * 3) jolt(t.x, t.z, 0.15);
          if (sink >= t.floors * FLOOR) { t.state = 'down'; heap(t, 0); jolt(t.x, t.z, 0.8); }
        } else {
          // topple: the whole stack; snap: only the floors above snapAt, pivoting on that floor
          const from = t.mode === 'snap' ? t.snapAt : 0, pivotY = from * FLOOR;
          const angle = Math.min(Math.PI / 2 * 0.92, 0.12 * age * age * (t.mode === 'snap' ? 2.2 : 1.4));
          for (let f = 0; f < t.floors; f++) for (let qi = 0; qi < 4; qi++) {
            if (f < from) { put(t.style, pieceMatrix(t, f, qi, 0)); continue; }
            put(t.style, pieceMatrix(t, f, qi, 0, (ob) => tipAbout(ob, dx * t.size / 2, pivotY, dz * t.size / 2, axis, angle)));
          }
          if (Math.random() < dt * 10) puff(t.x + dx * t.size / 2, t.y0 + pivotY + 1, t.z + dz * t.size / 2, 1.5 + Math.random() * 2, 0xa39d90);
          if (angle >= Math.PI / 2 * 0.92 || (t.mode === 'snap' && angle > 1.1)) {
            breakApart(t, from, t.floors, angle, pivotY);
            t.state = 'down'; heap(t, t.floors - from);
            if (t.mode === 'snap') t.floors = from;   // the stump stays
          }
        }
        continue;
      }
      // down: the stump of a snapped tower still stands
      if (t.mode === 'snap') for (let f = 0; f < t.floors; f++) for (let qi = 0; qi < 4; qi++) put(t.style, pieceMatrix(t, f, qi, 0));
    }
    // loose pieces: fly, tumble, land, lie still, sink away after 20 s
    pieces = pieces.filter((p) => now - p.t0 < 22000);
    for (const p of pieces) {
      if (!p.rest) {
        p.vy -= 9.8 * dt;
        p.p.x += p.vx * dt; p.p.y += p.vy * dt; p.p.z += p.vz * dt;
        p.r.premultiply(q.setFromAxisAngle(p.spin, p.w * dt));
        const gy = groundAt(p.p.x, p.p.z) + p.sc.y * 0.4;
        if (p.p.y < gy) {
          p.p.y = gy;
          if (Math.abs(p.vy) > 4) { puff(p.p.x, gy, p.p.z, 1.5 + Math.random() * 2, 0x9c968a); if (Math.random() < 0.3) jolt(p.p.x, p.p.z, 0.2); }
          p.vy *= -0.25; p.vx *= 0.5; p.vz *= 0.5; p.w *= 0.5;
          if (Math.abs(p.vy) < 1.2 && Math.hypot(p.vx, p.vz) < 1) p.rest = true;
        }
      }
      const sinkAway = Math.max(0, (now - p.t0) / 1000 - 16) * 0.6;
      o.position.set(p.p.x, p.p.y - sinkAway, p.p.z); o.quaternion.copy(p.r); o.scale.copy(p.sc); o.updateMatrix();
      put(p.style, o.matrix);
    }
    for (const [name, m] of Object.entries(meshes)) { m.count = used[name]; m.instanceMatrix.needsUpdate = true; }
    let rn = 0;
    for (const r of rubble) {
      if (rn >= 3000) break;
      o.position.set(r.x, r.y, r.z); o.rotation.set(r.ry * 0.3, r.ry, r.ry * 0.2); o.scale.set(r.s, r.s * 0.7, r.s * 1.1); o.updateMatrix();
      rubbleMesh.setMatrixAt(rn, o.matrix); rubbleMesh.setColorAt(rn++, col.setHex(r.c));
    }
    rubbleMesh.count = rn; rubbleMesh.instanceMatrix.needsUpdate = true; if (rubbleMesh.instanceColor) rubbleMesh.instanceColor.needsUpdate = true;
  }

  return {
    build, hit, update, start,
    get list() { return towers; },
    standing() { return towers.filter((t) => t.state === 'up'); },
  };
}
