// Workshop › UI (moods, HUD defaults, radio) and game rules › experience, plus the tier editor for units.
// Data: data/ui.json, data/experience.json, unit.experience.tiers. Rules: engine/tactics/ui.js, experience.js.
import { icon } from '../icons.js';
import { el } from '../ui.js';
import { catalog } from './pages.js';
import { TOKEN_GROUPS, FONT_SELECTION, HUD_STANDARD_FIELDS, RADIO_TEXTS, SOURCES, TIERS_STATS, TIERS_EFFECTS, tiersText, hasOwnItemsTiers, effective } from '../../engine/tactics/index.js';
import { applyMoodOn, loadFonts } from './hud/moods.js';

const O_ = w => w.p.data.ui;
const n = o => Object.keys(o || {}).length;
const SUB = [['moods', 'Stimmungen', 'contrast'], ['hud', 'HUD-Standards', 'settings'], ['radio', 'Funk-Texte', 'speechBubble']];

export function navbarUi(w, navbar, entry, number) {
  const s = w.page, O = O_(w), isOpen = s.area === 'ui';
  navbar.append(el('div', { class: 'da-navbar-title tk-spacing' }, 'OBERFLÄCHE'));
  const z = { moods: n(O.moods), radio: Object.keys(RADIO_TEXTS).length };
  for (const [u, name, ic] of SUB) navbar.append(entry(isOpen && s.sub === u, icon(ic, 18), name, number(z[u] || null), () => w.go({ area: 'ui', sub: u })));
}

