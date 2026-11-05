// NomadTactics – Party: mouse, touch and keys for the battle. Shared by the 2D and the 3D view.
// Works in screen space through the active view (project/unproject), so picking and frame selection
// behave the same in both. Sends only commands; the simulation is never touched.
// With the HUD (app.hud) the HUD owns selection, orders and its keys; this module then only moves the camera:
// right/middle drag pans (left drag too when the HUD setting „Linksziehen: Kamera“ is on), wheel zooms,
// arrows pan, Shift+arrows turn, one finger pans (unless the touch bar wants a frame), two fingers pan/zoom/turn, Space = own landing pad, Tab = 2D/3D, P = pause.

export function battleInput({ el, app, send, meSeat, view }) {
  const keys = new Set();
  const groups = {};
  const sim = () => app.ls?.sim;
  const own = () => { const s = sim(); const me = meSeat(); return s ? s.units.filter((u) => u.seat === me && !s.types[u.type].building) : []; };

  // nearest unit under the pointer, in screen pixels
  function hitUnit(px, py, pred) {
    const s = sim(); if (!s) return null;
    const v = view();
    let best = null, bd = Infinity;
    for (const u of s.units) {
      if (!pred(u)) continue;
      const [ux, uy] = v.project(u.x, u.y, u);
      const r = Math.max(11, v.pixelsPerMm(u.x, u.y) * (s.types[u.type].radius + 600));
      const d = Math.hypot(ux - px, uy - py);
      if (d < r && d < bd) { best = u; bd = d; }
    }
    return best;
  }
  function order(x, y, ids, target = null) {
    if (!ids.length) return;
    app.pending = { x, y, time: performance.now(), attack: !!target };
    if (target) send({ t: 'command', b: { kind: 'attack', ids, target: target.id } });
    else send({ t: 'command', b: { kind: 'drive', ids, x, y } });
  }
  app.command = (x, y, ids) => order(x, y, ids);
  app.ownItems = own;

  // two-finger gestures on the iPad: pinch = zoom, move = pan, twist = rotate (3D)
  const touches = new Map();
  let gesture = null;

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (app.view !== 'game') return;
    try { el.setPointerCapture(e.pointerId); } catch {}   // synthetic pointers (tests) cannot be captured
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (touches.size === 2) { app.drag = null; gesture = startGesture(); return; }
      if (touches.size > 2) return;
      if (app.hud?.touchFrame && touches.size === 1) return;   // touch bar „Rahmen“: the HUD draws the frame
    }
    const leftPans = app.hud && e.button === 0 && app.leftDragCamera;
    if (app.hud && e.button === 0 && !leftPans && e.pointerType !== 'touch') return; // the HUD selects
    app.drag = { x0: e.offsetX, y0: e.offsetY, x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, frame: false, pan: false, right: e.button === 2, middle: e.button === 1 || leftPans, shift: e.shiftKey };
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (gesture && touches.size === 2) { moveGesture(); return; }
    }
    const z = app.drag;
    if (!z) { hover(e); return; }
    z.x = e.offsetX; z.y = e.offsetY;
    const far = Math.hypot(z.x - z.x0, z.y - z.y0) > 8;
    if ((z.right || z.middle) && far) z.pan = true;
    else if (!z.right && !z.middle && far) { if (app.hud) z.pan = true; else z.frame = true; }
    if (z.pan) { view().pan(z.x - z.lx, z.y - z.ly); }
    z.lx = z.x; z.ly = z.y;
  });
  const up = (e) => {
    if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (gesture) { if (touches.size === 0) gesture = null; app.drag = null; return; } }
    const z = app.drag; app.drag = null;
    const s = sim();
    if (!z || !s || z.pan || z.middle || app.spectator || app.hud) return;
    const me = meSeat();
    if (z.frame) {
      const x0 = Math.min(z.x0, z.x), x1 = Math.max(z.x0, z.x), y0 = Math.min(z.y0, z.y), y1 = Math.max(z.y0, z.y);
      if (!z.shift) app.selection.clear();
      const v = view();
      for (const u of own()) { const [px, py] = v.project(u.x, u.y, u); if (px >= x0 && px <= x1 && py >= y0 && py <= y1) app.selection.add(u.id); }
      return;
    }
    const mine = hitUnit(z.x, z.y, (u) => u.seat === me && !s.types[u.type].building);
    if (!z.right && mine) {
      if (z.shift) { app.selection.has(mine.id) ? app.selection.delete(mine.id) : app.selection.add(mine.id); }
      else { app.selection.clear(); app.selection.add(mine.id); }
      return;
    }
    if (!app.selection.size) return;
    const enemy = hitUnit(z.x, z.y, (u) => u.seat !== me);
    const [wx, wy] = view().unproject(z.x, z.y);
    const size = s.map.size;
    order(Math.max(0, Math.min(size - 1, Math.round(wx))), Math.max(0, Math.min(size - 1, Math.round(wy))), [...app.selection], enemy);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); gesture = null; app.drag = null; });

  function startGesture() {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  function moveGesture() {
    const g = startGesture(), v = view();
    v.pan(g.mx - gesture.mx, g.my - gesture.my);
    if (gesture.d > 20) v.zoom(g.d / gesture.d, g.mx, g.my);
    let da = g.ang - gesture.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    v.rotate?.(da);
    gesture = g;
  }

  el.addEventListener('dblclick', (e) => {
    const s = sim(); if (!s || app.hud) return;
    const me = meSeat();
    const u = hitUnit(e.offsetX, e.offsetY, (x) => x.seat === me && !s.types[x.type].building);
    if (!u) return;
    const v = view(), w = el.clientWidth, h = el.clientHeight;
    for (const x of own()) if (x.type === u.type) {
      const [px, py] = v.project(x.x, x.y, x);
      if (px >= 0 && py >= 0 && px <= w && py <= h) app.selection.add(x.id);
    }
  });
  function hover(e) {
    if (!sim() || !app.selection.size || app.hud) { el.style.cursor = ''; return; }
    el.style.cursor = hitUnit(e.offsetX, e.offsetY, (u) => u.seat !== meSeat()) ? 'crosshair' : '';
  }
  el.addEventListener('wheel', (e) => {
    if (app.view !== 'game') return;
    e.preventDefault();
    view().zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (app.view !== 'game' || e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (app.hud) {   // the HUD has the letter keys (QWER/ASDF/ZXCV, H, digits, Esc …)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); keys.turn = e.shiftKey; e.preventDefault(); }
      else if (k === 'tab') { e.preventDefault(); app.toggleView?.(); }
      else if (k === ' ' || k === 'home') { e.preventDefault(); home(); }
      else if (k === 'p') send({ t: app.state?.pause?.reason === 'manual' ? 'next' : 'pause' });
      else if (k === '+' || k === '=') view().zoom(1.25, el.clientWidth / 2, el.clientHeight / 2);
      else if (k === '-') view().zoom(0.8, el.clientWidth / 2, el.clientHeight / 2);
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k) && !e.ctrlKey && !e.metaKey) keys.add(k);
    if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); app.selection = new Set(own().map((u) => u.id)); }
    else if (k === 'escape') app.selection.clear();
    else if (k === 'h') { const ids = [...app.selection]; if (ids.length) send({ t: 'command', b: { kind: 'halt', ids } }); }
    else if (k === 'p') send({ t: app.state?.pause?.reason === 'manual' ? 'next' : 'pause' });
    else if (k === ' ' || k === 'home') { e.preventDefault(); home(); }
    else if (k === 'v') app.toggleView?.();
    else if (k === '+' || k === '=') view().zoom(1.25, el.clientWidth / 2, el.clientHeight / 2);
    else if (k === '-') view().zoom(0.8, el.clientWidth / 2, el.clientHeight / 2);
    else if (/^[1-9]$/.test(k)) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); groups[k] = [...app.selection]; app.toast?.(`Gruppe ${k} gespeichert`); }
      else if (groups[k]) {
        const again = app.lastGroup === k && performance.now() - app.lastGroupTime < 400;
        app.selection = new Set(e.shiftKey ? [...app.selection, ...groups[k]] : groups[k]);
        app.lastGroup = k; app.lastGroupTime = performance.now();
        if (again) centreOn([...app.selection]);
      }
    }
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') keys.turn = false; });
  window.addEventListener('blur', () => keys.clear());

  // called every frame by the page
  function step(dt) {
    if (!keys.size || app.view !== 'game') return;
    if (app.hud && document.activeElement?.closest?.('input, textarea')) return;
    const v = view(), p = 700 * dt;
    let dx = 0, dy = 0;
    if (app.hud) {   // arrows only; with Shift they turn the 3D camera
      const turn = keys.turn && (keys.has('arrowleft') || keys.has('arrowright'));
      if (turn) { if (keys.has('arrowleft')) v.rotate?.(-1.6 * dt); if (keys.has('arrowright')) v.rotate?.(1.6 * dt); }
      if (!turn && keys.has('arrowleft')) dx += p;
      if (!turn && keys.has('arrowright')) dx -= p;
      if (keys.has('arrowup')) dy += p;
      if (keys.has('arrowdown')) dy -= p;
      if (dx || dy) v.pan(dx, dy);
      return;
    }
    if (keys.has('a') || keys.has('arrowleft')) dx += p;
    if (keys.has('d') || keys.has('arrowright')) dx -= p;
    if (keys.has('w') || keys.has('arrowup')) dy += p;
    if (keys.has('s') || keys.has('arrowdown')) dy -= p;
    if (dx || dy) v.pan(dx, dy);
    if (keys.has('q')) v.rotate?.(-1.6 * dt);
    if (keys.has('e')) v.rotate?.(1.6 * dt);
  }
  function centreOn(ids) {
    const s = sim(); if (!s) return;
    const us = ids.map((id) => s.byId.get(id)).filter(Boolean);
    if (!us.length) return;
    view().centreOn(us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.y, 0) / us.length);
  }
  function home() {
    const s = sim(); if (!s) return;
    const p = s.units.find((u) => u.seat === meSeat() && s.types[u.type].building);
    if (p) view().centreOn(p.x, p.y);
  }
  function reset() { for (const k in groups) delete groups[k]; }
  return { step, home, reset };
}
