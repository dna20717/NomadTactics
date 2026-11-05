// Browser loader: JSON via fetch, PNG via an image element into an engine image.
import { Bitmap } from '../engine/image.js';

export function browserLoader(basis) {
  const url = p => new URL(p, basis).href;
  const cache = new Map();
  return {
    basis,
    async json(p) {
      const r = await fetch(url(p), { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
      return r.json();
    },
    image(p) {
      if (!cache.has(p)) cache.set(p, loadImage(url(p)));
      return cache.get(p);
    },
    async has(p) { try { return (await fetch(url(p), { method: 'HEAD' })).ok; } catch { return false; } },
  };
}

// Load via fetch + Blob: also works where <img> may only use data:/blob: (artifacts).
async function loadImage(src) {
  const r = await fetch(src);
  if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return new Bitmap(c.width, c.height, d.data);
}

// Engine image → canvas (for fast drawing with drawImage)
export function asCanvas(image, mask = null, px = null) {
  const c = document.createElement('canvas');
  if (px) {
    const [x, y, w, h] = px;
    c.width = w; c.height = h;
    const part = new Bitmap(w, h);
    part.draw(image, x, y, w, h, 0, 0, { mask });
    c.getContext('2d').putImageData(new ImageData(part.data, w, h), 0, 0);
  } else {
    c.width = image.w; c.height = image.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.w, image.h), 0, 0);
  }
  return c;
}
