// NomadTactics – Party (MVP): join, lobby, trial game in lockstep via the party server.
// URL parameters for testing: ?name=Ava&auto=1 (join immediately), ?verz=150&zitter=60 (artificial delay in ms).

import { Connection } from '../../engine/net/connection.js';
import { Lockstep } from '../../engine/net/lockstep.js';
import { ROUND_MS, REASON, SYNC_EACH, COLORS, COLOR_NAMES, isBlue } from '../../engine/net/protocol.js';
import { newProbe, probeRun, WIDTH, HEIGHT, FIELD } from '../../engine/tactics/probe.js';
import { icon } from '../icons.js';

const q = new URLSearchParams(location.search);
const ui = document.getElementById('ui');
const cv = document.getElementById('field');
const g = cv.getContext('2d');
const NAME_KEY = 'nomadtactics-party-name';
const TOKEN_KEY = 'nomadtactics-party-token:' + location.host;

const app = {
  view: 'start',   // start | verbinde | lobby | spiel | abgelehnt
  connection: null, ls: null, state: null, timeOffset: 0,
  selection: new Set(), drag: null, marker: null,
  before: null, beforeTime: 0, message: '', check: null,
};
window.party = app; // for tests and the console

const store = (() => {
  try { sessionStorage.setItem('_t', '1'); sessionStorage.removeItem('_t'); } catch { return null; }
  return { lies: () => sessionStorage.getItem(TOKEN_KEY), write: (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY)) };
})();
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lies = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------- kleine DOM-Helfer ----------
function el(tag, attr = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of children.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const button = (text, onclick, class_ = '', ic = null, extra = {}) => el('button', { class: 'pt-button ' + class_, onclick, ...extra }, ic ? icon(ic, 16) : null, text);

// ---------- Verbinden ----------
function join(name) {
  name = (name || '').trim() || 'Spieler';
  remember(NAME_KEY, name);
  app.connection?.stop();
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/net';
  const test = { delay: Number(q.get('delay')) || 0, jitter: Number(q.get('jitter')) || 0 };
  const l = new Connection({ url, name, store, test });
  app.connection = l;
  app.view = 'connect';
  l.onStatus = (s, info) => {
    if (s === 'rejected') { app.view = 'rejected'; app.message = info?.text || 'Abgelehnt.'; app.superseded = info?.reason === 'superseded' ? true : info?.reason === 'out' ? 'out' : false; }
    drawUi();
  };
  l.on('welcome', (m) => {
    app.spectator = !!m.spectator;
    if (app.spectator) store?.write(null);
    if (app.view === 'connect' || app.view === 'rejected') app.view = app.ls ? 'game' : 'lobby';
    drawUi();
  });
  l.on('state', (m) => {
    app.state = m; app.timeOffset = m.now - Date.now();
    if (m.phase === 'lobby' && app.view !== 'start' && app.view !== 'rejected') { app.view = 'lobby'; app.ls = null; }
    drawUi();
  });
  l.on('match', (m) => {
    if (!app.ls) app.ls = new Lockstep(newProbe, { reportSync: reportSync });
    app.ls.match(m);
    app.view = 'game'; app.selection.clear(); app.before = null;
    drawUi();
  });
  l.on('round', (m) => { if (!app.ls) return; app.ls.round(m); if (app.ls.gap) { app.ls.gap = false; l.cut(); } });
  l.on('lobby', () => { app.ls = null; app.view = 'lobby'; drawUi(); });
  l.on('error', (m) => { app.message = m.text; drawUi(); setTimeout(() => { app.message = ''; drawUi(); }, 3000); });
  l.start();
  drawUi();
}

function reportSync(round, sum) {
  if (app.spectator) return;
  // When catching up (reconnecting) do not report every fifth round, only at the end and now and then
  if (app.ls && app.ls.isOpen > SYNC_EACH * 2 && round % 100 !== 99) return;
  app.connection?.send({ t: 'sync', round, sum });
}

function send(m) { app.connection?.send(m); }

// ---------- UI ----------
function meSeat() { return app.connection?.seat; }
function playerList() { return app.state?.player || []; }
function serverNow() { return Date.now() + app.timeOffset; }

function drawUi() {
  ui.replaceChildren();
  const a = app.view;
  if (a === 'start') ui.append(startMap());
  else if (a === 'connect') ui.append(el('div', { class: 'pt-map' }, el('div', { class: 'pt-kind' }, 'NomadTactics · Party'), el('div', { class: 'pt-title' }, 'Verbinde …'), el('p', { class: 'pt-text' }, 'Suche den Party-Server unter ' + location.host + '.')));
  else if (a === 'rejected') ui.append(el('div', { class: 'pt-map' }, el('div', { class: 'pt-kind' }, 'NomadTactics · Party'),
    el('div', { class: 'pt-title' }, app.superseded === 'out' ? 'Vom Gastgeber rausgenommen' : app.superseded ? 'Woanders weiter' : 'Das hat nicht geklappt'), el('p', { class: 'pt-text' }, app.message),
    el('div', { class: 'pt-bottom' }, el('span'), app.superseded
      ? button(app.superseded === 'out' ? 'Wieder beitreten' : 'Hier weiterspielen', () => join(lies(NAME_KEY)), 'main', 'play')
      : button('Nochmal', () => { app.view = 'start'; drawUi(); }, 'main', 'restart'))));
  else if (a === 'lobby') ui.append(lobbyMap());
  else if (a === 'game') {
    ui.append(bar()); const b = banner(); if (b) ui.append(b);
    ui.append(el('div', { class: 'pt-tap' }, app.spectator ? 'Du schaust zu. In der Lobby rückst du auf einen freien Platz.'
      : ['Antippen wählt eigene Würfel · Ziehen wählt mehrere · Tippen ins Feld schickt sie los', el('span', { class: 'keys' }, ' · A alle · P Pause')]));
  }
}

function startMap() {
  const field = el('input', { class: 'pt-field', id: 'pt-name', maxlength: 20, placeholder: 'Dein Name', value: lies(NAME_KEY) || '', autocomplete: 'off' });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(field.value); });
  setTimeout(() => field.focus(), 0);
  const check = app.check
    ? el('div', { class: 'pt-small' }, `Geräte-Check: `, el('b', {}, app.check.sum), ` (${app.check.ms} ms). Diese Zahl muss auf jedem Gerät gleich sein.`)
    : el('div', { class: 'pt-small' }, 'Rechnet dieses Gerät genau wie die anderen?');
  return el('div', { class: 'pt-map' },
    el('div', { class: 'pt-kind' }, 'NomadTactics · Party'),
    el('div', { class: 'pt-title' }, 'Mitspielen'),
    el('div', { class: 'pt-row' }, field, button('Beitreten', () => join(field.value), 'main', 'play', { id: 'pt-join' })),
    el('div', { class: 'pt-bottom' }, check, button('Prüfen', () => {
      const t = performance.now(); const sum = probeRun(); app.check = { sum, ms: Math.round(performance.now() - t) }; drawUi();
    }, 'small', 'verify', { id: 'pt-check' })));
}

