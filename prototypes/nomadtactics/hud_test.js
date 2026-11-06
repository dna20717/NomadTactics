// NomadTactics – stress test with game HUD (game/tactics/hud). Entry point for `npm run build:stress` (permanently built in since stress test 8).
// This adapter is the only part that knows the stress test. In the real game it is replaced by an adapter
// that reads from the engine and sends commands into the lockstep. Production and money are dummies here;
// names, costs, build time, keywords, experience, UI and radio come from the workshop.
// Test panel (old bars of the stress test): button in the HUD, ?testpult in the URL, automatic under test automation (except ?hud).
import './stress_test.js';
import { createHud } from '../../game/tactics/hud/hud.js';
import hudCss from '../../game/tactics/hud/hud.css';
import { effective, tiersFrom, tiersFactors, tiersText } from '../../engine/tactics/index.js';
import UI from '../../projects/nomadtactics/data/ui.json';
import EXPERIENCE from '../../projects/nomadtactics/data/experience.json';
import KEYWORDS from '../../projects/nomadtactics/data/keywords.json';
import WEAPONS from '../../projects/nomadtactics/data/weapons.json';
import MODELS from '../../projects/nomadtactics/data/models.json';
import USA from '../../projects/nomadtactics/factions/usa.json';
import UKRAINE from '../../projects/nomadtactics/factions/ukraine.json';

const H = window.stressTest, THREE = H.THREE;
const DESK = new URLSearchParams(location.search).has('testDesk') || (navigator.webdriver && !new URLSearchParams(location.search).has('hud'));
H.hooks.hudActive = !DESK;
document.body.classList.add('with-hud');
if (DESK) document.body.classList.add('testDesk');
const st = document.createElement('style');
st.textContent = `body.mit-hud:not(.testDesk) #top, body.mit-hud:not(.testDesk) #bottom, body.mit-hud:not(.testDesk) #stats, body.mit-hud:not(.testDesk) #legend, body.mit-hud:not(.testDesk) #bridges, body.mit-hud:not(.testDesk) #hint { display: none; }
  body.testpult .hud-dock-top { top: 7.5em; }
  .lf.lf-portrait { pointer-events: none; transition: none; z-index: 1; }
  .lf.lf-portrait .lf-head, .lf.lf-portrait .lf-foot, .lf.lf-portrait .lf-corner, .lf.lf-portrait .lf-jam { display: none !important; }
  .portrait canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; }
  .portrait .way { position: absolute; inset: 0; display: none; place-items: center; text-align: center; font: 700 0.75em ui-monospace, monospace; letter-spacing: .14em; color: #ff6a5a; z-index: 8; text-shadow: 0 0 4px #000; }
  .portrait.verloren .way { display: grid; }`;
document.head.appendChild(st);

