// Shared building blocks for editor UIs: context menu, select field with search, number by dragging.
import { icon } from './icons.js';

export const el = (tag, attr = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of children.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

// One open overlay (menu or search list) at a time; closes on click outside and on Esc
let isOpen = null;
export function closeOverlay() { isOpen?.closeFn(); }
function openOverlay(node, closeFn) {
  closeOverlay();
  const way = e => { if (!node.contains(e.target)) { e.stopPropagation(); e.preventDefault(); end(); } };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); end(); } };
  const end = () => { if (isOpen?.node !== node) return; isOpen = null; node.remove(); removeEventListener('pointerdown', way, true); removeEventListener('keydown', esc, true); closeFn?.(); };
  isOpen = { node, closeFn: end };
  document.body.append(node);
  setTimeout(() => addEventListener('pointerdown', way, true));
  addEventListener('keydown', esc, true);
  return end;
}
// Fenster im sichtbaren Bereich halten
function place(k, x, y, evadeX) {
  const b = k.offsetWidth, h = k.offsetHeight, W = innerWidth, H = innerHeight;
  if (x + b > W - 6) x = evadeX != null ? evadeX - b : W - b - 6;
  if (y + h > H - 6) y = Math.max(6, H - h - 6);
  k.style.left = Math.max(6, x) + 'px'; k.style.top = Math.max(6, y) + 'px';
}

