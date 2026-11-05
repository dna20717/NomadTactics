// NomadTactics – reads MagicaVoxel / Voxel Max files (.vox) into the model format of models.js.
// .vox is z-up; here y is up. The model is centred on x/z and stands on y = 0.
// Front: the negative end of the longer horizontal axis becomes +z (matches Daniel's first tank, barrel towards −x);
// with { forward: '+x' | '-x' | '+y' | '-y' } (models.json › forward) it can be set per model.
// Team colour: every strongly magenta voxel (like the agreed bright pink) becomes 'team'.

import { newModel } from './models.js';

export function readVox(buffer, { forward = null } = {}) {
  const d = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const tag = (p) => String.fromCharCode(d.getUint8(p), d.getUint8(p + 1), d.getUint8(p + 2), d.getUint8(p + 3));
  if (tag(0) !== 'VOX ') throw new Error('Keine .vox-Datei');
  let size = null, voxels = null, palette = null;
  // header (8 bytes), then MAIN: id, content size, children size; the children follow
  const n0 = d.getInt32(12, true), m0 = d.getInt32(16, true);
  let p = 20 + n0;
  const stop = Math.min(d.byteLength, 20 + n0 + m0);
  while (p + 12 <= stop) {
    const id = tag(p), n = d.getInt32(p + 4, true), m = d.getInt32(p + 8, true), q = p + 12;
    if (id === 'SIZE' && !size) size = [d.getInt32(q, true), d.getInt32(q + 4, true), d.getInt32(q + 8, true)];
    else if (id === 'XYZI' && !voxels) {
      const k = d.getInt32(q, true);
      voxels = [];
      for (let i = 0; i < k; i++) voxels.push([d.getUint8(q + 4 + i * 4), d.getUint8(q + 5 + i * 4), d.getUint8(q + 6 + i * 4), d.getUint8(q + 7 + i * 4)]);
    } else if (id === 'RGBA') {
      palette = [];
      for (let i = 0; i < 256; i++) palette.push([d.getUint8(q + i * 4), d.getUint8(q + i * 4 + 1), d.getUint8(q + i * 4 + 2)]);
    }
    p = q + n + m;
    if (n < 0 || m < 0) break;
  }
  if (!size || !voxels) throw new Error('.vox ohne Modell');
  const color = (ci) => {
    const [r, g, b] = palette ? palette[ci - 1] : [200, 200, 200];
    if (r > 200 && b > 170 && g < 110) return 'team';
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  };
  // bounding box of the voxels (Voxel Max saves a big canvas, the model sits somewhere inside)
  const lo = [255, 255, 255], hi = [0, 0, 0];
  for (const v of voxels) for (let i = 0; i < 3; i++) { if (v[i] < lo[i]) lo[i] = v[i]; if (v[i] > hi[i]) hi[i] = v[i]; }
  // forward axis: explicit or the longer of x / y
  const f = forward || (hi[0] - lo[0] >= hi[1] - lo[1] ? '-x' : '-y');
  const [W, s] = newModel();
  const cx = Math.floor((lo[0] + hi[0]) / 2), cy = Math.floor((lo[1] + hi[1]) / 2);
  for (const [x, y, zz, ci] of voxels) {
    const z = zz - lo[2];
    let a = x - cx, b = y - cy; // a/b: horizontal, z: up
    let wx, wz;
    if (f === '+x') { wz = a; wx = -b; } else if (f === '-x') { wz = -a; wx = b; }
    else if (f === '+y') { wz = b; wx = a; } else { wz = -b; wx = -a; }
    s(wx, z, wz, color(ci));
  }
  return { model: W, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1], count: voxels.length };
}
