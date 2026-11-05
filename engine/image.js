// Software image: RGBA buffer with the operations that renderers and tools need.
// Runs identically in the browser and in Node. No dependency on canvas.
import { textWidth, drawText } from './font.js';

export class Bitmap {
  constructor(width, height, data) {
    this.w = width | 0;
    this.h = height | 0;
    this.data = data || new Uint8ClampedArray(this.w * this.h * 4);
  }

  static color(hex, alpha = 255) {
    if (Array.isArray(hex)) return [hex[0], hex[1], hex[2], hex[3] ?? alpha];
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alpha];
  }

  fill(color) {
    const [r, g, b, a] = Bitmap.color(color);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
    }
    return this;
  }

  // Recolored copy (placeholder figures): rotate hue, scale saturation and brightness.
  // Pixels with a hue in the "schonen" range (default: skin tones) and almost-gray pixels stay as they are.
  recolored({ hue = 0, saturation = 1, brightness = 1, spare = [8, 42] } = {}) {
    const new_ = new Bitmap(this.w, this.h, new Uint8ClampedArray(this.data)), d = new_.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min;
      let h = 0, s = 0;
      if (c > 0) {
        s = c / (1 - Math.abs(2 * l - 1));
        h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
        h = (h * 60 + 360) % 360;
      }
      const spared = spare && h >= spare[0] && h <= spare[1] && s > 0.2 && l > 0.35;
      if (s < 0.12 || spared) { if (brightness !== 1) { d[i] *= brightness; d[i + 1] *= brightness; d[i + 2] *= brightness; } continue; }
      h = (h + hue + 360) % 360; s = Math.min(1, s * saturation);
      const l2 = Math.min(1, l * brightness), c2 = (1 - Math.abs(2 * l2 - 1)) * s, x = c2 * (1 - Math.abs((h / 60) % 2 - 1)), m = l2 - c2 / 2;
      const [r1, g1, b1] = h < 60 ? [c2, x, 0] : h < 120 ? [x, c2, 0] : h < 180 ? [0, c2, x] : h < 240 ? [0, x, c2] : h < 300 ? [x, 0, c2] : [c2, 0, x];
      d[i] = (r1 + m) * 255; d[i + 1] = (g1 + m) * 255; d[i + 2] = (b1 + m) * 255;
    }
    return new_;
  }

  // Farben exakt tauschen: { "#c42430": "#7a3a8a", … } (Paletten-Tausch, z. B. andere Hemdfarbe)
  swapped(swap = {}) {
    const new_ = new Bitmap(this.w, this.h, new Uint8ClampedArray(this.data)), d = new_.data, map = new Map();
    const number = h => parseInt(String(h).replace('#', ''), 16);
    for (const [a, b] of Object.entries(swap)) map.set(number(a), number(b));
    if (!map.size) return new_;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const z = map.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (z !== undefined) { d[i] = z >> 16; d[i + 1] = (z >> 8) & 255; d[i + 2] = z & 255; }
    }
    return new_;
  }

  pixel(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  // Blend one pixel with alpha.
  mix(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, d = this.data;
    if (a >= 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    const k = a / 255, ok = d[i + 3] / 255, na = k + ok * (1 - k);
    d[i] = (r * k + d[i] * ok * (1 - k)) / na;
    d[i + 1] = (g * k + d[i + 1] * ok * (1 - k)) / na;
    d[i + 2] = (b * k + d[i + 2] * ok * (1 - k)) / na;
    d[i + 3] = na * 255;
  }

  rect(x, y, w, h, color) {
    const [r, g, b, a] = Bitmap.color(color);
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w)), y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.mix(xx, yy, r, g, b, a);
  }

  frame(x, y, w, h, color, thickness = 1) {
    this.rect(x, y, w, thickness, color);
    this.rect(x, y + h - thickness, w, thickness, color);
    this.rect(x, y, thickness, h, color);
    this.rect(x + w - thickness, y, thickness, h, color);
  }

  line(x0, y0, x1, y1, color) {
    const [r, g, b, a] = Bitmap.color(color);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.mix(x0, y0, r, g, b, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Draw a section of another image into this one.
  // opt: spiegeln (horizontal flip), alpha (0..1), hell (brightness factor), maske (Uint8Array for section pixels)
  draw(source, sx, sy, sw, sh, dx, dy, opt = {}) {
    const alpha = opt.alpha ?? 1, brightness = opt.brightness ?? 1, mirror = !!opt.mirror, mask = opt.mask;
    dx = Math.round(dx); dy = Math.round(dy);
    const q = source.data, qw = source.w;
    for (let y = 0; y < sh; y++) {
      const ty = dy + y; if (ty < 0 || ty >= this.h) continue;
      const qy = sy + y; if (qy < 0 || qy >= source.h) continue;
      for (let x = 0; x < sw; x++) {
        const tx = dx + x; if (tx < 0 || tx >= this.w) continue;
        const qx = sx + (mirror ? sw - 1 - x : x); if (qx < 0 || qx >= qw) continue;
        if (mask && !mask[(mirror ? sw - 1 - x : x) + y * sw]) continue;
        const i = (qy * qw + qx) * 4, a = q[i + 3] * alpha;
        if (a <= 0) continue;
        this.mix(tx, ty, q[i] * brightness, q[i + 1] * brightness, q[i + 2] * brightness, a);
      }
    }
  }

  // Scale the whole image (integer only, pixels stay sharp).
  scaled(factor) {
    if (factor === 1) return this;
    const n = new Bitmap(this.w * factor, this.h * factor);
    for (let y = 0; y < n.h; y++) for (let x = 0; x < n.w; x++) {
      const i = ((y / factor | 0) * this.w + (x / factor | 0)) * 4, j = (y * n.w + x) * 4;
      n.data[j] = this.data[i]; n.data[j + 1] = this.data[i + 1]; n.data[j + 2] = this.data[i + 2]; n.data[j + 3] = this.data[i + 3];
    }
    return n;
  }

  crop(x, y, w, h) {
    const n = new Bitmap(w, h);
    n.draw(this, x, y, w, h, 0, 0);
    return n;
  }

  // Sichtbarer Bereich (Alpha > 0) innerhalb eines Rechtecks.
  bound(x, y, w, h) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (this.pixel(xx, yy)[3] > 0) { if (xx < x0) x0 = xx; if (yy < y0) y0 = yy; if (xx > x1) x1 = xx; if (yy > y1) y1 = yy; }
    }
    if (x1 < 0) return null;
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  // Connected pixels from a start point within a rectangle (8-neighborhood).
  // Liefert {px:[x,y,w,h], maske}.
  cutOut(x, y, w, h, sx, sy) {
    const sight = (xx, yy) => xx >= x && yy >= y && xx < x + w && yy < y + h && this.pixel(xx, yy)[3] > 0;
    if (!sight(sx, sy)) {
      let best = null, bd = Infinity;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (sight(xx, yy)) {
        const d = (xx - sx) ** 2 + (yy - sy) ** 2; if (d < bd) { bd = d; best = [xx, yy]; }
      }
      if (!best) return null;
      [sx, sy] = best;
    }
    const visited = new Uint8Array(w * h), stack = [[sx, sy]];
    let x0 = sx, y0 = sy, x1 = sx, y1 = sy;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (!sight(cx, cy) || visited[(cy - y) * w + (cx - x)]) continue;
      visited[(cy - y) * w + (cx - x)] = 1;
      if (cx < x0) x0 = cx; if (cy < y0) y0 = cy; if (cx > x1) x1 = cx; if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) stack.push([cx + dx, cy + dy]);
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, mask = new Uint8Array(bw * bh);
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) mask[yy * bw + xx] = visited[(y0 + yy - y) * w + (x0 + xx - x)];
    return { px: [x0, y0, bw, bh], mask };
  }

  text(t, x, y, color = '#ffffff', opt = {}) {
    drawText(this, t, x, y, color, opt);
  }

  static textWidth(t, opt) { return textWidth(t, opt); }
}