// Address for fellow players: whoever opens the server on their own PC via "localhost" needs the home network address
let lanAddresses = [];
fetch('/addresses').then((r) => r.json()).then((l) => { lanAddresses = l; if (app.view === 'lobby') drawUi(); }).catch(() => {});
function invite() {
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  return local && lanAddresses.length ? lanAddresses[0] : location.origin;
}

// Choose team color. Blue is reserved – for Daniel and the ghost.
function colorChoice(me) {
  if (!me || app.spectator) return null;
  if (isBlue(me.name)) return el('div', { class: 'pt-colors' }, el('span', { class: 'pt-small' }, 'Deine Farbe: Blau. Wie immer.'));
  const occupied = new Set(playerList().filter((x) => x.seat !== me.seat).map((x) => x.color));
  return el('div', { class: 'pt-colors' }, el('span', { class: 'pt-small' }, 'Deine Farbe'),
    COLORS.map((f) => el('button', {
      class: 'pt-dab' + (f === me.color ? ' on' : ''), style: `background:${f}`, title: COLOR_NAMES[f] + (occupied.has(f) ? ' (vergeben)' : ''),
      'aria-label': COLOR_NAMES[f], disabled: occupied.has(f), 'data-color': f,
      onclick: () => send({ t: 'color', color: f }),
    })));
}