// ---------- Context menu ----------
// entries: [{ text, icon?, short?, action?, off?: true (disabled), on?: true (checkmark), red?, below?: [...] } | '-' ]
export function showMenu(x, y, entries, title) {
  const construct = (list, depth) => {
    const box = el('div', { class: 'ed-cmenu', role: 'menu' });
    if (title && !depth) box.append(el('div', { class: 'ed-cmenu-title' }, title));
    let belowIsOpen = null;
    for (const e of list.filter(Boolean)) {
      if (e === '-') { if (box.lastChild && !box.lastChild.classList.contains('ed-cmenu-separator')) box.append(el('div', { class: 'ed-cmenu-separator' })); continue; }
      const b = el('button', { class: 'ed-cmenu-point' + (e.red ? ' red' : '') + (e.below ? ' hat-unter' : ''), disabled: !!e.off, role: 'menuitem' },
        el('span', { class: 'ed-cmenu-icon' }, e.on ? icon('check', 15) : e.icon ? icon(e.icon, 15) : ''),
        el('span', { class: 'ed-cmenu-text' }, e.text),
        e.short ? el('kbd', {}, e.short) : null, e.below ? icon('right', 14, 'ed-cmenu-arrow') : null);
      const openBelow = () => {
        belowIsOpen?.remove();
        if (!e.below?.length) return;
        const u = construct(e.below, depth + 1); u.classList.add('below');
        document.body.append(u);
        const r = b.getBoundingClientRect();
        place(u, r.right - 2, r.top - 4, r.left + 2);
        belowIsOpen = u; end.below.push(u);
      };
      if (e.below) { b.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') openBelow(); }); b.addEventListener('click', openBelow); }
      else b.addEventListener('click', () => { end(); e.action?.(); });
      if (!e.below) b.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') { belowIsOpen?.remove(); belowIsOpen = null; } });
      box.append(b);
    }
    if (box.lastChild?.classList?.contains('ed-cmenu-separator')) box.lastChild.remove();
    return box;
  };
  const root = el('div', { class: 'ed-cmenu-root' });
  const end = openOverlay(root, () => end.below.forEach(u => u.remove()));
  end.below = [];
  // Submenus are attached to the body: clicks on them do not count as "outside"
  root.contains = n => Node.prototype.contains.call(root, n) || end.below.some(u => u.contains(n));
  const box = construct(entries, 0);
  root.append(box);
  place(box, x, y);
  return end;
}

// ---------- Select field with search (for references) ----------
// opt: { options: [{ stat, name, info?, icon? }], stat, empty?: 'text for ""' (then selectable), onChoice(stat), title?, full? }
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function suchChoice(opt) {
  const list = [...(opt.empty != null ? [{ stat: '', name: opt.empty, empty: true }] : []), ...opt.options];
  const current = list.find(o => String(o.stat) === String(opt.stat ?? ''));
  const button = el('button', { type: 'button', class: 'ed-choice ed-searchPick' + (opt.full ? ' full' : '') + (current?.empty || !current ? ' empty' : ''), title: opt.title || '' },
    el('span', { class: 'ed-searchPick-text' }, current ? current.name : (opt.stat ? `${opt.stat} (fehlt)` : opt.empty ?? '—')), icon('down', 14));
  button.addEventListener('click', ev => {
    const search = el('input', { type: 'search', class: 'ed-field', placeholder: 'Suchen …', autocomplete: 'off' });
    const box = el('div', { class: 'ed-searchList' }), hit = el('div', { class: 'ed-searchList-hit' });
    box.append(search, hit);
    let visible = [], idx = 0;
    const select = o => { end(); if (String(o.stat) !== String(opt.stat ?? '')) opt.onChoice(o.stat); };
    const draw = () => {
      const q = norm(search.value);
      visible = list.filter(o => !q || norm(o.name).includes(q) || norm(o.stat).includes(q) || norm(o.info).includes(q)).slice(0, 300);
      idx = Math.max(0, Math.min(idx, visible.length - 1));
      hit.replaceChildren(...visible.map((o, i) => el('button', { type: 'button', class: 'ed-searchList-point' + (i === idx ? ' focus' : '') + (String(o.stat) === String(opt.stat ?? '') ? ' on' : ''), onclick: () => select(o) },
        o.icon ? icon(o.icon, 14) : null, el('span', {}, o.name), o.info || (!o.empty && o.name !== o.stat) ? el('small', {}, o.info || o.stat) : null)),
        ...(visible.length ? [] : [el('p', { class: 'ed-small' }, 'Nichts gefunden.')]));
      hit.querySelector('.focus')?.scrollIntoView({ block: 'nearest' });
    };
    search.addEventListener('input', () => { idx = 0; draw(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { idx++; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && visible[idx]) { select(visible[idx]); e.preventDefault(); }
    });
    const end = openOverlay(box);
    const r = button.getBoundingClientRect();
    box.style.minWidth = Math.max(220, r.width) + 'px';
    idx = Math.max(0, list.findIndex(o => String(o.stat) === String(opt.stat ?? '')));
    draw();
    place(box, r.left, r.bottom + 2);
    if (ev.pointerType !== 'touch') search.focus();
  });
  return button;
}

// ---------- Number by dragging the label (like in Affinity/Photoshop) ----------
// grip: the element to drag (label); inp: the number field
// opt: { schritt = 1, min, max, start(), live(wert), ende() }
export function draggable(grip, inp, opt = {}) {
  grip.classList.add('ed-draggable');
  grip.title = (grip.title ? grip.title + ' · ' : '') + 'Ziehen ändert den Wert (Shift = fein)';
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target === inp) return;
    e.preventDefault();
    grip.setPointerCapture?.(e.pointerId);
    const x0 = e.clientX, basis = inp.value === '' ? +(inp.placeholder || 0) || 0 : +inp.value;
    const step = opt.step || +inp.step || 1, decimals = Math.max(0, (String(step).split('.')[1] || '').length + 1);
    let moved = false;
    const moveBy = ev => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; opt.start?.(); document.body.classList.add('ed-drags-number'); }
      let v = basis + Math.round(dx / (ev.shiftKey ? 16 : 5)) * (ev.shiftKey ? step / 4 : step);
      if (opt.min != null) v = Math.max(opt.min, v);
      if (opt.max != null) v = Math.min(opt.max, v);
      v = +v.toFixed(decimals);
      if (String(v) === inp.value) return;
      inp.value = v; opt.live?.(v);
    };
    const up = () => {
      grip.removeEventListener('pointermove', moveBy); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      document.body.classList.remove('ed-drags-number');
      if (moved) opt.end?.(); else { inp.focus(); inp.select?.(); }
    };
    grip.addEventListener('pointermove', moveBy); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
}

