// NomadTactics – Launcher: the start page. Behind the menu a diorama runs: an endless AI battle on the map
// „Grenzland“ (M, 384 m) with the real simulation (offline, four sides, big waves), drawn by the same renderer as
// the battle (game/party/battle_3d.js, here with boom 1.8), so every look improvement shows up here first.
// The camera follows a hero unit until it is destroyed, then the next one (Daniel, 06.11.).
// Live dials (time of day, weather, climate) are optics only and exist only here (Daniel, 05.11.).
// Menu: Spiel (/party) · Werkstatt (/workshop, online only) · Optionen (name, quality, HUD size).

import { Battle } from '../../engine/tactics/battle.js';
import { loadSkirmish } from '../../engine/tactics/skirmish.js';
import { TICKS_PER_ROUND, ROUND_MS, BLUE } from '../../engine/net/protocol.js';
import { battleView3d } from '../party/battle_3d.js';
import { DATA, gameData } from '../party/game_data.js';
import { icon } from '../icons.js';

const root = document.getElementById('launcher');
const cv = document.getElementById('field');
const KEY = 'nomadtactics-launcher';
const NAME_KEY = 'nomadtactics-party-name';
const QUALITY_KEY = 'nomadtactics-quality';
const HUD_KEY = 'nt.hud.settings';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// four sides on the four start slots of the map (names only for the record, the diorama shows no names)
const SIDES = [
  { seat: 0, name: 'Blau', color: BLUE },
  { seat: 1, name: 'Rot', color: '#e2524a' },
  { seat: 2, name: 'Gelb', color: '#f2c94c' },
  { seat: 3, name: 'Grün', color: '#4caf50' },
];
const WEATHER = [
  ['clear', 'Klar', 'sun'], ['cloudy', 'Bewölkt', 'cloud'], ['rain', 'Regen', 'rain'], ['fog', 'Nebel', 'fog'],
  ['snow', 'Schnee', 'snow'], ['storm', 'Sturm', 'storm'], ['wind', 'Wind', 'wind'],
];
const CLIMATES = [['gemaessigt', 'Gemäßigt'], ['steppe', 'Steppe'], ['wueste', 'Wüste'], ['winter', 'Winter']];
const DAY_SECONDS = 720;   // one day in 12 minutes, like data/world.json › daytime

let saved = {};
try { saved = JSON.parse(read(KEY) || '{}'); } catch {}
const dials = { hour: saved.hour ?? 16.5, running: saved.running ?? true, weather: saved.weather || 'clear', climate: saved.climate || 'gemaessigt', fx: saved.fx ?? true };
const remember = () => write(KEY, JSON.stringify(dials));

const app = { view: 'game', ls: null, selection: new Set(), drag: null, hud: true };   // hud: no rings or order lines
window.launcher = app;   // for tests and the console

// ---------- page ----------
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
const timeText = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

let online = null, panel = null;
function drawMenu() {
  root.replaceChildren();
  const lan = online?.lan;
  const entry = (id, label, sub, ic, onclick, main = false) => el('button', { class: 'ln-entry' + (main ? ' main' : ''), id, onclick },
    el('span', { class: 'ln-ic' }, icon(ic, 20)), el('span', { class: 'ln-txt' }, el('b', {}, label), el('small', {}, sub)), el('span', { class: 'ln-go' }, icon('chevron_right', 16)));
  const menu = el('nav', { class: 'ln-menu' },
    el('div', { class: 'ln-title' }, 'NOMADTACTICS'),
    el('div', { class: 'ln-sub' }, 'Echtzeit-Strategie im Voxel-Diorama'),
    el('div', { class: 'ln-entries' },
      entry('ln-play', 'Spiel', 'Gefecht online oder allein üben', 'play', () => { location.href = lan ? 'party.html' : 'party'; }, true),
      lan ? null : entry('ln-workshop', 'Werkstatt', 'Einheiten, Nationen, Welt, Oberfläche', 'workbench', () => { location.href = 'workshop'; }),
      entry('ln-options', 'Optionen', 'Name, Qualität, Größe der Oberfläche', 'settings', () => { panel = panel ? null : 'options'; drawMenu(); })),
    panel === 'options' ? optionsPanel() : null,
  );
  root.append(menu, dialsCard(), el('div', { class: 'ln-foot' }, footText()));
}
function footText() {
  if (online?.user) return `Angemeldet als ${online.user.name} · Daten ${online.branch || 'main'}${app.commit ? ' @' + app.commit.slice(0, 7) : ''}`;
  if (online?.lan) return 'Party-Server im Heimnetz';
  return '';
}