// ---------- Data from the workshop (projects/nomadtactics) ----------
// Names, costs, build time, keywords, experience tiers, UI and radio come from the workshop.
// Combat stats (health, damage, range, speed) remain those of the stress test until the real simulation exists.
// Mapping via the model: models.json › quelle „prototype:<name>“ → stress-test type.
const P = { data: { experience: EXPERIENCE, keywords: KEYWORDS, weapons: WEAPONS, ui: UI, models: MODELS }, paths: {}, factions: new Map([['usa', USA], ['ukraine', UKRAINE]]) };
const NATION = ['usa', 'ukraine'];                                    // Team 0 plays USA, team 1 plays Ukraine
const PROTO_TYPE = { tank: 'tank', werfer: 'werfer', spaeher: 'spaeher', soldat: 'squad', dozer: 'dozer' };
const FALLBACK_MODEL = { daniel_tank: 'tank' };                        // .vox-Modelle ohne Prototyp
const SYMBOL = { squad: 'humans', spaeher: 'target', tank: 'vehicle', werfer: 'rakete', dozer: 'build' };
const HEIGHT = { squad: 1.9, spaeher: 2.3, tank: 2.8, werfer: 3.2, dozer: 2.8 };
// kit models (06.11.) carry their size class in `footprint` (tank, werfer, spaeher, soldat, dozer)
const simType = model => { const q = MODELS[model]?.source || ''; return q.startsWith('prototype:') ? PROTO_TYPE[q.slice(10)] : PROTO_TYPE[MODELS[model]?.footprint] || FALLBACK_MODEL[model]; };
const shortName = n => n.length <= 9 ? n : n.split(/[\s-]/)[0].length <= 9 ? n.split(/[\s-]/)[0] : n.slice(0, 8) + '.';
const swText = (id, w) => (KEYWORDS[id]?.name || id) + (w !== true && w != null ? `(${w})` : '');
const DATA = {}, Q = EXPERIENCE.sources || {};
for (const [team, fid] of NATION.entries()) {
  const f = effective(P.factions.get(fid), null);
  for (const [uid, e] of Object.entries(f.units || {})) {
    const type = simType(e.model); if (!type) continue;
    const T = H.TYPES[type], st = tiersFrom(P, e);
    const tiers = st.map((s, i) => { const F = tiersFactors(P, e, i + 1); const newSw = (s.effect || []).filter(w => w.kind === 'keyword');
      return { name: s.name, min: s.min, text: tiersText(P, s), keyword: newSw.length ? newSw.map(w => swText(w.keyword, w.stat)).join(', ') : null, F }; });
    DATA[`${fid}:${uid}`] = { id: uid, faction: fid, team, type, name: e.name, short: e.short || shortName(e.name), symbol: SYMBOL[type], cost: e.cost?.money || 0, buildTime: e.buildTime || 8, height: HEIGHT[type],
      health: T.hp, damage: T.damage ? Math.round(T.damage * (T.salvo || 1)) : 0, range: T.range || 0, speed: T.speed, radius: T.radius, halfB: T.radius * 0.52, halfL: T.radius * 0.95, infantry: !!T.infantry,
      keywords: Object.entries(e.keywords || {}).map(([k, w]) => swText(k, w)), swIds: Object.keys(e.keywords || {}), tiers };
  }
}
// Stress-test units get their data key (art); what the nation's buildings build is preferred
const buildable = fid => Object.values(effective(P.factions.get(fid), null).building || {}).flatMap(g => g.produces || []);
function kindFor(type, team) {
  const fid = NATION[team], b = buildable(fid), cand = Object.values(DATA).filter(d => d.faction === fid && d.type === type);
  const d = cand.find(x => b.includes(x.id)) || cand[0];
  return d ? `${fid}:${d.id}` : null;
}
// Fallback if a nation has no matching type: base stats of the stress test
for (const [type, T] of Object.entries(H.TYPES)) DATA['sim:' + type] = { id: type, type, name: T.name, short: shortName(T.name), symbol: SYMBOL[type], cost: 0, buildTime: 8, height: HEIGHT[type], health: T.hp,
  damage: T.damage ? Math.round(T.damage * (T.salvo || 1)) : 0, range: T.range || 0, speed: T.speed, radius: T.radius, halfB: T.radius * 0.52, halfL: T.radius * 0.95, infantry: !!T.infantry, keywords: [], swIds: [], tiers: [] };
const giveKind = u => { u.kind ||= kindFor(u.type, u.team) || 'sim:' + u.type; return u.kind; };
for (const u of H.units()) giveKind(u);
const dataFrom = u => DATA[giveKind(u)];

// ---------- Production buildings of the blue base ----------
const boxData = g => { const c = g.box.getCenter(new THREE.Vector3()), s = g.box.getSize(new THREE.Vector3()); return { x: c.x, y: g.box.min.y, z: c.z, hx: s.x / 2, hz: s.z / 2 }; };
const kaserneBlue = H.building.find(g => g.kind === 'kaserne' && g.grp.position.z < 0);
const kaserneRed = H.building.find(g => g.kind === 'kaserne' && g.grp.position.z > 0);
const factoryG = H.buildingAssign(H.kaserne(), -24, -60, 0, H.TEAM_COLOR[0], 'kaserne');
const kaserne2G = H.buildingAssign(H.kaserne(), 24, -60, 0, H.TEAM_COLOR[0], 'kaserne');
let gid = 0;
const bld = (g, name, produces = [], team = 0) => ({ id: ++gid, g, name, team, produces, queue: [], ...boxData(g), rally: null });
// Nation's buildings: name and build list from the workshop (only units the stress test can represent)
const bldData = (team, gid) => { const fid = NATION[team], g = effective(P.factions.get(fid), null).building?.[gid] || {};
  return [g.name || gid, (g.produces || []).map(id => `${fid}:${id}`).filter(k => DATA[k])]; };
const BUILDING = [bld(kaserneBlue, ...bldData(0, 'kaserne'), 0), bld(factoryG, ...bldData(0, 'waffenfabrik'), 0), bld(kaserne2G, ...bldData(0, 'hauptquartier'), 0), bld(kaserneRed, bldData(1, 'shelter')[0], [], 1)];
for (const b of BUILDING) b.rally = { x: b.x, z: b.z + (b.team ? -1 : 1) * (b.hz + 16) };