function lobbyMap() {
  const z = app.state;
  const list = playerList();
  const me = meSeat();
  const online = list.filter((s) => s.online).length;
  const rows = [];
  const max = z?.max || 4;
  for (let i = 0; i < max; i++) {
    const s = list.find((x) => x.seat === i);
    rows.push(s
      ? el('li', {}, el('span', { class: 'pt-point', style: `background:${s.color}` }), el('span', { class: 'pt-name' }, s.name, s.seat === me ? el('span', { class: 'pt-du' }, 'du') : null),
        el('span', { class: 'pt-info' + (s.online ? '' : ' way') }, s.online ? (s.ping != null ? s.ping + ' ms' : 'da') : 'weg'))
      : el('li', { class: 'empty' }, el('span', { class: 'pt-point', style: 'border:1px dashed var(--ui-border-strong)' }), 'Freier Platz'));
  }
  const spectator = z?.spectator || [];
  return el('div', { class: 'pt-map' },
    el('div', { class: 'pt-kind' }, 'NomadTactics · Lobby'),
    el('div', { class: 'pt-title' }, app.spectator ? 'Du schaust zu' : online < 2 ? 'Warte auf Mitspieler …' : `${online} Spieler bereit`),
    el('ul', { class: 'pt-player' }, rows),
    colorChoice(list.find((x) => x.seat === me)),
    spectator.length ? el('div', { class: 'pt-small pt-spectator' }, icon('auge', 14), 'Zuschauer: ', spectator.map((x) => x.name).join(', ')) : null,
    el('div', { class: 'pt-small', style: 'margin-top:12px' }, 'Andere im selben WLAN öffnen:'),
    el('div', { class: 'pt-address', id: 'pt-address' }, invite()),
    el('div', { class: 'pt-error' }, app.message),
    el('div', { class: 'pt-bottom' },
      button('Verlassen', () => { app.connection?.stop(); store?.write(null); app.view = 'start'; app.state = null; drawUi(); }, '', 'arrow_left'),
      app.spectator ? el('span', { class: 'pt-small' }, 'Alle Plätze sind belegt.')
        : button('Partie starten', () => send({ t: 'start' }), 'main', 'play', { id: 'pt-start', disabled: online < 2 })));
}

function bar() {
  const z = app.state; const ls = app.ls; const me = meSeat();
  const chips = playerList().filter((s) => !s.out).map((s) => el('span', { class: 'pt-chip' + (s.online ? '' : ' way') + (z?.waits?.includes(s.seat) ? ' waits' : '') },
    el('span', { class: 'pt-point', style: `background:${s.color}` }), s.name, s.seat === me ? el('span', { class: 'pt-du' }, 'du') : null,
    el('span', { class: 'pt-info' + (s.online ? '' : ' way') }, s.online ? (s.ping != null ? s.ping + ' ms' : '') : 'weg')));
  const paused = z?.pause?.reason === REASON.manual;
  const zs = z?.spectator?.length ? el('span', { class: 'pt-chip', title: z.spectator.map((x) => x.name).join(', ') }, icon('auge', 14), z.spectator.length) : null;
  if (app.spectator) return el('div', { class: 'pt-bar' }, chips, zs, el('span', { class: 'pt-air' }),
    el('span', { class: 'pt-measurement', id: 'pt-measurement' }, messText()), el('span', { class: 'pt-chip' }, icon('auge', 14), 'Du schaust zu'));
  return el('div', { class: 'pt-bar' }, chips, zs, el('span', { class: 'pt-air' }),
    el('span', { class: 'pt-measurement', id: 'pt-measurement' }, messText()),
    button(paused ? 'Weiter' : 'Pause', () => send({ t: paused ? 'next' : 'pause' }), 'small', paused ? 'play' : 'pause', { id: 'pt-pause', disabled: !!z?.pause && !paused }),
    button('Lobby', () => send({ t: 'new' }), 'small', 'restart'));
}

