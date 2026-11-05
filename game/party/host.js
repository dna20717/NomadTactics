// NomadTactics – host page: QR code to join, players, controls, game master, log.
// Reads /gastgeber/status every second. Actions (POST /gastgeber/aktion) are only allowed for the server machine itself.

import qrcode from './qrcode.js';
import { icon } from '../icons.js';
import { COLOR_NAMES, BLUE } from '../../engine/net/protocol.js';

const root = document.getElementById('gg');
const app = { status: null, error: false, message: '', messageUntil: 0, address: null };
window.host = app;

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

// ---------- Daten ----------
async function hole() {
  try {
    const r = await fetch('/host/status', { cache: 'no-store' });
    app.status = await r.json(); app.error = false;
  } catch { app.error = true; }
  draw();
}
setInterval(hole, 1000);
hole();

async function action(m) {
  try {
    const r = await fetch('/host/action', { method: 'POST', body: JSON.stringify(m) });
    const a = await r.json();
    if (!a.ok && a.text) report(a.text);
  } catch { report('Server nicht erreichbar.'); }
  hole();
}
function report(t) { app.message = t; app.messageUntil = Date.now() + 3500; draw(); }

// ---------- UI ----------
let last = '';
function draw() {
  const s = app.status;
  // only rebuild when something has changed (otherwise the selection in the log jumps)
  const invKey = JSON.stringify([s && { ...s, now: 0 }, app.error, app.messageUntil > Date.now() ? app.message : '']);
  if (invKey === last) return;
  last = invKey;
  root.replaceChildren(head(s), qrBox(s), playerBox(s), ladderBox(s), protocolBox(s));
  if (app.messageUntil > Date.now()) root.append(el('div', { class: 'pt-chip gg-hint' }, icon('info', 14), app.message));
}

function head(s) {
  let status;
  if (app.error || !s) status = el('span', { class: 'gg-status red' }, icon('warning', 14), 'Server nicht erreichbar');
  else if (s.phase === 'lobby') status = el('span', { class: 'gg-status' }, icon('humans', 14), 'Lobby');
  else if (s.pause?.reason === 'desync') status = el('span', { class: 'gg-status red' }, icon('error', 14), `Desync in Runde ${s.pause.round}`);
  else if (s.pause) status = el('span', { class: 'gg-status pause' }, icon('pause', 14), `Pause${s.pause.who ? ' · ' + s.pause.who : ''}`);
  else status = el('span', { class: 'gg-status running' }, icon('play', 14), `Partie läuft · ${time(s.round * 100)}`);
  return el('header', { class: 'gg-box gg-head' },
    el('div', {}, el('div', { class: 'pt-kind' }, 'NomadTactics'), el('div', { class: 'pt-title' }, 'Gastgeber')),
    status, el('span', { class: 'gg-air' }),
    button('Selbst mitspielen', () => window.open('/party.html', '_blank'), 'main', 'play'));
}