// ---------- Preview: a piece of game HUD with the mood's tokens ----------
function preview(mood, accent) {
  loadFonts();
  const box = el('div', { class: 'nt-hud tk-hudPreview' });
  applyMoodOn(null, box, mood?.tokens || {});
  if (accent) box.style.setProperty('--hud-acc', accent);
  const pane = (title, ic, content, class_ = '') => el('section', { class: 'hud-pane ' + class_ }, el('header', { class: 'hud-head' }, el('span', { class: 'hud-symbol' }, icon(ic, 14)), el('span', { class: 'hud-title' }, title), el('span', { class: 'hud-head-extra' }), el('button', { class: 'hud-k' }, icon('down', 13))), el('div', { class: 'hud-content' }, ...content));
  const rk = (ic, name, price, taste, n) => el('button', { class: 'rk' }, el('span', { class: 'ri' }, icon(ic, 22)), el('span', { class: 'rn' }, name), el('span', { class: 'rp' }, price), el('kbd', {}, taste), n ? el('em', {}, n) : null, el('i', { class: 'rf', style: n ? 'height:40%' : '' }));
  const bal = (name, width, color, text) => el('div', { class: 'bal' + (color === 'xp' ? ' xp' : '') }, el('span', {}, name), el('span', { class: 'bl' }, el('i', { style: `width:${width}%;${color && color !== 'xp' ? `background:var(--hud-${color})` : ''}` })), el('small', {}, text));
  box.append(
    el('div', { class: 'tk-hv-series' }, pane('Lage', 'flag', [el('div', { class: 'res' }, el('span', { class: 'res-i' }, icon('coins', 15)), el('b', {}, '4.250'), el('small', {}, '+25/s')),
      el('div', { class: 'res' }, el('span', { class: 'res-i' }, icon('flash', 15)), el('span', { class: 'power-bar' }, el('i', { style: 'width:60%' })), el('small', {}, '45/80')),
      el('button', { class: 'idle on' }, el('span', { class: 'res-i' }, icon('factory', 15)), el('b', {}, '1'), el('small', {}, 'im Leerlauf'))], 'f-res')),
    el('div', { class: 'tk-hv-series' },
      el('div', { class: 'tk-hv-column' },
        pane('General', 'general', [el('button', { class: 'abil' }, el('span', { class: 'abil-i' }, icon('rakete', 22)), el('span', { class: 'abil-n' }, 'Luftschlag')), el('button', { class: 'abil loads' }, el('span', { class: 'abil-i' }, icon('skull', 22)), el('span', { class: 'abil-n' }, 'Superwaffe'), el('span', { class: 'abil-cd', style: '--f:200deg' }, '42'))], 'f-abil'),
        pane('Funk', 'speechBubble', [el('div', { class: 'tick good' }, el('small', {}, '3:12'), el('span', {}, 'Kampfpanzer bereit.')), el('div', { class: 'tick warn' }, el('small', {}, '3:05'), el('span', {}, 'Fabrik im Leerlauf.')), el('div', { class: 'tick hostile' }, el('small', {}, '2:58'), el('span', {}, 'Einheit verloren.'))], 'f-ticker')),
      el('div', { class: 'tk-hv-column' },
        pane('Auswahl', 'selection', [el('div', { class: 'one' }, el('div', { class: 'portrait tk-hv-portrait' }, el('span', { class: 'pl' }, 'Live')),
          el('div', { class: 'ed' }, el('div', { class: 'headRow' }, el('span', { class: 'dot', style: 'background:var(--hud-info)' }), el('b', {}, 'Kampfpanzer'), el('small', {}, 'im Gefecht')),
            bal('Leben', 64, 'warn', '320/500'), bal('Erfahrung', 45, 'xp', 'Veteran · 140/220 EP'),
            el('div', { class: 'stats' }, el('span', {}, 'Schaden 60 '), el('em', {}, '+15 %')), el('div', { class: 'chips' }, el('span', { class: 'chip' }, 'Kette'), el('span', { class: 'chip new' }, 'Selbstreparatur'))))], 'f-selection'),
        el('div', { class: 'tk-hv-mark' }, markerSvg(mood?.tokens))),
      pane('Waffenfabrik', 'factory', [el('div', { class: 'grid' }, rk('target', 'Späher', 700, 'Q'), rk('vehicle', 'Panzer', 1200, 'W', 2), rk('rakete', 'Werfer', 1400, 'E'), el('button', { class: 'rk empty' })),
        el('div', { class: 'queue' }, el('span', { class: 'sch erst' }, el('b', {}, 'Panzer'), el('i', { style: 'width:40%' })), el('span', { class: 'sh' }, el('b', {}, 'Panzer')))], 'f-construction')));
  return box;
}
// Markers as in the game: double line (selection + edge), corners around a vehicle, ring around a squad, march line with little flag
function markerSvg(t = {}) {
  const a = t.selection || '#fff', r = t.selectionBorder || '#000', ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 260 90'); svg.setAttribute('class', 'tk-hv-svg');
  const line = (d, width, color, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const double = (d, extra = '') => line(d, 4.5, r, extra) + line(d, 2, a, extra);
  const corners = 'M20 30 L20 20 L32 20 M68 20 L80 20 L80 30 M80 58 L80 68 L68 68 M32 68 L20 68 L20 58';
  svg.innerHTML = `<rect x="0" y="0" width="260" height="90" rx="8" fill="#5b7a3c"/>
    <rect x="30" y="30" width="40" height="28" rx="3" fill="#4d5a35"/><rect x="40" y="36" width="18" height="12" fill="#3a78d8"/>
    ${double(corners)}<ellipse cx="135" cy="46" rx="26" ry="14" fill="none" stroke="${r}" stroke-width="4.5"/><ellipse cx="135" cy="46" rx="26" ry="14" fill="none" stroke="${a}" stroke-width="2"/>
    <circle cx="128" cy="44" r="3" fill="#2a3d6e"/><circle cx="138" cy="48" r="3" fill="#2a3d6e"/><circle cx="144" cy="42" r="3" fill="#2a3d6e"/>
    ${double('M80 44 L215 40', 'stroke-dasharray="9 7"')}${double('M215 40 L215 22')}<path d="M215 22 L226 26 L215 30 Z" fill="${a}" stroke="${r}" stroke-width="1.5"/>`;
  return svg;
}

// ---------- Color/text field for tokens: color field + free text (rgba, CSS) ----------
function tokenField(w, label, stat, kind, set) {
  const text = el('input', { class: 'ed-field', value: stat ?? '', spellcheck: 'false' });
  text.addEventListener('change', () => set(text.value.trim() || undefined));
  if (kind === 'color') {
    const hex = /^#[0-9a-f]{6}$/i.test(stat || '') ? stat : '#888888';
    const color = el('input', { type: 'color', value: hex, class: 'tk-tokenColor', title: 'Farbe wählen' });
    color.addEventListener('change', () => set(color.value));
    return w.labeled(label, el('span', { class: 'ed-row tk-tokenRow' }, el('i', { class: 'tk-tokenPattern', style: `background:${stat || 'transparent'}` }, color), text));
  }
  if (kind === 'font') return w.labeled(label, el('span', { class: 'tk-tokenColumn' }, w.selection(FONT_SELECTION.map(s => [s, s.split(',')[0].replace(/"/g, '')]), FONT_SELECTION.includes(stat) ? stat : '', v => v && set(v), 'eigene …'), text));
  return w.labeled(label, text);
}

export const UI_PAGES = {
  // ---------- Stimmungen (Styleguide) ----------
  moods(w, main, insp) {
    const O = O_(w), file = w.path('ui'), S = O.moods = O.moods || {};
    const showing = S[w.page.choice] ? w.page.choice : O.standard;
    catalog(w, main, insp, { title: 'Stimmungen', singular: 'Stimmung', ic: 'contrast', obj: () => S, file,
      new: () => structuredClone(S[O.standard] || Object.values(S)[0] || { name: 'Neue Stimmung', tokens: {} }),
      hint: 'Eine Stimmung ist ein Satz Design-Tokens für das Spiel-HUD: Flächen, Text, Akzent, Markierungen, Form und Schrift. Der Spieler wählt im Spiel (Esc), Nationen können eine eigene Stimmung und Akzentfarbe haben (Fraktion › Übersicht). Ohne Auswahl siehst du die Standard-Stimmung.',
      renamed: (a, b) => { if (O.standard === a) O.standard = b; for (const f of w.p.factions.values()) if (f.ui?.mood === a) { f.ui.mood = b; w.changed(w.p.factionPaths.get(f.id)); } },
      deleted: id => { if (O.standard === id) O.standard = Object.keys(S)[0] || null; },
      row: (id, s) => [el('span', { class: 'tk-moodPattern' }, ...['bg', 'acc', 'text', 'selection'].map(k => el('i', { style: `background:${s.tokens?.[k]}` }))), el('span', { class: 'da-name' }, s.name || id), el('small', {}, O.standard === id ? 'Standard' : '')],
      inspector: (s, id) => {
        s.tokens = s.tokens || {};
        insp.append(w.field('Name', s, 'name', 'text', file),
          O.standard === id ? el('p', { class: 'ed-small' }, icon('check', 12), ' Standard-Stimmung im Spiel') : w.button('star', 'Als Standard', () => w.change(file, () => { O.standard = id; }), 'main'));
        for (const [group, list] of TOKEN_GROUPS) insp.append(el('h4', {}, group), ...list.map(([k, label, kind]) => tokenField(w, label, s.tokens[k], kind, v => w.change(file, () => { if (v === undefined) delete s.tokens[k]; else s.tokens[k] = v; }))));
      } });
    main.append(el('h3', {}, `Vorschau: ${S[showing]?.name || '—'}`), el('p', { class: 'ed-small' }, 'So sehen Fenster, Bauleiste, Balken und Markierungen im Spiel aus. Jede Änderung im Inspektor wirkt sofort.'), preview(S[showing]));
  },

  // ---------- HUD defaults: what a new player sees ----------
  hud(w, main, insp) {
    const O = O_(w), file = w.path('ui'), H = O.hud = O.hud || {}, S = O.moods || {};
    main.append(w.head('HUD-Standards'), el('p', { class: 'ed-small' }, 'Startwerte für jeden Spieler. Im Spiel kann jeder sie unter Esc für sich ändern; das merkt sich sein Gerät. Layout der Fenster (andocken, schweben) gehört ebenfalls dem Spieler.'),
      el('div', { class: 'tk-hudStandard' },
        w.labeled('Standard-Stimmung', w.selection(Object.entries(S).map(([k, s]) => [k, s.name || k]), O.standard || '', v => w.change(file, () => { O.standard = v || null; }))),
        ...Object.entries(HUD_STANDARD_FIELDS).map(([k, [name, choice]]) => w.labeled(name, el('div', { class: 'seg tk-seg' }, ...choice.map(([v, t]) => el('button', { class: 'ed-button wide' + ((H[k] ?? choice[0][0]) === v ? ' on' : ''), onclick: () => w.change(file, () => { H[k] = v; }) }, t))))),
        w.field('Funkstimme an', H, 'voice', 'checkbox', file),
        w.field('UI-Größe (1 = 100 %)', H, 'scale', 'number', file)),
      el('h3', {}, 'Vorschau Standard-Stimmung'), preview(S[O.standard]));
    insp.append(el('h3', {}, 'Was ist fest?'), el('p', { class: 'ed-small' }, 'Kurz-Rechtsklick = Befehl, rechte Taste halten = Kreismenü, Strg+1–9 Gruppen, Alt = alle Marschlinien, Esc = Einstellungen. Diese Bedienung ist gleich für alle, damit sich jeder an jedem Rechner zurechtfindet.'));
  },

  // ---------- Funk-Texte ----------
  radio(w, main, insp) {
    const O = O_(w), file = w.path('ui'), F = O.radio = O.radio || {};
    main.append(w.head('Funk-Texte'), el('p', { class: 'ed-small' }, 'Was der Funk sagt und in den Ticker schreibt. Platzhalter in geschweiften Klammern: {name} Einheit oder Fähigkeit, {stufe} Erfahrungsstufe, {gebaeude} Gebäude. Leeres Feld = eingebauter Text. Später je Nation eigene Aufnahmen.'),
      el('div', { class: 'tk-radio' }, ...Object.entries(RADIO_TEXTS).map(([k, [name, std]]) => w.input(name, F[k], 'text', { set: v => w.change(file, () => { if (!v) delete F[k]; else F[k] = v; }) }))),
      el('h4', {}, 'Quittungen beim Befehl (eine je Zeile, zufällig)'),
      (() => { const t = el('textarea', { class: 'ed-field', rows: 5 }, (F.acks || []).join('\n')); t.addEventListener('change', () => w.change(file, () => { F.acks = t.value.split('\n').map(x => x.trim()).filter(Boolean); })); return t; })());
    insp.append(el('h3', {}, 'Probe'), ...Object.entries(RADIO_TEXTS).map(([k, [name, std]]) => el('p', { class: 'ed-small' }, el('b', {}, name + ': '), String(F[k] || std).replace('{name}', 'Kampfpanzer').replace('{stufe}', 'Elite').replace('{gebaeude}', 'Waffenfabrik'))),
      el('button', { class: 'ed-button wide', onclick: () => { try { const u = new SpeechSynthesisUtterance(String(F.ready || RADIO_TEXTS.ready[1]).replace('{name}', 'Kampfpanzer')); u.long = 'de-DE'; speechSynthesis.speak(u); } catch { w.hint('Sprachausgabe gibt es hier nicht.'); } } }, icon('loudspeaker', 16), ' Anhören'));
  },
};

// ---------- Spielregeln › Erfahrung ----------
export function experiencePage(w, main, insp) {
  const file = w.path('experience'), E = w.p.data.experience = w.p.data.experience || { sources: {}, tiers: [] }, Q = E.sources = E.sources || {};
  const ownItems = [];
  for (const [fid, f] of w.p.factions) for (const [uid, u] of Object.entries(f.units || {})) ownItems.push({ fid, uid, u, f });
  main.append(w.head('Erfahrung'),
    el('p', { class: 'ed-small' }, 'Einheiten sammeln Erfahrung in der Partie und steigen in Stufen auf. Jede Stufe ändert Werte, gibt Stichwörter oder Waffen und kann das Modell tauschen. Hier steht der Standard-Satz für alle Einheiten ohne eigene Stufen. Eigene Stufen bearbeitest du an der Einheit; Generäle können sie über ihre Ebene ändern.'),
    el('h3', {}, 'Standard-Stufen'), tiersEditor(w, E.tiers || [], v => w.change(file, () => { E.tiers = v; })),
    el('h3', {}, 'Wer hat eigene Stufen?'), el('table', { class: 'tk-table' }, el('tr', {}, ...['Einheit', 'Fraktion', 'Stufen'].map(t => el('th', {}, t))),
      ...ownItems.map(({ fid, uid, u, f }) => el('tr', { onclick: () => w.go({ area: 'faction', faction: fid, sub: 'units', choice: uid, general: null }) },
        el('td', {}, u.name), el('td', {}, el('i', { class: 'da-color rounded', style: `background:${f.color}` }), ' ' + f.name), el('td', { class: hasOwnItemsTiers(u) ? '' : 'tk-std' }, hasOwnItemsTiers(u) ? u.experience.tiers.map(s => s.name).join(' › ') : 'Standard')))));
  insp.append(el('h3', {}, 'Erfahrungspunkte je Quelle'), el('p', { class: 'ed-small' }, 'Woraus Erfahrung entsteht. 0 schaltet eine Quelle ab. Alles gilt nur innerhalb einer Partie.'),
    ...Object.entries(SOURCES).map(([k, t]) => w.input(t, Q[k], 'number', { set: v => w.change(file, () => { if (v === undefined) delete Q[k]; else Q[k] = v; }) })));
}

// ---------- Tier editor (default and per unit) ----------
export function tiersEditor(w, list, set) {
  list = list || [];
  const p = w.p, S = p.data.keywords || {}, Wf = p.data.weapons || {}, M = p.data.models || {};
  const arrange = l => [...l].sort((a, b) => (a.min || 0) - (b.min || 0));
  const change = (i, part) => set(arrange(list.map((s, j) => j === i ? { ...s, ...part } : s)));
  const number = (stat, f, ph, width = 64) => { const x = el('input', { type: 'number', step: 'any', class: 'ed-field small', placeholder: ph, value: stat ?? '', style: `width:${width}px` }); x.addEventListener('change', () => f(x.value === '' ? undefined : +x.value)); return x; };
  const text = (stat, f, ph) => { const x = el('input', { class: 'ed-field', placeholder: ph, value: stat ?? '' }); x.addEventListener('change', () => f(x.value || undefined)); return x; };
  const max = Math.max(1, ...list.map(s => s.min || 0)) * 1.1;
  const ladder = el('div', { class: 'tk-ladder' }, el('i', { class: 'tk-ladder-band' }), ...list.map((s, i) => el('span', { class: 'tk-ladder-tier', style: `left:${(s.min || 0) / max * 100}%` }, el('b', {}, '›'.repeat(i + 1)), el('small', {}, `${s.name} · ${s.min}`))));
  return el('div', { class: 'tk-tiers' }, list.length ? ladder : el('p', { class: 'ed-small' }, 'Noch keine Stufen.'),
    ...list.map((s, i) => {
      const eff = s.effect || [];
      const changeW = (j, part) => change(i, { effect: eff.map((x, k) => k === j ? { ...x, ...part } : x) });
      return el('div', { class: 'tk-tier' },
        el('div', { class: 'tk-tier-head' }, el('b', { class: 'tk-angle' }, '›'.repeat(i + 1)), text(s.name, v => change(i, { name: v }), 'Name'), el('span', { class: 'ed-small' }, 'ab'), number(s.min, v => change(i, { min: v }), 'EP', 72), el('span', { class: 'ed-small' }, 'EP'),
          el('button', { class: 'ed-button small red', title: 'Stufe löschen', onclick: () => set(list.filter((_, j) => j !== i)) }, icon('delete', 14))),
        el('div', { class: 'tk-effects' }, ...eff.map((x, j) => el('div', { class: 'da-row' }, el('b', { class: 'da-kind' }, TIERS_EFFECTS[x.kind] || x.kind),
          ...(x.kind === 'stat' ? [w.selection(Object.entries(TIERS_STATS), x.field || '', v => changeW(j, { field: v }), '— Wert —'), el('span', { class: 'ed-small' }, '×'), number(x.times, v => changeW(j, { times: v }), '1'), el('span', { class: 'ed-small' }, '+'), number(x.plus, v => changeW(j, { plus: v }), '0')]
            : x.kind === 'keyword' ? [w.selection(Object.entries(S).map(([k, d]) => [k, d.name]), x.keyword || '', v => changeW(j, { keyword: v }), '— Stichwort —'), S[x.keyword]?.number ? number(x.stat, v => changeW(j, { stat: v }), 'X') : null]
              : [w.selection(Object.entries(Wf).map(([k, d]) => [k, d.name]), x.weapon || '', v => changeW(j, { weapon: v }), '— Waffe —'), w.selection(Object.entries(Wf).map(([k, d]) => [k, 'ersetzt ' + d.name]), x.replaced || '', v => changeW(j, { replaced: v || undefined }), 'zusätzlich')]),
          el('button', { class: 'ed-button small red', title: 'Entfernen', onclick: () => change(i, { effect: eff.filter((_, k) => k !== j) }) }, icon('x', 14)))),
          w.selection(Object.entries(TIERS_EFFECTS), '', v => v && change(i, { effect: [...eff, v === 'stat' ? { kind: v, field: 'damage', times: 1.1 } : { kind: v }] }), '+ Wirkung')),
        el('div', { class: 'ed-row tk-tier-foot' }, text(s.text, v => change(i, { text: v }), `Text im Spiel (sonst: ${tiersText(p, { ...s, text: null }) || '—'})`),
          w.selection(Object.entries(M).map(([k, m]) => [k, m.name]), s.model || '', v => change(i, { model: v || undefined }), 'Modell bleibt')));
    }),
    w.button('plus', 'Stufe', () => { const min = (list[list.length - 1]?.min || 0) * 2 || 100; set([...list, { id: 'tier' + (list.length + 1), name: `Stufe ${list.length + 1}`, min, effect: [{ kind: 'stat', field: 'damage', times: 1.1 }] }]); }));
}

// ---------- Unit › Experience (in the inspector) ----------
export function experienceSection(w, eb, uid, x, B) {
  const std = w.p.data.experience?.tiers || [], own = hasOwnItemsTiers(x);
  return [el('h4', {}, 'Erfahrung'),
    own ? B('Eigene Stufen', 'experience', (v, s) => tiersEditor(w, v?.tiers || [], st => s(st.length ? { tiers: st } : undefined)))
      : el('div', {}, el('p', { class: 'ed-small' }, `Nutzt den Standard: ${std.map(s => `${s.name} (${s.min})`).join(' › ') || 'keine Stufen'}.`),
        w.button('plus', 'Eigene Stufen', () => w.change(eb.file, () => eb.set('units', uid, 'experience', { tiers: structuredClone(std) })))),
    own ? el('div', { class: 'ed-row' }, w.button('restart', 'Zurück zum Standard', () => w.change(eb.file, () => eb.set('units', uid, 'experience', undefined))),
      w.button('arrow_right', 'Erfahrungsregeln', () => w.go({ area: 'experience' }))) : null];
}

// ---------- Faction › UI (in the overview inspector) ----------
export function factionUi(w, f, file) {
  const O = O_(w), S = O.moods || {}, fo = f.ui || {};
  const set = (k, v) => w.change(file, () => { f.ui = { ...(f.ui || {}) }; if (v) f.ui[k] = v; else delete f.ui[k]; if (!Object.keys(f.ui).length) delete f.ui; });
  return [el('h4', {}, 'Oberfläche'),
    w.labeled('Stimmung', w.selection(Object.entries(S).map(([k, s]) => [k, s.name || k]), fo.mood || '', v => set('mood', v), 'wie Standard')),
    w.input('Akzentfarbe', fo.accent, 'color', { set: v => set('accent', v) }),
    fo.accent ? w.button('x', 'Akzent entfernen', () => set('accent', null)) : null,
    el('p', { class: 'ed-small' }, 'Wer diese Nation spielt, bekommt diese Stimmung und Akzentfarbe als Start (er kann im Spiel trotzdem umstellen).'),
    preview(S[fo.mood || O.standard], fo.accent)];
}
