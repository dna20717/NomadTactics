// NomadTactics – 3D preview of a model in the workshop (Daniel 06.11.: „Bau die Möglichkeit ein, sie in der Werkstatt
// anzuschauen“). One WebGL renderer for the whole page (browsers allow only a few), drawn into the box that is on screen.
// Shows hull, turret, wheels, legs and rotors like in the game; with movement on, wheels roll, legs walk, rotors spin,
// the turret looks around. Drag = turn, wheel/pinch = zoom, double click = back to the start view.
import * as THREE from 'three';
import { voxelGeometry, vehicleMaterial } from './voxel/mesh.js';
import { assemble, extent } from './voxel/assemble.js';
import { icon } from '../icons.js';
import { el } from '../ui.js';

const TEAMS = [['#3a78d8', 'Blau'], ['#d8453a', 'Rot'], ['#e0b52c', 'Gelb'], ['#3fa34d', 'Grün']];
let R = null, scene, camera, mat, plate, sun;
const views = new Set();
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setClearColor(0x000000, 0);
  // soft studio backdrop (the box behind is a CSS gradient; some browsers drop the alpha on copy)
  R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x3b4048);
  scene.add(new THREE.HemisphereLight(0xe4ecf4, 0x5d5444, 1.15));
  sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-8, 14, 9); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  plate = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x8b8466, roughness: 0.95 }));
  plate.position.y = -0.06; plate.receiveShadow = true; scene.add(plate);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1.08, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
  rim.position.y = -0.27; plate.add(rim);
  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
  mat = vehicleMaterial(null);
  requestAnimationFrame(loop);
  return R;
}

// A preview box for one model (data/models.json entry). Options: base (URL of the project folder, for .vox), height (px).
export function modelPreview(def, { base = null, height = 260, mini = false } = {}) {
  const box = el('div', { class: 'tk-model-view' + (mini ? ' mini' : ''), style: `height:${height}px` });
  const canvas = el('canvas', {});
  const info = el('div', { class: 'tk-mv-info' }, 'Modell wird gebaut …');
  const v = { box, canvas, ctx: canvas.getContext('2d'), group: null, yaw: 0.7, pitch: 0.42, dist: 10, home: null, play: true, team: 0, t0: performance.now(), def, base, parts: null };
  const teamBtn = el('button', { class: 'tk-mv-btn', title: 'Teamfarbe wechseln', onclick: () => { v.team = (v.team + 1) % TEAMS.length; teamBtn.style.color = TEAMS[v.team][0]; build(v); } }, icon('brush', 14));
  teamBtn.style.color = TEAMS[0][0];
  const playBtn = el('button', { class: 'tk-mv-btn on', title: 'Bewegung an/aus (Räder, Beine, Rotoren, Turm)', onclick: () => { v.play = !v.play; playBtn.classList.toggle('on', v.play); } }, icon('play', 14));
  const homeBtn = el('button', { class: 'tk-mv-btn', title: 'Ansicht zurücksetzen (Doppelklick)', onclick: () => reset(v) }, icon('restart', 14));
  box.append(canvas, info);
  if (!mini) box.append(el('div', { class: 'tk-mv-bar' }, playBtn, teamBtn, homeBtn));
  v.info = info;
  if (mini) { views.add(v); try { renderer(); } catch { info.textContent = 'Keine 3D-Grafik'; return box; } build(v); return box; }
  // turning and zooming
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: v.yaw, pitch: v.pitch }; canvas.setPointerCapture(e.pointerId); v.spinPause = performance.now(); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; v.yaw = drag.yaw - (e.clientX - drag.x) * 0.012; v.pitch = Math.max(0.05, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.01)); v.spinPause = performance.now(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); v.dist = Math.max(v.home.dist * 0.35, Math.min(v.home.dist * 3, v.dist * (1 + Math.sign(e.deltaY) * 0.12))); }, { passive: false });
  canvas.addEventListener('dblclick', () => reset(v));
  views.add(v);
  try { renderer(); } catch (e) { info.textContent = 'Keine 3D-Grafik verfügbar (WebGL).'; return box; }
  build(v);
  return box;
}
function reset(v) { Object.assign(v, { yaw: 0.7, pitch: 0.42, dist: v.home?.dist || 10 }); }

