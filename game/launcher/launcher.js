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
import { createMusic, nowPlaying, musicVolume, setMusicVolume, PLAYLIST } from '../party/music.js';

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
// liveliness of units (Fidelity step 2): shared with the battle, standard on
const LIFE_KEY = 'nomadtactics-life', lifeOn = () => read(LIFE_KEY) !== '0';

const app = { view: 'game', ls: null, selection: new Set(), drag: null, hud: true };   // hud: no rings or order lines
// Daniel's own tank (Voxel Max, models.json › daniel_tank with its own voxel size) drives for the yellow side
app.swapModel = (seat, key) => (seat === 2 && key === 'tank' && setup?.models?.daniel_tank ? 'daniel_tank' : null);
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
    el('label', {}, 'Lautstärke der Musik'),
    el('div', { class: 'ln-volume' }, icon('muted', 14),
      el('input', { type: 'range', min: 0, max: 100, step: 1, value: musicVolume(), class: 'ln-range ln-vol', id: 'ln-volume', oninput: (e) => setMusicVolume(Number(e.target.value)) }),
      icon('loudspeaker', 14)),
    el('div', { class: 'ln-hint' }, `Musik: „${PLAYLIST[0].title}“ von ${PLAYLIST[0].artist} (${PLAYLIST[0].credit}, ${PLAYLIST[0].license}). Im Spiel etwas leiser.`),
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
        onclick: () => { dials.fx = !dials.fx; view.imageFx(dials.fx); remember(); drawMenu(); } }, icon('star', 13)),
      el('button', { class: 'ln-mini' + (lifeOn() ? ' on' : ''), id: 'ln-life', title: lifeOn() ? 'Einheiten mit Leben (Federung, Rückstoß, Staub, Schaden) – tippen für den alten Look' : 'Einheiten ohne Leben (alter Look) – tippen für Federung, Rückstoß, Staub, Schaden',
        onclick: () => { write(LIFE_KEY, lifeOn() ? '0' : '1'); view.life(lifeOn()); drawMenu(); } }, icon('vehicle', 13))),
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
view.life(lifeOn());