function messText() {
  const ls = app.ls;
  if (!ls?.sim) return '';
  return `Runde ${ls.done + 1} · #${ls.sim.sum()} · Ping ${app.connection?.ping ?? '–'} ms`;
}

function banner() {
  const z = app.state; const l = app.connection;
  const b = (title, text, buttons = [], class_ = '', ic = 'info') => el('div', { class: 'pt-banner ' + class_, id: 'pt-banner' },
    el('div', { class: 'pt-title' }, icon(ic, 20), title), text ? el('p', { class: 'pt-text' }, text) : null, buttons.length && !app.spectator ? el('div', { class: 'pt-bottom' }, buttons) : null);
  if (l?.status !== 'da') return b('Verbindung weg', 'Verbinde neu … Die Partie wartet so lange.', [], '', 'warning');
  if (!z) return null;
  const p = z.pause;
  if (p?.reason === REASON.desync) {
    const sums = Object.entries(p.sums || {}).map(([pl, s]) => `${playerList().find((x) => x.seat === Number(pl))?.name ?? pl}: ${s}`).join(' · ');
    return b(`Desync in Runde ${p.round}`, `Die Geräte rechnen unterschiedlich, die Partie ist nicht mehr zu retten. ${sums}`, [button('Zur Lobby', () => send({ t: 'new' }), 'main', 'restart')], 'red', 'error');
  }
  if (p?.reason === REASON.disconnected) {
    const way = playerList().filter((s) => p.seats?.includes(s.seat));
    return b(`Pause – ${p.who} ist weg`, 'Sobald die Verbindung wieder steht, geht es von selbst weiter.',
      [...way.map((s) => button(`Ohne ${s.name} weiter`, () => send({ t: 'without', seat: s.seat }), '', 'x')), button('Zur Lobby', () => send({ t: 'new' }), '', 'restart')], '', 'hourglass');
  }
  if (p?.reason === REASON.manual) return b(`Pause (${p.who})`, 'Weiter geht es mit „Weiter“ oder P.', [button('Weiter', () => send({ t: 'next' }), 'main', 'play')], '', 'pause');
  if (z.waits?.length) {
    const names = playerList().filter((s) => z.waits.includes(s.seat)).map((s) => s.name).join(', ');
    return b(`Warte auf ${names}`, 'Rechnet gerade nach und holt auf.', [], '', 'hourglass');
  }
  if (app.ls && app.ls.isOpen > 20) return b('Hole auf …', `Noch ${app.ls.isOpen} Runden nachrechnen.`, [], '', 'hourglass');
  const rest = z.nextUm - serverNow();
  if (z.phase === 'running' && rest > 0) return el('div', { class: 'pt-banner', id: 'pt-banner' }, el('div', { class: 'pt-big' }, Math.ceil(rest / 1000)), el('p', { class: 'pt-text' }, z.round === 0 ? 'Gleich geht’s los' : 'Weiter in …'));
  return null;
}

// Continuously refresh small parts of the UI without rebuilding everything
let uiKey = '';
setInterval(() => {
  if (app.view !== 'game') return;
  const m = document.getElementById('pt-measurement'); if (m) m.textContent = messText();
  const z = app.state;
  const invKey = [app.connection?.status, z?.pause?.reason, z?.waits?.join(), Math.ceil(((z?.nextUm ?? 0) - serverNow()) / 1000) > 0 ? Math.ceil((z.nextUm - serverNow()) / 1000) : 0, (app.ls?.isOpen ?? 0) > 20 ? app.ls.isOpen : 0,
    playerList().map((s) => s.ping + s.online).join(), z?.spectator?.length].join('|');
  if (invKey !== uiKey) { uiKey = invKey; drawUi(); }
}, 200);

