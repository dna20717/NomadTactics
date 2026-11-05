// Leopard 2A7-style main battle tank, low-poly, built from primitives.
// Units: meters. z = front, y = up, x = right. Ground at y = 0.
import * as THREE from 'three';

const COLORS = {
  oliv: 0x4f5634,
  olivBrightness: 0x626a42,
  olivDark: 0x3a4027,
  track: 0x2b2a27,
  wheel: 0x3c4229,
  rubber: 0x1d1d1c,
  glass: 0x7fb6c9,
  metall: 0x55595c,
  black: 0x1a1a1a,
};

function mat(color, opt = {}) {
  return new THREE.MeshStandardMaterial({ color: color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opt });
}

// Seitenprofil (z, y) entlang x extrudieren: Breite b, mittig um x0
function profile(points, b, color, x0 = 0) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: b, bevelEnabled: false });
  g.translate(0, 0, -b / 2);
  g.rotateY(-Math.PI / 2);          // Shape-x -> Welt-z, Extrusion -> Welt-x
  const m = new THREE.Mesh(g, mat(color));
  m.position.x = x0;
  return m;
}

// Extrude the top-view outline (x, z) upward, tapered at the top
function outline(points, h, color, taper = 1) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);          // Extrusion upward
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h - 1e-4) { p.setX(i, p.getX(i) * taper); p.setZ(i, p.getZ(i) * (0.5 + taper / 2)); }
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat(color));
}

function box(b, h, t, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b, h, t), mat(color));
  m.position.set(x, y, z);
  return m;
}

function barrel(r1, r2, l, color, pages = 8) {
  const g = new THREE.CylinderGeometry(r2, r1, l, pages);
  g.rotateX(Math.PI / 2);           // entlang z
  g.translate(0, 0, l / 2);
  return new THREE.Mesh(g, mat(color));
}

function wheel(r, b, color, x, y, z) {
  const g = new THREE.CylinderGeometry(r, r, b, 10);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(x, y, z);
  return m;
}