// ---------- Spielstand-Attrappe ----------
const S = { money: 4000, income: 25, rank: 1, xpTotal: 0 };
const WEATHER_SYMBOL = { clear: 'sun', cloudy: 'cloud', rain: 'rain', fog: 'fog', snow: 'snow', storm: 'storm', wind: 'wind' };
const WEATHER_TINT = { clear: 'rgba(255,240,180,0.06)', cloudy: 'rgba(120,130,140,0.25)', rain: 'rgba(60,90,140,0.35)', fog: 'rgba(220,225,230,0.5)', snow: 'rgba(255,255,255,0.45)', storm: 'rgba(40,50,70,0.5)', wind: 'rgba(200,220,230,0.2)' };

// ---------- Hilfen ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), overlay = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
function jumpTo(x, z) { const d = tmp.set(x - H.ctl.target.x, 0, z - H.ctl.target.z); H.ctl.target.add(d); H.mainCam.position.add(d); H.ctl.update(); }
function tierApply(u) {   // Factors from the effects of the tiers (tiersFactors, cumulative)
  const F = dataFrom(u).tiers[u.tier - 1]?.F || {};
  const oldL = u.mHealth || 1;
  u.mDamage = F.damage || 1; u.mHealth = F.health || 1; u.mSpeed = F.speed || 1;
  u.stabTier = F.keywords || [];
  u.hp *= u.mHealth / oldL;
}
const hasKeyword = (u, id) => dataFrom(u).swIds.includes(id) || (u.stabTier || []).includes(id);
function experience(u, amount) {
  if (!u || !u.alive || amount <= 0) return;
  u.xp = (u.xp || 0) + amount; u.tier ||= 0;
  if (u.team === 0) S.xpTotal += amount;
  hud.experience(u, amount);
  const st = dataFrom(u).tiers;
  while (st[u.tier] && u.xp >= st[u.tier].min) { u.tier++; tierApply(u); hud.promoted(u, st[u.tier - 1]); }
}

