// NomadTactics – Party: top-down 2D view of the battle (quick overview; the voxel diorama is battle_3d.js).
// Draws only, never touches the simulation: reads units/projectiles/events. Input lives in battle_input.js
// and talks to the view through project/unproject/pan/zoom/centreOn.

import { ROUND_MS } from '../../engine/net/protocol.js';

const TAU = Math.PI * 2;
const toRad = (a) => (a / 256) * TAU;
// body sizes in metres (length, width)
const BODY = { tank: [7.2, 3.6], spaeher: [5.2, 2.6], werfer: [6.4, 2.9], dozer: [6, 3.4] };

export function battleView({ cv, app, meSeat, playerList, toast }) {
  const g = cv.getContext('2d');
  const cam = { zoom: 1, cx: null, cy: null };
  let mapCanvas = null, mapFor = null;
  let effects = [], wrecks = [];
  let shown = true;

  // ---------- camera ----------
  function frame() {
    const w = cv.clientWidth, h = cv.clientHeight, top = 56, bottom = 44;
    const size = app.ls?.sim?.map.size || 256000;
    const fit = Math.min((w - 24) / size, (h - top - bottom) / size);
    if (cam.cx == null) { cam.cx = size / 2; cam.cy = size / 2; }
    const s = fit * cam.zoom;
    return { s, ox: w / 2 - cam.cx * s, oy: top + (h - top - bottom) / 2 - cam.cy * s, w, h, size };
  }
  const toWorld = (px, py) => { const { s, ox, oy } = frame(); return [(px - ox) / s, (py - oy) / s]; };
  function clampCam() {
    const size = app.ls?.sim?.map.size || 256000;
    cam.zoom = Math.max(1, Math.min(6, cam.zoom));
    cam.cx = Math.max(0, Math.min(size, cam.cx)); cam.cy = Math.max(0, Math.min(size, cam.cy));
  }

  // ---------- map picture (once per map) ----------
  function mapPicture(sim) {
    if (mapFor === sim.map) return mapCanvas;
    const m = sim.map, n = m.n, P = 4;
    const c = document.createElement('canvas'); c.width = c.height = n * P;
    const x = c.getContext('2d');
    const terrains = sim.world.terrains || {};
    const rgb = m.grounds.map((id) => hex(terrains[id]?.color || '#6f9a4a'));
    const levelAt = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? 0 : m.level[j * n + i]);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let [r, gg, b] = rgb[m.ground[k]];
      const l = m.level[k];
      const lift = l * 22;
      // tiny static noise per cell, so fields do not look like flat paint
      const noise = ((Math.imul(k, 2654435761) >>> 24) % 13) - 6;
      // shadow on the low side of a cliff (light comes from the top left)
      const shade = levelAt(i - 1, j - 1) > l || levelAt(i, j - 1) > l || levelAt(i - 1, j) > l ? -30 : 0;
      x.fillStyle = `rgb(${clamp(r + lift + noise + shade)},${clamp(gg + lift + noise + shade)},${clamp(b + lift + noise + shade)})`;
      x.fillRect(i * P, j * P, P, P);
      if (m.ramp[k]) {
        x.fillStyle = 'rgba(255,255,255,.10)';
        if ((i + j) % 2 === 0) x.fillRect(i * P, j * P, P, P);
      }
    }
    // cliff edges
    x.strokeStyle = 'rgba(20,18,14,.75)'; x.lineWidth = 1.5; x.beginPath();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (i + 1 < n && m.level[k] !== m.level[k + 1] && !(m.ramp[k] || m.ramp[k + 1])) { x.moveTo((i + 1) * P, j * P); x.lineTo((i + 1) * P, (j + 1) * P); }
      if (j + 1 < n && m.level[k] !== m.level[k + n] && !(m.ramp[k] || m.ramp[k + n])) { x.moveTo(i * P, (j + 1) * P); x.lineTo((i + 1) * P, (j + 1) * P); }
    }
    x.stroke();
    // trees: little dots on forest cells
    const forest = m.grounds.indexOf('forest');
    for (let k = 0; k < n * n; k++) if (m.ground[k] === forest && (Math.imul(k, 40503) >>> 28) < 6) {
      const i = k % n, j = (k - i) / n;
      x.fillStyle = 'rgba(14,40,18,.85)'; x.beginPath(); x.arc(i * P + 2, j * P + 2, 3.2, 0, TAU); x.fill();
      x.fillStyle = 'rgba(80,130,70,.6)'; x.beginPath(); x.arc(i * P + 1.4, j * P + 1.4, 1.4, 0, TAU); x.fill();
    }
    mapCanvas = c; mapFor = sim.map;
    return c;
  }

  // ---------- events → effects ----------
  function drain(sim, skip) {
    const now = performance.now();
    if (skip) { sim.events.length = 0; return; }
    const me = meSeat();
    for (const e of sim.events) {
      if (e.kind === 'shot') effects.push({ kind: 'shot', p: e.projectile, x: e.x, y: e.y, tx: e.tx, ty: e.ty, t0: now, dur: Math.max(60, e.time * 50) });
      else if (e.kind === 'impact') effects.push({ kind: 'boom', x: e.x, y: e.y, r: e.splash || (e.projectile === 2 ? 1500 : 500), t0: now, dur: e.splash ? 450 : 200 });
      else if (e.kind === 'dead') {
        const t = sim.types[e.type];
        effects.push({ kind: 'boom', x: e.x, y: e.y, r: t?.cls === 'infantry' ? 900 : t?.building ? 14000 : 5500, t0: now, dur: t?.building ? 1400 : 700, big: true });
        if (t && t.cls !== 'infantry') wrecks.push({ x: e.x, y: e.y, h: e.h, model: t.shape || t.model, building: t.building, radius: t.radius, t0: now });
      } else if (e.kind === 'wave') {
        effects.push({ kind: 'ring', x: e.x, y: e.y, r: 16000, t0: now, dur: 1200, seat: e.seat });
        if (e.seat === me) toast(`Welle ${e.n}: Verstärkung ist gelandet`);
      } else if (e.kind === 'out') {
        const p = playerList().find((x) => x.seat === e.seat);
        toast(e.seat === me ? 'Du bist raus.' : `${p?.name ?? 'Jemand'} ist raus.`);
      }
    }
    sim.events.length = 0;
    if (effects.length > 500) effects = effects.slice(-500);
    wrecks = wrecks.filter((w) => now - w.t0 < 25000);
  }

  // ---------- draw ----------
  function draw(before, beforeTime) {
    const d = window.devicePixelRatio || 1;
    const W = Math.round(cv.clientWidth * d), H = Math.round(cv.clientHeight * d);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = css('--ui-canvas', '#0e0e10'); g.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    const sim = app.ls?.sim;
    if (app.view !== 'game' || !sim || !shown) return;
    const { s, ox, oy, size } = frame();
    const now = performance.now();
    const t = Math.min(1, (now - beforeTime) / ROUND_MS);
    const pos = (u) => { const v = before?.get(u.id); return v ? [v[0] + (u.x - v[0]) * t, v[1] + (u.y - v[1]) * t] : [u.x, u.y]; };
    const X = (x) => ox + x * s, Y = (y) => oy + y * s, L = (m) => m * s;

    // plate with a little diorama border
    g.save();
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.fillStyle = '#3a2f24'; g.fillRect(X(0) - 10, Y(0) - 10, L(size) + 20, L(size) + 20);
    g.restore();
    g.imageSmoothingEnabled = cam.zoom < 2.5;
    g.drawImage(mapPicture(sim), X(0), Y(0), L(size), L(size));

    const colors = Object.fromEntries(playerList().map((x) => [x.seat, x.color]));
    const me = meSeat();
    const sel = app.selection;
    for (const id of [...sel]) if (!sim.byId.has(id)) sel.delete(id);

    // wrecks
    for (const w of wrecks) {
      const a = Math.min(1, (25000 - (now - w.t0)) / 3000);
      g.globalAlpha = a * .85;
      if (w.building) { g.fillStyle = '#2a2622'; g.beginPath(); g.arc(X(w.x), Y(w.y), L(w.radius), 0, TAU); g.fill(); }
      else body(X(w.x), Y(w.y), w.h, w.model, '#2b2925', '#1b1a18', s);
      g.globalAlpha = 1;
    }

    // order lines of the own selection
    g.lineWidth = 1.2; g.setLineDash([5, 5]); g.lineDashOffset = -now / 40;
    for (const u of sim.units) {
      if (app.hud || !sel.has(u.id) || u.seat !== me) continue;
      const [x, y] = pos(u);
      if (u.order === 1) { g.strokeStyle = 'rgba(255,255,255,.45)'; line(X(x), Y(y), X(u.gx), Y(u.gy)); }
      else if (u.order === 2) { const e = sim.byId.get(u.tgt); if (e) { g.strokeStyle = 'rgba(255,90,80,.6)'; const [ex, ey] = pos(e); line(X(x), Y(y), X(ex), Y(ey)); } }
    }
    g.setLineDash([]);

    // units: buildings, infantry, vehicles
    const list = [...sim.units].sort((a, b) => rank(sim, a) - rank(sim, b));
    for (const u of list) {
      const ty = sim.types[u.type];
      const [x, y] = pos(u);
      const col = colors[u.seat] || '#999';
      if (ty.building) pad(X(x), Y(y), L(ty.radius), col, u);
      else if (ty.air) {
        // companion drone: small cross with the team colour
        const r = Math.max(3, L(1400)), a = toRad(u.h) + Math.PI / 4;
        g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2.6;
        for (const q of [0, Math.PI / 2]) line(X(x) - Math.cos(a + q) * r, Y(y) - Math.sin(a + q) * r, X(x) + Math.cos(a + q) * r, Y(y) + Math.sin(a + q) * r);
        g.strokeStyle = col; g.lineWidth = 1.4;
        for (const q of [0, Math.PI / 2]) line(X(x) - Math.cos(a + q) * r, Y(y) - Math.sin(a + q) * r, X(x) + Math.cos(a + q) * r, Y(y) + Math.sin(a + q) * r);
      } else if (ty.cls === 'infantry') {
        const r = Math.max(2.2, L(650));
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(X(x) + r * .3, Y(y) + r * .3, r, 0, TAU); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(X(x), Y(y), r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke();
      } else {
        const e = u.tgt ? sim.byId.get(u.tgt) : null;
        const aim = e ? Math.atan2(e.y - y, e.x - x) : toRad(u.h);
        body(X(x), Y(y), u.h, ty.shape || ty.model, col, shade(col, -45), s, aim);
      }
      if (sel.has(u.id)) {
        g.strokeStyle = '#fff'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X(x), Y(y), Math.max(5, L(ty.radius + 600)), 0, TAU); g.stroke();
      }
      if (ty.building || (!app.hud && (u.hp < ty.hp || sel.has(u.id)))) bar(X(x), Y(y) - Math.max(7, L(ty.radius + 1200)), Math.max(14, L(ty.radius * 2)), u.hp / ty.hp);
    }

    // projectiles and effects
    effects = effects.filter((f) => now - f.t0 < f.dur);
    for (const f of effects) {
      const k = (now - f.t0) / f.dur;
      if (f.kind === 'shot') {
        const px = f.x + (f.tx - f.x) * k, py = f.y + (f.ty - f.y) * k;
        if (f.p <= 1) { g.strokeStyle = `rgba(255,230,150,${1 - k})`; g.lineWidth = 1; line(X(f.x + (f.tx - f.x) * Math.max(0, k - .4)), Y(f.y + (f.ty - f.y) * Math.max(0, k - .4)), X(px), Y(py)); }
        else if (f.p === 3) { // rocket with a small arc and smoke trail
          const lift = Math.sin(k * Math.PI) * Math.hypot(f.tx - f.x, f.ty - f.y) * .18;
          g.fillStyle = 'rgba(200,200,200,.35)';
          for (let q = 1; q < 5; q++) { const kk = Math.max(0, k - q * .03); const l2 = Math.sin(kk * Math.PI) * Math.hypot(f.tx - f.x, f.ty - f.y) * .18; g.beginPath(); g.arc(X(f.x + (f.tx - f.x) * kk), Y(f.y + (f.ty - f.y) * kk - l2), 1.5 + q * .5, 0, TAU); g.fill(); }
          g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(X(px), Y(py - lift), 2, 0, TAU); g.fill();
        } else if (f.p === 4) { g.strokeStyle = `rgba(120,220,255,${1 - k})`; g.lineWidth = 2; line(X(f.x), Y(f.y), X(f.tx), Y(f.ty)); }
        else { g.fillStyle = '#fff2c0'; g.beginPath(); g.arc(X(px), Y(py), 1.8, 0, TAU); g.fill(); }
      } else if (f.kind === 'boom') {
        const r = Math.max(2, L(f.r) * (.4 + k * .8));
        g.fillStyle = f.big ? `rgba(255,${150 - k * 100},60,${(1 - k) * .8})` : `rgba(255,220,140,${(1 - k) * .7})`;
        g.beginPath(); g.arc(X(f.x), Y(f.y), r, 0, TAU); g.fill();
        if (f.big) { g.strokeStyle = `rgba(60,50,40,${(1 - k) * .6})`; g.lineWidth = 2; g.beginPath(); g.arc(X(f.x), Y(f.y), r * 1.3, 0, TAU); g.stroke(); }
      } else if (f.kind === 'ring') {
        g.strokeStyle = (colors[f.seat] || '#fff') + hexAlpha(1 - k); g.lineWidth = 2;
        g.beginPath(); g.arc(X(f.x), Y(f.y), L(f.r) * (.3 + k), 0, TAU); g.stroke();
      }
    }

    // local feedback right away (before the round with the command arrives)
    const p = app.pending;
    if (p && now - p.time < 700 && !app.hud) {
      const a = 1 - (now - p.time) / 700;
      g.strokeStyle = p.attack ? `rgba(255,90,80,${a})` : `rgba(242,193,78,${a})`; g.lineWidth = 2;
      g.beginPath(); g.arc(X(p.x), Y(p.y), 6 + (1 - a) * 16, 0, TAU); g.stroke();
      g.beginPath(); g.arc(X(p.x), Y(p.y), 3, 0, TAU); g.stroke();
    }

    // selection frame
    const z = app.drag;
    if (z?.frame) {
      g.strokeStyle = css('--ui-acc-line', '#f2c14e'); g.fillStyle = 'rgba(242,193,78,.08)'; g.lineWidth = 1;
      g.fillRect(z.x0, z.y0, z.x - z.x0, z.y - z.y0); g.strokeRect(z.x0 + .5, z.y0 + .5, z.x - z.x0, z.y - z.y0);
    }

    function body(cx, cy, h, model, col, dark, sc, aim) {
      const [len, wid] = BODY[model] || [5.5, 3];
      const a = toRad(h);
      g.save(); g.translate(cx, cy); g.rotate(a);
      const l = Math.max(9, len * 1000 * sc), w = Math.max(5, wid * 1000 * sc);
      g.fillStyle = 'rgba(0,0,0,.35)'; rr(-l / 2 + 2, -w / 2 + 2, l, w, 2); g.fill();
      g.fillStyle = dark; rr(-l / 2, -w / 2, l, w, 2); g.fill();         // tracks / wheels
      g.fillStyle = col; rr(-l / 2 + 1, -w / 2 + w * .18, l - 2, w * .64, 2); g.fill();
      if (model === 'werfer') { g.fillStyle = '#7a1f1a'; rr(-l / 2 + 1, -w * .28, l * .45, w * .56, 1); g.fill(); g.fillStyle = '#1b1b1b'; rr(-l / 2 + 1 + l * .08, -w * .16, l * .3, w * .32, 1); g.fill(); }
      if (model === 'dozer') { g.fillStyle = '#e8c02c'; g.fillRect(l / 2 - 2, -w / 2 - 1, 3, w + 2); }
      g.restore();
      if (model === 'tank' || model === 'spaeher') {
        const r = model === 'tank' ? Math.max(3, 1.4 * 1000 * sc) : Math.max(2, .8 * 1000 * sc);
        const barrel = model === 'tank' ? Math.max(8, 5 * 1000 * sc) : Math.max(4, 2 * 1000 * sc);
        g.strokeStyle = dark; g.lineWidth = Math.max(1.5, (model === 'tank' ? .45 : .3) * 1000 * sc);
        line(cx, cy, cx + Math.cos(aim) * barrel, cy + Math.sin(aim) * barrel);
        g.fillStyle = shade(col, 18); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
        g.strokeStyle = dark; g.lineWidth = 1; g.stroke();
      }
    }
    function pad(cx, cy, r, col, u) {
      g.fillStyle = 'rgba(0,0,0,.35)'; rr(cx - r + 3, cy - r + 3, r * 2, r * 2, r * .2); g.fill();
      g.fillStyle = '#4a4a4c'; rr(cx - r, cy - r, r * 2, r * 2, r * .2); g.fill();
      g.strokeStyle = col; g.lineWidth = Math.max(2, r * .12); rr(cx - r * .86, cy - r * .86, r * 1.72, r * 1.72, r * .15); g.stroke();
      g.fillStyle = '#e8e8e8'; g.font = `700 ${Math.max(10, r * 1.1)}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('H', cx, cy + 1); g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    }
    function bar(cx, y, w, f) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(cx - w / 2 - 1, y - 1, w + 2, 5);
      g.fillStyle = f > .6 ? '#5ad16a' : f > .3 ? '#f2c14e' : '#e2524a'; g.fillRect(cx - w / 2, y, w * Math.max(0, f), 3);
    }
  }
  function line(a, b, c, d) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

  // ---------- camera interface for battle_input.js ----------
  function project(x, y) { const { s, ox, oy } = frame(); return [ox + x * s, oy + y * s]; }
  function pixelsPerMm() { return frame().s; }
  function pan(dx, dy) { const { s } = frame(); cam.cx -= dx / s; cam.cy -= dy / s; clampCam(); }
  function zoom(f, px, py) {
    const [wx, wy] = toWorld(px, py);
    cam.zoom *= f; clampCam();
    const { s, ox, oy } = frame();
    cam.cx += wx - (px - ox) / s; cam.cy += wy - (py - oy) / s; clampCam();
  }
  function centreOn(x, y, keepZoom = false) { cam.cx = x; cam.cy = y; if (!keepZoom && cam.zoom < 2) cam.zoom = 2; clampCam(); }
  // world point in metres → screen (height lifts a little so labels sit above the unit)
  function projectWorld(x, y, z) { const [px, py] = project(x * 1000, z * 1000); return { x: px, y: py - Math.min(14, Math.max(0, y) * 4) }; }
  function reset() { cam.zoom = 1; cam.cx = null; cam.cy = null; effects = []; wrecks = []; }
  function show(on) { shown = on; }

  return { draw, drain, reset, project, unproject: toWorld, pixelsPerMm, pan, zoom, centreOn, show, kind: '2d', projectWorld };

}

function rank(sim, u) { const t = sim.types[u.type]; return t.building ? 0 : t.air ? 3 : t.cls === 'infantry' ? 1 : 2; }
function hex(c) { const v = parseInt(c.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function shade(c, d) { const [r, g, b] = hex(c); return `rgb(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)})`; }
function hexAlpha(a) { return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0'); }
function css(n, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback; }