function qrBox(s) {
  const addresses = s?.addresses?.length ? s.addresses : [location.origin];
  if (!app.address || !addresses.includes(app.address)) app.address = addresses[0];
  const q = qrcode(0, 'M'); q.addData(app.address); q.make();
  const box = el('div');
  box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  return el('section', { class: 'gg-box gg-qr' },
    el('div', { class: 'gg-h' }, icon('connect', 14), 'Mitspielen'),
    box.firstChild,
    el('div', { class: 'gg-big' }, app.address.replace(/^http:\/\//, '')),
    el('div', { class: 'pt-small' }, 'iPad: Kamera auf den Code halten. Alle müssen im selben WLAN sein.'),
    addresses.length > 1 ? el('div', { class: 'pt-bottom' }, addresses.map((a) => button(a.replace(/^http:\/\//, ''), () => { app.address = a; last = ''; draw(); }, 'small' + (a === app.address ? ' main' : '')))) : null,
    el('div', { class: 'pt-bottom' }, button('Adresse kopieren', () => { navigator.clipboard?.writeText(app.address).then(() => report('Kopiert.'), () => report(app.address)); }, 'small', 'copyAction')));
}

function playerBox(s) {
  const may = s?.may;
  const list = s?.player || [];
  const rows = list.map((p) => {
    const back = s.phase === 'running' && p.online ? Math.max(0, s.round - 1 - p.round) : 0;
    const state = p.out ? 'ausgestiegen' : !p.online ? 'weg' : s.waits?.includes(p.seat) ? 'holt auf' : s.phase === 'running' ? (back > 15 ? `${(back / 10).toFixed(1).replace('.', ',')} s hinterher` : 'dabei') : 'bereit';
    return el('tr', {},
      el('td', {}, el('span', { class: 'pt-point', style: `background:${p.color};display:inline-block;vertical-align:-1px;margin-right:8px` }), el('b', {}, p.name)),
      el('td', { class: 'pt-small' }, COLOR_NAMES[p.color] || '', p.color === BLUE ? ' (reserviert)' : ''),
      el('td', { class: !p.online || p.out ? 'gg-way' : '' }, state),
      el('td', { class: 'right' }, p.online && p.ping != null ? p.ping + ' ms' : '–'),
      el('td', { class: 'right' }, may && !p.out ? button('Rauswerfen', () => action({ t: 'out', seat: p.seat }), 'small red', 'x') : null));
  });
  const zs = s?.spectator || [];
  return el('section', { class: 'gg-box gg-player' },
    el('div', { class: 'gg-h' }, icon('humans', 14), `Spieler ${list.filter((p) => !p.out).length} / ${s?.max ?? '–'}`, el('span', { class: 'gg-air' }),
      may ? gameButtons(s) : null),
    list.length
      ? el('table', { class: 'gg-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Farbe'), el('th', {}, 'Zustand'), el('th', { class: 'right' }, 'Ping'), el('th'))), el('tbody', {}, rows))
      : el('div', { class: 'gg-empty' }, 'Noch niemand da. Zeig den QR-Code herum.'),
    zs.length ? el('div', { class: 'pt-small pt-spectator' }, icon('auge', 14), 'Zuschauer: ', zs.map((z) => z.name).join(', ')) : null,
    may ? null : el('div', { class: 'pt-small', style: 'margin-top:10px' }, 'Steuern geht nur am Server-Rechner.'));
}

function gameButtons(s) {
  if (!s) return null;
  if (s.phase === 'lobby') return el('div', { class: 'gg-buttons' }, button('Partie starten', () => action({ t: 'start' }), 'small main', 'play', { disabled: (s.player || []).filter((p) => p.online).length < 2 }));
  const paused = s.pause?.reason === 'manual';
  return el('div', { class: 'gg-buttons' },
    button(paused ? 'Weiter' : 'Pause', () => action({ t: paused ? 'next' : 'pause' }), 'small', paused ? 'play' : 'pause', { disabled: !!s.pause && !paused }),
    button('Zur Lobby', () => action({ t: 'lobby' }), 'small', 'restart'));
}

// Game master: intervenes in the match via a command, like an invisible player.
function ladderBox(s) {
  const running = s?.phase === 'running' && !s.pause && s.may;
  const angle = [5, 6, 7, 4, -1, 0, 3, 2, 1]; // Raster 3×3 → Richtung 0–7 (0 = Osten, im Uhrzeigersinn)
  return el('section', { class: 'gg-box gg-ladder' },
    el('div', { class: 'gg-h' }, icon('spell', 14), 'Spielleiter'),
    el('div', { class: 'gg-ladder-row' },
      el('p', { class: 'gg-ladder-text' }, 'Eingriffe landen wie ein Befehl in der nächsten Runde und passieren auf allen Geräten gleichzeitig. Im Probe-Spiel gibt es dafür einen Windstoß, später Wetter, Tageszeit und mehr.'),
      el('div', { class: 'gg-wind', title: 'Windstoß' }, angle.map((r) => r < 0
        ? el('span', { class: 'pt-button center' })
        : windButton(r, running)))));
}

function windButton(r, running) {
  const k = button('', () => action({ t: 'command', b: { kind: 'wind', direction: r } }), 'small', null, { disabled: !running, 'aria-label': 'Windstoß', 'data-direction': r });
  const i = icon('arrow_left', 18); i.style.transform = `rotate(${180 + r * 45}deg)`; k.append(i);
  return k;
}

function protocolBox(s) {
  const p = s?.protocol || [];
  return el('section', { class: 'gg-box gg-protocol' },
    el('div', { class: 'gg-h' }, icon('list', 14), 'Protokoll', el('span', { class: 'gg-air' }), s ? el('span', {}, `läuft seit ${clock(s.since)}`) : null),
    p.length ? el('ul', { class: 'gg-log' }, p.slice().reverse().map((z) => el('li', {}, el('time', {}, clock(z.time)), z.text))) : el('div', { class: 'gg-empty' }, 'Noch nichts passiert.'));
}

const clock = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const time = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- calm background (placeholder for the diorama) ----------
const cv = document.getElementById('field'); const g = cv.getContext('2d');
const points = Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % 1000 / 1000, y: (i * 61) % 1000 / 1000, r: 1 + (i % 3), v: 0.00002 + (i % 5) * 0.00001 }));
function rear(t) {
  const d = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
  if (cv.width !== w * d) { cv.width = w * d; cv.height = h * d; }
  g.setTransform(d, 0, 0, d, 0, 0);
  const st = getComputedStyle(document.documentElement);
  g.fillStyle = st.getPropertyValue('--ui-canvas').trim() || '#0e0e10'; g.fillRect(0, 0, w, h);
  g.strokeStyle = st.getPropertyValue('--ui-point').trim() || 'rgba(255,255,255,.07)'; g.lineWidth = 1;
  const off = (t * 0.004) % 48; g.beginPath();
  for (let x = -48 + off; x < w + h; x += 48) { g.moveTo(x, 0); g.lineTo(x - h * 0.5, h); }
  for (let x = -h + off; x < w + h; x += 48) { g.moveTo(x, 0); g.lineTo(x + h * 0.5, h); }
  g.stroke();
  g.fillStyle = 'rgba(242,193,78,.18)';
  for (const p of points) { const y = (p.y + t * p.v) % 1; g.beginPath(); g.arc(p.x * w, y * h, p.r, 0, Math.PI * 2); g.fill(); }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(rear);
}
requestAnimationFrame(rear);
