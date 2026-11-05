// NomadTactics – game HUD (Daniel and Ava, 04.11.2026). Decisions: claude.ai project, doc `claude/nomadtactics-ui.md`.
//
// Principle: the HUD never touches the simulation. It READS via an adapter and ACTS only via commands.
// In the stress test the adapter executes commands immediately, in the real game the same commands go into the lockstep.
//
// Adapter A (Pflicht, siehe prototypes/nomadtactics/hud_test.js):
//   THREE, szene, kamera, leinwand (canvas for input), team (own team)
//   units()  → list with fields x y z rot typ art? team hp lebt xp stufe befehl ziel halten (art = data key for data(), otherwise typ)
//   gebaeude()   → [{ id, name, team, x, y, z, hx, hz, produziert: [typ], schlange: [{ typ, rest, dauer }], sammel: { x, z } }]
//   daten(art)   → { name, kurz, symbol, kosten, bauzeit, leben, schaden, reichweite, tempo, hoehe, radius, stichwoerter, stufen: [{ name, ab, text, stichwort? }] }
//   stand()      → { geld, einkommen, strom: [liefert, braucht], rang, wetter: { name, symbol }, zeit }
//   hit(cx, cy) → { art: 'unit', e } | { art: 'building', g } | { art: 'ground', x, z } | null
//   ground(x, z)  → height;  visible(x, y, z) → freely visible from the camera?
//   befehl(b)    → bauen | abbrechen | fahren | angriff | halt | sammelpunkt | faehigkeit
//   steuerung: { springe(x, z), linksZiehen(an), blickfeld() → 4 Bodenpunkte, ziel() }
//   welt: { min, max }, minimap(ebene) → canvas with base image, faehigkeiten: [{ id, name, symbol, cooldown, description }]
//   portrait(el | null, e) → live image of a unit in el;  livePane(e);  testDesk?() (optional)
//   optional: project(x, y, z) → { x, y } screen point (else the camera projects; lets a 2D view use the HUD too),
//   flat() → true when the view has no perspective (no distance culling of gauges),
//   state().money === null hides money and power (modes without economy), state().wave = text for the wave countdown
import { chevronsSvg } from '../chevrons.js';
import { PaneSystem } from './pane.js';
import { applyMoodOn, token, loadFonts, setMoods, moods } from './moods.js';
import { Markers, FORM } from './markers.js';
import { Overlay } from './overlay.js';
import { icon } from '../../icons.js';

const STANDARD = { mood: 'terminal', marker: 'corners', march: 'selection', drag: 'frame', multiple: 'single', voice: true, scale: 1, colors: 'team' };
const GRID = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
const COLORS_IVF = { me: '#4fa3ff', allied: '#5fd68a', foe: '#ff5a4a' };
const ACK = ['Verstanden.', 'Bin unterwegs.', 'Jawohl.', 'Wird gemacht.', 'Bestätigt.'];
const RADIO = { ready: '{name} bereit.', promoted: 'Beförderung! {name} ist jetzt {stufe}.', lost: 'Einheit verloren.', money: 'Nicht genug Geld.', idle: '{gebaeude} im Leerlauf.',
  halt: 'Halten Position.', attack: 'Ziel erfasst.', retreat: 'Rückzug.', ability: '{name} ist unterwegs.' };
const el = (tag, class_, html) => { const e = document.createElement(tag); if (class_) e.className = class_; if (html != null) e.innerHTML = html; return e; };
const kind = u => u.kind ?? u.type;   // Data key of the unit (workshop ID), otherwise the sim type
const timeText = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createHud(A, opt = {}) { return new Hud(A, opt); }

class Hud {
  constructor(A, { css = '' } = {}) {
    this.A = A; this.T = A.THREE;
    // UI from the workshop (daten/ui.json): moods, defaults, radio; the player's nation can specify mood and accent
    const O = A.ui || {};
    setMoods(O.moods);
    this.radioData = O.radio || {};
    this.accent = A.nation?.accent || null;
    this.standard = { ...STANDARD, ...(O.hud || {}), mood: A.nation?.mood || O.standard || STANDARD.mood };
    if (!moods()[this.standard.mood]) this.standard.mood = Object.keys(moods())[0];
    try { this.e = { ...this.standard, ...JSON.parse(localStorage.getItem('nt.hud.settings') || '{}') }; } catch { this.e = { ...this.standard }; }
    if (!moods()[this.e.mood]) this.e.mood = this.standard.mood;
    loadFonts();
    if (css) { const st = el('style'); st.textContent = css; document.head.appendChild(st); }
    this.root = el('div', 'nt-hud'); this.root.id = 'hud'; document.body.appendChild(this.root);
    this.overlay = new Overlay(this.root);
    this.mark = new Markers(this.T, A.scene, A.camera);
    this.fs = new PaneSystem(this.root);
    this.selection = { units: new Set(), groups: new Set(), building: null };
    this.groups = {};
    this.ticker = []; this.targetMode = null; this.decay = {}; this.hidden = new WeakMap(); this.hiddenT = 0;
    this.xpBuffer = new Map(); this.pulse = new WeakMap(); this.oldPressed = false; this.lastClick = null;
    this.v = new this.T.Vector3();
    this.constructPane();
    this.inputs();
    this.apply();
    this.refreshT = 0;
  }

  // ---------- Einstellungen ----------
  set(k, v) { this.e[k] = v; try { localStorage.setItem('nt.hud.settings', JSON.stringify(this.e)); } catch {} this.apply(); }
  apply() {
    applyMoodOn(this.e.mood, document.documentElement, null, this.e.mood === this.standard.mood ? this.accent : null);
    this.mark.dark(token('selectionBorder', '#0b0d12'));
    this.root.style.fontSize = (13 * this.e.scale) + 'px';
    this.A.controls.leftDrag(this.e.drag === 'camera');
    this.colorsCache = null;
    this.drawSettings?.();
    this.sig = {};
  }
  colors() {
    if (!this.colorsCache) this.colorsCache = { good: token('good'), warn: token('warn'), hostile: token('hostile'), border: token('selectionBorder', '#000'), selection: token('selection', '#fff'), acc: token('acc'), info: token('info') };
    return this.colorsCache;
  }
  teamColor(team) {
    if (this.e.colors === 'ivf') return team === this.A.team ? COLORS_IVF.me : COLORS_IVF.foe;
    return this.A.teamColor(team);
  }