function optionsPanel() {
  let hud = {};
  try { hud = JSON.parse(read(HUD_KEY) || '{}'); } catch {}
  const q = read(QUALITY_KEY) || 'medium';
  const seg = (items, value, set) => el('div', { class: 'ln-seg' }, items.map(([v, n]) => el('button', { class: v === value ? 'on' : '', onclick: () => { set(v); drawMenu(); } }, n)));
  const name = el('input', { class: 'ln-field', id: 'ln-name', value: read(NAME_KEY) || online?.user?.name || '', placeholder: 'Wie heißt du im Spiel?', maxlength: 24,
    oninput: (e) => write(NAME_KEY, e.target.value.trim()) });
  return el('section', { class: 'ln-panel' },
    el('div', { class: 'ln-panel-head' }, icon('settings', 15), 'Optionen', el('button', { class: 'ln-x', title: 'Schließen', onclick: () => { panel = null; drawMenu(); } }, icon('x', 14))),
    el('label', {}, 'Name im Spiel'), name,
    el('label', {}, 'Grafik-Qualität'),
    seg([['beautiful', 'Schön'], ['medium', 'Mittel'], ['fast', 'Schnell']], q, (v) => { write(QUALITY_KEY, v); view.quality(v); }),
    el('div', { class: 'ln-hint' }, 'Gilt für Diorama und Gefecht. Am iPad lieber Mittel oder Schnell.'),
    el('label', {}, 'Größe der Oberfläche im Spiel'),
    seg([[0.9, '90 %'], [1, '100 %'], [1.15, '115 %'], [1.3, '130 %']], hud.scale ?? 1, (v) => { hud.scale = v; write(HUD_KEY, JSON.stringify(hud)); }),
  );
}

function dialsCard() {
  const hourIcon = () => (dials.hour >= 6.2 && dials.hour < 18.4 ? 'sun' : 'moon');
  const label = el('span', { class: 'ln-time' }, timeText(dials.hour));
  const sym = el('span', { class: 'ln-dial-ic' }, icon(hourIcon(), 15));
  const slider = el('input', { type: 'range', min: 0, max: 24, step: 0.05, value: dials.hour, class: 'ln-range', id: 'ln-hour', title: 'Tageszeit',
    oninput: (e) => { dials.hour = Number(e.target.value); dials.running = false; play.replaceChildren(icon('play', 13)); setAtmosphere(); remember(); } });
  const play = el('button', { class: 'ln-mini', id: 'ln-run', title: 'Zeit läuft / steht', onclick: () => { dials.running = !dials.running; play.replaceChildren(icon(dials.running ? 'pause' : 'play', 13)); remember(); } }, icon(dials.running ? 'pause' : 'play', 13));
  dialsCard.tick = () => {
    if (document.activeElement !== slider) slider.value = dials.hour;
    label.textContent = timeText(dials.hour);
    const want = hourIcon();
    if (sym.dataset.ic !== want) { sym.dataset.ic = want; sym.replaceChildren(icon(want, 15)); }
  };
  return el('aside', { class: 'ln-dials', id: 'ln-dials' },
    el('div', { class: 'ln-row' }, sym, slider, label, play,
      el('button', { class: 'ln-mini' + (dials.fx ? ' on' : ''), id: 'ln-fx', title: dials.fx ? 'Effekte an (Leuchten, Schatten in Ecken, Farbstimmung) – tippen für den alten Look' : 'Effekte aus (alter Look) – tippen für Leuchten, Schatten in Ecken, Farbstimmung',
        onclick: () => { dials.fx = !dials.fx; view.imageFx(dials.fx); remember(); drawMenu(); } }, icon('star', 13))),
    el('div', { class: 'ln-row ln-weather' }, WEATHER.map(([id, name, ic]) => el('button', { class: 'ln-mini' + (dials.weather === id ? ' on' : ''), 'data-w': id, title: name,
      onclick: () => { dials.weather = id; setAtmosphere(); remember(); drawMenu(); } }, icon(ic, 14)))),
    el('div', { class: 'ln-row ln-climate' }, CLIMATES.map(([id, name]) => el('button', { class: dials.climate === id ? 'on' : '', 'data-c': id,
      onclick: () => { dials.climate = id; setAtmosphere(); remember(); drawMenu(); } }, name))),
  );
}

