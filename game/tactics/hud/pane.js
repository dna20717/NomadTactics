// NomadTactics – "Everything is a window": one building block for all HUD parts.
// Windows are docked to an edge (top, bottom, left, right) or float freely.
// Dragging by the header detaches a window; releasing close to an edge docks it again. The layout is remembered.
import { icon } from '../../icons.js';

const BORDERS = ['top', 'bottom', 'left', 'right'];
const SNARE = 70;   // Pixel distance to the edge from which docking happens

export class PaneSystem {
  constructor(root, { invKey = 'nt.hud.layout' } = {}) {
    this.root = root; this.invKey = invKey; this.all = new Map();
    this.docks = {};
    for (const r of BORDERS) {
      const d = document.createElement('div'); d.className = 'hud-dock hud-dock-' + r; d.dataset.border = r;
      root.appendChild(d); this.docks[r] = d;
    }
    this.floating = document.createElement('div'); this.floating.className = 'hud-floating'; root.appendChild(this.floating);
    this.hint = document.createElement('div'); this.hint.className = 'hud-dock-hint'; root.appendChild(this.hint);
    try { this.layout = JSON.parse(localStorage.getItem(invKey) || '{}'); } catch { this.layout = {}; }
  }

  // id, titel, symbol (icon name), dock (default edge or null), reihe (order along the edge), breite, offen, schliessbar
  new(id, { title, symbol, dock = 'right', series = 0, width = null, isOpen = true, closable = false, class: class_ = '' } = {}) {
    const el = document.createElement('section');
    el.className = 'hud-pane ' + class_; el.dataset.id = id;
    el.innerHTML = `<header class="hud-head"><span class="hud-symbol"></span><span class="hud-title"></span><span class="hud-head-extra"></span>
      <button class="hud-k" data-k="to" title="Einklappen"></button>${closable ? '<button class="hud-k" data-k="x" title="Schließen"></button>' : ''}</header><div class="hud-content"></div>`;
    if (symbol) el.querySelector('.hud-symbol').appendChild(icon(symbol, 14));
    el.querySelector('.hud-title').textContent = title;
    el.querySelector('[data-k=to]').appendChild(icon('down', 13));
    if (closable) el.querySelector('[data-k=x]').appendChild(icon('x', 13));
    if (width) el.style.width = width;
    const remembered = this.layout[id] || {};
    const f = { id, el, content: el.querySelector('.hud-content'), extra: el.querySelector('.hud-head-extra'), dock: remembered.dock !== undefined ? remembered.dock : dock,
      series: remembered.series ?? series, width, x: remembered.x ?? 200, y: remembered.y ?? 120, to: remembered.to ?? false, standard: { dock, series } };
    this.all.set(id, f);
    el.classList.toggle('to', f.to);
    el.querySelector('[data-k=to]').onclick = () => { f.to = !f.to; el.classList.toggle('to', f.to); this.remember(); };
    if (closable) el.querySelector('[data-k=x]').onclick = () => this.show(id, false);
    this.draggable(f);
    this.place(f);
    if (!isOpen) el.hidden = true;
    return f;
  }

  show(id, on = true) { const f = this.all.get(id); if (!f) return; f.el.hidden = !on; if (on && !f.dock) this.inSight(f); }
  toggle(id) { const f = this.all.get(id); if (f) this.show(id, f.el.hidden); }

  place(f) {
    if (f.dock) {
      const d = this.docks[f.dock]; f.el.classList.remove('hovers'); f.el.style.left = f.el.style.top = ''; f.el.style.width = f.width || '';
      const neighbors = [...d.children].filter(c => (this.all.get(c.dataset.id)?.series ?? 0) > f.series);
      d.insertBefore(f.el, neighbors[0] || null);
      f.el.dataset.border = f.dock;
    } else {
      this.floating.appendChild(f.el); f.el.classList.add('hovers'); f.el.dataset.border = '';
      this.inSight(f);
    }
  }
  inSight(f) {
    f.x = Math.max(0, Math.min(innerWidth - 80, f.x)); f.y = Math.max(0, Math.min(innerHeight - 36, f.y));
    f.el.style.left = f.x + 'px'; f.el.style.top = f.y + 'px';
  }

  draggable(f) {
    const head = f.el.querySelector('.hud-head'); let move = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button !== 0) return;
      const b = f.el.getBoundingClientRect();
      move = { sx: e.clientX, sy: e.clientY, dx: e.clientX - b.left, dy: e.clientY - b.top, go: false, b };
      head.setPointerCapture(e.pointerId); e.stopPropagation();
    });
    head.addEventListener('pointermove', e => {
      if (!move) return;
      if (!move.go) {
        if (Math.hypot(e.clientX - move.sx, e.clientY - move.sy) < 5) return;
        move.go = true; f.dock = null; f.x = move.b.left; f.y = move.b.top; f.el.style.width = move.b.width + 'px'; this.place(f);
        this.root.classList.add('drags');
      }
      f.x = e.clientX - move.dx; f.y = e.clientY - move.dy; this.inSight(f);
      const r = this.borderAt(e.clientX, e.clientY);
      this.hint.dataset.border = r || ''; this.hint.classList.toggle('on', !!r);
    });
    const end = e => {
      if (!move) return;
      if (move.go) {
        const r = this.borderAt(e.clientX, e.clientY);
        if (r) { f.dock = r; f.series = this.seriesAt(r, e.clientX, e.clientY, f); this.place(f); }
        this.hint.classList.remove('on'); this.root.classList.remove('drags'); this.remember();
      }
      move = null;
    };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  }
  borderAt(x, y) {
    if (x < SNARE) return 'left'; if (x > innerWidth - SNARE) return 'right';
    if (y < SNARE) return 'top'; if (y > innerHeight - SNARE) return 'bottom';
    return null;
  }
  seriesAt(border, x, y, self) {
    const vertical = border === 'left' || border === 'right', pos = vertical ? y : x;
    let series = 0;
    for (const c of this.docks[border].children) {
      if (c === self.el) continue;
      const b = c.getBoundingClientRect(), center = vertical ? b.top + b.height / 2 : b.left + b.width / 2, o = this.all.get(c.dataset.id);
      if (pos > center) series = Math.max(series, (o?.series ?? 0) + 0.5);
    }
    return series;
  }
  remember() {
    const l = {};
    for (const [id, f] of this.all) l[id] = { dock: f.dock, series: f.series, x: Math.round(f.x), y: Math.round(f.y), to: f.to };
    this.layout = l;
    try { localStorage.setItem(this.invKey, JSON.stringify(l)); } catch {}
  }
  reset() {
    for (const f of this.all.values()) { f.dock = f.standard.dock; f.series = f.standard.series; f.to = false; f.el.classList.remove('to'); }
    for (const f of [...this.all.values()].sort((a, b) => a.series - b.series)) this.place(f);
    this.remember();
  }
}