  // ---------- Fenster ----------
  constructPane() {
    const fs = this.fs;
    this.fRes = fs.new('resources', { title: 'Lage', symbol: 'flag', dock: 'top', series: 0, class: 'f-res' });
    this.fAbil = fs.new('abilities', { title: 'General', symbol: 'general', dock: 'left', series: 0, class: 'f-abil' });
    this.fTicker = fs.new('ticker', { title: 'Funk', symbol: 'speechBubble', dock: 'left', series: 1, class: 'f-ticker' });
    this.fMap = fs.new('minimap', { title: 'Karte', symbol: 'map', dock: 'left', series: 2, class: 'f-map' });
    this.fSel = fs.new('selection', { title: 'Auswahl', symbol: 'selection', dock: 'bottom', series: 0, class: 'f-selection' });
    this.fConstruction = fs.new('buildBar', { title: 'Bauen', symbol: 'factory', dock: 'right', series: 0, class: 'f-construction' });
    this.fInp = fs.new('settings', { title: 'Einstellungen', symbol: 'settings', dock: null, isOpen: false, closable: true, class: 'f-inp' });
    const inp = fs.all.get('settings'); if (!fs.layout.settings) { inp.x = innerWidth / 2 - 190; inp.y = 90; fs.inSight(inp); }
    this.constructResources(); this.constructAbilities(); this.constructMap(); this.constructSettings();
    if (!(this.A.abilities || []).length) this.fs.show('abilities', false);
    this.tooltip = el('div', 'hud-tip'); this.root.appendChild(this.tooltip);
    this.circle = el('div', 'hud-circle'); this.root.appendChild(this.circle);
    this.targetHint = el('div', 'hud-targetHint'); this.root.appendChild(this.targetHint);
  }

  constructResources() {
    const c = this.fRes.content;
    c.innerHTML = `<div class="res"><span class="res-i"></span><b data-w="money">0</b><small data-w="shop"></small></div>
      <div class="res power"><span class="res-i"></span><span class="power-bar"><i data-w="power"></i></span><small data-w="powerText"></small></div>
      <div class="res"><span class="res-i"></span><b data-w="rank">1</b></div>
      <div class="res"><span class="res-i" data-w="weatherI"></span><small data-w="weather"></small></div>
      <div class="res"><span class="res-i"></span><small data-w="time"></small></div>
      <div class="res" data-opt="wave"><span class="res-i"></span><small data-w="wave"></small></div>
      <button class="idle" title="Produktion im Leerlauf – Klick springt reihum (Taste ,)"><span class="res-i"></span><b data-w="empty">0</b><small>im Leerlauf</small></button>
      <span class="res-air"></span>`;
    const is = c.querySelectorAll('.res-i');
    is[0].appendChild(icon('coins', 15)); is[1].appendChild(icon('flash', 15)); is[2].appendChild(icon('star', 15)); is[4].appendChild(icon('clock', 15)); is[5].appendChild(icon('wave', 15)); is[6].appendChild(icon('factory', 15));
    c.querySelector('.idle').onclick = () => this.nextEmptyBuilding();
    const x = this.fRes.extra;
    if (this.A.testDesk) { const b = el('button', 'hud-k', ''); b.title = 'Testpult (alte Härtetest-Leisten)'; b.appendChild(icon('grip', 14)); b.onclick = () => this.A.testDesk(); x.appendChild(b); }
    const b = el('button', 'hud-k', ''); b.title = 'Einstellungen (Esc)'; b.appendChild(icon('settings', 14)); b.onclick = () => this.fs.toggle('settings'); x.appendChild(b);
  }

  constructAbilities() {
    const c = this.fAbil.content; c.innerHTML = '';
    for (const f of this.A.abilities || []) {
      const b = el('button', 'abil'); b.dataset.id = f.id;
      b.innerHTML = '<span class="abil-i"></span><span class="abil-n"></span><span class="abil-cd"></span>';
      b.querySelector('.abil-i').appendChild(icon(f.symbol, 22)); b.querySelector('.abil-n').textContent = f.name;
      b.onclick = () => this.startTarget(f);
      this.tap(b, () => `<b>${f.name}</b><br>${f.description}<br><span class="tip-k">Abklingzeit ${f.cooldown} s · Ziel auf der Karte wählen</span>`);
      c.appendChild(b);
    }
  }
  startTarget(f) {
    if ((this.decay[f.id] || 0) > 0) { this.message(`${f.name} lädt noch (${Math.ceil(this.decay[f.id])} s).`, null, { kind: 'warn' }); return; }
    this.targetMode = { kind: 'ability', f };
    this.targetHint.textContent = `${f.name}: Ziel wählen · Rechtsklick/Esc bricht ab`; this.targetHint.classList.add('on');
    this.root.classList.add('aims');
  }
  endTarget() { this.targetMode = null; this.targetHint.classList.remove('on'); this.root.classList.remove('aims'); }