// ---------- Feld ----------
const color = (n, fallback) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;
function mass() {
  const w = cv.clientWidth, h = cv.clientHeight, top = 64, border = 16;
  const s = Math.min((w - 2 * border) / WIDTH, (h - top - border - 30) / HEIGHT);
  return { s, ox: (w - WIDTH * s) / 2, oy: top + (h - top - 30 - HEIGHT * s) / 2 };
}
const toWorld = (px, py) => { const { s, ox, oy } = mass(); return [Math.round((px - ox) / s), Math.round((py - oy) / s)]; };

function size() {
  const d = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * d), h = Math.round(cv.clientHeight * d);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.setTransform(d, 0, 0, d, 0, 0);
}

function compute() {
  const ls = app.ls;
  if (!ls?.sim) return;
  const isOpen = ls.isOpen;
  if (isOpen <= 0) return;
  const pos = new Map(ls.sim.units.map((e) => [e.id, [e.x, e.y]]));
  const n = ls.progress(isOpen > 3 ? 400 : 1);   // normal: round by round, fast when catching up
  app.before = n === 1 ? pos : null;
  app.beforeTime = performance.now();
}

function draw() {
  size();
  const w = cv.clientWidth, h = cv.clientHeight;
  g.fillStyle = color('--ui-canvas', '#0e0e10'); g.fillRect(0, 0, w, h);
  const ls = app.ls;
  if (app.view !== 'game' || !ls?.sim) return;
  const { s, ox, oy } = mass();
  // Platte
  g.fillStyle = color('--ui-panel', '#1e1e21'); g.fillRect(ox, oy, WIDTH * s, HEIGHT * s);
  g.strokeStyle = color('--ui-point', 'rgba(255,255,255,.07)'); g.lineWidth = 1; g.beginPath();
  for (let x = 0; x <= WIDTH; x += 2 * FIELD) { g.moveTo(ox + x * s + .5, oy); g.lineTo(ox + x * s + .5, oy + HEIGHT * s); }
  for (let y = 0; y <= HEIGHT; y += 2 * FIELD) { g.moveTo(ox, oy + y * s + .5); g.lineTo(ox + WIDTH * s, oy + y * s + .5); }
  g.stroke();
  g.strokeStyle = color('--ui-border', '#313136'); g.strokeRect(ox + .5, oy + .5, WIDTH * s - 1, HEIGHT * s - 1);

  const t = Math.min(1, (performance.now() - app.beforeTime) / (ROUND_MS));
  const colors = Object.fromEntries(playerList().map((x) => [x.seat, x.color]));
  const me = meSeat();
  const k = 700 * s;
  // Targets of the own selection
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([4, 4]); g.beginPath();
  for (const e of ls.sim.units) if (e.target && app.selection.has(e.id)) {
    const [x0, y0] = situation(e, t);
    g.moveTo(ox + x0 * s, oy + y0 * s); g.lineTo(ox + e.zx * s, oy + e.zy * s);
  }
  g.stroke(); g.setLineDash([]);
  for (const e of ls.sim.units) {
    const [x, y] = situation(e, t);
    const px = ox + x * s, py = oy + y * s;
    g.fillStyle = colors[e.seat] || '#888';
    g.globalAlpha = e.seat === me ? 1 : .9;
    rounded(px - k / 2, py - k / 2, k, k, Math.max(2, k * .18)); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.25)'; rounded(px - k / 2, py + k * .12, k, k * .38, Math.max(2, k * .18)); g.fill();
    if (app.selection.has(e.id)) { g.strokeStyle = '#fff'; g.lineWidth = 2; rounded(px - k / 2 - 3, py - k / 2 - 3, k + 6, k + 6, Math.max(3, k * .22)); g.stroke(); }
  }
  // Klick-Marker
  if (app.marker && performance.now() - app.marker.time < 600) {
    const a = 1 - (performance.now() - app.marker.time) / 600;
    g.strokeStyle = `rgba(242,193,78,${a})`; g.lineWidth = 2; g.beginPath();
    g.arc(ox + app.marker.x * s, oy + app.marker.y * s, 6 + (1 - a) * 14, 0, Math.PI * 2); g.stroke();
  }
  // Auswahlrahmen
  const z = app.drag;
  if (z?.frame) { g.strokeStyle = color('--ui-acc-line', '#f2c14e'); g.fillStyle = 'rgba(242,193,78,.08)'; g.lineWidth = 1;
    g.fillRect(z.x0, z.y0, z.x - z.x0, z.y - z.y0); g.strokeRect(z.x0 + .5, z.y0 + .5, z.x - z.x0, z.y - z.y0); }
}

