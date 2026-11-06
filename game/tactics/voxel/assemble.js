// NomadTactics – one model from data/models.json, put together from its source, for every viewer
// (workshop preview, kit pictures). Sources: "kit:<type>" (kit.js), "prototype:<name>" (models.js), a path to a .vox file.
// Result: { hull, turret, pivot (voxels), scale (m per voxel), wheels?, legs?, rotors?, trackMid } – parts like in kit.js.
import { PROTOTYPES, landingPad, V } from './models.js';
import { buildKit } from './kit.js';
import { readVox } from './vox.js';

const voxCache = new Map();
export async function assemble(def, { base = null, skin = 0 } = {}) {
  const src = def?.source || '';
  if (src.startsWith('kit:')) {
    const type = src.slice(4);
    const k = buildKit(type, type === 'soldier' ? { ...(def.kit || {}), skin } : def.kit || {}, def.paint || 'usa');
    return { ...k, scale: def.scale || k.scale };
  }
  if (src === 'prototype:pad') return { hull: landingPad(31), turret: null, pivot: null, scale: def.scale || V };
  if (src.startsWith('prototype:')) {
    const p = PROTOTYPES[src.slice(10)] || PROTOTYPES.tank;
    return { hull: p.hull(), turret: p.turret ? p.turret() : null, pivot: p.pivot || null, scale: def.scale || p.scale || V };
  }
  if (!src) return null;
  const url = base ? new URL(src, base).href : src;
  if (!voxCache.has(url)) voxCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); }));
  const buf = await voxCache.get(url);
  return { hull: readVox(buf, { forward: def.forward || null }).model, turret: null, pivot: null, scale: def.scale || V };
}

// Size of a model in m (for camera distance): from the hull's voxel keys
export function extent(m) {
  let r = 0, top = 0;
  for (const W of [m.hull, m.turret].filter(Boolean)) for (const k of W.keys()) {
    const [x, y, z] = k.split(',').map(Number);
    r = Math.max(r, Math.hypot(x, z)); top = Math.max(top, y + 1 + (W === m.turret ? m.pivot?.[1] || 0 : 0));
  }
  return { radius: r * m.scale, height: top * m.scale };
}