let setup = null, sim = null, before = null, beforeTime = 0, overAt = 0, round = 0;
function newBattle() {
  const seed = (Math.random() * 0x7fffffff) | 0;
  sim = new Battle(seed, SIDES.map((s) => s.seat), setup);
  app.ls = { sim };
  round = 0; overAt = 0; before = null; hero.id = 0; director.nextStrike = 0; if (director.mode === 'tower') director.mode = 'hero';
  view.reset();
}
// AI: every 3 s each side sends its idle units at the nearest enemy landing pad; they fight whatever they meet
function orders() {
  for (const side of SIDES) {
    const own = sim.units.filter((u) => u.seat === side.seat && u.hp > 0);
    const pad = own.find((u) => sim.types[u.type].building);
    const idle = own.filter((u) => !sim.types[u.type].building && !sim.types[u.type].air && sim.types[u.type].weapon && !u.order && !u.tgt);
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
// tests and screenshots: hold the camera where it is (launcher.hold(), launcher.cam)
app.hold = (on = true) => { auto.since = on ? 1e15 : -1e9; };
const hero = { id: 0, since: 0, shots: 0, fell: 0, x: 0, z: 0, name: '', seat: 0 };
const HERO_RANK = { kampfpanzer: 5, lenkwerfer: 4, spaeher: 3 };
function pickHero(now) {
  const fighting = sim.units.filter((u) => u.hp > 0 && !sim.types[u.type].building && !sim.types[u.type].air);
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
// Director (06.11.): a wide shot at the start („Totale“), then the hero; every third fallen hero another wide
// shot; every 45–70 s a rocket strike on a standing tower with its own shot (towers also fall by themselves when
// the fighting gets too close – then the camera goes there too, if it is not busy).
const director = { mode: overview ? 'wide' : 'wide', until: 0, tower: null, heroes: 0, nextStrike: 0 };
function shotWide(now, ms) { director.mode = 'wide'; director.until = now + ms; app.marked = 0; heroChip.label('Totale', 'Grenzland · vier Armeen'); }
function shotTower(now, t, text) {
  director.mode = 'tower'; director.tower = t; director.until = now + 15000; app.marked = 0; heroChip.label(text, 'Hochhaus');
  // pick the view: from outside the city, a little from the side of the fall, and with no other tower in between
  const size = sim.map.size / 1000, ox = t.x - size / 2, oz = t.z - size / 2, len = Math.hypot(ox, oz) || 1;
  const side = [-t.dir[1], t.dir[0]];
  let best = 0, bestScore = -1e9;
  for (let i = 0; i < 24; i++) {
    const yaw = i / 24 * Math.PI * 2, vx = Math.sin(yaw), vz = Math.cos(yaw);
    let score = (vx * ox + vz * oz) / len * 1.5 + Math.abs(vx * side[0] + vz * side[1]);
    // blocked? walk along the line of sight from the camera (165 m, pitch 0.42) to the tower's middle
    const cx = t.x + vx * 165 * Math.cos(0.42), cz = t.z + vz * 165 * Math.cos(0.42), cy = 165 * Math.sin(0.42), ty = view.towers.height(t) * 0.45;
    for (const o2 of view.towers.list) {
      if (o2 === t || o2.state === 'down') continue;
      if (Math.hypot(cx - o2.x, cz - o2.z) < o2.size + 30) score -= 10;   // right next to the camera
      for (let q = 0; q < 0.95; q += 0.05) {
        const x = cx + (t.x - cx) * q, z = cz + (t.z - cz) * q, y = cy + (ty - cy) * q;
        if (Math.abs(x - o2.x) < o2.size * 0.75 + 12 && Math.abs(z - o2.z) < o2.size * 0.75 + 12 && y < view.towers.height(o2) + 18) { score -= 8; break; }
      }
    }
    if (score > bestScore) { bestScore = score; best = yaw; }
  }
  director.yaw = best;
}
app.director = director;
app.strikeNow = (t) => launchStrike(performance.now(), t);
app.shot = (t) => { shotTower(performance.now(), t, 'Einsturz'); director.until = 1e15; };
app.towers = () => view.towers.list;
app.viewTowers = view.towers;
app.cam = view.cam;
// tests and screenshots: a fixed time of day (stops the clock)
app.setHour = (h) => { dials.hour = h; dials.running = false; setAtmosphere(); };
app.view3d = view;
function launchStrike(now, chosen = null) {
  const standing = view.towers.standing();
  if (!standing.length) return;
  const t = chosen || standing[(Math.random() * standing.length) | 0];
  // rockets into the facade at different heights, the first ones low (that is what brings it down)
  for (let i = 0; i < 10; i++) {
    const [x, z, y] = view.towers.facadePoint(t);
    view.strike(x, z, i * 330, { y: i < 4 ? t.y0 + 1 + Math.random() * 4 : y, radius: 2.6 + Math.random(), size: 1.1 });
  }
  shotTower(now, t, 'Luftschlag');
}
// artillery: a few shells into the thick of the fighting (more explosions, Daniel 06.11.)
function barrage() {
  const busy = sim.units.filter((u) => u.hp > 0 && u.tgt && !sim.types[u.type].building);
  if (!busy.length) return;
  const u = busy[(Math.random() * busy.length) | 0], x = u.x / 1000, z = u.y / 1000;
  const n = 4 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) view.strike(x + (Math.random() - 0.5) * 24, z + (Math.random() - 0.5) * 24, i * 180 + Math.random() * 200, { size: 0.75, radius: 1.8, flight: 1500 });
}
// crushed or hit from outside (launcher only, the simulation runs offline here): units lose health
function hurt(x, z, r, pct) {
  const R = r * 1000;
  for (const u of sim.units) {
    const t = sim.types[u.type];
    if (u.hp <= 0 || t.building) continue;
    const dx = u.x - x * 1000, dz = u.y - z * 1000;
    if (dx * dx + dz * dz > R * R) continue;
    u.hp -= Math.ceil(t.hp * pct / 100);
  }
}
view.hooks.onCrush = (x, z, r, pct) => hurt(x, z, r, pct);
view.hooks.onStrike = (x, z, size) => hurt(x, z, 4.5 * size, 55);
view.hooks.onTower = (t, what) => { if (what === 'warn' && director.mode === 'hero' && !overview) shotTower(performance.now(), t, 'Einsturz'); };
function camera(dt, now) {
  const c = view.cam, size = sim.map.size / 1000;
  if (!director.nextStrike) director.nextStrike = now + 18000;
  if (!overview && now > director.nextStrike) { director.nextStrike = now + 30000 + Math.random() * 20000; if (director.mode !== 'tower') launchStrike(now); }
  if (!director.nextBarrage || now > director.nextBarrage) { if (director.nextBarrage) barrage(); director.nextBarrage = now + 6000 + Math.random() * 5000; }
  // a tower starts to fall on its own: go there unless something else is on
  if (!overview && director.mode === 'hero') {
    const falling = view.towers.list.find((t) => t.state === 'warn');
    if (falling) shotTower(now, falling, 'Einsturz');
  }
  if (now - auto.since < 6000) return;
  const k = 1 - Math.exp(-dt * 1.4), kSlow = 1 - Math.exp(-dt * 0.5);
  if (overview || director.mode === 'wide') {
    c.yaw += dt * 0.04;
    c.tx += (size / 2 - c.tx) * kSlow; c.tz += (size / 2 - c.tz) * kSlow;
    c.dist += (330 - c.dist) * kSlow; c.pitch += (0.7 - c.pitch) * kSlow;
    if (!overview && now > director.until) { director.mode = 'hero'; hero.id = 0; }
    if (director.mode !== 'hero') return;
  }
  if (director.mode === 'tower') {
    const t = director.tower;
    let dy = director.yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += dy * k + dt * 0.02; director.yaw += dt * 0.02;
    // look a bit above the base, from further away so the whole height and the fall fit in
    const fx = t.x + t.dir[0] * 12, fz = t.z + t.dir[1] * 12;
    c.tx += (fx - c.tx) * k; c.tz += (fz - c.tz) * k;
    c.dist += (165 - c.dist) * kSlow; c.pitch += (0.42 - c.pitch) * kSlow;
    // stay while it is still coming down (at most 20 s longer)
    const busy = t.state === 'warn' || t.state === 'fall';
    if (now > director.until && (!busy || now > director.until + 20000)) { director.mode = 'hero'; hero.id = 0; }
    else if (!busy && t.state === 'down' && director.until > now + 5000 && director.until < 1e14) director.until = now + 5000;
    return;
  }
  const u = hero.id ? sim.byId.get(hero.id) : null;
  if (u && u.hp > 0) { hero.x = u.x / 1000; hero.z = u.y / 1000; }
  else if (hero.id && !hero.fell) { hero.fell = now; app.marked = 0; heroChip.fallen(); }
  if (!hero.id || (hero.fell && now - hero.fell > 2600)) {
    hero.id = 0;
    if (++director.heroes % 3 === 0) { shotWide(now, 9000); return; }
    pickHero(now);
  }
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
    label(title, sub) {
      if (overview) return;
      box.className = 'ln-hero on scene';
      box.replaceChildren(icon(title === 'Totale' ? 'map' : 'building', 13), el('b', {}, title), el('span', { class: 'ln-hero-sub' }, sub));
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
// music with the „Now Playing“ chip bottom left (starts with the first tap or key, browser rule)
const music = createMusic({ level: 1 });
nowPlaying(music, document.body, { className: 'np-launcher' });
music.start();
app.music = music;
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
  view.setModels(s.models, s.life);
  newBattle();
  // start in the middle of things: a few waves already landed and on their way
  for (let i = 0; i < 420; i++) { if (i % 30 === 0) orders(); for (let k = 0; k < TICKS_PER_ROUND; k++) sim.step(); sim.events.length = 0; }
  round = 420;
  // intro: the whole battlefield first, then down to the first hero
  const c = view.cam, size = sim.map.size / 1000;
  c.yaw = 0.5; c.pitch = 0.62; c.dist = 380; c.tx = size / 2; c.tz = size / 2;
  shotWide(performance.now(), 10000);
  drawMenu();
  app.ready = true;
}).catch((e) => { root.append(el('div', { class: 'ln-error' }, 'Spieldaten fehlen: ' + e.message)); });
requestAnimationFrame(loop);