// ---------- diorama ----------
const sides = () => SIDES;
const view = battleView3d({ host: document.body, overlay: cv, app, meSeat: () => -1, playerList: sides, toast: () => {}, modelsBase: new URL(DATA, location.href).href });
view.show(true);
view.quality(read(QUALITY_KEY) || 'medium');
const setAtmosphere = () => view.atmosphere({ hour: dials.hour, weather: dials.weather, climate: dials.climate });
setAtmosphere();
view.imageFx(dials.fx);

let setup = null, sim = null, before = null, beforeTime = 0, overAt = 0, round = 0;
function newBattle() {
  const seed = (Math.random() * 0x7fffffff) | 0;
  sim = new Battle(seed, SIDES.map((s) => s.seat), setup);
  app.ls = { sim };
  round = 0; overAt = 0; before = null; hero.id = 0;
  view.reset();
}
// AI: every 3 s each side sends its idle units at the nearest enemy landing pad; they fight whatever they meet
function orders() {
  for (const side of SIDES) {
    const own = sim.units.filter((u) => u.seat === side.seat && u.hp > 0);
    const pad = own.find((u) => sim.types[u.type].building);
    const idle = own.filter((u) => !sim.types[u.type].building && sim.types[u.type].weapon && !u.order && !u.tgt);
    if (!idle.length) continue;
    const from = pad || idle[0];
    let best = null, bd = Infinity;
    for (const u of sim.units) {
      if (u.seat === side.seat || u.hp <= 0 || !sim.types[u.type].building) continue;
      const d = (u.x - from.x) ** 2 + (u.y - from.y) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    // every third group picks any enemy pad, so the fronts cross on the whole board
    const pads = sim.units.filter((u) => u.seat !== side.seat && u.hp > 0 && sim.types[u.type].building);
    if (pads.length > 1 && Math.random() < 0.33) best = pads[(Math.random() * pads.length) | 0];
    // no enemy pad left: hunt the nearest enemy unit
    if (!best) for (const u of sim.units) {
      if (u.seat === side.seat || u.hp <= 0) continue;
      const d = (u.x - from.x) ** 2 + (u.y - from.y) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    if (best) sim.command(side.seat, { kind: 'attack', ids: idle.map((u) => u.id), target: best.id });
  }
}
function oneRound() {
  if (round % Math.round(3000 / ROUND_MS) === 0) orders();
  round++;
  before = new Map(sim.units.map((u) => [u.id, [u.x, u.y]]));
  for (let i = 0; i < TICKS_PER_ROUND; i++) sim.step();
  for (const e of sim.events) if (e.kind === 'shot' && e.src === hero.id) hero.shots++;
  view.drain(sim, false);
  beforeTime = performance.now();
  // endless: once only one landing pad is left (or the match is over), a new battle starts 12 s later
  const pads = sim.units.reduce((n, u) => n + (sim.types[u.type].building && u.hp > 0 ? 1 : 0), 0);
  if ((sim.over || pads <= 1) && !overAt) overAt = performance.now();
}

// camera: follows a hero until it is destroyed, stays a moment on the wreck, then picks the next one.
// Hero = a vehicle in the thick of it (has a target, enemies close by), tanks first.
// ?overview shows the whole board instead (slow orbit). Dragging takes over for 6 s.
const overview = new URLSearchParams(location.search).has('overview');
const auto = { since: -1e9 };
const hero = { id: 0, since: 0, shots: 0, fell: 0, x: 0, z: 0, name: '', seat: 0 };
const HERO_RANK = { kampfpanzer: 5, lenkwerfer: 4, spaeher: 3 };
function pickHero(now) {
  const fighting = sim.units.filter((u) => u.hp > 0 && !sim.types[u.type].building);
  if (!fighting.length) return null;
  let best = null, bs = -1e18;
  for (const u of fighting) {
    const t = sim.types[u.type];
    let near = 0;
    for (const v of fighting) if (v.seat !== u.seat && Math.abs(v.x - u.x) < 60000 && Math.abs(v.y - u.y) < 60000) near++;
    const score = (HERO_RANK[u.type] ?? (t.cls === 'infantry' ? 0 : 2)) * 10 + (u.tgt ? 25 : 0) + Math.min(near, 12) * 3 + Math.random() * 8;
    if (score > bs) { bs = score; best = u; }
  }
  app.marked = best.id;
  Object.assign(hero, { id: best.id, since: now, shots: 0, fell: 0, name: sim.types[best.type].name || best.type, seat: best.seat, x: best.x / 1000, z: best.y / 1000 });
  heroChip.show();
  return best;
}
function camera(dt, now) {
  const c = view.cam, size = sim.map.size / 1000;
  if (now - auto.since < 6000) return;
  const k = 1 - Math.exp(-dt * 1.4), kSlow = 1 - Math.exp(-dt * 0.5);
  if (overview) {
    c.yaw += dt * 0.035;
    c.tx += (size / 2 - c.tx) * kSlow; c.tz += (size / 2 - c.tz) * kSlow;
    c.dist += (300 - c.dist) * kSlow; c.pitch += (0.66 - c.pitch) * kSlow;
    return;
  }
  const u = hero.id ? sim.byId.get(hero.id) : null;
  if (u && u.hp > 0) { hero.x = u.x / 1000; hero.z = u.y / 1000; }
  else if (hero.id && !hero.fell) { hero.fell = now; app.marked = 0; heroChip.fallen(); }
  if (!hero.id || (hero.fell && now - hero.fell > 2600)) { hero.id = 0; pickHero(now); }
  c.yaw += dt * 0.05;
  // wide screens: the hero sits right of the menu (focus moved to the camera's left)
  const shift = innerWidth >= 700 ? c.dist * 0.2 : 0;
  const fx = hero.x - Math.cos(c.yaw) * shift, fz = hero.z + Math.sin(c.yaw) * shift;
  c.tx += (fx - c.tx) * k; c.tz += (fz - c.tz) * k;
  c.dist += ((innerWidth < 700 ? 95 : 72) - c.dist) * kSlow; c.pitch += (0.8 - c.pitch) * kSlow;
}
// small chip top right: whom the camera follows, for how long, how many shots
const heroChip = (() => {
  const box = el('div', { class: 'ln-hero', id: 'ln-hero' });
  document.body.append(box);
  let t = 0;
  const side = () => SIDES.find((x) => x.seat === hero.seat) || SIDES[0];
  const age = () => { const s = Math.floor((performance.now() - hero.since) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return {
    show() {
      if (overview) return;
      box.className = 'ln-hero on';
      box.replaceChildren(el('span', { class: 'ln-dot', style: `background:${side().color}` }), el('b', {}, hero.name),
        el('span', { class: 'ln-hero-sub' }, `${side().name} · `, el('span', { id: 'ln-hero-time' }, '0:00'), ' · ', el('span', { id: 'ln-hero-shots' }, '0'), ' Schuss'));
    },
    fallen() { box.className = 'ln-hero on fallen'; box.querySelector('.ln-hero-sub')?.replaceChildren(`Gefallen nach ${age()} · ${hero.shots} Schuss`); },
    tick(now) {
      if (now - t < 250 || hero.fell || !hero.id) return; t = now;
      const a = document.getElementById('ln-hero-time'), b = document.getElementById('ln-hero-shots');
      if (a) a.textContent = age();
      if (b) b.textContent = hero.shots;
    },
  };
})();
let drag = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; auto.since = performance.now(); try { cv.setPointerCapture(e.pointerId); } catch {} });
cv.addEventListener('pointermove', (e) => { if (!drag) return; view.rotate((e.clientX - drag.x) * 0.006); view.cam.pitch = Math.max(0.35, Math.min(1.35, view.cam.pitch + (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; auto.since = performance.now(); });
addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); auto.since = performance.now(); }, { passive: false });

let last = performance.now(), acc = 0;
function loop() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (sim) {
    acc += dt * 1000;
    let n = 0;
    while (acc >= ROUND_MS && n++ < 3) { acc -= ROUND_MS; oneRound(); }
    if (acc > ROUND_MS * 3) acc = 0;
    if (overAt && now - overAt > 12000) newBattle();
    if (dials.running) { dials.hour = (dials.hour + dt * 24 / DAY_SECONDS) % 24; setAtmosphere(); }
    dialsCard.tick?.();
    camera(dt, now);
    heroChip.tick(now);
    view.draw(before, beforeTime);
  }
  requestAnimationFrame(loop);
}

// ---------- start ----------
drawMenu();
gameData().then(async (d) => {
  online = d.online; app.commit = d.commit;
  const s = await loadSkirmish(d.json, { faction: 'usa', map: 'grenzland', mode: 'skirmish' });
  // the diorama wants a lot more going on than a real match: big waves every 15 s, up to 45 units per side,
  // rocket launchers in every wave
  // landing pads hold five times longer, so a round lasts several minutes
  const faction = structuredClone(s.faction);
  const padId = s.mode.pad || 'landeplatz';
  if (faction.building?.[padId]) faction.building[padId].health *= 5;
  setup = { ...s, faction, mode: { ...s.mode, waveEvery: 15, maxUnits: 45,
    waves: [{ units: { kampfpanzer: 4, spaeher: 2, soldat: 10, lenkwerfer: 2 } }, { units: { kampfpanzer: 2, spaeher: 2, soldat: 6, lenkwerfer: 1 } }],
    extra: [{ each: 2, units: { lenkwerfer: 2, kampfpanzer: 1 } }] } };
  view.excite(1.8);
  view.setModels(s.models);
  newBattle();
  // start in the middle of things: a few waves already landed and on their way
  for (let i = 0; i < 420; i++) { if (i % 30 === 0) orders(); for (let k = 0; k < TICKS_PER_ROUND; k++) sim.step(); sim.events.length = 0; }
  round = 420;
  const c = view.cam, size = sim.map.size / 1000, first = pickHero(performance.now());
  c.yaw = 0.5; c.pitch = overview ? 0.66 : 0.8; c.dist = overview ? 300 : 72;
  if (first && !overview) { c.tx = hero.x; c.tz = hero.z; } else { c.tx = size / 2; c.tz = size / 2; }
  drawMenu();
  app.ready = true;
}).catch((e) => { root.append(el('div', { class: 'ln-error' }, 'Spieldaten fehlen: ' + e.message)); });
requestAnimationFrame(loop);