// ---------- Adapter ----------
const A = {
  THREE, scene: H.s, camera: H.mainCam, canvas: H.r.domElement, team: 0,
  units: () => H.units(),
  building: () => BUILDING.filter(b => !b.g.dead && !b.g.sinks),
  data: kind => DATA[kind],
  ui: UI,
  nation: USA.ui || null,
  teamColor: t => '#' + H.TEAM_COLOR[t].toString(16).padStart(6, '0'),
  state: () => ({ money: S.money, income: S.income, power: [80, 30 + 15 * BUILDING.filter(b => b.team === 0 && b.queue.length).length], rank: S.rank,
    weather: { name: H.WEATHER[H.W.kind].name, symbol: WEATHER_SYMBOL[H.W.kind] || 'cloud', tint: WEATHER_TINT[H.W.kind] }, time: H.simTime() }),
  isPause: () => H.isPause(),
  ground: (x, z) => H.groundHeight(x, z),
  world: { min: -H.N * H.V, max: H.N * H.V },
  basis: () => ({ x: 0, z: -44 }),
  hit(cx, cy) {
    const p = H.targetPoint(cx, cy); if (!p) return null;
    const u = H.unitAt(p); if (u) return { kind: 'unit', e: u };
    for (const b of A.building()) if (Math.abs(p.x - b.x) < b.hx + 0.8 && Math.abs(p.z - b.z) < b.hz + 0.8) return { kind: 'building', g: b };
    return { kind: 'ground', x: p.x, z: p.z };
  },
  visible(x, y, z) {
    const target = tmp.set(x, y, z), from = H.mainCam.position, d = target.distanceTo(from);
    ray.set(from, target.clone().sub(from).normalize()); ray.far = d - 1;
    const meshes = []; for (const g of H.building) if (!g.dead && !g.sinks) for (const s of g.segs.values()) meshes.push(s.mesh);
    return ray.intersectObjects(meshes, false).length === 0;
  },
  controls: {
    jumpTo, target: () => H.ctl.target,
    leftDrag(on) { H.ctl.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : null; },
    fieldOfView() {
      const out = [];
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ray.setFromCamera(ndc.set(x, y), H.mainCam); const p = ray.ray.intersectPlane(overlay, new THREE.Vector3()); if (!p) return null; out.push(p); }
      return out;
    },
  },
  minimap(kind) {
    const n = 2 * H.N + 1, cv = document.createElement('canvas'); cv.width = cv.height = n;
    const g = cv.getContext('2d'), img = g.createImageData(n, n);
    const COLOR = { grass: [92, 140, 62], grassBrightness: [128, 168, 80], earth: [128, 100, 66], soot: [58, 54, 50], plate: [150, 150, 140], asphalt: [74, 76, 80] };
    for (let gz = -H.N; gz <= H.N; gz++) for (let gx = -H.N; gx <= H.N; gx++) {
      const b = H.ground(gx, gz), i = ((gz + H.N) * n + gx + H.N) * 4; if (!b) continue;
      let [r, gr, bl] = COLOR[H.KINDS[b[1]]] || [100, 120, 80];
      if (kind === 'terrain') { const b2 = H.ground(gx - 1, gz - 1); const k = 1 + ((b2 ? b[0] - b2[0] : 0) * 0.12) + b[0] * 0.02; r *= k; gr *= k; bl *= k; }
      img.data[i] = r; img.data[i + 1] = gr; img.data[i + 2] = bl; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); return cv;
  },
  abilities: [
    { id: 'airstrike', name: 'Luftschlag', symbol: 'rakete', cooldown: 25, description: 'Sechs Raketen auf das Zielgebiet.' },
    { id: 'fog', name: 'Nebelwand', symbol: 'fog', cooldown: 60, description: 'Ruft 40 Sekunden dichten Nebel (Wetter-Fähigkeit, wie für Sela geplant).' },
    { id: 'super', name: 'Superwaffe', symbol: 'skull', cooldown: 90, description: 'Countdown, Blitz, Pilzwolke. Alles im Umkreis von 18 m ist hin.' },
  ],
  command(b) {
    switch (b.kind) {
      case 'build': {
        const d = DATA[b.type]; if (S.money < d.cost || b.building.queue.length >= 9) return false;
        S.money -= d.cost; b.building.queue.push({ type: b.type, rest: d.buildTime, duration: d.buildTime }); return true;
      }
      case 'cancel': {
        const l = b.building.queue; for (let i = l.length - 1; i >= 0; i--) if (l[i].type === b.type) { S.money += DATA[b.type].cost; l.splice(i, 1); return true; }
        return false;
      }
      case 'drive': for (const z of b.targets) { z.e.command = { kind: 'drive', x: z.x, z: z.z, speed: b.speed, gid: b.gid }; z.e.hold = false; z.e.target = null; } return true;
      case 'attack': for (const e of b.units) { e.command = { kind: 'attack', target: b.target }; e.hold = false; } return true;
      case 'halt': for (const e of b.units) { e.command = null; e.target = null; e.hold = true; e.wx = e.x; e.wz = e.z; } return true;
      case 'rallyPoint': b.building.rally = { x: b.x, z: b.z }; return true;
      case 'ability': {
        const p = new THREE.Vector3(b.x, H.groundHeight(b.x, b.z), b.z);
        if (b.id === 'super') H.superweapon(p);
        if (b.id === 'airstrike') for (let i = 0; i < 6; i++) setTimeout(() => { const q = p.clone(); q.x += (Math.random() - 0.5) * 14; q.z += (Math.random() - 0.5) * 14; q.y = H.groundHeight(q.x, q.z); H.playerExplosion(q, 2.6, 1.8); }, 300 + i * 260);
        if (b.id === 'fog') { const before = H.W.kind === 'fog' ? 'clear' : H.W.kind; H.setWeather('fog'); setTimeout(() => { if (H.W.kind === 'fog') H.setWeather(before); }, 40000); }
        return true;
      }
    }
    return false;
  },
  livePane: u => H.openFollow(u),
  testDesk: () => { const on = document.body.classList.toggle('testDesk'); H.hooks.hudActive = !on; },
  portrait(el, u) { portrait(el, u); },
};