async function build(v) {
  const token = (v.token = (v.token || 0) + 1);
  let m;
  try { m = await assemble(v.def, { base: v.base, skin: 1 }); } catch (e) { v.info.textContent = `Modell lässt sich nicht laden (${e.message}).`; return; }
  if (token !== v.token) return;
  if (!m) { v.info.textContent = 'Keine Quelle eingetragen.'; return; }
  if (v.group) { v.group.traverse((o) => o.geometry?.dispose()); }
  const team = new THREE.Color(TEAMS[v.team][0]).getHex(), sc = m.scale;
  const g = new THREE.Group(), parts = { turret: null, wheels: [], legs: [], rotors: [] };
  let tris = 0, voxels = 0;
  const mesh = (W) => { const geo = voxelGeometry(W, { team, scale: sc }); tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; voxels += W.size; const me = new THREE.Mesh(geo, mat); me.castShadow = me.receiveShadow = true; return me; };
  const shared = (W) => { const geo = voxelGeometry(W, { team, scale: sc }); return geo; };
  g.add(mesh(m.hull));
  if (m.turret && m.pivot) { const t = new THREE.Group(); t.position.set(m.pivot[0] * sc, m.pivot[1] * sc, m.pivot[2] * sc); t.add(mesh(m.turret)); g.add(t); parts.turret = t; }
  if (m.wheels) {
    const geo = shared(m.wheels.W);
    for (const a of m.wheels.at) {
      const o = new THREE.Group(); o.position.set(a.x, a.y, a.z); o.rotation.y = a.side < 0 ? Math.PI : 0;
      const spin = new THREE.Group(); const me = new THREE.Mesh(geo, mat); me.castShadow = true;
      me.position.set(-m.wheels.center[0], -m.wheels.center[1], -m.wheels.center[2]); spin.add(me); o.add(spin); g.add(o);
      parts.wheels.push({ spin, side: a.side, r: m.wheels.r, front: a.front, steer: o });
      tris += geo.attributes.position.count / 3; voxels += m.wheels.W.size;
    }
  }
  if (m.legs) {
    const geo = shared(m.legs.W);
    m.legs.at.forEach((a, j) => {
      const o = new THREE.Group(); o.position.set(a.x, m.legs.hip, a.z || 0);
      const me = new THREE.Mesh(geo, mat); me.castShadow = true; me.position.set(-m.legs.center[0], -m.legs.center[1], -m.legs.center[2]); o.add(me); g.add(o);
      parts.legs.push({ o, side: j ? 1 : -1 });
    });
  }
  for (const r of m.rotors || []) {
    const geo = shared(r.W);
    const o = new THREE.Group(); o.position.set(...r.at);
    const me = new THREE.Mesh(geo, mat); me.castShadow = true;
    if (r.turn === 'x') me.rotation.x = Math.PI / 2; else if (r.turn === 'z') me.rotation.z = Math.PI / 2;
    o.add(me); g.add(o);
    parts.rotors.push({ o, axis: r.axis || 'y', rate: r.rate || 30 });
    tris += geo.attributes.position.count / 3;
  }
  // stand on the plate: flying models hover a little above it
  const ex = extent(m);
  g.position.y = m.hover || 0;
  v.group = g; v.parts = parts; v.extent = ex; v.spin = !!m.spin;
  const size = Math.max(ex.radius * 1.15, ex.height * 0.9, 0.6);
  v.plateR = size * 1.05;
  v.home = { dist: size * 2.3 + 1 }; v.dist = v.home.dist; v.lookY = Math.min(ex.height * 0.45, size) + (m.hover || 0) * 0.5;
  v.info.textContent = `${(voxels).toLocaleString('de-DE')} Würfel à ${Math.round(sc * 100)} cm · ${Math.round(tris).toLocaleString('de-DE')} Dreiecke · ${(ex.radius * 2).toFixed(1).replace('.', ',')} m`;
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  for (const v of views) {
    if (!v.box.isConnected) { views.delete(v); v.group?.traverse((o) => o.geometry?.dispose()); continue; }
    if (!v.group) continue;
    const r = v.box.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
    draw(v, now, r);
  }
}
function draw(v, now, rect) {
  const pr = R.getPixelRatio(), w = Math.round(rect.width), h = Math.round(rect.height);
  if (v.canvas.width !== w * pr || v.canvas.height !== h * pr) { v.canvas.width = w * pr; v.canvas.height = h * pr; v.canvas.style.width = w + 'px'; v.canvas.style.height = h + 'px'; }
  const dt = Math.min(0.05, (now - (v.last || now)) / 1000); v.last = now;
  if (!v.spinPause || now - v.spinPause > 3500) v.yaw += dt * 0.35;
  const t = (now - v.t0) / 1000, P = v.parts;
  if (v.play) {
    const speed = 3;   // m/s for wheels and legs
    for (const wl of P.wheels) { wl.spin.rotation.x = (t * speed / wl.r); if (wl.front) wl.steer.rotation.y = (wl.side < 0 ? Math.PI : 0) + Math.sin(t * 0.7) * 0.3; }
    for (const lg of P.legs) lg.o.rotation.x = Math.sin(t * speed * Math.PI / 0.75) * 0.5 * lg.side;
    for (const ro of P.rotors) ro.o.rotation[ro.axis] = t * ro.rate;
    if (P.turret) P.turret.rotation.y = v.spin ? t * 1.2 : Math.sin(t * 0.5) * 0.8;
  }
  scene.add(v.group);
  plate.scale.set(v.plateR, 1, v.plateR);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.set(Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist, v.lookY + Math.sin(v.pitch) * v.dist, Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist);
  camera.lookAt(0, v.lookY, 0);
  if (R.domElement.width !== v.canvas.width || R.domElement.height !== v.canvas.height) R.setSize(w, h, false);
  R.render(scene, camera);
  v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
  v.ctx.drawImage(R.domElement, 0, 0, v.canvas.width, v.canvas.height);
  scene.remove(v.group);
}
