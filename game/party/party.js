// NomadTactics – Party (MVP): join, lobby, trial game in lockstep via the party server.
// URL parameters for testing: ?name=Ava&auto=1 (join immediately), ?verz=150&zitter=60 (artificial delay in ms).

import { Connection } from '../../engine/net/connection.js';
import { Lockstep } from '../../engine/net/lockstep.js';
import { ROUND_MS, REASON, SYNC_EACH, COLORS, COLOR_NAMES, isBlue } from '../../engine/net/protocol.js';
import { probeRun } from '../../engine/tactics/probe.js';
import { Battle, TICKS_PER_SECOND } from '../../engine/tactics/battle.js';
import { loadSkirmish, battleRun } from '../../engine/tactics/skirmish.js';
import { battleView } from './battle_view.js';
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

// Game data comes from the party server (same files for everyone = same simulation)
const DATA = 'projects/nomadtactics/';
app.setupReady = loadSkirmish(async (p) => { const r = await fetch(DATA + p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.json(); })
  .then((s) => { app.setup = s; return s; })
  .catch((e) => { app.message = 'Spieldaten fehlen: ' + e.message; drawUi(); });
const newSim = (seed, seats) => new Battle(seed, seats, app.setup);

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
  if (!app.setup) { app.view = 'connect'; drawUi(); app.setupReady.then(() => app.setup && join(name)); return; }
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
    if (m.phase === 'lobby' && app.view !== 'start' && app.view !== 'rejected') { app.view = 'lobby'; app.ls = null; app.overSeen = false; }
    drawUi();
  });
  l.on('match', async (m) => {
    if (!app.setup) await app.setupReady;
    const fresh = !app.ls || app.ls.seed !== m.seed;
    if (!app.ls) app.ls = new Lockstep(newSim, { reportSync: reportSync });
    app.ls.match(m);
    if (fresh) { app.selection.clear(); view.reset(); app.overSeen = false; }
    app.view = 'game'; app.before = null;
    drawUi();
    if (fresh) setTimeout(() => view.home(), 0);
  });
  l.on('round', (m) => { if (!app.ls) return; app.ls.round(m); if (app.ls.gap) { app.ls.gap = false; l.cut(); } });
  l.on('lobby', () => { app.ls = null; app.view = 'lobby'; app.overSeen = false; drawUi(); });
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
      : [selectionText() || 'Antippen wählt · Ziehen wählt mehrere · Tippen ins Feld fährt hin, auf Feinde greift an', el('span', { class: 'keys' }, ' · Strg+A alle · H Halt · Leertaste Landeplatz · Rad/Rechts-Ziehen Kamera')]));
  }
}

function startMap() {
  const field = el('input', { class: 'pt-field', id: 'pt-name', maxlength: 20, placeholder: 'Dein Name', value: lies(NAME_KEY) || '', autocomplete: 'off' });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(field.value); });
  setTimeout(() => field.focus(), 0);
  const check = app.check
    ? el('div', { class: 'pt-small' }, `Geräte-Check: `, el('b', {}, app.check.sum), ' · ', el('b', { id: 'pt-battle-check' }, app.check.battle || '–'), ` (${app.check.ms} ms). Diese Zahlen müssen auf jedem Gerät gleich sein.`)
    : el('div', { class: 'pt-small' }, 'Rechnet dieses Gerät genau wie die anderen?');
  return el('div', { class: 'pt-map' },
    el('div', { class: 'pt-kind' }, 'NomadTactics · Party'),
    el('div', { class: 'pt-title' }, 'Mitspielen'),
    el('div', { class: 'pt-row' }, field, button('Beitreten', () => join(field.value), 'main', 'play', { id: 'pt-join' })),
    el('div', { class: 'pt-bottom' }, check, button('Prüfen', () => {
      const t = performance.now(); const sum = probeRun(); const battle = app.setup ? battleRun(app.setup) : null; app.check = { sum, battle, ms: Math.round(performance.now() - t) }; drawUi();
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
  const wave = ls.sim.over ? '' : `Welle in ${Math.ceil(ls.sim.nextWave / TICKS_PER_SECOND)} s · `;
  return `${wave}Runde ${ls.done + 1} · #${ls.sim.sum()} · Ping ${app.connection?.ping ?? '–'} ms`;
}

function banner() {
  const z = app.state; const l = app.connection;
  const b = (title, text, buttons = [], class_ = '', ic = 'info') => el('div', { class: 'pt-banner ' + class_, id: 'pt-banner' },
    el('div', { class: 'pt-title' }, icon(ic, 20), title), text ? el('p', { class: 'pt-text' }, text) : null, buttons.length && !app.spectator ? el('div', { class: 'pt-bottom' }, buttons) : null);
  if (l?.status !== 'da') return b('Verbindung weg', 'Verbinde neu … Die Partie wartet so lange.', [], '', 'warning');
  if (!z) return null;
  const over = app.ls?.sim?.over;
  if (over) {
    const win = playerList().find((x) => x.seat === over.winner);
    const mine = over.winner === meSeat() && !app.spectator;
    return b(mine ? 'Sieg!' : win ? `${win.name} gewinnt` : 'Unentschieden', mine ? 'Der letzte Landeplatz ist gefallen. Gut gemacht.' : 'Die Partie ist vorbei.',
      [button('Zur Lobby', () => send({ t: 'new' }), 'main', 'restart')], '', mine ? 'star_full' : 'flag');
  }
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

function selectionText() {
  const sim = app.ls?.sim; if (!sim || !app.selection.size) return '';
  const count = {};
  for (const id of app.selection) { const u = sim.byId.get(id); if (u) count[u.type] = (count[u.type] || 0) + 1; }
  return Object.entries(count).map(([t, n]) => `${n}× ${sim.types[t].name}`).join(' · ');
}

// Continuously refresh small parts of the UI without rebuilding everything
let uiKey = '';
setInterval(() => {
  if (app.view !== 'game') return;
  const m = document.getElementById('pt-measurement'); if (m) m.textContent = messText();
  const z = app.state;
  const invKey = [app.connection?.status, z?.pause?.reason, z?.waits?.join(), Math.ceil(((z?.nextUm ?? 0) - serverNow()) / 1000) > 0 ? Math.ceil((z.nextUm - serverNow()) / 1000) : 0, (app.ls?.isOpen ?? 0) > 20 ? app.ls.isOpen : 0,
    playerList().map((s) => s.ping + s.online).join(), z?.spectator?.length, selectionText(), !!app.ls?.sim?.over].join('|');
  if (invKey !== uiKey) { uiKey = invKey; drawUi(); }
}, 200);

// ---------- Feld ----------
const view = battleView({ cv, app, send, meSeat, playerList });

function compute() {
  const ls = app.ls;
  if (!ls?.sim) return;
  const isOpen = ls.isOpen;
  if (isOpen <= 0) return;
  const pos = new Map(ls.sim.units.map((e) => [e.id, [e.x, e.y]]));
  const n = ls.progress(isOpen > 3 ? 400 : 1);   // normal: round by round, fast when catching up
  view.drain(ls.sim, n > 1);
  app.before = n === 1 ? pos : null;
  app.beforeTime = performance.now();
  if (ls.sim.over && !app.overSeen) { app.overSeen = true; drawUi(); }
}

function loop() { compute(); view.draw(app.before, app.beforeTime); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

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
