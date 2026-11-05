// NomadTactics – voxel models as plain data: Map "x,y,z" -> kind (palette name, 'team' or '#rrggbb').
// x = width, y = up, +z = front. One voxel = 0.4 m. No three.js in here; meshing lives in mesh.js.
// The unit models are the ones from the stress test (prototypes/nomadtactics/stress_test.js).

export const V = 0.4;

export const PAL = {
  oliv: [0x5f6a3e, 0x66714a, 0x5a653a], brown: [0x6e563c, 0x765e43], black: [0x34342e, 0x3a3a33],
  track: [0x33322e, 0x3a3934], metall: [0x7d8285, 0x868b8e], glass: [0x6fa7bd, 0x7bb3c8],
  concrete: [0xc9c6bd, 0xd1cec5, 0xc2bfb6], concreteDark: [0xa9a69e, 0xb1aea6], plaster: [0xe8dcbc, 0xeee3c5, 0xe2d6b5],
  roof: [0x5a5d63, 0x62656b, 0x55585e], sand: [0xcbb98a, 0xd2c092], holz: [0x8a6a48, 0x93724f], red: [0xc4473a, 0xc4473a],
  white: [0xffffff, 0xf6f7f9], sheet: [0x4f9a3c, 0x58a443, 0x478f36, 0x61ad4a], sheetDark: [0x3f7f30, 0x467f35, 0x3a7429],
  trunk: [0x7a5a3c, 0x82613f], skin: [0xd9a37c, 0xc68d68, 0x9c6b4c], pants: [0x3b4f73, 0x4a4a52],
  tires: [0x2b2a27, 0x312f2b], yellow: [0xe2b232, 0xe9bb3c, 0xdcab2c], yellowDark: [0xb98a22, 0xc09126],
  asphalt: [0x56585b, 0x5b5d60, 0x515356], paint: [0xeeeeea, 0xf4f4f0],
};

// Surface kind per voxel kind for the vehicle shader: 0 camo paint, 1 team paint, 2 metal, 3 rubber/fabric, 4 glass, 5 plain paint
export const SURFACE = { oliv: 0, brown: 0, sand: 0, team: 1, metall: 2, black: 2, track: 3, tires: 3, pants: 3, skin: 3, glass: 4,
  yellow: 5, yellowDark: 5, red: 5, concrete: 5, concreteDark: 5, white: 5, paint: 5, asphalt: 3, holz: 3 };

export const newModel = () => { const W = new Map(); return [W, (x, y, z, a) => W.set(`${x},${y},${z}`, a)]; };
export const box = (s, x0, x1, y0, y1, z0, z1, a) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) s(x, y, z, typeof a === 'function' ? a(x, y, z) : a); };