  // ---------- Minikarte ----------
  constructMap() {
    const c = this.fMap.content;
    this.mapCv = el('canvas', 'map'); this.mapCv.width = this.mapCv.height = 216; c.appendChild(this.mapCv);
    this.mapLayer = 'terrain'; this.baseFrames = {};
    const overlays = [['terrain', 'mountain', 'Gelände'], ['ground', 'tracks', 'Bodenarten'], ['weather', 'cloud', 'Wetter'], ['sight', 'auge', 'Sicht']];
    for (const [id, sym, name] of overlays) {
      const b = el('button', 'hud-k map-layer' + (id === this.mapLayer ? ' on' : '')); b.title = 'Ebene: ' + name; b.dataset.e = id; b.appendChild(icon(sym, 13));
      b.onclick = () => { this.mapLayer = id; this.fMap.extra.querySelectorAll('.map-layer').forEach(x => x.classList.toggle('on', x === b)); };
      this.fMap.extra.appendChild(b);
    }
    const world = (e) => { const r = this.mapCv.getBoundingClientRect(), W = this.A.world; return { x: W.min + (e.clientX - r.left) / r.width * (W.max - W.min), z: W.min + (e.clientY - r.top) / r.height * (W.max - W.min) }; };
    let drags = false;
    this.mapCv.addEventListener('pointerdown', e => {
      e.stopPropagation(); const p = world(e);
      if (e.button === 2) { this.commandsDrive(p.x, p.z, true); return; }
      drags = true; this.mapCv.setPointerCapture(e.pointerId); this.A.controls.jumpTo(p.x, p.z);
    });
    this.mapCv.addEventListener('pointermove', e => { if (drags) { const p = world(e); this.A.controls.jumpTo(p.x, p.z); } });
    this.mapCv.addEventListener('pointerup', () => drags = false);
    this.mapCv.addEventListener('contextmenu', e => e.preventDefault());
  }
  drawMap() {
    const g = this.mapCv.getContext('2d'), S = this.mapCv.width, W = this.A.world, k = S / (W.max - W.min);
    const reason = this.mapLayer === 'ground' ? 'ground' : 'terrain';
    if (!this.baseFrames[reason]) this.baseFrames[reason] = this.A.minimap(reason);
    g.imageSmoothingEnabled = false; g.drawImage(this.baseFrames[reason], 0, 0, S, S);
    const px = x => (x - W.min) * k;
    if (this.mapLayer === 'weather') {
      const w = this.A.state().weather; g.fillStyle = w.tint || 'rgba(0,0,0,0)'; g.fillRect(0, 0, S, S);
      g.font = '600 11px Inter, sans-serif'; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.strokeText(w.name, 6, S - 8); g.fillText(w.name, 6, S - 8);
    }
    for (const b of this.A.building()) {
      g.fillStyle = this.teamColor(b.team); g.strokeStyle = '#000'; g.lineWidth = 1;
      g.fillRect(px(b.x - b.hx), px(b.z - b.hz), b.hx * 2 * k, b.hz * 2 * k); g.strokeRect(px(b.x - b.hx), px(b.z - b.hz), b.hx * 2 * k, b.hz * 2 * k);
    }
    const sel = this.unitsSelection();
    for (const u of this.A.units()) {
      if (!u.alive) continue;
      const x = px(u.x), y = px(u.z), s = sel.has(u);
      g.fillStyle = s ? '#fff' : this.teamColor(u.team); g.fillRect(x - 1.5, y - 1.5, 3, 3);
      if (s) { g.strokeStyle = this.teamColor(u.team); g.lineWidth = 1; g.strokeRect(x - 2.5, y - 2.5, 5, 5); }
    }
    if (this.mapLayer === 'sight') {
      g.save(); g.fillStyle = 'rgba(0,0,0,0.62)'; g.beginPath(); g.rect(0, 0, S, S);
      for (const u of this.A.units()) if (u.alive && u.team === this.A.team) { g.moveTo(px(u.x) + 30 * k, px(u.z)); g.arc(px(u.x), px(u.z), 30 * k, 0, Math.PI * 2, true); }
      g.fill('evenodd'); g.restore();
    }
    const bf = this.A.controls.fieldOfView();
    if (bf) { g.beginPath(); bf.forEach((p, i) => i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))); g.closePath(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); }
  }

  // ---------- Einstellungen ----------
  constructSettings() {
    this.drawSettings = () => {
      const c = this.fInp.content, e = this.e;
      const seg = (k, opts) => `<div class="seg">${opts.map(([v, n]) => `<button data-k="${k}" data-v="${v}" class="${e[k] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
      c.innerHTML = `
        <label>Stimmung</label>${seg('mood', Object.entries(moods()).map(([id, s]) => [id, s.name || id]))}
        <label>Markierung</label>${seg('marker', [['corners', 'Ecken + Ring'], ['rings', 'Nur Ringe']])}
        <label>Marschlinien</label>${seg('march', [['off', 'Aus'], ['selection', 'Nur Auswahl'], ['all', 'Alle eigenen']])}
        <label>Linksziehen</label>${seg('drag', [['frame', 'Auswahlrahmen'], ['camera', 'Kamera schieben']])}
        <label>Mehrfachauswahl</label>${seg('multiple', [['single', 'Einzeln'], ['stacked', 'Nach Typ']])}
        <label>Farben</label>${seg('colors', [['team', 'Teamfarben'], ['ivf', 'Ich · Verbündete · Feinde']])}
        <label>Funkstimme</label>${seg('voice', [[true, 'An'], [false, 'Aus']])}
        <label>UI-Größe <small>${Math.round(e.scale * 100)} %</small></label><input type="range" min="0.8" max="1.5" step="0.05" value="${e.scale}">
        <div class="inp-foot"><button class="standard">Standard der Werkstatt</button><button class="layout">Layout zurücksetzen</button></div>
        <p class="inp-help">Alt halten = alle Marschlinien · Strg+1–9 Gruppe speichern (darf Gruppen enthalten) · 1–9 wählen, zweimal = hinspringen · Shift+Zahl dazu · Strg+A alle Kampfeinheiten · , Leerlauf-Gebäude · . Leerlauf-Einheit · H Halt · Doppelklick = alle gleichen Typs · Rechtsklick: Befehl / Sammelpunkt · Rechte Taste halten: Kreismenü</p>`;
      c.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const v = b.dataset.v; this.set(b.dataset.k, v === 'true' ? true : v === 'false' ? false : v); });
      c.querySelector('input').oninput = ev => { this.e.scale = +ev.target.value; this.set('scale', +ev.target.value); };
      c.querySelector('.layout').onclick = () => this.fs.reset();
      c.querySelector('.standard').onclick = () => { this.e = { ...this.standard }; try { localStorage.removeItem('nt.hud.settings'); } catch {} this.apply(); };
    };
    this.drawSettings();
  }

  // ---------- Tooltip ----------
  tap(node, content) {
    node.addEventListener('pointerenter', ev => { if (ev.pointerType === 'touch') return; this.tooltip.innerHTML = content(); this.tooltip.classList.add('on'); this.tipPos(node); });
    node.addEventListener('pointerleave', () => this.tooltip.classList.remove('on'));
  }
  tipPos(node) {
    const b = node.getBoundingClientRect(), t = this.tooltip.getBoundingClientRect();
    let x = b.left - t.width - 10, y = b.top;
    if (x < 8) x = b.right + 10;
    if (y + t.height > innerHeight - 8) y = innerHeight - t.height - 8;
    if (b.top > innerHeight * 0.6 && b.left > 200 && b.right < innerWidth - 200) { x = b.left + b.width / 2 - t.width / 2; y = b.top - t.height - 10; }
    this.tooltip.style.left = Math.max(8, x) + 'px'; this.tooltip.style.top = Math.max(8, y) + 'px';
  }

  // ---------- Messages and radio voice ----------
  message(text, pos = null, { kind = 'info', voice = false, speak = null } = {}) {
    this.ticker.unshift({ text, pos, kind, time: this.A.state().time });
    this.ticker.length = Math.min(this.ticker.length, 7);
    this.drawTicker();
    if (voice) this.speak(speak || text);
  }
  drawTicker() {
    const c = this.fTicker.content; c.innerHTML = '';
    if (!this.ticker.length) { c.innerHTML = '<p class="empty">Funkstille.</p>'; return; }
    for (const t of this.ticker) {
      const z = el('div', 'tick ' + t.kind + (t.pos ? ' clickable' : ''), `<small>${timeText(t.time)}</small><span></span>`);
      z.querySelector('span').textContent = t.text;
      if (t.pos) z.onclick = () => this.A.controls.jumpTo(t.pos.x, t.pos.z);
      c.appendChild(z);
    }
  }
  speak(text) {
    if (!this.e.voice) return;
    this.radioClick();
    const S = window.speechSynthesis; if (!S) return;
    const now = performance.now();
    if (S.speaking && now - (this.lastVoice || 0) < 1200) return;   // do not flood
    this.lastVoice = now;
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 1.12; u.pitch = 0.9; u.volume = 0.9;
      const de = S.getVoices().find(v => v.lang?.startsWith('de')); if (de) u.voice = de;
      S.speak(u);
    } catch {}
  }
  radioClick() {
    try {
      if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = this.ac.currentTime, o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(1500, t0); o.frequency.setValueAtTime(1100, t0 + 0.05);
      g.gain.setValueAtTime(0.04, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.11);
      o.connect(g).connect(this.ac.destination); o.start(t0); o.stop(t0 + 0.12);
    } catch {}
  }

  // ---------- Experience (reported by the adapter) ----------
  experience(u, amount) { this.xpBuffer.set(u, (this.xpBuffer.get(u) || 0) + amount); }
  promoted(u, tier) {
    const p = this.image(u.x, u.y + this.A.data(kind(u)).height, u.z);
    if (p) { this.overlay.flash(p.x, p.y); this.overlay.text(p.x, p.y, tier.name + '!'); this.overlay.spark(p.x, p.y, 12); }
    this.pulse.set(u, 1);
    const d = this.A.data(kind(u)), own = u.team === this.A.team;
    this.message(`${d.name} befördert: ${tier.name}${tier.text ? ' – ' + tier.text : ''}`, { x: u.x, z: u.z }, { kind: 'good', voice: own, speak: this.radio('promoted', { name: d.name, stufe: tier.name }) });
  }

  // ---------- Selection and groups ----------
  groupsUnits(n, seen = new Set()) {
    const out = new Set(), G = this.groups[n]; if (!G || seen.has(n)) return out;
    seen.add(n);
    for (const u of G.units) out.add(u);
    for (const m of G.groups) for (const u of this.groupsUnits(m, seen)) out.add(u);
    return out;
  }
  unitsSelection() {
    const s = new Set();
    for (const u of this.selection.units) if (u.alive) s.add(u);
    for (const n of this.selection.groups) for (const u of this.groupsUnits(n)) if (u.alive) s.add(u);
    return s;
  }
  ownItemsSelection() { return [...this.unitsSelection()].filter(u => u.team === this.A.team); }
  select(units = [], { add = false, building = null } = {}) {
    if (!add) { this.selection.units.clear(); this.selection.groups.clear(); }
    for (const u of units) { this.selection.units.add(u); this.pulse.set(u, 1); }
    this.selection.building = building;
    if (building) this.pulse.set(building, 1);
    this.selectionChanged();
  }
  selectionChanged() {
    this.sig = {};
    const sel = this.unitsSelection();
    const one = sel.size === 1 && !this.selection.building ? [...sel][0] : null;
    if (one !== this.portraitE) { this.portraitE = one; this.A.portrait(null); }
  }
  groupSave(n) {
    const gr = new Set([...this.selection.groups].filter(m => m !== n && !this.contains(m, n)));
    const discarded = [...this.selection.groups].filter(m => !gr.has(m));
    this.groups[n] = { units: new Set(this.selection.units), groups: gr };
    const parts = [];
    if (gr.size) parts.push('Gruppe ' + [...gr].join(', '));
    if (this.selection.units.size) parts.push(this.selection.units.size + ' Einheiten');
    this.message(`Gruppe ${n} gespeichert${parts.length ? ': ' + parts.join(' + ') : ' (leer)'}.`, null, { kind: 'info' });
    if (discarded.length) this.message(`Gruppe ${n} kann sich nicht selbst enthalten.`, null, { kind: 'warn' });
  }
  contains(m, n, seen = new Set()) {   // does group m contain group n (indirectly)?
    if (m === n) return true; if (seen.has(m)) return false; seen.add(m);
    return [...(this.groups[m]?.groups || [])].some(x => this.contains(x, n, seen));
  }
  groupChoose(n, add) {
    if (!this.groups[n]) return;
    const now = performance.now();
    if (!add && this.lastGroup?.n === n && now - this.lastGroup.t < 400) {
      const s = [...this.groupsUnits(n)].filter(u => u.alive);
      if (s.length) this.A.controls.jumpTo(s.reduce((a, u) => a + u.x, 0) / s.length, s.reduce((a, u) => a + u.z, 0) / s.length);
    }
    this.lastGroup = { n, t: now };
    if (!add) { this.selection.units.clear(); this.selection.groups.clear(); }
    this.selection.groups.add(n); this.selection.building = null;
    for (const u of this.groupsUnits(n)) this.pulse.set(u, 1);
    this.selectionChanged();
  }

  // ---------- Befehle ----------
  commandsDrive(x, z, ack = false) {
    const us = this.ownItemsSelection(); if (!us.length) return false;
    const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cz = us.reduce((a, u) => a + u.z, 0) / us.length;
    let distance = 0; for (const u of us) distance = Math.max(distance, Math.hypot(u.x - cx, u.z - cz));
    const k = distance > 22 ? 22 / distance : 1;   // Hold formation, but not scattered across half the map
    const speed = us.length > 1 ? Math.min(...us.map(u => this.A.data(kind(u)).speed)) : null;
    const gid = Math.random();
    this.A.command({ kind: 'drive', targets: us.map(u => ({ e: u, x: x + (u.x - cx) * k, z: z + (u.z - cz) * k })), speed, gid });
    if (ack) this.acknowledge(us);
    return true;
  }
  acknowledge(us, text) {
    const now = performance.now(), q = this.radioData.acks?.length ? this.radioData.acks : ACK;
    if (now - (this.lastAck || 0) > 1600) { this.lastAck = now; this.speak(text || q[Math.floor(Math.random() * q.length)]); }
  }
  // Radio text from the workshop with placeholders {name} {tier} {building}
  radio(id, stats = {}) { return String(this.radioData[id] || RADIO[id] || '').replace(/\{(\w+)\}/g, (_, k) => stats[k] ?? ''); }
  actions() {   // the same actions for build bar (grid) and radial menu
    const g = this.selection.building, A = this.A;
    if (g && g.team === A.team && g.produces?.length) {
      return g.produces.map((type, i) => {
        const d = A.data(type), n = g.queue.filter(s => s.type === type).length;
        return { taste: GRID[i], name: d.name, short: d.short, symbol: d.symbol, cost: d.cost, time: d.buildTime, count: n,
          on: () => { if (!A.command({ kind: 'build', building: g, type })) this.message(this.radio('money'), null, { kind: 'warn', voice: true }); },
          min: () => A.command({ kind: 'cancel', building: g, type }) };
      });
    }
    const us = this.ownItemsSelection();
    if (us.length) return [
      { taste: 'q', name: 'Halt', symbol: 'stop', on: () => { A.command({ kind: 'halt', units: us }); this.acknowledge(us, this.radio('halt')); }, info: 'Bleibt stehen und hält die Stellung (H)' },
      { taste: 'w', name: 'Live-Fenster', short: 'Live', symbol: 'auge', on: () => us.slice(0, 2).forEach(u => A.livePane(u)), info: 'Bild-im-Bild, das der Einheit folgt' },
      { taste: 'e', name: 'Zur Basis', short: 'Basis', symbol: 'flag', on: () => { const b = A.basis(); this.commandsDrive(b.x, b.z); this.acknowledge(us, this.radio('retreat')); }, info: 'Alle zurück zum Sammelplatz an der Basis' },
      { taste: 'r', name: 'Ausrüstung', short: 'Rüsten', symbol: 'armor', off: true, info: 'Kommt mit der Werkstatt (Plätze, Drohnen, Trupp-Upgrades)' },
    ];
    return [];
  }

  // ---------- Eingaben ----------
  inputs() {
    const cv = this.A.canvas; let down = null;
    cv.addEventListener('pointerdown', e => {
      this.circleTo(); this.tooltip.classList.remove('on');
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, b: e.button, far: 0 };
      clearTimeout(this.holdT);
      if (e.button === 2) {   // hold right button = radial menu
        const r = down;
        this.holdT = setTimeout(() => { if (down === r && r.far < 6 && !this.targetMode) { r.circle = true; this.circleFor(r.x, r.y); } }, 380);
      }
    });
    cv.addEventListener('pointermove', e => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!down) return;
      down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (down.b === 0 && this.e.drag === 'frame' && down.far > 6 && !this.targetMode) this.frame = { a: { x: down.x, y: down.y }, b: { x: e.clientX, y: e.clientY } };
    });
    addEventListener('pointerup', e => {
      if (!down) return;
      const r = down; down = null; clearTimeout(this.holdT);
      if (r.circle) return;
      if (this.frame) { this.frameChoice(this.frame, e.shiftKey); this.frame = null; return; }
      if (e.target !== cv || r.far > 6 || e.timeStamp - r.t > 600) return;
      if (r.b === 0) this.leftClick(e); else if (r.b === 2) this.rightClick(e);
    });
    addEventListener('keydown', e => this.taste(e, true));
    addEventListener('keyup', e => { if (e.key === 'Alt') this.oldPressed = false; });
    addEventListener('blur', () => this.oldPressed = false);
  }
  leftClick(e) {
    const A = this.A, t = A.hit(e.clientX, e.clientY);
    if (this.targetMode) {
      if (t) { const p = t.kind === 'ground' ? t : t.kind === 'unit' ? t.e : t.g; const f = this.targetMode.f;
        A.command({ kind: 'ability', id: f.id, x: p.x, z: p.z }); this.decay[f.id] = f.cooldown;
        this.overlay.ack(e.clientX, e.clientY, this.colors().hostile); this.message(`${f.name} angefordert.`, { x: p.x, z: p.z }, { kind: 'warn', voice: true, speak: this.radio('ability', { name: f.name }) }); }
      this.endTarget(); return;
    }
    const now = performance.now(), double = this.lastClick && now - this.lastClick.t < 320 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 12;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (!t || t.kind === 'ground') { if (!e.shiftKey) this.select([]); return; }
    if (t.kind === 'building') { this.select([], { building: t.g }); return; }
    const u = t.e;
    if (double && u.team === A.team) {   // all of the same type on screen
      const same = A.units().filter(o => o.alive && o.team === A.team && kind(o) === kind(u) && this.ontoScreen(o));
      this.select(same, { add: e.shiftKey }); return;
    }
    if (e.shiftKey && u.team === A.team) {
      if (this.selection.units.has(u)) { this.selection.units.delete(u); this.selectionChanged(); } else this.select([u], { add: true });
      return;
    }
    this.select([u]);
  }
  rightClick(e) {
    const A = this.A;
    if (this.targetMode) { this.endTarget(); return; }
    const t = A.hit(e.clientX, e.clientY); if (!t) return;
    const g = this.selection.building, us = this.ownItemsSelection();
    if (g && g.team === A.team && !us.length) {
      const p = t.kind === 'ground' ? t : t.kind === 'unit' ? t.e : t.g;
      A.command({ kind: 'rallyPoint', building: g, x: p.x, z: p.z }); this.overlay.ack(e.clientX, e.clientY, this.colors().info); return;
    }
    if (!us.length) return;
    if (t.kind === 'unit' && t.e.team !== A.team) {
      A.command({ kind: 'attack', units: us, target: t.e }); this.overlay.ack(e.clientX, e.clientY, this.colors().hostile); this.acknowledge(us, this.radio('attack')); return;
    }
    const p = t.kind === 'ground' ? t : t.kind === 'unit' ? t.e : { x: t.g.x, z: t.g.z };
    if (this.commandsDrive(p.x, p.z, true)) this.overlay.ack(e.clientX, e.clientY, this.colors().selection);
  }
  frameChoice(R, add) {
    const x0 = Math.min(R.a.x, R.b.x), x1 = Math.max(R.a.x, R.b.x), y0 = Math.min(R.a.y, R.b.y), y1 = Math.max(R.a.y, R.b.y);
    const inside = this.A.units().filter(u => { if (!u.alive || u.team !== this.A.team) return false; const p = this.image(u.x, u.y + 1, u.z); return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; });
    this.select(inside, { add });
  }
  taste(e) {
    if (e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Alt') { this.oldPressed = true; e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (this.circle.classList.contains('on')) this.circleTo();
      else if (this.targetMode) this.endTarget();
      else if (this.unitsSelection().size || this.selection.building) this.select([]);
      else this.fs.toggle('settings');
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = +digit[1];
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groupSave(n); } else this.groupChoose(n, e.shiftKey);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); this.select(this.A.units().filter(u => u.alive && u.team === this.A.team && this.A.data(kind(u)).damage > 0)); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ',') { this.nextEmptyBuilding(); return; }
    if (k === '.') { this.nearestEmptyUnit(); return; }
    if (k === 'h') { const us = this.ownItemsSelection(); if (us.length) { this.A.command({ kind: 'halt', units: us }); this.acknowledge(us, this.radio('halt')); } return; }
    const i = GRID.indexOf(k);
    if (i >= 0) { const a = this.actions().find(x => x.taste === k); if (a && !a.off) { e.shiftKey && a.min ? a.min() : a.on(); this.blink(k); } }
  }
  blink(k) { const b = this.fConstruction.content.querySelector(`[data-taste="${k}"]`); if (b) { b.classList.remove('press'); void b.offsetWidth; b.classList.add('press'); } }

  emptyBuilding() { return this.A.building().filter(g => g.team === this.A.team && g.produces?.length && !g.queue.length); }
  nextEmptyBuilding() {
    const l = this.emptyBuilding(); if (!l.length) { this.message('Alle Produktionsgebäude arbeiten.', null, { kind: 'good' }); return; }
    this.emptyI = ((this.emptyI ?? -1) + 1) % l.length; const g = l[this.emptyI];
    this.select([], { building: g }); this.A.controls.jumpTo(g.x, g.z);
  }
  nearestEmptyUnit() {
    const l = this.A.units().filter(u => u.alive && u.team === this.A.team && !u.command && !u.target && u.hold);
    if (!l.length) { this.message('Keine Einheit im Leerlauf.', null, { kind: 'good' }); return; }
    this.emptyE = ((this.emptyE ?? -1) + 1) % l.length; const u = l[this.emptyE];
    this.select([u]); this.A.controls.jumpTo(u.x, u.z);
  }

  // ---------- Radial menu ----------
  circleFor(x, y) {   // without a matching selection: select your own thing under the pointer
    const A = this.A;
    if (!this.actions().length) {
      const t = A.hit(x, y);
      if (t?.kind === 'building' && t.g.team === A.team) this.select([], { building: t.g });
      else if (t?.kind === 'unit' && t.e.team === A.team) this.select([t.e]);
    }
    this.circleOnto(x, y);
  }
  circleOnto(x, y) {
    const act = this.actions(); if (!act.length) return;
    const k = this.circle; k.innerHTML = ''; const R = 74 * this.e.scale;
    act.forEach((a, i) => {
      const w = -Math.PI / 2 + i / act.length * Math.PI * 2;
      const b = el('button', 'circle-k' + (a.off ? ' off' : ''));
      b.innerHTML = `<span class="ai"></span><span class="kn"></span><kbd>${a.taste.toUpperCase()}</kbd>${a.count ? `<em>${a.count}</em>` : ''}`;
      b.querySelector('.ai').appendChild(icon(a.symbol, 18)); b.querySelector('.kn').textContent = a.short || a.name;
      b.style.left = (Math.cos(w) * R) + 'px'; b.style.top = (Math.sin(w) * R) + 'px';
      b.onclick = ev => { ev.stopPropagation(); if (!a.off) a.on(); if (!a.cost) this.circleTo(); };
      b.oncontextmenu = ev => { ev.preventDefault(); a.min?.(); };
      k.appendChild(b);
    });
    k.style.left = x + 'px'; k.style.top = y + 'px'; k.classList.add('on');
  }
  circleTo() { this.circle.classList.remove('on'); }

  // ---------- Bildschirm-Helfer ----------
  image(x, y, z) {
    if (this.A.project) return this.A.project(x, y, z);
    const v = this.v.set(x, y, z).project(this.A.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }
  ontoScreen(u) { const p = this.image(u.x, u.y, u.z); return p && p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight; }

  // ---------- Build bar and selection (DOM, rebuilt only on change) ----------
  drawConstruction() {
    const c = this.fConstruction.content, g = this.selection.building, A = this.A, act = this.actions(), us = this.ownItemsSelection();
    const mode = g && g.team === A.team && g.produces?.length ? 'g' : us.length ? 'u' : 'over';
    const sig = mode + (g?.id ?? '') + act.map(a => a.taste + a.name).join() + (mode === 'over' ? A.building().filter(b => b.team === A.team && b.produces?.length).map(b => b.id).join() : '');
    if (this.sig.construction !== sig) {
      this.sig.construction = sig; c.innerHTML = '';
      this.fConstruction.el.querySelector('.hud-title').textContent = mode === 'g' ? g.name : mode === 'u' ? 'Befehle' : 'Produktion';
      if (mode === 'over') {
        const l = el('div', 'over');
        for (const b of A.building().filter(b => b.team === A.team && b.produces?.length)) {
          const z = el('button', 'over-z'); z.dataset.id = b.id;
          z.innerHTML = '<span class="ui"></span><span class="un"></span><small data-w="st"></small><span class="mini"><i></i></span>';
          z.querySelector('.ui').appendChild(icon('factory', 16)); z.querySelector('.un').textContent = b.name;
          z.onclick = () => { this.select([], { building: b }); this.A.controls.jumpTo(b.x, b.z); };
          l.appendChild(z);
        }
        c.appendChild(l); c.appendChild(el('p', 'hint', 'Gebäude anklicken, um zu bauen. Rechtsklick ins Gelände setzt danach den Sammelpunkt.'));
      } else {
        const r = el('div', 'grid');
        for (let i = 0; i < 12; i++) {
          const a = act.find(x => x.taste === GRID[i]);
          const b = el('button', 'rk' + (a ? '' : ' empty') + (a?.off ? ' off' : '')); b.dataset.taste = GRID[i];
          if (a) {
            b.innerHTML = `<span class="ri"></span><span class="rn"></span>${a.cost != null ? `<span class="rp">${a.cost}</span>` : ''}<kbd>${GRID[i].toUpperCase()}</kbd><em data-w="n"></em><i class="rf" data-w="f"></i>`;
            b.querySelector('.ri').appendChild(icon(a.symbol, 22)); b.querySelector('.rn').textContent = a.short || a.name;
            b.onclick = () => { if (!a.off) a.on(); };
            b.oncontextmenu = ev => { ev.preventDefault(); a.min?.(); };
            this.tap(b, () => `<b>${a.name}</b>${a.cost != null ? `<br><span class="tip-z">${icon('coins', 12).outerHTML} ${a.cost} · ${icon('hourglass', 12).outerHTML} ${a.time} s</span>` : ''}${a.info ? '<br>' + a.info : ''}<br><span class="tip-k">Taste ${a.taste.toUpperCase()}${a.min ? ' · Rechtsklick/Shift = abbrechen' : ''}</span>`);
          }
          r.appendChild(b);
        }
        c.appendChild(r);
        if (mode === 'g') { c.appendChild(el('div', 'queue')); c.appendChild(el('p', 'hint', 'Rechtsklick ins Gelände: Sammelpunkt')); }
      }
    }
    // Werte aktualisieren
    if (mode === 'g') {
      for (const a of act) {
        const b = c.querySelector(`[data-taste="${a.taste}"]`); if (!b) continue;
        const n = g.queue.filter(s => s.type === GRID_TYPE(g, a.taste)).length;
        b.querySelector('[data-w=n]').textContent = n || '';
        const first = g.queue[0], f = first && first.type === GRID_TYPE(g, a.taste) ? 1 - first.rest / first.duration : 0;
        b.querySelector('[data-w=f]').style.height = (f * 100) + '%';
        b.classList.toggle('expensive', A.state().money < a.cost);
      }
      const s = c.querySelector('.queue');
      const sigS = g.queue.map(x => x.type).join();
      if (s.dataset.sig !== sigS) {
        s.dataset.sig = sigS; s.innerHTML = g.queue.length ? '' : '<span class="empty">Leerlauf – nichts in Auftrag</span>';
        g.queue.forEach((x, i) => { const d = A.data(x.type); const ch = el('span', 'sh' + (i ? '' : ' erst'), `<b>${d.short}</b><i></i>`); ch.title = d.name; s.appendChild(ch); });
      }
      const first = s.querySelector('.first i'); if (first && g.queue[0]) first.style.width = ((1 - g.queue[0].rest / g.queue[0].duration) * 100) + '%';
    } else if (mode === 'over') {
      for (const b of A.building().filter(b => b.team === A.team && b.produces?.length)) {
        const z = c.querySelector(`.over-z[data-id="${b.id}"]`); if (!z) continue;
        const s = b.queue[0];
        z.querySelector('[data-w=st]').textContent = s ? `${A.data(s.type).short}${b.queue.length > 1 ? ' +' + (b.queue.length - 1) : ''}` : 'Leerlauf';
        z.classList.toggle('idle', !s);
        z.querySelector('.mini i').style.width = s ? ((1 - s.rest / s.duration) * 100) + '%' : '0';
      }
    }
  }

  drawSelection() {
    const c = this.fSel.content, A = this.A, sel = [...this.unitsSelection()], g = this.selection.building;
    const mode = g ? 'g' : sel.length === 1 ? 'one' : sel.length ? 'many' : 'nothing';
    const sig = mode + (g?.id ?? '') + (mode === 'one' ? A.data(kind(sel[0])).name + sel[0].tier : '') + (mode === 'many' ? this.e.multiple + sel.length + sel.map(u => kind(u)).join() : '');
    if (this.sig.sel !== sig) {
      this.sig.sel = sig; c.innerHTML = '';
      if (mode === 'nothing') c.appendChild(el('p', 'empty', 'Nichts ausgewählt. Klick wählt, Rahmen ziehen wählt mehrere, Doppelklick alle gleichen Typs.'));
      if (mode === 'g') {
        const nb = el('div', 'one');
        nb.innerHTML = `<div class="portrait bld"></div><div class="ed"><div class="headRow"><span class="dot"></span><b></b><small></small></div><div class="stats"></div></div>`;
        nb.querySelector('.bld').appendChild(icon('factory', 46)); nb.querySelector('b').textContent = g.name;
        nb.querySelector('.dot').style.background = this.teamColor(g.team);
        nb.querySelector('small').textContent = g.team === A.team ? 'Eigenes Gebäude' : 'Fremdes Gebäude';
        nb.querySelector('.stats').innerHTML = g.produces?.length ? `<span>Baut: ${g.produces.map(t => A.data(t).name).join(', ')}</span><span data-w="st"></span>` : '<span>Keine Produktion</span>';
        c.appendChild(nb);
      }
      if (mode === 'one') {
        const u = sel[0], d = A.data(kind(u)), st = d.tiers || [];
        const nb = el('div', 'one');
        nb.innerHTML = `<div class="portrait"><span class="pl">Live</span></div><div class="ed">
          <div class="headRow"><span class="dot"></span><b></b><small data-w="st"></small></div>
          <div class="bal"><span>Leben</span><span class="bl"><i data-w="hp"></i></span><small data-w="hpT"></small></div>
          <div class="bal xp"><span>Erfahrung</span><span class="bl"><i data-w="xp"></i></span><small data-w="xpT"></small></div>
          <div class="stats" data-w="stats"></div><div class="chips" data-w="chips"></div>
          <div class="slots"><span class="slot" title="Ausrüstung kommt mit der Werkstatt">Ausrüstung –</span><span class="slot">–</span></div></div>`;
        nb.querySelector('b').textContent = d.name; nb.querySelector('.dot').style.background = this.teamColor(u.team);
        c.appendChild(nb);
        this.portraitSlot = nb.querySelector('.portrait');
        this.portraitE = u; A.portrait(this.portraitSlot, u);
      } else this.portraitSlot = null;
      if (mode === 'many') {
        const head = el('div', 'many-head', `<b>${sel.length} Einheiten</b><span class="seg small"><button data-m="single">Einzeln</button><button data-m="stacked">Nach Typ</button></span>`);
        head.querySelectorAll('[data-m]').forEach(b => { b.classList.toggle('on', b.dataset.m === this.e.multiple); b.onclick = () => this.set('multiple', b.dataset.m); });
        c.appendChild(head);
        const lattice = el('div', 'tiles');
        if (this.e.multiple === 'single') {
          for (const u of sel.slice(0, 40)) {
            const d = A.data(kind(u)), k = el('button', 'tile', `<span class="ai"></span><b>${d.short}</b><span class="kb"><i></i></span><span class="kv">${chevronsSvg(u.tier || 0)}</span>`);
            k.querySelector('.ai').appendChild(icon(d.symbol, 16)); k._u = u;
            k.onclick = ev => { if (ev.shiftKey) { this.selection.units.delete(u); this.selection.groups.clear(); this.select(sel.filter(o => o !== u)); } else this.select([u]); };
            lattice.appendChild(k);
          }
          if (sel.length > 40) lattice.appendChild(el('span', 'more', `+${sel.length - 40}`));
        } else {
          const types = {}; for (const u of sel) (types[kind(u)] ||= []).push(u);
          for (const [type, l] of Object.entries(types)) {
            const d = A.data(type), k = el('button', 'tile stack', `<span class="ai"></span><b>${d.name}</b><em>${l.length}</em>`);
            k.querySelector('.ai').appendChild(icon(d.symbol, 18));
            k.onclick = ev => this.select(ev.shiftKey ? sel.filter(u => kind(u) !== type) : l);
            lattice.appendChild(k);
          }
        }
        c.appendChild(lattice);
      }
    }
    // Werte
    if (mode === 'one') {
      const u = sel[0], d = A.data(kind(u)), st = d.tiers || [], T = (u.tier || 0);
      const q = s => c.querySelector(`[data-w="${s}"]`);
      const hp = Math.max(0, u.hp) / (d.health * (u.mHealth || 1));
      q('hp').style.width = (Math.min(1, hp) * 100) + '%'; q('hp').style.background = hp > 0.6 ? 'var(--hud-good)' : hp > 0.3 ? 'var(--hud-warn)' : 'var(--hud-hostile)';
      q('hpT').textContent = `${Math.ceil(Math.max(0, u.hp))}/${Math.round(d.health * (u.mHealth || 1))}`;
      const nearest = st[T], previous = T ? st[T - 1].min : 0;
      q('xp').style.width = (nearest ? Math.min(1, (u.xp - previous) / (nearest.min - previous)) * 100 : 100) + '%';
      q('xpT').textContent = `${T ? st[T - 1].name : 'Rekrut'} · ${Math.floor(u.xp)}${nearest ? '/' + nearest.min : ''} EP`;
      q('st').textContent = !u.alive ? 'zerstört' : u.command?.kind === 'attack' ? 'greift an' : u.command ? 'fährt' : u.target ? 'im Gefecht' : u.hold ? 'hält Stellung' : 'rückt vor';
      const sig2 = T + '|' + kind(u);
      if (q('stats').dataset.sig !== sig2) {
        q('stats').dataset.sig = sig2;
        const pr = m => m && m !== 1 ? ` <em>+${Math.round((m - 1) * 100)} %</em>` : '';
        q('stats').innerHTML = `<span>Leben ${d.health}${pr(u.mHealth)}</span><span>Schaden ${d.damage}${pr(u.mDamage)}</span><span>Reichweite ${d.range} m</span><span>Tempo ${d.speed}${pr(u.mSpeed)}</span>`;
        const sw = [...(d.keywords || []), ...st.slice(0, T).map(s => s.keyword).filter(Boolean)];
        q('chips').innerHTML = sw.map((s, i) => `<span class="chip${i >= (d.keywords || []).length ? ' new' : ''}">${s}</span>`).join('');
      }
    }
    if (mode === 'many' && this.e.multiple === 'single') {
      for (const k of c.querySelectorAll('.tile')) { const u = k._u; if (!u) continue; const d = A.data(kind(u)), hp = Math.max(0, u.hp) / (d.health * (u.mHealth || 1)); const i = k.querySelector('.kb i'); i.style.width = (hp * 100) + '%'; i.style.background = hp > 0.6 ? 'var(--hud-good)' : hp > 0.3 ? 'var(--hud-warn)' : 'var(--hud-hostile)'; k.classList.toggle('dead', !u.alive); }
    }
    if (mode === 'g') { const z = c.querySelector('[data-w=st]'); if (z) z.textContent = g.queue?.length ? `In Arbeit: ${A.data(g.queue[0].type).name} (${Math.ceil(g.queue[0].rest)} s), ${g.queue.length - 1} wartend` : 'Leerlauf'; }
  }

  drawResources() {
    const s = this.A.state(), c = this.fRes.content, q = k => c.querySelector(`[data-w="${k}"]`);
    const economy = s.money != null;
    q('money').closest('.res').hidden = !economy; q('power').closest('.res').hidden = !economy;
    c.querySelector('[data-opt=wave]').hidden = !s.wave; if (s.wave) q('wave').textContent = s.wave;
    if (!economy) s.money = 0;
    q('money').textContent = Math.floor(s.money).toLocaleString('de-DE'); q('shop').textContent = `+${s.income}/s`;
    const [has, needs] = s.power; q('power').style.width = Math.min(100, needs / Math.max(1, has) * 100) + '%';
    q('power').classList.toggle('scarce', needs > has); q('powerText').textContent = `${needs}/${has}`;
    q('rank').textContent = s.rank; q('weather').textContent = s.weather.name; q('time').textContent = timeText(s.time);
    const wi = q('weatherI'); if (wi.dataset.s !== s.weather.symbol) { wi.dataset.s = s.weather.symbol; wi.innerHTML = ''; wi.appendChild(icon(s.weather.symbol, 15)); }
    const n = this.emptyBuilding().length; q('empty').textContent = n; c.querySelector('.idle').classList.toggle('on', n > 0);
    for (const b of this.fAbil.content.querySelectorAll('.abil')) {
      const rest = this.decay[b.dataset.id] || 0, f = (this.A.abilities.find(x => x.id === b.dataset.id) || {}).cooldown || 1;
      b.classList.toggle('loads', rest > 0); b.querySelector('.abil-cd').style.setProperty('--f', (rest / f * 360) + 'deg');
      b.querySelector('.abil-cd').textContent = rest > 0 ? Math.ceil(rest) : '';
      b.classList.toggle('aims', this.targetMode?.f.id === b.dataset.id);
    }
  }

  // ---------- Jedes Bild ----------
  step(dt) {
    const A = this.A, F = this.colors();
    for (const id in this.decay) this.decay[id] = Math.max(0, this.decay[id] - (A.isPause?.() ? 0 : dt));
    const now = performance.now();
    if (now - this.refreshT > 180) { this.refreshT = now; this.drawResources(); this.drawConstruction(); this.drawSelection(); this.drawMap(); }
    // Occlusion check (x-ray view) only for marked units, four times per second
    this.hiddenT -= dt;
    const sel = this.unitsSelection(), gSel = this.selection.building;
    if (this.hiddenT <= 0) { this.hiddenT = 0.25; for (const u of sel) this.hidden.set(u, !A.visible(u.x, u.y + A.data(kind(u)).height * 0.6, u.z)); }
    // Markierungen am Boden
    const list = [], corners = this.e.marker === 'corners';
    for (const u of sel) {
      const d = A.data(kind(u)), p = this.pulse.get(u) || 0;
      const form = corners && !d.infantry ? FORM.corners : FORM.ring;
      list.push({ x: u.x, y: u.y, z: u.z, red: form === FORM.corners ? u.red : 0, hx: form === FORM.corners ? d.halfB : d.radius, hz: form === FORM.corners ? d.halfL : d.radius,
        form, color: u.team === A.team ? F.selection : F.hostile, pulse: p, hidden: this.hidden.get(u) });
      if (p > 0) this.pulse.set(u, Math.max(0, p - dt * 3.5));
      if (u.command?.kind === 'attack' && u.command.target.alive && u.team === A.team) {
        const z = u.command.target, dz = A.data(kind(z));
        list.push({ x: z.x, y: z.y, z: z.z, red: 0, hx: dz.radius * 1.1, hz: dz.radius * 1.1, form: FORM.ring, color: F.hostile, alpha: 0.8, dashed: true });
      }
    }
    if (gSel) {
      const p = this.pulse.get(gSel) || 0;
      list.push({ x: gSel.x, y: gSel.y, z: gSel.z, red: 0, hx: gSel.hx + 0.6, hz: gSel.hz + 0.6, form: corners ? FORM.corners : FORM.ring, color: gSel.team === A.team ? F.selection : F.hostile, pulse: p });
      if (!corners) list[list.length - 1].hx = list[list.length - 1].hz = Math.max(gSel.hx, gSel.hz) * 1.25;
      if (p > 0) this.pulse.set(gSel, Math.max(0, p - dt * 3.5));
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    for (const g of this.emptyBuilding()) if (g !== gSel) list.push({ x: g.x, y: g.y, z: g.z, red: 0, hx: g.hx + 0.6, hz: g.hz + 0.6, form: FORM.corners, color: '#ffcf4a', alpha: 0.45 + 0.4 * pulse, dashed: true });
    this.mark.set(list, innerHeight, dt);
    // 2D-Ebene
    const O = this.overlay; O.clear(dt);
    this.drawLines(sel, gSel, F);
    this.drawGauge(sel, F);
    for (const [u, amount] of this.xpBuffer) {
      if (amount < 2 && this.xpBuffer.size > 1) continue;
      if (u.alive && (u.team === A.team || sel.has(u))) { const p = this.image(u.x, u.y + A.data(kind(u)).height, u.z); if (p) O.spark(p.x, p.y - 8, Math.ceil(Math.min(amount, 40) / 6)); }
      this.xpBuffer.delete(u);
    }
    O.effects(dt, F);
    if (this.frame) O.frame(this.frame.a, this.frame.b, F.selection);
    // Keep the live portrait following its slot in the selection window
    if (this.portraitSlot && this.portraitE) A.portrait(this.portraitSlot, this.portraitE);
  }

  drawLines(sel, gSel, F) {
    const A = this.A, mode = this.oldPressed ? 'all' : this.e.march;
    const line = (x0, z0, x1, z1, color, opt) => {
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1.5) return;
      const n = Math.max(2, Math.min(40, Math.ceil(len / 3))), pts = [];
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, p = this.image(x, A.ground(x, z) + 0.25, z); if (p) pts.push(p); }
      this.overlay.line(pts, color, F.border, opt);
    };
    if (gSel && gSel.team === A.team && gSel.rally) line(gSel.x, gSel.z, gSel.rally.x, gSel.rally.z, F.info, { speed: 0.6 });
    if (mode === 'off') return;
    const source = mode === 'all' ? A.units().filter(u => u.alive && u.team === A.team) : [...sel].filter(u => u.team === A.team);
    const groups = new Map();
    for (const u of source) {
      const b = u.command; if (!b) continue;
      if (b.kind === 'attack') { if (b.target.alive) line(u.x, u.z, b.target.x, b.target.z, F.hostile, { target: false, speed: 1.4 }); continue; }
      const k = b.gid ?? u; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u);
    }
    for (const l of groups.values()) {   // one line per command group, from the centroid to the target centroid
      const n = l.length, sx = l.reduce((a, u) => a + u.x, 0) / n, sz = l.reduce((a, u) => a + u.z, 0) / n;
      const zx = l.reduce((a, u) => a + u.command.x, 0) / n, zz = l.reduce((a, u) => a + u.command.z, 0) / n;
      line(sx, sz, zx, zz, F.selection, { alpha: mode === 'all' && !sel.has(l[0]) ? 0.55 : 1 });
    }
  }

  drawGauge(sel, F) {
    const A = this.A, k = A.camera.position, target = A.controls.target?.() || k;
    const far = Math.hypot(k.x - target.x, k.y - target.y, k.z - target.z) * 2.2;
    for (const u of A.units()) {
      if (!u.alive) continue;
      const d = A.data(kind(u)), max = d.health * (u.mHealth || 1), s = sel.has(u), hurt = u.hp < max - 0.5;
      if (!s && !hurt) continue;
      if (!s && !A.flat?.() && Math.hypot(u.x - k.x, u.z - k.z) > far) continue;
      const p = this.image(u.x, u.y + d.height + 0.6, u.z); if (!p || p.x < -40 || p.y < -20 || p.x > innerWidth + 40 || p.y > innerHeight + 20) continue;
      const st = d.tiers || [], T = u.tier || 0, nearest = st[T], ahead = T ? st[T - 1].min : 0;
      const xp = (u.team === A.team || s) && (s || u.xp > 0) ? (nearest ? Math.min(1, (u.xp - ahead) / (nearest.min - ahead)) : 1) : null;
      this.overlay.gauge(p.x, p.y, d.infantry ? 26 : 34, Math.max(0, u.hp / max), xp, T, F);
    }
  }
}
function GRID_TYPE(g, taste) { return g.produces[GRID.indexOf(taste)]; }
