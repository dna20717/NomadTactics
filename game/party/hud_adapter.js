// NomadTactics – Party: the game HUD (game/tactics/hud) on top of the battle.
// This adapter is the only part that knows both sides: it READS the simulation (through stable proxy objects,
// because the HUD keeps units in Sets) and turns HUD commands into lockstep commands. It never writes the simulation.
// Works with both views: 3D projects through the camera, 2D through projectWorld (A.project / A.flat).

import * as THREE from 'three';
import { createHud } from '../tactics/hud/hud.js';
import { PRACTICE_SEAT, PRACTICE, TICKS_PER_SECOND } from '../../engine/tactics/battle.js';
import { ROUND_MS } from '../../engine/net/protocol.js';

const M = 1 / 1000;
const SYMBOL = { tank: 'vehicle', werfer: 'rakete', spaeher: 'target', soldat: 'humans', dozer: 'build' };
const HEIGHT = { tank: 2.8, werfer: 3.2, spaeher: 2.3, soldat: 1.9, dozer: 2.8 };
const shortName = (n) => (n.length <= 9 ? n : n.split(/[\s-]/)[0].length <= 9 ? n.split(/[\s-]/)[0] : n.slice(0, 8) + '.');

export function hudForBattle({ app, views, send, meSeat, playerList, canvas }) {
  const v3 = views['3d'];
  const active = () => app.activeView();
  const sim = () => app.ls?.sim;
  const setup = app.setup;
  const units = new Map();   // sim id → proxy (stable object while the unit lives)
  const pads = new Map();
  let dataCache = new Map();
  const lives = new Map();   // unit id → live window

  // position between two rounds, like the views
  function pos(u) {
    const b = app.before?.get(u.id);
    if (!b) return [u.x, u.y];
    const t = Math.min(1, (performance.now() - app.beforeTime) / ROUND_MS);
    return [b[0] + (u.x - b[0]) * t, b[1] + (u.y - b[1]) * t];
  }
  const ground = (x, z) => (v3 ? v3.groundAt(x, z) : 0);

  function sync() {
    const s = sim(); if (!s) return;
    const seen = new Set();
    for (const u of s.units) {
      const t = s.types[u.type];
      if (t.air) continue; // companion drones: drawn by the views, never selected or commanded
      const [x, y] = pos(u);
      if (t.building) {
        let g = pads.get(u.id);
        if (!g) { g = { id: u.id, name: t.name, produces: [], queue: [], rally: null, alive: true }; pads.set(u.id, g); }
        const r = t.radius * M;
        Object.assign(g, { team: u.seat, x: x * M, z: y * M, y: ground(x * M, y * M), hx: r, hz: r, hp: u.hp / 100, alive: true });
      } else {
        let p = units.get(u.id);
        if (!p) { p = { id: u.id, kind: u.type, type: u.type, xp: 0, tier: 0, alive: true, stabTier: [] }; units.set(u.id, p); }
        p.team = u.seat; p.x = x * M; p.z = y * M;
        p.y = u.view ? u.view.y : ground(p.x, p.z);
        p.red = u.view ? u.view.yaw : Math.PI / 2 - (u.h / 256) * Math.PI * 2;
        p.hp = u.hp / 100; p.alive = true; p.hold = u.order === 0;
      }
      seen.add(u.id);
    }
    for (const [id, p] of units) if (!seen.has(id)) { p.alive = false; units.delete(id); }
    for (const [id, g] of pads) if (!seen.has(id)) { g.alive = false; pads.delete(id); }
    // orders and targets point at other proxies
    for (const u of s.units) {
      const p = units.get(u.id); if (!p) continue;
      const tgt = u.tgt ? units.get(u.tgt) || pads.get(u.tgt) : null;
      p.target = tgt || null;
      p.command = u.order === 1 ? { kind: 'drive', x: u.gx * M, z: u.gy * M, gid: `${u.seat}:${u.fkey}` }
        : u.order === 2 && tgt ? { kind: 'attack', target: tgt } : null;
    }
  }

  function data(kind) {
    if (dataCache.has(kind)) return dataCache.get(kind);
    const s = sim(); const t = s?.types[kind];
    if (!t) return { name: kind, short: kind, symbol: 'cube', health: 1, damage: 0, range: 0, speed: 0, height: 2, radius: 2, halfB: 1, halfL: 2, keywords: [], swIds: [], tiers: [] };
    const f = setup.faction.units?.[kind] || setup.faction.building?.[kind] || {};
    const kw = setup.keywords || {};
    const r = t.radius * M, w = t.weapon;
    const d = {
      id: kind, name: t.name, short: f.short || shortName(t.name), symbol: SYMBOL[t.model] || (t.cls === 'infantry' ? 'humans' : 'vehicle'),
      cost: f.cost?.money || 0, buildTime: f.buildTime || 0, health: Math.round(t.hp / 100),
      damage: w ? Math.round((w.damage / 100) * w.salvo) : 0, range: w ? Math.round(w.range * M) : 0, speed: f.speed || 0,
      height: HEIGHT[t.model] || (t.cls === 'infantry' ? 1.9 : 2.6), radius: r, halfB: r * 0.62, halfL: r * 1.05, infantry: t.cls === 'infantry',
      keywords: Object.entries(f.keywords || {}).map(([k, v]) => (kw[k]?.name || k) + (v !== true && v != null ? `(${v})` : '')),
      swIds: Object.keys(f.keywords || {}), tiers: [],
    };
    dataCache.set(kind, d);
    return d;
  }

  function teamColor(seat) {
    if (seat === PRACTICE_SEAT) return PRACTICE.color;
    return playerList().find((p) => p.seat === seat)?.color || '#999999';
  }

  function hit(cx, cy, minRadius = 12) {   // fingers get a bigger catch radius
    const s = sim(); if (!s) return null;
    const v = active();
    let best = null, bd = Infinity;
    for (const p of units.values()) {
      if (!p.alive) continue;
      const q = v.projectWorld(p.x, p.y + 1, p.z); if (!q) continue;
      const r = Math.max(minRadius, v.pixelsPerMm(p.x / M, p.z / M) * (data(p.kind).radius / M + 600));
      const d = Math.hypot(q.x - cx, q.y - cy);
      if (d < r && d < bd) { best = p; bd = d; }
    }
    if (best) return { kind: 'unit', e: best };
    const [wx, wy] = v.unproject(cx, cy);
    const x = wx * M, z = wy * M;
    for (const g of pads.values()) if (Math.abs(x - g.x) < g.hx + 0.8 && Math.abs(z - g.z) < g.hz + 0.8) return { kind: 'building', g };
    return { kind: 'ground', x, z };
  }

  function command(b) {
    const s = sim(); if (!s || app.spectator) return false;
    const me = meSeat();
    const ids = (list) => list.filter((u) => u.team === me).map((u) => u.id);
    if (b.kind === 'drive') {
      const list = b.targets.map((t) => t.e).filter((u) => u.team === me);
      if (!list.length) return false;
      const x = b.targets.reduce((a, t) => a + t.x, 0) / b.targets.length, z = b.targets.reduce((a, t) => a + t.z, 0) / b.targets.length;
      // driving onto an enemy landing pad means: attack it
      const pad = [...pads.values()].find((g) => g.team !== me && Math.abs(x - g.x) < g.hx + 0.8 && Math.abs(z - g.z) < g.hz + 0.8);
      if (pad) { send({ t: 'command', b: { kind: 'attack', ids: ids(list), target: pad.id } }); return true; }
      const size = s.map.size - 1;
      send({ t: 'command', b: { kind: 'drive', ids: ids(list), x: Math.max(0, Math.min(size, Math.round(x / M))), y: Math.max(0, Math.min(size, Math.round(z / M))) } });
      return true;
    }
    if (b.kind === 'attack') { send({ t: 'command', b: { kind: 'attack', ids: ids(b.units), target: b.target.id } }); return true; }
    if (b.kind === 'halt') { send({ t: 'command', b: { kind: 'halt', ids: ids(b.units) } }); return true; }
    return false; // build, cancel, rally point, abilities: not in this mode yet
  }

  function minimap() {
    const s = sim(); const m = s.map, n = m.n;
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), img = g.createImageData(n, n);
    const terrains = s.world.terrains || {};
    const rgb = m.grounds.map((id) => { const v = parseInt((terrains[id]?.color || '#6f9a4a').slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; });
    for (let k = 0; k < n * n; k++) {
      const [r, gg, b] = rgb[m.ground[k]], i = k % n, j = (k - i) / n;
      const up = j > 0 && i > 0 ? m.level[k] - m.level[k - n - 1] : 0;
      const f = 1 + m.level[k] * 0.12 + up * 0.18;
      img.data.set([Math.min(255, r * f), Math.min(255, gg * f), Math.min(255, b * f), 255], k * 4);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // live picture into a slot (selection portrait) or into its own window
  function liveCanvas(el) {
    let cv = el.querySelector('canvas.live');
    if (!cv) {
      cv = document.createElement('canvas'); cv.className = 'live'; el.appendChild(cv);
      const w = document.createElement('div'); w.className = 'way'; w.textContent = 'VERBINDUNG VERLOREN'; el.appendChild(w);
    }
    return cv;
  }
  function portrait(el, u) {
    if (!v3) return;
    if (!el || !u) { v3.inset('portrait', null); return; }
    const cv = liveCanvas(el);
    el.classList.toggle('lost', !u.alive);
    v3.inset('portrait', cv, u.id);
  }
  function livePane(u) {
    if (!v3 || lives.has(u.id)) { lives.get(u.id) && hud.fs.show(lives.get(u.id).id, true); return; }
    const id = 'live' + u.id;
    const f = hud.fs.new(id, { title: `Live · ${data(u.kind).name}`, symbol: 'auge', dock: null, closable: true, class: 'f-live' });
    f.x = 260 + lives.size * 30; f.y = 120 + lives.size * 30; hud.fs.inSight(f);
    const box = document.createElement('div'); box.className = 'portrait live-box'; f.content.appendChild(box);
    const cv = liveCanvas(box);
    v3.inset(id, cv, u.id);
    lives.set(u.id, { id, f, box, u });
  }

  const dummy = v3 ? null : { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
  const A = {
    THREE, scene: v3 ? v3.scene : dummy.scene, camera: v3 ? v3.camera : dummy.camera, canvas,
    get team() { return meSeat(); },
    ui: setup.ui || {}, nation: setup.faction.ui || null,
    units: () => [...units.values()],
    building: () => [...pads.values()],
    data, teamColor,
    state: () => {
      const s = sim();
      return { money: null, income: 0, power: [0, 0], rank: 1, weather: { name: 'Klar', symbol: 'sun' }, time: s ? s.tick / TICKS_PER_SECOND : 0,
        wave: s && !s.over ? `Welle ${s.waveCount + 1} in ${Math.ceil(s.nextWave / TICKS_PER_SECOND)} s` : null };
    },
    isPause: () => !!app.state?.pause,
    ground,
    get world() { return { min: 0, max: (sim()?.map.size || 256000) * M }; },
    basis: () => { const g = [...pads.values()].find((x) => x.team === meSeat()); return g ? { x: g.x, z: g.z } : { x: 128, z: 128 }; },
    hit, visible: () => true, command,
    controls: {
      jumpTo: (x, z) => active().centreOn(x / M, z / M, true),
      target: () => (v3 && active() === v3 ? v3.target() : null),
      leftDrag: (on) => { app.leftDragCamera = on; },
      touchFrame: (on) => { app.touchFrame = on; },   // one finger draws a frame instead of moving the camera
      fieldOfView: () => {
        const v = active(), w = canvas.clientWidth, h = canvas.clientHeight;
        return [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => { const [x, y] = v.unproject(px, py); return { x: x * M, z: y * M }; });
      },
    },
    minimap, abilities: [],
    portrait, livePane,
    project: (x, y, z) => active().projectWorld(x, y, z),
    flat: () => active().kind === '2d',
  };

  const hud = createHud(A);
  hud.partyPane = hud.fs.new('party', { title: 'Partie', symbol: 'humans', dock: 'top', series: 1, class: 'f-party' });

  // messages from the simulation
  let lossT = -1e9;
  function events(list) {
    const s = sim(); const me = meSeat();
    for (const e of list) {
      if (e.kind === 'wave' && e.seat === me) hud.message(`Welle ${e.n}: Verstärkung ist gelandet.`, { x: e.x * M, z: e.y * M }, { kind: 'good', voice: true, speak: 'Verstärkung ist da.' });
      else if (e.kind === 'dead' && e.seat === me && !s.types[e.type]?.air && performance.now() - lossT > 5000) {
        const t = s.types[e.type];
        lossT = performance.now();
        hud.message(`${t.name} verloren.`, { x: e.x * M, z: e.y * M }, { kind: 'hostile', voice: !t.building, speak: hud.radio('lost') });
      } else if (e.kind === 'dead' && s.types[e.type]?.building && e.seat !== me) hud.message('Feindlicher Landeplatz zerstört!', { x: e.x * M, z: e.y * M }, { kind: 'good', voice: true });
      else if (e.kind === 'out') {
        const name = e.seat === PRACTICE_SEAT ? PRACTICE.name : playerList().find((p) => p.seat === e.seat)?.name ?? 'Jemand';
        hud.message(e.seat === me ? 'Du bist raus.' : `${name} ist raus.`, null, { kind: e.seat === me ? 'hostile' : 'good', voice: true });
      }
    }
  }

  function step(dt) {
    sync();
    // live windows: close the picture when the window is closed, show „lost“ when the unit is gone
    for (const [id, l] of lives) {
      if (l.f.el.hidden) { v3?.inset(l.id, null); l.f.el.remove(); hud.fs.all.delete(l.id); lives.delete(id); continue; }
      l.box.classList.toggle('lost', !units.has(id));
    }
    // the views read the selection as a set of ids
    app.selection = new Set([...hud.unitsSelection()].map((p) => p.id));
    hud.step(dt);
  }
  function show(on) { hud.root.style.display = on ? '' : 'none'; }
  function reset() {
    units.clear(); pads.clear(); dataCache = new Map();
    hud.select([]); hud.groups = {}; hud.ticker = []; hud.drawTicker(); hud.baseFrames = {};
    for (const [, l] of lives) { v3?.inset(l.id, null); l.f.el.remove(); hud.fs.all.delete(l.id); }
    lives.clear();
  }
  return { hud, step, show, reset, events, message: (t, k = 'info') => hud.message(t, null, { kind: k }) };
}