// ---------- Dialog: uniform for all editor windows ----------
// Layout: title with icon on the left, close cross on the right; content; secondary buttons bottom left,
// „Abbrechen“ bottom right and the main action (gold) at the far right. Button rule 1.3: dialogs bottom right,
// Vollbild-Arbeitsfenster (Grafik-Fenster) oben rechts im Kopf. Esc = Abbrechen, Enter = Hauptaktion
// (not in multi-line fields). Without a main action, a tap next to the window also closes it.
// opt: { titel, icon?, breit?, inhalt: [Elemente], links?: [Elemente], haupt?: { text, icon?, gefahr?, aktion(): false = offen lassen },
//        cancel?: 'Abbrechen' | 'Schließen' | false, onDone?() }
export function openDialogue(opt) {
  const error = el('p', { class: 'ed-error' });
  let isOpen = true;
  const closeFn = () => { if (!isOpen) return; isOpen = false; dlg.remove(); removeEventListener('keydown', taste, true); opt.onDone?.(); };
  const go = async () => {
    if (!opt.main || buttonMain.disabled) return;
    error.textContent = '';
    try { if ((await opt.main.action({ error: t => (error.textContent = t) })) !== false) closeFn(); }
    catch (e) { error.textContent = e.message; }
  };
  const taste = e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeFn(); }
    else if (e.key === 'Enter' && opt.main && !e.shiftKey && document.activeElement?.tagName !== 'TEXTAREA' && dlg.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); go(); }
  };
  const buttonMain = opt.main ? el('button', { class: 'ed-button wide ' + (opt.main.hazard ? 'red' : 'main'), onclick: go }, opt.main.icon ? icon(opt.main.icon, 16) : null, opt.main.icon ? ' ' + opt.main.text : opt.main.text) : null;
  const abbr = opt.cancel === false ? null : el('button', { class: 'ed-button wide', onclick: closeFn }, opt.cancel || (opt.main ? 'Abbrechen' : 'Schließen'));
  const dlg = el('div', { class: 'ed-dialogue' + (opt.class ? ' ' + opt.class : ''), onclick: e => { if (e.target === dlg && !opt.main) closeFn(); } },
    el('div', { class: 'ed-dialogue-box' + (opt.wide ? ' wide' : ''), role: 'dialogue', 'aria-label': opt.title },
      el('div', { class: 'ed-dialogue-head' }, el('h3', {}, opt.icon ? icon(opt.icon, 20) : null, opt.icon ? ' ' + opt.title : opt.title), el('span', { class: 'ed-grow' }),
        el('button', { class: 'ed-button small', title: 'Schließen (Esc)', onclick: closeFn }, icon('x', 16))),
      ...(opt.content || []), error,
      el('div', { class: 'ed-dialogue-foot' }, ...(opt.left || []), el('span', { class: 'ed-grow' }), abbr, buttonMain)));
  document.body.append(dlg);
  addEventListener('keydown', taste, true);
  setTimeout(() => dlg.querySelector('input:not([type=file]):not([type=checkbox]), textarea, select')?.focus());
  return { dlg, closeFn, error: t => (error.textContent = t), main: buttonMain };
}

// ---------- Small text input as a dialog (instead of prompt, which doesn't work in the artifact) ----------
export function askText(title, label, suggestion = '', hint = '') {
  return new Promise(done => {
    const inp = el('input', { type: 'text', class: 'ed-field', value: suggestion });
    let stat = null;
    openDialogue({ title, content: [el('div', { class: 'ed-row' }, el('label', {}, label + ' '), inp), hint ? el('p', { class: 'ed-small' }, hint) : null].filter(Boolean),
      main: { text: 'OK', icon: 'check', action: () => { stat = inp.value.trim() || null; } }, onDone: () => done(stat) });
    setTimeout(() => inp.select());
  });
}

// ---------- Inspector header (rule 1.3): kind small, name large, below it the ID small and editable ----------
// Same in the map, data and assets inspectors and in the graphics window. rename(neu) receives a sanitized ID.
export const cleanId = s => String(s || '').trim().toLowerCase().replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9_]/g, '_');
export function idRow(id, { rename, onlyRead = false, empty = 'ohne ID', title, emptyAllowed = false } = {}) {
  const inp = el('input', { class: 'as-id', value: id || '', placeholder: empty, spellcheck: 'false', readonly: onlyRead || !rename || null,
    title: title || (onlyRead || !rename ? 'ID (fest)' : 'ID – ändern benennt um, Verweise ziehen mit') });
  if (!onlyRead && rename) {
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = id || ''; inp.blur(); } });
    inp.addEventListener('change', () => { const n = cleanId(inp.value); if (n === (id || '') || (!n && !emptyAllowed)) { inp.value = id || ''; return; } if (rename(n) === false) inp.value = id || ''; });
  }
  return el('div', { class: 'as-idRow' }, el('span', {}, 'ID'), inp);
}
// opt: { art, artIcon, titel, id, umbenennen, nurLesen, unter, rechts: [Elemente] }
export function inspectorHead({ kind, kindIcon, title, id, rename, onlyRead, below, right = [], empty, emptyAllowed, class: class_ = '' }) {
  return el('div', { class: 'as-ihead ' + class_ },
    kind ? el('div', { class: 'as-ihead-row' }, el('span', { class: 'as-ikind' }, kindIcon ? icon(kindIcon, 14) : null, kind), el('span', { class: 'ed-grow' }), ...right) : null,
    el('h3', {}, title),
    id !== undefined ? idRow(id, { rename, onlyRead, empty, emptyAllowed }) : null,
    below ? el('div', { class: 'ed-small' }, below) : null);
}

// Color from the design tokens (for canvas backgrounds that follow the theme)
export function uiColor(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}
