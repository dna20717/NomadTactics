// NomadTactics – 2D layer above the playing field: health and experience bars, veteran chevrons, march lines,
// Klick-Quittung, Erfahrungs-Funken, Aufstiegs-Blitz, Auswahlrahmen. Reine Optik.

export class Overlay {
  constructor(root) {
    this.cv = document.createElement('canvas'); this.cv.className = 'hud-overlay'; root.prepend(this.cv);
    this.g = this.cv.getContext('2d'); this.acks = []; this.sparks = []; this.texts = []; this.flashes = []; this.time = 0;
    this.size(); addEventListener('resize', () => this.size());
  }
  size() {
    const pr = Math.min(2, devicePixelRatio || 1); this.pr = pr;
    this.cv.width = innerWidth * pr; this.cv.height = innerHeight * pr; this.cv.style.width = innerWidth + 'px'; this.cv.style.height = innerHeight + 'px';
  }
  clear(dt) { this.time += dt; const g = this.g; g.setTransform(this.pr, 0, 0, this.pr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight); }

  // March line: ground points (already projected) as a dashed double line, dashes run in the direction of travel
  line(points, color, border, { target = true, speed = 1, alpha = 1 } = {}) {
    if (points.length < 2) return;
    const g = this.g; g.save(); g.globalAlpha = alpha; g.lineCap = 'round'; g.lineJoin = 'round';
    const path = () => { g.beginPath(); g.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y); };
    g.setLineDash([9, 7]); g.lineDashOffset = -this.time * 28 * speed;
    path(); g.strokeStyle = border; g.lineWidth = 4.5; g.stroke();
    path(); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    g.setLineDash([]);
    if (target) {   // Little flag at the target
      const p = points[points.length - 1];
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 18); g.strokeStyle = border; g.lineWidth = 4; g.stroke(); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(p.x, p.y - 18); g.lineTo(p.x + 11, p.y - 14); g.lineTo(p.x, p.y - 10); g.closePath();
      g.fillStyle = color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = border; g.stroke();
      g.beginPath(); g.ellipse(p.x, p.y, 5, 2.5, 0, 0, Math.PI * 2); g.fillStyle = border; g.fill();
    }
    g.restore();
  }

  // Health bar (segmented), below it a thin experience bar, next to it a chevron per tier
  gauge(x, y, width, health, experience, tiers, colors) {
    const g = this.g, h = 5, left = Math.round(x - width / 2), top = Math.round(y);
    g.fillStyle = colors.border; g.fillRect(left - 1, top - 1, width + 2, h + 2 + (experience != null ? 4 : 0));
    const c = health > 0.6 ? colors.good : health > 0.3 ? colors.warn : colors.hostile;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(left, top, width, h);
    g.fillStyle = c; g.fillRect(left, top, Math.max(0, width * health), h);
    g.fillStyle = colors.border; for (let s = 1; s < 5; s++) g.fillRect(left + Math.round(width * s / 5), top, 1, h);
    if (experience != null) { g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(left, top + h + 1, width, 2); g.fillStyle = '#ffcf4a'; g.fillRect(left, top + h + 1, width * experience, 2); }
    for (let i = 0; i < tiers; i++) this.angle(left + width + 7, top + 7 - i * 4, colors.border);
  }
  angle(x, y, border) {
    const g = this.g; g.beginPath(); g.moveTo(x - 4.5, y - 2); g.lineTo(x, y + 1.5); g.lineTo(x + 4.5, y - 2);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = border; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#ffcf4a'; g.lineWidth = 2; g.stroke();
  }

  ack(x, y, color) { this.acks.push({ x, y, t: 0, color }); }
  spark(x, y, n = 3) { for (let i = 0; i < Math.min(12, n); i++) this.sparks.push({ x: x + (Math.random() - 0.5) * 14, y: y - Math.random() * 6, vx: (Math.random() - 0.5) * 24, vy: -30 - Math.random() * 40, t: 0, T: 0.7 + Math.random() * 0.5 }); }
  text(x, y, text, color = '#ffcf4a') { this.texts.push({ x, y, text, color, t: 0 }); }
  flash(x, y) { this.flashes.push({ x, y, t: 0 }); }

  // Acknowledgments, sparks, texts and flashes are attached to screen points; follow(wert) returns the current point of a unit
  effects(dt, colors) {
    const g = this.g;
    for (let i = this.acks.length - 1; i >= 0; i--) {
      const q = this.acks[i]; q.t += dt; const f = q.t / 0.45; if (f >= 1) { this.acks.splice(i, 1); continue; }
      const r = 6 + f * 22; g.globalAlpha = 1 - f;
      g.beginPath(); g.ellipse(q.x, q.y, r, r * 0.5, 0, 0, Math.PI * 2); g.strokeStyle = colors.border; g.lineWidth = 4; g.stroke(); g.strokeStyle = q.color; g.lineWidth = 2; g.stroke();
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const b = this.flashes[i]; b.t += dt; const f = b.t / 0.7; if (f >= 1) { this.flashes.splice(i, 1); continue; }
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, 20 + f * 60);
      gr.addColorStop(0, `rgba(255, 236, 160, ${0.85 * (1 - f)})`); gr.addColorStop(1, 'rgba(255, 200, 80, 0)');
      g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, 20 + f * 60, 0, Math.PI * 2); g.fill();
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i]; p.t += dt; if (p.t >= p.T) { this.sparks.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt;
      g.globalAlpha = 1 - p.t / p.T; g.fillStyle = '#ffd55c'; g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      g.fillStyle = 'rgba(255, 245, 200, 0.9)'; g.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
    }
    g.font = '700 13px Inter, sans-serif'; g.textAlign = 'center';
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.t += dt; if (t.t >= 2.2) { this.texts.splice(i, 1); continue; }
      const y = t.y - 24 - t.t * 16; g.globalAlpha = Math.min(1, (2.2 - t.t) * 2);
      g.lineWidth = 4; g.strokeStyle = colors.border; g.strokeText(t.text, t.x, y); g.fillStyle = t.color; g.fillText(t.text, t.x, y);
    }
    g.globalAlpha = 1;
  }

  frame(a, b, color) {
    const g = this.g, x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3; g.strokeRect(x, y, w, h); g.strokeStyle = color; g.lineWidth = 1.2; g.strokeRect(x, y, w, h);
  }
}
