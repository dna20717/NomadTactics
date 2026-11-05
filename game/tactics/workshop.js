// NomadTactics – workshop (data editor for the genre module "Tactics").
// Uses the building blocks of the Cosy editor: design tokens (ui.css), base styles (basis.css), ui.js (dialogs, search, dragging on numbers,
// Inspektor-Kopf), icons.js, speicher.js (Artifact-Datenbank bzw. localStorage), baumflaeche.js (Graph).
// Layout like Build › Data: navigation on the left (accordion), exactly one data type in the middle, the inspector on the right.
import { icon } from '../icons.js';
import { el, openDialogue, suchChoice, draggable, inspectorHead, cleanId } from '../ui.js';
import { openStore } from '../store.js';
import { openCloudStore } from './cloud_store.js';
import { browserLoader } from '../browser_loader.js';
import { loadTactics, validateTactics } from '../../engine/tactics/index.js';
import { PAGES, NAVBAR } from './pages.js';
import { WORLD_PAGES } from './world_pages.js';
import { UI_PAGES, experiencePage } from './ui_pages.js';

const THEMES = { gray: 'Grau', violet: 'Violett', brightness: 'Hell' };
const clockTime = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
// Web workshop: save automatically after this many seconds without a new change (profile; ?autosave=5 for tests)
const AUTOSAVE_URL = (() => { try { const n = Number(new URLSearchParams(location.search).get('autosave')); return n > 0 ? n : null; } catch { return null; } })();
const AUTOSAVE_TEXT = { 0: 'Aus (nur mit ⌘S)', 30: 'nach 30 s Ruhe', 60: 'nach 1 Min. Ruhe', 300: 'nach 5 Min. Ruhe' };
const secondsText = s => s < 60 ? s + ' s' : Math.round(s / 60) + ' Min.';
import { Overlay as OverlayCore, freeId, same } from '../../engine/tactics/overlay.js';
export { freeId, same };

// Overlay related to the workshop (file for undo/saving); the logic lives in engine/tactics/overlay.js
export class Overlay extends OverlayCore {
  constructor(w, f, gid) { super(f, gid); this.w = w; }
  get file() { return this.w.p.factionPaths.get(this.f.id); }
}

// ---------- Werkstatt ----------
export class Workshop {
  constructor(root, basis) {
    this.root = root; this.basis = basis;
    this.undo = []; this.redo = []; this.dirty = new Set();
    this.page = { area: 'faction', sub: 'overview', faction: null, choice: null };
    this.general = {}; this.filter = ''; this.isOpen = new Set();
  }