function tankHull() {
  const [W, s] = newModel();
  box(s, -4, -3, 0, 1, -9, 8, 'track'); box(s, 3, 4, 0, 1, -9, 8, 'track');
  box(s, -4, -4, 1, 1, -10, 9, 'oliv'); box(s, 4, 4, 1, 1, -10, 9, 'oliv');
  box(s, -2, 2, 1, 1, -9, 8, 'black');
  box(s, -4, 4, 2, 2, -10, 9, 'oliv');
  box(s, -4, 4, 3, 3, -10, 6, 'oliv');
  box(s, -3, 3, 4, 4, -10, -8, 'black');
  box(s, -5, -5, 2, 2, -6, 4, 'team'); box(s, 5, 5, 2, 2, -6, 4, 'team');
  return W;
}
function tankTurret() {
  const [W, s] = newModel();
  box(s, -4, 4, 0, 1, -4, 4, 'oliv');
  box(s, -3, 3, 0, 1, 5, 5, 'oliv');
  for (const x of [-2, -1, 1, 2]) box(s, x, x, 0, 1, 6, 6, 'oliv');
  box(s, -3, 3, 0, 0, -5, -5, (x) => (x % 2 ? 'black' : 'oliv'));
  s(0, 0, 6, 'black'); s(0, 1, 6, 'black');
  for (let z = 7; z <= 19; z++) s(0, 1, z, z >= 18 ? 'metall' : 'oliv');
  box(s, -2, 2, 2, 2, -3, 1, 'team');
  s(2, 2, 3, 'black'); s(2, 3, 3, 'metall');
  return W;
}
function launcherHull() {
  const [W, s] = newModel();
  box(s, -2, 2, 1, 1, -9, 8, 'black');
  for (const z of [-7, -6, -3, -2, 5, 6]) { box(s, -3, -3, 0, 1, z, z, 'tires'); box(s, 3, 3, 0, 1, z, z, 'tires'); }
  box(s, -3, 3, 2, 2, -9, 3, 'oliv');
  box(s, -3, 3, 2, 5, 4, 8, 'oliv');
  box(s, -2, 2, 4, 4, 8, 8, 'glass'); box(s, -3, -3, 4, 4, 5, 7, 'glass'); box(s, 3, 3, 4, 4, 5, 7, 'glass');
  box(s, -3, 3, 6, 6, 4, 7, 'team');
  box(s, -3, 3, 2, 2, 9, 9, 'black');
  return W;
}
function launcherTurret() {
  const [W, s] = newModel();
  box(s, -1, 1, 0, 0, -1, 1, 'metall');
  for (let z = -5; z <= 4; z++) {
    const y0 = 1 + Math.floor((z + 5) / 3);
    box(s, -3, 3, y0, y0 + 2, z, z, (x, y) => (z === 4 ? ((x + y) % 2 ? 'black' : 'red') : (y === y0 + 2 && Math.abs(x) <= 1 ? 'team' : 'oliv')));
  }
  return W;
}
function scoutHull() {
  const [W, s] = newModel();
  for (const z of [-4, -3, 3, 4]) { box(s, -3, -3, 0, 1, z, z, 'tires'); box(s, 3, 3, 0, 1, z, z, 'tires'); }
  box(s, -2, 2, 1, 1, -5, 5, 'black');
  box(s, -3, 3, 2, 2, -5, 5, 'oliv');
  box(s, -3, 3, 3, 3, -5, -5, 'oliv'); box(s, -3, -3, 3, 3, -5, 1, 'oliv'); box(s, 3, 3, 3, 3, -5, 1, 'oliv');
  box(s, -3, 3, 3, 3, 2, 5, (x) => (Math.abs(x) <= 2 ? 'team' : 'oliv'));
  box(s, -3, 3, 4, 4, 2, 2, 'glass');
  box(s, -2, -1, 3, 3, 0, 0, 'black'); box(s, 1, 2, 3, 3, 0, 0, 'black');
  return W;
}
function scoutTurret() {
  const [W, s] = newModel();
  box(s, 0, 0, 0, 1, 0, 0, 'metall');
  box(s, -1, 1, 2, 3, 1, 1, 'oliv');
  for (let z = 0; z <= 5; z++) s(0, 2, z, 'black');
  return W;
}
function dozer() {
  const [W, s] = newModel();
  box(s, -4, -3, 0, 1, -5, 4, 'track'); box(s, 3, 4, 0, 1, -5, 4, 'track');
  box(s, -2, 2, 1, 4, -5, 2, 'yellow'); box(s, -2, 2, 1, 1, -5, 2, 'yellowDark');
  box(s, -2, 2, 5, 7, -5, -2, (x, y, z) => (y === 6 && !(Math.abs(x) === 2 && (z === -5 || z === -2)) ? 'glass' : 'yellow'));
  box(s, -2, 2, 8, 8, -5, -2, 'team');
  box(s, 1, 1, 5, 7, 0, 0, 'black');
  box(s, -3, -3, 2, 2, 3, 5, 'black'); box(s, 3, 3, 2, 2, 3, 5, 'black');
  box(s, -5, 5, 0, 3, 6, 6, 'metall'); box(s, -5, 5, 0, 0, 7, 7, 'metall'); box(s, -5, 5, 3, 3, 5, 5, 'metall');
  return W;
}
function soldier() {
  const [W, s] = newModel();
  box(s, -1, -1, 0, 1, 0, 0, 'pants'); box(s, 0, 0, 0, 1, 0, 0, 'pants');
  box(s, -1, 0, 2, 3, 0, 0, 'team');
  box(s, -1, 0, 4, 4, 0, 0, 'skin');
  box(s, -1, 0, 5, 5, 0, 0, 'oliv');
  s(0, 3, 1, 'black'); s(0, 3, 2, 'black');
  return W;
}

// Landing pad: concrete plate with a white H and a team-coloured rim (size in voxels, odd)
export function landingPad(size = 31) {
  const [W, s] = newModel();
  const h = size >> 1;
  const H = (x, z) => (Math.abs(x) >= 3 && Math.abs(x) <= 4 && Math.abs(z) <= 6) || (Math.abs(x) <= 4 && Math.abs(z) <= 0);
  for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
    const rim = Math.abs(x) === h || Math.abs(z) === h;
    s(x, 0, z, 'concreteDark');
    s(x, 1, z, rim ? 'team' : H(x, z) ? 'paint' : (Math.abs(x) === h - 2 || Math.abs(z) === h - 2) && (x + z) % 2 === 0 ? 'yellow' : 'concrete');
  }
  for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]]) { s(x, 2, z, 'team'); s(x, 3, z, 'white'); }
  return W;
}

// Trees in a few sizes (crowns are spheres with holes)
export function tree(size = 1, seed = 0) {
  const [W, s] = newModel();
  const up = 3 + size;
  box(s, 0, 0, 0, up, 0, 0, 'trunk');
  const r0 = 2 + size;
  for (let y = up - 1; y <= up + 2 * r0; y++) {
    const t = (y - (up + r0)) / r0;
    const rr = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * r0);
    for (let x = -rr; x <= rr; x++) for (let z = -rr; z <= rr; z++)
      if (x * x + z * z <= rr * rr + 1 && ((x * 31 + z * 17 + y * 7 + seed) % 11) !== 0) s(x, y, z, y < up + r0 - 1 ? 'sheetDark' : 'sheet');
  }
  return W;
}

// Built-in models ("prototype:<name>" in data/models.json). pivot = turret pivot in voxels on the hull.
export const PROTOTYPES = {
  tank: { hull: tankHull, turret: tankTurret, pivot: [0, 4, -3] },
  werfer: { hull: launcherHull, turret: launcherTurret, pivot: [0, 3, -3] },
  spaeher: { hull: scoutHull, turret: scoutTurret, pivot: [0, 3, -2] },
  dozer: { hull: dozer },
  soldat: { hull: soldier },
};