// ---------- Live portrait: live window under the slot, image is copied over after every frame ----------
let por = null;
function portrait(el, u) {
  if (!el || !u) { if (por) { if (!por.before) H.close(por.f); por = null; } return; }
  if (!por || por.u !== u) {
    if (por && !por.before) H.close(por.f);
    const before = H.pane.find(f => f.u === u && f.kind === 'follow');
    const f = H.openFollow(u); f.el.classList.add('lf-portrait');
    por = { u, f, el: null, cv: null, before: !!before };
  }
  if (por.el !== el) {   // Slot was rebuilt (e.g. after a promotion): re-attach the canvas
    let cv = el.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); el.appendChild(cv); const w = document.createElement('div'); w.className = 'way'; w.textContent = 'VERBINDUNG VERLOREN'; el.appendChild(w); }
    por.el = el; por.cv = cv;
  }
  const { f, cv } = por, b = el.getBoundingClientRect();
  if (!H.pane.includes(f)) { el.classList.add('lost'); return; }
  f.el.style.left = b.left + 'px'; f.el.style.top = b.top + 'px'; f.el.style.width = b.width + 'px'; f.image.style.height = b.height + 'px';
  if (f.mark) f.mark.visible = false;
  el.classList.toggle('lost', f.kind === 'lost');
  const pr = H.r.getPixelRatio(), w = Math.round(b.width * pr), h = Math.round(b.height * pr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  try { cv.getContext('2d').drawImage(H.r.domElement, b.left * pr, b.top * pr, w, h, 0, 0, w, h); } catch {}
}

// ---------- HUD starten ----------
const hud = createHud(A, { css: hudCss });
window.hud = hud;
H.hooks.event = (p, title, sub) => hud.message(`${title}: ${sub}`, { x: p.x, z: p.z }, { kind: title === 'Verlust' ? 'hostile' : 'warn', voice: title !== 'Verlust', speak: sub });
H.hooks.hit = (from, target, damage, dead) => {
  if (from) experience(from, damage * (Q.damage ?? 1) + (dead ? (Q.kill ?? 0) + dataFrom(target).health * (Q.killStat ?? 0) : 0));
  if (!dead && target.alive) experience(target, damage * (Q.taken ?? 0));     // took damage and survived
};
H.hooks.new = u => { u.stabTier = []; giveKind(u); };
let lossT = -99;
H.hooks.die = u => {
  if (u.team === 0 && (u.produces || (u.tier || 0) >= 2) && H.simTime() - lossT > 6) { lossT = H.simTime(); const d = dataFrom(u); hud.message(`${d.name}${u.tier ? ' (' + d.tiers[u.tier - 1].name + ')' : ''} verloren.`, { x: u.x, z: u.z }, { kind: 'hostile', voice: true, speak: hud.radio('lost') }); }
};
let fightT = 0;
H.hooks.afterImage = dt => {
  if (!H.isPause()) {
    S.money += S.income * dt;
    for (const b of BUILDING) {
      const s = b.queue[0]; if (!s || b.g.dead || b.g.sinks) continue;
      s.rest -= dt;
      if (s.rest <= 0) {
        b.queue.shift();
        const ahead = b.team ? -1 : 1, u = H.newUnit(DATA[s.type].type, b.team, b.x + (Math.random() - 0.5) * 3, b.z + ahead * (b.hz + 3));
        u.kind = s.type;
        if (b.rally) { u.command = { kind: 'drive', x: b.rally.x + (Math.random() - 0.5) * 6, z: b.rally.z + (Math.random() - 0.5) * 6, gid: 'rally' + b.id }; u.hold = false; }
        hud.message(`${hud.radio('ready', { name: DATA[s.type].name })} (${b.name})`, { x: u.x, z: u.z }, { kind: 'good', voice: true, speak: hud.radio('ready', { name: DATA[s.type].name }) });
        if (!b.queue.length) hud.message(hud.radio('idle', { gebaeude: b.name }), { x: b.x, z: b.z }, { kind: 'warn' });
      }
    }
    // Experience from surviving, spotting and supporting (once per second)
    fightT += dt;
    if (fightT >= 1) {
      fightT -= 1;
      for (const u of H.units()) {
        if (!u.alive) continue;
        if (u.target) experience(u, Q.fight ?? 0);                                                                     // survived in combat
        if ((hasKeyword(u, 'builds') || hasKeyword(u, 'repaired')) && u.team === 0) experience(u, Q.support ?? 0);  // builds and repairs at the base
        if (hasKeyword(u, 'scout') && u.target) experience(u, Q.recon ?? 0);                                  // spots
        if (hasKeyword(u, 'selfRepair')) u.hp = Math.min(H.TYPES[u.type].hp * (u.mHealth || 1), u.hp + 1.5);
      }
      S.rank = 1 + Math.floor(S.xpTotal / 600);
    }
  }
  hud.step(dt);
};
hud.message(`Härtetest bereit. ${BUILDING[0].name} oder ${BUILDING[1].name} anklicken und bauen.`, null, { kind: 'good' });