export function constructTank({ team = 0x2f6fd6 } = {}) {
  const tank = new THREE.Group();
  tank.name = 'leopard';
  const wanne = new THREE.Group(); wanne.name = 'wanne';
  tank.add(wanne);

  // --- Tracks and running gear ---
  const tracksProfile = [[-3.85, 0.62], [-3.55, 0.12], [3.15, 0.12], [3.8, 0.66], [3.55, 0.92], [-3.62, 0.92]];
  for (const s of [-1, 1]) {
    wanne.add(profile(tracksProfile, 0.64, COLORS.track, s * 1.5));
    // 7 Laufrollen, Triebrad hinten, Leitrad vorne
    for (let i = 0; i < 7; i++) wanne.add(wheel(0.36, 0.68, COLORS.wheel, s * 1.5, 0.44, -2.75 + i * 0.86));
    wanne.add(wheel(0.38, 0.6, COLORS.metall, s * 1.5, 0.62, -3.5));
    wanne.add(wheel(0.33, 0.6, COLORS.wheel, s * 1.5, 0.64, 3.45));
    // Track skirts, thicker at the front (add-on armor)
    wanne.add(box(0.08, 0.48, 6.4, COLORS.olivDark, s * 1.86, 0.78, -0.55));
    wanne.add(box(0.16, 0.56, 1.25, COLORS.oliv, s * 1.88, 0.8, 3.05));
  }

  // --- Wanne ---
  // Unterwanne zwischen den Ketten
  wanne.add(profile([[-3.7, 0.5], [3.3, 0.45], [3.95, 0.98], [-3.85, 0.98]], 2.35, COLORS.olivDark));
  // Upper hull across the full width, flat front plate
  wanne.add(profile([[-3.85, 0.98], [-3.85, 1.5], [2.55, 1.56], [3.85, 1.12], [3.95, 0.98]], 3.62, COLORS.oliv));
  // Engine deck with ventilation grilles
  wanne.add(box(2.6, 0.06, 1.7, COLORS.olivDark, 0, 1.53, -2.7));
  for (let i = 0; i < 5; i++) wanne.add(box(2.4, 0.03, 0.12, COLORS.black, 0, 1.57, -3.4 + i * 0.3));
  // Driver's hatch and angled mirror at front left
  wanne.add(box(0.7, 0.08, 0.6, COLORS.olivBrightness, -0.75, 1.6, 2.1));
  wanne.add(box(0.5, 0.06, 0.12, COLORS.glass, -0.75, 1.66, 2.42));
  // Scheinwerfer
  for (const s of [-1, 1]) wanne.add(box(0.22, 0.14, 0.12, COLORS.metall, s * 1.45, 1.25, 3.72));
  // Auspuffgitter hinten seitlich
  for (const s of [-1, 1]) wanne.add(box(0.06, 0.3, 0.9, COLORS.black, s * 1.82, 1.25, -3.1));
  // Rear door/stowage boxes
  wanne.add(box(2.8, 0.42, 0.2, COLORS.olivDark, 0, 1.25, -3.92));

  // --- Turm (dreht sich) ---
  const tower = new THREE.Group(); tower.name = 'tower';
  tower.position.set(0, 1.56, -0.35);
  tank.add(tower);
  // Main body with wedge add-on armor (arrow shape from above)
  const towerOutline = [[-1.6, -2.3], [1.6, -2.3], [1.75, 0.3], [1.68, 0.75], [0.55, 2.35], [0.32, 1.95],
                      [-0.32, 1.95], [-0.55, 2.35], [-1.68, 0.75], [-1.75, 0.3]];
  tower.add(outline(towerOutline, 0.78, COLORS.oliv, 0.94));
  // Turmdach etwas heller
  const roof = outline([[-1.45, -2.1], [1.45, -2.1], [1.55, 0.5], [0.45, 1.85], [-0.45, 1.85], [-1.55, 0.5]], 0.04, COLORS.olivBrightness);
  roof.position.y = 0.76; tower.add(roof);
  // Staukorb am Heck
  tower.add(box(3.0, 0.42, 0.55, COLORS.olivDark, 0, 0.42, -2.55));
  for (let i = 0; i < 6; i++) tower.add(box(0.05, 0.44, 0.58, COLORS.black, -1.45 + i * 0.58, 0.42, -2.56));
  // Blende
  tower.add(box(0.7, 0.58, 0.45, COLORS.olivDark, 0, 0.4, 2.0));
  // L55 gun with thermal sleeve and muzzle reference
  const kanone = new THREE.Group(); kanone.name = 'kanone';
  kanone.position.set(0, 0.42, 2.1);
  tower.add(kanone);
  kanone.add(barrel(0.17, 0.15, 1.6, COLORS.oliv));
  const r2 = barrel(0.14, 0.13, 2.1, COLORS.olivBrightness); r2.position.z = 1.6; kanone.add(r2);
  const r3 = barrel(0.125, 0.12, 1.65, COLORS.oliv); r3.position.z = 3.7; kanone.add(r3);
  const mr = box(0.12, 0.14, 0.18, COLORS.olivDark, 0, 0.17, 5.0); kanone.add(mr);
  // Gunner's sight (EMES) at front right, block with glass
  tower.add(box(0.55, 0.32, 0.75, COLORS.olivDark, 0.95, 0.9, 0.85));
  tower.add(box(0.4, 0.2, 0.04, COLORS.glass, 0.95, 0.92, 1.23));
  // Rundblickperiskop des Kommandanten (PERI) hinten rechts
  const peri = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.45, 8), mat(COLORS.olivDark));
  peri.position.set(0.95, 1.0, -0.75); tower.add(peri);
  tower.add(box(0.36, 0.26, 0.36, COLORS.olivBrightness, 0.95, 1.34, -0.75));
  tower.add(box(0.26, 0.14, 0.04, COLORS.glass, 0.95, 1.36, -0.56));
  // Commander's hatch and loader's hatch with MG
  const luke1 = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.1, 10), mat(COLORS.olivBrightness));
  luke1.position.set(0.55, 0.84, -1.35); tower.add(luke1);
  const luke2 = luke1.clone(); luke2.position.set(-0.75, 0.84, -0.7); tower.add(luke2);
  const mg = barrel(0.035, 0.03, 1.0, COLORS.black, 6); mg.position.set(-0.75, 1.02, -0.6); tower.add(mg);
  tower.add(box(0.12, 0.16, 0.3, COLORS.black, -0.75, 0.97, -0.75));
  // Nebelwurfbecher seitlich (je 8 in zwei Reihen)
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 6), mat(COLORS.olivDark));
    b.rotation.z = s * -1.1; b.rotation.x = -0.5;
    b.position.set(s * 1.72, 0.55 + j * 0.15, -0.6 - i * 0.16); tower.add(b);
  }
  // Team color: stripes on both turret sides and identification panel at the rear
  for (const s of [-1, 1]) {
    const st = box(0.03, 0.16, 1.6, team, s * 1.69, 0.5, -1.15);
    st.material = mat(team, { emissive: team, emissiveIntensity: 0.15 }); st.name = 'teamColor'; tower.add(st);
  }
  const tail = box(0.9, 0.2, 0.03, team, 0, 0.42, -2.84); tail.name = 'teamColor'; tower.add(tail);
  // Antennen
  for (const [x, z] of [[-1.25, -1.9], [1.25, -1.9]]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.8, 4), mat(COLORS.black));
    a.position.set(x, 1.65, z); tower.add(a);
  }

  tank.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return tank;
}

export function countTriangles(obj) {
  let n = 0;
  obj.traverse(o => { if (o.isMesh) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return Math.round(n);
}