function situation(e, t) {
  const v = app.before?.get(e.id);
  if (!v) return [e.x, e.y];
  return [v[0] + (e.x - v[0]) * t, v[1] + (e.y - v[1]) * t];
}
function rounded(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

function loop() { compute(); draw(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ---------- Eingabe ----------
function ownItems() { const me = meSeat(); return app.ls?.sim ? app.ls.sim.units.filter((e) => e.seat === me) : []; }

function command(x, y, ids) {
  if (!ids.length) return;
  app.marker = { x, y, time: performance.now() };
  send({ t: 'command', b: { kind: 'target', ids, x, y } });
}
app.command = command;
app.ownItems = ownItems;

cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  if (app.view !== 'game') return;
  cv.setPointerCapture(e.pointerId);
  app.drag = { x0: e.offsetX, y0: e.offsetY, x: e.offsetX, y: e.offsetY, frame: false, right: e.button === 2, shift: e.shiftKey };
});
cv.addEventListener('pointermove', (e) => {
  const z = app.drag; if (!z) return;
  z.x = e.offsetX; z.y = e.offsetY;
  if (!z.right && Math.hypot(z.x - z.x0, z.y - z.y0) > 8) z.frame = true;
});
cv.addEventListener('pointerup', (e) => {
  const z = app.drag; app.drag = null; if (!z || !app.ls?.sim) return;
  const { s } = mass();
  if (z.frame) {
    const [ax, ay] = toWorld(Math.min(z.x0, z.x), Math.min(z.y0, z.y));
    const [bx, by] = toWorld(Math.max(z.x0, z.x), Math.max(z.y0, z.y));
    if (!z.shift) app.selection.clear();
    for (const u of ownItems()) if (u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by) app.selection.add(u.id);
    return;
  }
  const [wx, wy] = toWorld(z.x, z.y);
  if (!z.right) {
    const hit = ownItems().find((u) => Math.abs(u.x - wx) < 600 && Math.abs(u.y - wy) < 600 + 6 / s);
    if (hit) {
      if (z.shift) { app.selection.has(hit.id) ? app.selection.delete(hit.id) : app.selection.add(hit.id); }
      else { app.selection.clear(); app.selection.add(hit.id); }
      return;
    }
  }
  const ids = app.selection.size ? [...app.selection] : ownItems().map((u) => u.id);
  command(Math.max(0, Math.min(WIDTH, wx)), Math.max(0, Math.min(HEIGHT, wy)), ids);
});

window.addEventListener('keydown', (e) => {
  if (app.view !== 'game' || e.target instanceof HTMLInputElement) return;
  if (e.key === 'a' || e.key === 'A') { app.selection = new Set(ownItems().map((u) => u.id)); }
  else if (e.key === 'Escape') app.selection.clear();
  else if (e.key === 'p' || e.key === 'P') send({ t: app.state?.pause?.reason === REASON.manual ? 'next' : 'pause' });
});

// iPad: after waking up check immediately whether the connection is still alive
document.addEventListener('visibilitychange', () => {
  const l = app.connection;
  if (document.visibilityState === 'visible' && l && l.status === 'da' && Date.now() - l.lastSeen > 2000) l.cut();
});
window.addEventListener('pagehide', () => { /* Token bleibt in sessionStorage: Neuladen = Wiederverbinden */ });

// ---------- Start ----------
if (q.get('auto') && q.get('name')) join(q.get('name'));
else if (store?.lies() && lies(NAME_KEY)) join(lies(NAME_KEY)); // Page reloaded: rejoin right away
else drawUi();