  async start() {
    try { this.store = await openCloudStore(); } catch (e) { this.cloudError = e.message; }
    if (!this.store) this.store = await openStore({ project: 'nomadtactics', withoutAssets: true });
    if (this.store.kind === 'cloud') this.applyProfile();
    this.state = await this.store.all().catch(() => new Map());
    const repo = browserLoader(this.basis), state = this.state;
    const loader = { ...repo, json: async p => state.has(p) ? structuredClone(state.get(p)) : repo.json(p) };
    this.p = await loadTactics(loader);
    this.page.faction = [...this.p.factions.keys()][0] || null;
    this.isOpen.add('f:' + this.page.faction);
    this.constructUi();
    this.draw();
    addEventListener('keydown', e => this.taste(e));
    addEventListener('beforeunload', e => { if (this.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------- Undo, edit, save ----------
  snapshot() { return JSON.stringify({ def: this.p.def, data: this.p.data, factions: [...this.p.factions], paths: [...this.p.factionPaths] }); }
  fileDrafts() { const m = new Map(); for (const d of this.allFiles()) m.set(d, JSON.stringify(this.content(d))); return m; }
  spotHer(s) {
    const before = this.fileDrafts(), x = JSON.parse(s);
    this.p.def = x.def; this.p.data = x.data; this.p.factions = new Map(x.factions); this.p.factionPaths = new Map(x.paths);
    const afterwards = this.fileDrafts();   // only files that have really changed count as unsaved
    for (const d of new Set([...before.keys(), ...afterwards.keys()])) if (before.get(d) !== afterwards.get(d)) this.dirty.add(d);
    this.planAutosave();
    if (!this.p.factions.has(this.page.faction)) this.page.faction = [...this.p.factions.keys()][0] || null;
    this.draw();
  }
  begin() { this.undo.push(this.snapshot()); if (this.undo.length > 100) this.undo.shift(); this.redo = []; }
  undo() { if (this.undo.length) { this.redo.push(this.snapshot()); this.spotHer(this.undo.pop()); } }
  repeat() { if (this.redo.length) { this.undo.push(this.snapshot()); this.spotHer(this.redo.pop()); } }
  changed(file) { if (file) this.dirty.add(file); this.planAutosave(); }
  // Web workshop: one minute after the last change everything is saved (= one commit)
  autosaveS() { return AUTOSAVE_URL ?? (this.store?.profile?.autosave ?? 60); }
  planAutosave() {
    if (this.store?.kind !== 'cloud') return;
    clearTimeout(this.autosaveTimer);
    if (this.dirty.size && this.autosaveS() > 0) this.autosaveTimer = setTimeout(() => this.persist({ auto: true }), this.autosaveS() * 1000);
  }
  // ---------- Profile (web workshop) ----------
  applyProfile() {
    const p = this.store.profile || {};
    if (p.theme && THEMES[p.theme]) { document.documentElement.dataset.theme = p.theme; try { localStorage.setItem('nomad.theme', p.theme); } catch { /* privat */ } }
  }
  showProfile() {
    const st = this.store, p = { ...st.profile };
    const field = (label, input, hint) => el('label', { class: 'da-field' }, el('span', {}, label), el('div', {}, input, hint ? el('p', { class: 'ed-small' }, hint) : null));
    const name = el('input', { class: 'ed-field', value: p.name || '', maxlength: 40 });
    const color = el('input', { type: 'color', class: 'ed-field', value: p.color || '#4a90d9' });
    const mail = el('input', { class: 'ed-field', value: p.commitEmail || '', placeholder: 'leer = anonym' });
    const auto = el('select', { class: 'ed-field' }, ...Object.entries(AUTOSAVE_TEXT).map(([k, t]) => el('option', { value: k, selected: +k === (p.autosave ?? 60) }, t)));
    const theme = el('select', { class: 'ed-field' }, ...Object.entries(THEMES).map(([k, t]) => el('option', { value: k, selected: k === (p.theme || document.documentElement.dataset.theme) }, t)));
    openDialogue({
      title: 'Dein Profil', icon: 'person',
      content: [
        el('p', { class: 'ed-small' }, `Angemeldet als ${st.user.email || p.email}. Diese Adresse bleibt privat und landet nie im Repository.`),
        field('Name', name, 'So stehst du in der Werkstatt und als Autor in den Commits.'),
        field('Farbe', color, 'Deine Farbe in der Werkstatt (später auch, wenn mehrere gleichzeitig bauen).'),
        field('E-Mail im Commit', mail, 'Leer lassen = anonym. Mit deiner GitHub-noreply-Adresse (GitHub › Settings › Emails) zeigt GitHub deine Commits mit Bild an.'),
        field('Automatisch speichern', auto),
        field('Darstellung', theme)],
      main: { text: 'Speichern', icon: 'save', action: async ({ error }) => {
        try { await st.saveProfile({ name: name.value, color: color.value, commitEmail: mail.value, autosave: +auto.value, theme: theme.value }); }
        catch (e) { error(e.message); return false; }
        this.applyProfile(); this.planAutosave(); this.drawMenu(); this.hint('Profil gespeichert.');
      } },
    });
  }
  change(file, f) { this.begin(); const r = f(); this.changed(file); this.draw(); return r; }
  path(kind) { return this.p.paths[kind] || (this.p.paths[kind] = this.p.def[kind] = `data/${kind}.json`); }
  allFiles() { return ['project.json', ...Object.values(this.p.paths), ...this.p.factionPaths.values()]; }
  content(file) {
    if (file === 'project.json') return this.p.def;
    for (const [kind, pf] of Object.entries(this.p.paths)) if (pf === file) return this.p.data[kind];
    for (const [id, pf] of this.p.factionPaths) if (pf === file) return this.p.factions.get(id);
    return null;
  }
  async persist(opt = {}) {
    if (this.store.saveAll) return this.persistCloud(opt);
    if (!this.dirty.size) { this.hint('Nichts zu speichern.'); return; }
    this.storeError = null; this.statusShowing('saves');
    try {
      for (const d of [...this.dirty]) { const x = this.content(d); if (x) await this.store.persist(d, x); else await this.store.discard(d); this.dirty.delete(d); this.state.set(d, x); }
      this.latestSaved = clockTime(); this.hint(this.store.kind === 'artifact' ? 'Gespeichert. Ava übernimmt die Stände ins Repository.' : 'Gespeichert (in diesem Browser).');
    } catch (e) { this.storeError = e.message; this.hint('Speichern fehlgeschlagen: ' + e.message); }
    this.drawMenu();
  }
  // Web workshop: all changed files as one commit into the repository
  async persistCloud({ auto = false, force = false } = {}) {
    clearTimeout(this.autosaveTimer);
    if (this.saving) { this.saveAgain = true; return; }
    if (!this.dirty.size) { if (!auto) this.hint('Nichts zu speichern.'); return; }
    const files = [...this.dirty], sent = new Map(files.map(d => [d, JSON.stringify(this.content(d))]));
    const changes = files.map(d => ({ file: d, content: this.content(d) || null }));
    this.saving = true; this.storeError = null; this.statusShowing('saves');
    try {
      const r = await this.store.saveAll(changes, { force });
      for (const d of files) { if (JSON.stringify(this.content(d)) === sent.get(d)) this.dirty.delete(d); this.state.set(d, this.content(d)); }
      this.latestSaved = clockTime(); this.latestCommit = r.short;
      this.hint(r.unchanged ? 'Gespeichert (keine inhaltliche Änderung).' : `Gespeichert${auto ? ' (automatisch)' : ''} · Commit ${r.short} im Repository.`);
    } catch (e) {
      if (e.status === 409 && e.conflicts?.length) this.conflict(e.conflicts);
      else { this.storeError = e.message; this.hint('Speichern fehlgeschlagen: ' + e.message); }
    } finally {
      this.saving = false;
    }
    this.drawMenu();
    if (this.saveAgain) { this.saveAgain = false; this.persistCloud({ auto: true }); }
    else this.planAutosave();
  }
  conflict(files) {
    this.storeError = 'Konflikt beim Speichern';
    openDialogue({
      title: 'Jemand war schneller', icon: 'warning',
      content: [el('p', {}, `Diese ${files.length === 1 ? 'Datei wurde' : 'Dateien wurden'} inzwischen von jemand anderem geändert:`),
        el('ul', {}, ...files.map(f => el('li', {}, el('code', {}, f)))),
        el('p', { class: 'ed-small' }, '„Neu laden“ holt den aktuellen Stand und verwirft deine ungespeicherten Änderungen. „Überschreiben“ speichert deinen Stand trotzdem, die Änderungen der anderen an diesen Dateien gehen dann verloren (im Git-Verlauf bleiben sie erhalten).')],
      left: [el('button', { class: 'ed-button wide red', onclick: () => { document.querySelector('.ed-dialogue')?.remove(); this.persistCloud({ force: true }); } }, 'Überschreiben')],
      main: { text: 'Neu laden', icon: 'restart', action: () => { this.dirty.clear(); location.reload(); } },
    });
  }
  taste(e) {
    const t = e.target, writes = t.matches?.('input, textarea, select') && !(e.metaKey || e.ctrlKey);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.persist(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !t.matches?.('input, textarea')) { e.preventDefault(); e.shiftKey ? this.repeat() : this.undo(); return; }
    if (writes) return;
    if (e.key === '?') this.showHelp();
  }

  // ---------- UI ----------
  constructUi() {
    document.body.classList.add('build', 'data-mode');
    this.ui = { menu: el('div', { class: 'ed-menu' }), data: el('div', { class: 'ed-data tk-data' }), hint: el('div', { class: 'ed-hint' }) };
    this.root.replaceChildren(this.ui.menu, this.ui.data, this.ui.hint);
    this.root.hidden = false;
  }
  statusContent(kind) {
    const n = this.dirty.size;
    if (n && !this.unsavedSince) this.unsavedSince = clockTime();
    if (!n) this.unsavedSince = null;
    if (kind === 'saves') return ['isOpen', icon('save', 14), this.store?.kind === 'cloud' ? 'Schreibe ins Repository …' : 'Speichere …', '', ''];
    if (this.store?.kind === 'cloud' && !this.storeError) {
      if (n) return ['isOpen', el('i', { class: 'ed-status-point' }), 'Ungespeichert · seit ', this.unsavedSince, `Ungespeichert seit ${this.unsavedSince} · ${n} ${n === 1 ? 'Datei' : 'Dateien'} geändert · ${this.autosaveS() ? `speichert automatisch nach ${secondsText(this.autosaveS())} Ruhe · ⌘S speichert sofort` : '⌘S speichert (automatisch speichern ist im Profil aus)'}`];
      if (this.latestSaved) return ['ok', icon('check', 14), 'Gespeichert · ', this.latestSaved, `Gespeichert um ${this.latestSaved} als Commit ${this.latestCommit} in ${this.store.repo}`];
    }
    return this.storeError ? ['error', icon('warning', 14), 'Fehler beim Speichern', '', this.storeError]
      : n ? ['isOpen', el('i', { class: 'ed-status-point' }), 'Ungespeichert · seit ', this.unsavedSince, `Ungespeichert seit ${this.unsavedSince} · ${n} ${n === 1 ? 'Datei' : 'Dateien'} geändert · ⌘S speichert`]
        : this.latestSaved ? ['ok', icon('check', 14), 'Gespeichert · ', this.latestSaved, `Gespeichert um ${this.latestSaved}`]
          : ['empty', icon('check', 14), 'Nichts geändert', '', 'Seit dem Laden nichts geändert'];
  }
  statusShowing(kind) {
    const [a, ic, text, time, title] = this.statusContent(kind);
    this.ui.status.className = 'ed-status ' + a; this.ui.status.title = title;
    this.ui.status.replaceChildren(ic, el('span', {}, el('span', { class: 'ed-status-text' + (time ? '' : ' alone') }, text), time ? el('span', { class: 'ed-status-time' }, time) : null));
  }
  drawMenu() {
    const ui = this.ui, m = this.messages || [];
    const error = m.filter(x => x.kind === 'error').length, warn = m.filter(x => x.kind === 'warning').length;
    ui.status = el('span', { class: 'ed-status' });
    ui.menu.replaceChildren(...[
      el('span', { class: 'tk-title' }, icon('flag', 18), el('b', {}, 'NomadTactics'), el('span', {}, 'Werkstatt')),
      el('span', { class: 'ed-separator' }),
      el('button', { class: 'ed-button', title: 'Speichern (⌘S)', onclick: () => this.persist() }, icon('save', 18)), ui.status,
      el('span', { class: 'ed-separator' }),
      el('button', { class: 'ed-button', title: 'Rückgängig (⌘Z)', disabled: !this.undo.length, onclick: () => this.undo() }, icon('undo', 18)),
      el('button', { class: 'ed-button', title: 'Wiederholen (⇧⌘Z)', disabled: !this.redo.length, onclick: () => this.repeat() }, icon('redo', 18)),
      el('span', { class: 'ed-separator' }),
      el('button', { class: 'ed-button tk-checkButton' + (error ? ' red' : warn ? ' yellow' : ' green'), title: 'Prüfung (wie nt check)', onclick: () => this.go({ area: 'validation' }) },
        icon(error ? 'error' : warn ? 'warning' : 'verify', 16), error ? ` ${error} Fehler` : warn ? ` ${warn} Warnungen` : ' Alles stimmig'),
      el('span', { class: 'ed-grow' }),
      this.store.kind === 'cloud' ? el('button', { class: 'ed-button tk-user', title: `Dein Profil · angemeldet als ${this.store.user.email} · speichert direkt in ${this.store.repo}`, onclick: () => this.showProfile() },
        el('i', { class: 'tk-user-dot', style: `background:${this.store.profile?.color || '#4a90d9'}` }), ' ' + this.store.user.name) : null,
      this.cloudError ? el('span', { class: 'ed-small tk-state', title: this.cloudError }, icon('warning', 14), ' Nur in diesem Browser') : null,
      this.state.size && this.store.kind !== 'cloud' ? el('span', { class: 'ed-small tk-state', title: 'Gespeicherte Stände überdecken diese Repo-Dateien, bis Ava sie übernimmt: ' + [...this.state.keys()].join(', ') }, icon('info', 14), ` ${this.state.size} gespeicherte ${this.state.size === 1 ? 'Datei' : 'Dateien'}`) : null,
      el('button', { class: 'ed-button ed-theme', title: `Darstellung: ${THEMES[document.documentElement.dataset.theme] || 'Grau'}`, onclick: () => this.nextTheme() }, icon('contrast', 18)),
      el('button', { class: 'ed-button', title: 'Hilfe (?)', onclick: () => this.showHelp() }, icon('help', 18))].filter(Boolean));
    this.statusShowing();
  }
  nextTheme() {
    const ids = Object.keys(THEMES), new_ = ids[(ids.indexOf(document.documentElement.dataset.theme) + 1) % ids.length];
    document.documentElement.dataset.theme = new_; try { localStorage.setItem('nomad.theme', new_); } catch { /* privat */ }
    if (this.store?.saveProfile) this.store.saveProfile({ ...this.store.profile, theme: new_ }).catch(() => {});
    this.drawMenu(); this.hint(`Darstellung: ${THEMES[new_]}`);
  }
  hint(text, opt = {}) {
    const h = this.ui.hint;
    h.replaceChildren(text);
    if (opt.undo) h.append(' ', el('button', { class: 'ed-button small', onclick: () => { h.classList.remove('on'); this.undo(); } }, icon('undo', 14), ' Rückgängig'));
    h.classList.toggle('with-button', !!opt.undo); h.classList.add('on');
    clearTimeout(this.hintTime); this.hintTime = setTimeout(() => h.classList.remove('on'), opt.undo ? 6000 : 2600);
  }

  // Navigation to a location (from validation, reference buttons)
  go(target) {
    Object.assign(this.page, { choice: null, node: null }, target);
    if (target.faction) this.isOpen.add('f:' + target.faction);
    if ('general' in target && target.faction) this.general[target.faction] = target.general;
    this.filter = ''; this.draw();
  }
  overlay(fid = this.page.faction) { const f = this.p.factions.get(fid); return f ? new Overlay(this, f, f.generals?.[this.general[fid]] ? this.general[fid] : null) : null; }

  draw() {
    this.messages = validateTactics(this.p);
    this.drawMenu();
    const navbar = el('nav', { class: 'da-navbar', 'aria-label': 'Werkstatt-Bereiche' });
    NAVBAR(this, navbar);
    const main = el('div', { class: 'da-main' }), insp = el('div', { class: 'da-insp' });
    for (const box of [main, insp]) { const orig = box.append.bind(box); box.append = (...k) => orig(...k.flat().filter(x => x != null && x !== false)); }
    const s = this.page, f = s.area === 'world' ? WORLD_PAGES[s.sub] : s.area === 'ui' ? UI_PAGES[s.sub] : s.area === 'experience' ? experiencePage : PAGES[s.area === 'faction' ? 'f_' + s.sub : s.area === 'combat' ? 'combat_' + s.sub : s.area];
    try { f ? f(this, main, insp) : main.append(el('p', {}, 'Unbekannte Seite')); }
    catch (e) { console.error(e); main.append(el('p', { class: 'ed-error' }, 'Fehler beim Zeichnen: ' + e.message)); }
    const scroll = [this.ui.data.querySelector('.da-main')?.scrollTop, this.ui.data.querySelector('.da-insp')?.scrollTop];
    this.ui.data.replaceChildren(navbar, main, insp);
    if (this.keepScroll) { main.scrollTop = scroll[0] || 0; insp.scrollTop = scroll[1] || 0; }
    this.keepScroll = true;
  }

  // ---------- shared building blocks (as in the Cosy data editor) ----------
  head(title, ...buttons) { return el('div', { class: 'da-head' }, el('h2', {}, title), el('span', { class: 'da-grow' }), ...buttons); }
  button(ic, text, f, extra = '') {
    const delete_ = ic === 'delete';
    return el('button', { class: 'ed-button wide ' + extra + (delete_ && !extra.includes('red') ? ' red' : ''), onclick: delete_ ? e => { if (f(e) !== false) this.hint('Gelöscht.', { undo: true }); } : f }, icon(ic, 16), text ? ' ' + text : '');
  }
  // Input field for an ordinary object (rules, general profile)
  field(label, obj, key, type, file, after) {
    return this.input(label, obj[key], type, {
      set: v => this.change(file, () => { if (v === '' || v === false || v == null) delete obj[key]; else obj[key] = v; after?.(); }),
      live: v => { obj[key] = v; this.changed(file); },
    });
  }
  // Basic building block: field with label, numbers draggable by the name; opt: set(v), live(v), geerbt, back()
  input(label, stat, type = 'text', opt = {}) {
    stat = stat ?? '';
    const inp = type === 'textarea' ? el('textarea', { class: 'ed-field', rows: 3 }, String(stat))
      : type === 'checkbox' ? el('input', { type: 'checkbox', checked: !!stat })
        : el('input', { type: type, class: 'ed-field' + (type === 'number' ? ' small' : ''), value: type === 'color' ? (stat || '#cccccc') : stat, step: type === 'number' ? 'any' : null });
    // On redraw an old field loses focus and reports "change" once more: only real changes count
    let last = type === 'checkbox' ? !!stat : String(stat);
    inp.addEventListener('change', () => { const v = type === 'checkbox' ? inp.checked : inp.value; if (v === last) return; last = v; opt.set(type === 'number' ? (v === '' ? undefined : +v) : v); });
    const name = el('span', { class: opt.inherited ? 'tk-inherited' : '' }, label);
    if (type === 'number' && opt.live) draggable(name, inp, { start: () => this.begin(), live: v => opt.live(v), end: () => this.draw() });
    const back = opt.back ? el('button', { class: 'ed-button small tk-back', title: 'Wert der Fraktion wiederherstellen', onclick: opt.back }, '↺') : null;
    return el('label', { class: 'da-field' + (type === 'checkbox' ? ' across' : '') + (opt.back ? ' tk-over' : '') }, name, back ? el('span', { class: 'tk-withBack' }, inp, back) : inp);
  }
  selection(options, stat, onChange, empty = null) {
    if (options.length > 6) return suchChoice({ options: options.map(([v, n]) => ({ stat: v, name: n ?? v })), stat: stat ?? '', empty, onChoice: onChange });
    const s = el('select', { class: 'ed-choice' }, empty != null ? el('option', { value: '' }, empty) : null, ...options.map(([v, n]) => el('option', { value: v, selected: v === stat }, n ?? v)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  labeled(label, content, opt = {}) {
    const back = opt.back ? el('button', { class: 'ed-button small tk-back', title: 'Wert der Fraktion wiederherstellen', onclick: opt.back }, '↺') : null;
    return el('div', { class: 'da-field' + (opt.back ? ' tk-over' : '') }, el('span', { class: opt.inherited ? 'tk-inherited' : '' }, label), back ? el('span', { class: 'tk-withBack' }, content, back) : content);
  }
  // List of IDs as chips with ✕ and "+ …" to add
  chips(list, options, onChange, plus = '+ hinzufügen', name = id => id) {
    list = list || [];
    return el('div', { class: 'da-tags' }, ...list.map((v, i) => el('span', { class: 'da-tag' }, name(v), el('button', { class: 'ed-button small', title: 'Entfernen', onclick: () => onChange(list.filter((_, j) => j !== i)) }, icon('x', 12)))),
      this.selection(options.filter(([v]) => !list.includes(v)), '', v => v && onChange([...list, v]), plus));
  }
  // Keywords: chips with value when the keyword carries a number
  keywordEditor(sw, for_, onChange) {
    sw = sw || {}; const S = this.p.data.keywords;
    const set = (k, v) => { const n = { ...sw }; if (v === undefined) delete n[k]; else n[k] = v; onChange(n); };
    return el('div', { class: 'da-tags' }, ...Object.entries(sw).map(([k, v]) => {
      const def = S[k], title = def ? `${def.name}: ${def.description || ''}` : 'unbekanntes Stichwort';
      const number = def?.number ? el('input', { type: 'number', class: 'ed-field small', value: typeof v === 'number' ? v : '', onchange: e => set(k, e.target.value === '' ? true : +e.target.value) }) : null;
      return el('span', { class: 'da-tag' + (def ? '' : ' tk-wrong'), title: title }, def?.name || k, number, el('button', { class: 'ed-button small', title: 'Entfernen', onclick: () => set(k) }, icon('x', 12)));
    }), this.selection(Object.entries(S).filter(([k, d]) => !(k in sw) && (!for_ || !d.for || d.for.includes(for_))).map(([k, d]) => [k, d.name + (d.number ? ' (X)' : '')]), '', k => k && set(k, S[k].number ? 1 : true), '+ Stichwort'));
  }
  // Costs only in supplies (money, scrap …); withPoints: also points like rank (general abilities). Capacities like power are not costs.
  costEditor(cost, resources, onChange, withPoints = false) {
    cost = cost || {}; const R = this.p.data.resources;
    const ids = [...new Set([...resources.filter(r => R[r]?.kind === 'supply' || (withPoints && R[r]?.kind === 'points')), ...Object.keys(cost)])];
    return el('div', { class: 'da-costFields' }, ...ids.map(r => {
      const f = el('input', { type: 'number', min: 0, class: 'ed-field small', value: cost[r] ?? '' });
      f.addEventListener('change', () => { const n = { ...cost }; if (+f.value > 0) n[r] = +f.value; else delete n[r]; onChange(n); });
      return el('label', { class: 'da-tag' }, el('i', { class: 'da-color rounded', style: `background:${R[r]?.color || '#888'}` }), R[r]?.name || r, f);
    }));
  }
  costText(k) { const R = this.p.data.resources; return Object.entries(k || {}).map(([r, n]) => el('span', { class: 'tk-cost', style: `--f:${R[r]?.color || '#888'}` }, short(n))); }
  list(entries, choice, onChoice, rendering, class_ = () => '') {
    const f = this.filter.toLowerCase();
    return el('div', { class: 'da-list' }, ...entries.filter(([id, x]) => !f || id.includes(f) || String(x?.name || '').toLowerCase().includes(f)).map(([id, x]) =>
      el('button', { class: 'da-entry ' + class_(id, x) + (choice === id ? ' on' : ''), onclick: () => onChoice(id) }, ...rendering(id, x))));
  }
  search() {
    const s = el('input', { type: 'search', class: 'ed-field', placeholder: 'Suchen …', value: this.filter });
    s.addEventListener('input', () => { this.filter = s.value; clearTimeout(this.sz); this.sz = setTimeout(() => { this.draw(); const n = this.ui.data.querySelector('input[type=search]'); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 200); });
    return s;
  }
  ihead(kind, kindIcon, title, id, rename, right = []) { return inspectorHead({ kind, kindIcon, title, id, rename, right }); }
  jsonDialogue(title, data, onImport) {
    const text = el('textarea', { class: 'ed-field da-json', spellcheck: 'false' }, JSON.stringify(data, null, 1));
    const { error } = openDialogue({ title, icon: 'export', wide: true, content: [el('p', { class: 'ed-small' }, 'Export: Text kopieren. Import: JSON einfügen, dann „Importieren“ (ersetzt den ganzen Bereich).'), text],
      left: [this.button('copyAction', 'Kopieren', async () => { try { await navigator.clipboard.writeText(text.value); error('Kopiert.'); } catch { text.select(); error('Bitte mit ⌘C kopieren.'); } })],
      main: onImport ? { text: 'Importieren', icon: 'import', action: () => { try { onImport(JSON.parse(text.value)); } catch (e) { error('Kein gültiges JSON: ' + e.message); return false; } } } : null });
  }
  askId(title, suggestion, onOk) {
    const inp = el('input', { class: 'ed-field', value: suggestion });
    openDialogue({ title, icon: 'plus', content: [el('label', { class: 'da-field' }, el('span', {}, 'Name'), inp)], main: { text: 'Anlegen', icon: 'plus', action: () => { if (!inp.value.trim()) return false; onOk(inp.value.trim(), cleanId(inp.value)); } } });
    setTimeout(() => inp.select(), 30);
  }
  showHelp() {
    const t = (h, ...p) => [el('h4', {}, h), ...p.map(x => el('p', { class: 'ed-small' }, x))];
    openDialogue({ title: 'Werkstatt – Was ist was?', icon: 'help', wide: true, content: [
      ...t('Spielregeln', 'Gelten für alle Fraktionen: Ressourcen (Geld, Strom, Schrott …), Kampf (Schadensarten gegen Rüstungen als Tabelle, Klassen), Stichwörter (kurze Regeln wie „Zäh(3)“ oder „Tarnung“) und Waffen. Modelle verweisen auf Voxel-Modelle.'),
      ...t('Welt', 'Gilt für alle Karten: Größenstufen und Höhenvorteil, Bewegungsarten (woran eine Einheit erkannt wird: Klasse oder Stichwort), Bodenarten mit Tempo je Bewegungsart und Deckung, Umwandlungen (Einschlag, Einsturz, Überfahren, Wetter verändern den Boden), Tag & Nacht (Phasen mit Sicht), Wetter und Klimata (wie oft welches Wetter kommt, mit Probe-Ablauf).'),
      ...t('Fraktion', 'Besteht aus Einheiten, Gebäuden und einem Techbaum. Gebäude bauen Einheiten (produziert) und haben Voraussetzungen. Forschungen sind Knoten im Techbaum mit Wirkungen (Werte ändern, Stichwort geben, Waffe geben, Fähigkeit).'),
      ...t('General', 'Eine Ebene über der Fraktion, wie eine Vorlage mit Abweichungen. Oben die Ebene wählen: Alles, was du dann änderst, landet beim General. Kursiv = von der Fraktion geerbt, ↺ setzt zurück. „Ohne“ entfernt etwas nur für diesen General, Neues gibt es nur bei ihm.'),
      ...t('Techbaum', 'Eckige Knoten sind Gebäude, runde sind Forschungen. Am Punkt ● ziehen und auf einem anderen Knoten loslassen = Voraussetzung. Linie antippen löst sie. Doppeltippen ins Leere = neue Forschung.'),
      ...t('Prüfung', 'Wie „node tools/nt.js check“: unbekannte Verweise, Kreise, Einheiten ohne Gebäude, Kosten in Ressourcen, die die Fraktion nicht nutzt. Antippen springt hin.'),
      ...t('Tasten', '⌘S speichern · ⌘Z / ⇧⌘Z rückgängig/wiederholen · Zahlen am Namen ziehen (Shift = fein) · ? Hilfe'),
    ] });
  }
}
export const short = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (Math.round(n / 100) / 10).toString().replace('.', ',') + 'k' : String(n);
