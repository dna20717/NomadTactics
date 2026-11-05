// Shared core building block: graph surface for trees (Cosy: skill trees, Tactics: tech tree).
// Drag node = move, drag from the ● point and release on another node = prerequisite,
// tap line = unlink, double-tap into empty space = new node. Cycles are prevented.
//
// opt.knoten: [[id, { pos: [x, y], voraus: [ids], name, symbol, farbe, kosten: [[farbe, text]], klasse?, titel? }]]
// opt.chosen, opt.onChoice(id), opt.onMove(id, pos), opt.onConnect(from, to), opt.onUnlink(to, from),
// opt.onNew?(pos), opt.onEmpty?(), opt.hint?(text), opt.connectable?(from, to) -> false | text (reason)
import { el } from './ui.js';

export function treeSurface(opt) {
  const X = opt.X ?? 150, Y = opt.Y ?? 104, R = 24, border = 70;
  const node = opt.node, toId = new Map(node);
  const xs = node.map(([, k]) => k.pos?.[0] ?? 0), ys = node.map(([, k]) => k.pos?.[1] ?? 0);
  const minx = Math.min(0, ...xs), miny = Math.min(0, ...ys);
  const width = (Math.max(2, ...xs) - minx + 2) * X + border * 2, height = (Math.max(2, ...ys) - miny + 2) * Y + border * 2;
  const toPx = p => [(p[0] - minx) * X + border, (p[1] - miny) * Y + border];
  const fromPx = (x, y) => [Math.round(((x - border) / X + minx) * 2) / 2, Math.round(((y - border) / Y + miny) * 2) / 2];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', height); svg.setAttribute('class', 'da-lines');
  const surface = el('div', { class: 'da-surface', style: `width:${width}px;height:${height}px` }, svg);
  const wrap = el('div', { class: 'da-tree' }, surface);
  const line = (x1, y1, x2, y2) => { const my = (y1 + y2) / 2; return `M${x1},${y1 + R} C${x1},${my} ${x2},${my} ${x2},${y2 - R}`; };
  // Is "from" reachable from "to" via prerequisites? (cycle check)
  const reached = (from, to) => { const st = [from], g = new Set(); while (st.length) { const x = st.pop(); if (x === to) return true; if (g.has(x)) continue; g.add(x); st.push(...(toId.get(x)?.requires || [])); } return false; };
  for (const [kid, k] of node) for (const v of k.requires || []) {
    const a = toId.get(v); if (!a) continue;
    const [x1, y1] = toPx(a.pos || [0, 0]), [x2, y2] = toPx(k.pos || [0, 0]);
    const pth = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pth.setAttribute('d', line(x1, y1, x2, y2)); pth.setAttribute('class', 'da-link');
    pth.addEventListener('click', () => opt.onUnlink(kid, v));
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = `${a.name || v} → ${k.name || kid} (antippen löscht)`; pth.append(t);
    svg.append(pth);
  }
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path'); preview.setAttribute('class', 'da-preview'); svg.append(preview);
  for (const [kid, k] of node) {
    const [x, y] = toPx(k.pos || [0, 0]);
    const cost = (k.cost || []).map(([f, n]) => el('i', { style: `background:${f}` }, String(n)));
    const grip = el('span', { class: 'da-grip', title: 'Ziehen: Voraussetzung für einen anderen Knoten' });
    const button = el('div', { class: 'da-node' + (opt.chosen === kid ? ' on' : '') + (k.class ? ' ' + k.class : ''), style: `left:${x}px;top:${y}px;--f:${k.color || '#999'}`, 'data-id': kid, title: k.title || null },
      el('span', { class: 'da-symbol' }, k.symbol || (k.name || kid)[0].toUpperCase()), el('span', { class: 'da-nodeName' }, k.name || kid), el('span', { class: 'da-cost' }, ...cost), grip);
    button.addEventListener('pointerdown', e => {
      if (e.target === grip) return;
      e.preventDefault(); button.setPointerCapture(e.pointerId);
      const r0 = surface.getBoundingClientRect(), start = [e.clientX, e.clientY]; let moved = false;
      const drag = ev => { if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 4) moved = true; if (moved) { button.style.left = `${ev.clientX - r0.left}px`; button.style.top = `${ev.clientY - r0.top}px`; } };
      const go = ev => {
        button.removeEventListener('pointermove', drag); button.removeEventListener('pointerup', go);
        if (moved) opt.onMove(kid, fromPx(ev.clientX - r0.left, ev.clientY - r0.top));
        else opt.onChoice(kid);
      };
      button.addEventListener('pointermove', drag); button.addEventListener('pointerup', go);
    });
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      const r0 = surface.getBoundingClientRect();
      const drag = ev => preview.setAttribute('d', `M${x},${y + R} L${ev.clientX - r0.left},${ev.clientY - r0.top}`);
      const go = ev => {
        grip.removeEventListener('pointermove', drag); grip.removeEventListener('pointerup', go); preview.setAttribute('d', '');
        const target = document.elementsFromPoint(ev.clientX, ev.clientY).map(n => n.closest?.('.da-node')).find(n => n && n.dataset.id !== kid);
        if (!target) return;
        const zid = target.dataset.id;
        if ((toId.get(zid)?.requires || []).includes(kid)) return;
        if (reached(kid, zid)) return opt.hint?.('Das ergäbe einen Kreis.');
        const reason = opt.connectable?.(kid, zid); if (reason) return opt.hint?.(reason);
        opt.onConnect(kid, zid);
      };
      grip.addEventListener('pointermove', drag); grip.addEventListener('pointerup', go);
    });
    surface.append(button);
  }
  if (opt.onNew) surface.addEventListener('dblclick', e => { if (e.target === surface || e.target === svg) { const r0 = surface.getBoundingClientRect(); opt.onNew(fromPx(e.clientX - r0.left, e.clientY - r0.top)); } });
  surface.addEventListener('click', e => { if ((e.target === surface || e.target === svg) && opt.chosen) opt.onEmpty?.(); });
  return wrap;
}
