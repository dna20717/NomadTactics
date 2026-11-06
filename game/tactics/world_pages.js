// Werkstatt › Welt: Karten, Bewegungsarten, Bodenarten, Umwandlungen, Tag & Nacht, Wetter, Klimata.
// Data in daten/world.json, rules in engine/tactics/world.js (same logic as the simulation).
import { icon } from '../icons.js';
import { el } from '../ui.js';
import { catalog } from './pages.js';
import { freeId } from './workshop.js';
import { TRIGGER, WATER, movementTypes, cycleDuration, weatherPlan, phaseUm, renameWorld, effective } from '../../engine/tactics/index.js';

const SUB = [
  ['maps', 'Karten & Höhe', 'map'], ['movementTypes', 'Bewegungsarten', 'tracks'], ['terrains', 'Bodenarten', 'overlays'], ['transformations', 'Umwandlungen', 'restart'],
  ['daytime', 'Tag & Nacht', 'dayNight'], ['weather', 'Wetter', 'rain'], ['climates', 'Klimata', 'world_icon'],
];
const WEATHER_SYMBOLS = ['sun', 'cloud', 'rain', 'fog', 'snow', 'storm', 'wind', 'drop', 'moon'];
const PHASE_COLOR = { tag: '#f2c14e', dusk: '#e0855a', night: '#3b4a7a', dawn: '#b58ad6' };
const W_ = w => w.p.data.world;
const n = o => Object.keys(o || {}).length;
const minutes = s => s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} Min`;
const point = color => el('i', { class: 'da-color rounded', style: `background:${color || '#888'}` });

export function navbarWorld(w, navbar, entry, number) {
  const s = w.page, W = W_(w), isOpen = s.area === 'world';
  navbar.append(el('div', { class: 'da-navbar-title tk-spacing' }, 'WELT'));
  const z = { movementTypes: n(W.movementTypes), terrains: n(W.terrains), transformations: n(W.transformations), weather: n(W.weather), climates: n(W.climates), maps: n(W.maps?.sizes), daytime: (W.daytime?.phases || []).length };
  for (const [u, name, ic] of SUB) navbar.append(entry(isOpen && s.sub === u, icon(ic, 18), name, number(z[u] || null), () => w.go({ area: 'world', sub: u })));
}

// A number that belongs directly in a table/row (speed, weight …); '' = remove field
function numberField(stat, set, { min = 0, max, width, placeholder } = {}) {
  const inp = el('input', { type: 'number', step: 1, min, max, class: 'ed-field small', value: stat ?? '', placeholder: placeholder ?? null, style: width ? `width:${width}px` : null });
  inp.addEventListener('change', () => set(inp.value === '' ? undefined : Math.round(+inp.value)));
  return inp;
}
const setOrWay = (o, k, v) => { if (v === undefined || v === '' || v === null) delete o[k]; else o[k] = v; };

export const WORLD_PAGES = {
  // ---------- Maps: sizes, grid, height advantage ----------
  maps(w, main, insp) {
    const W = W_(w), file = w.path('world'), K = W.maps = W.maps || {}, G = K.sizes = K.sizes || {}, H = W.height = W.height || {};
    const voxel = w.p.def.voxel || 0.4, largest = Math.max(1, ...Object.values(G).map(g => g.meter || 0));
    catalog(w, main, insp, { title: 'Kartengrößen', singular: 'Kartengröße', ic: 'map', obj: () => G, file, new: () => ({ name: 'Neue Größe', meter: 384, player: [2, 4] }),
      hint: 'Größe ist ein Wert jeder Karte. Hier stehen die Stufen, aus denen Generator und Editor wählen. Ohne Auswahl: Grundwerte und Höhenvorteil.',
      row: (id, g) => [el('span', { class: 'tk-ksize', style: `--a:${Math.max(8, (g.meter || 0) / largest * 34)}px` }), el('span', { class: 'da-name' }, g.name || id), el('small', {}, `${g.meter} m · ${(g.player || []).join('–')} Spieler · ${Math.round((g.meter / voxel) ** 2 / 1e5) / 10} Mio. Säulen`)],
      inspector: g => insp.append(w.field('Name', g, 'name', 'text', file), w.field('Kantenlänge (m)', g, 'meter', 'number', file),
        w.labeled('Spieler', el('span', { class: 'ed-row' }, numberField(g.player?.[0], v => w.change(file, () => { g.player = [v ?? 2, g.player?.[1] ?? 2]; }), { min: 1, max: 8, width: 64 }), ' bis ', numberField(g.player?.[1], v => w.change(file, () => { g.player = [g.player?.[0] ?? 2, v ?? 2]; }), { min: 1, max: 8, width: 64 }))),
        w.field('Beschreibung', g, 'description', 'textarea', file),
        el('p', { class: 'ed-small' }, `${Math.round(g.meter / voxel)} × ${Math.round(g.meter / voxel)} Säulen à ${voxel} m, ${Math.round(g.meter / (voxel * 32) * 10) / 10} × ${Math.round(g.meter / (voxel * 32) * 10) / 10} Brocken. Bodenraster ${K.groundGrid || 2} m → ${Math.round(g.meter / (K.groundGrid || 2))}² Felder für Simulation und Wegfindung.`)) });
    if (w.page.choice) return;
    insp.append(el('h4', {}, 'Grundwerte'),
      w.field('Bodenraster (m)', K, 'groundGrid', 'number', file), w.field('Deko-Rand (m)', K, 'decoBorder', 'number', file),
      w.labeled('Startplätze', el('span', { class: 'ed-row' }, numberField(K.startSlots?.[0], v => w.change(file, () => { K.startSlots = [v ?? 2, K.startSlots?.[1] ?? 8]; }), { min: 1, max: 8, width: 64 }), ' bis ', numberField(K.startSlots?.[1], v => w.change(file, () => { K.startSlots = [K.startSlots?.[0] ?? 2, v ?? 8]; }), { min: 1, max: 8, width: 64 }))),
      el('p', { class: 'ed-small' }, 'Bodenraster: grobes Raster für Bodenart, Umwandlungen und Wegfindung unter den feinen Würfeln. Deko-Rand: Diorama-Sockel um den spielbaren Bereich.'),
      el('h4', {}, 'Höhenvorteil'), el('p', { class: 'ed-small' }, H.description || ''),
      w.field(`Schwelle (Lagen = ${Math.round((H.threshold || 0) * voxel * 10) / 10} m)`, H, 'threshold', 'number', file),
      w.field('Reichweite bergab (%)', H, 'rangeDownhill', 'number', file), w.field('Treffer bergauf (%)', H, 'hitUphill', 'number', file),
      w.labeled('Ohne bei Waffen', keywordChips(w, H.withoutWeapon, 'weapon', v => w.change(file, () => { H.withoutWeapon = v; }))),
      w.labeled('Ohne bei Einheiten', keywordChips(w, H.withoutUnit, 'unit', v => w.change(file, () => { H.withoutUnit = v; }))));
    // Size comparison in the middle
    main.append(el('h3', {}, 'Größenvergleich'), el('div', { class: 'tk-kcompare' }, ...Object.entries(G).sort((a, b) => b[1].meter - a[1].meter).map(([id, g]) =>
      el('button', { class: 'tk-ksquare', style: `width:${g.meter / largest * 100}%`, onclick: () => w.go({ ...w.page, choice: id }) }, el('span', {}, `${g.name || id} · ${g.meter} m`)))));
  },

  // ---------- Bewegungsarten ----------
  movementTypes(w, main, insp) {
    const W = W_(w), file = w.path('world'), B = W.movementTypes = W.movementTypes || {}, S = w.p.data.keywords, KL = w.p.data.combat.classes;
    const detections = [...Object.entries(KL).map(([k, x]) => [`class:${k}`, `Klasse ${x.name}`]), ...Object.entries(S).filter(([, x]) => !x.for || x.for.includes('unit')).map(([k, x]) => [`keyword:${k}`, `Stichwort ${x.name}`])];
    catalog(w, main, insp, { title: 'Bewegungsarten', singular: 'Bewegungsart', ic: 'tracks', obj: () => B, file, new: () => ({ name: 'Neue Bewegungsart', detection: 'keyword:wheel', standard: 100 }),
      hint: 'Woran die Simulation erkennt, wie eine Einheit fährt: Klasse oder Stichwort. Hat eine Einheit mehrere (Kette + Schwimmt), zählt auf jedem Boden die beste.',
      renamed: (a, b) => renameWorld(W, 'movement', a, b), deleted: id => renameWorld(W, 'movement', id, null),
      row: (id, b) => [icon(b.ignoresGround ? 'air' : 'tracks', 16), el('span', { class: 'da-name' }, b.name || id), el('small', {}, `${detections.find(([k]) => k === b.detection)?.[1] || b.detection} · ${b.ignoresGround ? 'ignoriert Boden' : `Standard ${b.standard ?? 100} %`} · ${hitsUnits(w, id).length} Einheiten`)],
      inspector: (b, id) => {
        const hit = hitsUnits(w, id);
        insp.append(w.field('Name', b, 'name', 'text', file),
          w.labeled('Erkennung', w.selection(detections, b.detection, v => w.change(file, () => { b.detection = v; }))),
          w.field('ignoriert Boden', b, 'ignoresGround', 'checkbox', file),
          b.ignoresGround ? null : w.field('Standard-Tempo (%)', b, 'standard', 'number', file),
          el('p', { class: 'ed-small' }, b.ignoresGround ? 'Fliegt über alles. Wetter kann die Bewegungsart sperren (Sturm).' : 'Standard gilt auf Böden ohne eigenen Wert. Schwimmt hat 0: An Land hilft es nicht.'),
          el('h4', {}, `Trifft (${hit.length})`), el('div', { class: 'da-tags' }, ...hit.map(t => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'faction', faction: t.fid, sub: 'units', choice: t.uid, general: null }) }, point(w.p.factions.get(t.fid).color), ' ' + t.name))));
      } });
  },

  // ---------- Bodenarten: Tempo-Tabelle ----------
  terrains(w, main, insp) {
    const W = W_(w), file = w.path('world'), BO = W.terrains = W.terrains || {}, B = W.movementTypes || {}, choice = w.page.choice;
    const amGround = Object.entries(B).filter(([, b]) => !b.ignoresGround);
    main.append(w.head('Bodenarten',
      w.button('plus', 'Neu', () => { const id = freeId('ground', new Set(Object.keys(BO))); w.change(file, () => { BO[id] = { name: 'Neuer Boden', color: '#8a8a7a', speed: {} }; }); w.go({ ...w.page, choice: id }); }),
      w.button('export', 'JSON', () => w.jsonDialogue('Bodenarten als JSON', BO, j => w.change(file, () => { for (const k of Object.keys(BO)) delete BO[k]; Object.assign(BO, j); })))),
      el('p', { class: 'ed-small' }, 'Tempo in Prozent je Bewegungsart, Gras = 100. 0 heißt: kommt nicht durch. Leeres Feld = Standard der Bewegungsart. Schwebt und Jet ignorieren den Boden. Zeile antippen öffnet den Boden im Inspektor.'),
      el('table', { class: 'tk-matrix tk-ground' }, el('tr', {}, el('th', {}), ...amGround.map(([, b]) => el('th', {}, b.name)), el('th', {}, 'Deckung')),
        ...Object.entries(BO).map(([id, bo]) => el('tr', { class: choice === id ? 'on' : '' },
          el('th', { onclick: () => w.go({ ...w.page, choice: id }) }, el('span', { class: 'tk-groundName' }, el('i', { class: 'tk-q', style: `background:${bo.color}` }), bo.name || id, bo.water ? icon('wave', 13) : null)),
          ...amGround.map(([a, b]) => {
            const v = bo.speed?.[a], eff = v ?? b.standard ?? 100;
            return el('td', { style: `--w:${Math.min(1, eff / 150)}`, class: (eff === 0 ? 'null' : eff > 100 ? 'strong' : '') + (v == null ? ' tk-std' : '') },
              numberField(v, x => w.change(file, () => { bo.speed = bo.speed || {}; setOrWay(bo.speed, a, x); }), { max: 300, placeholder: String(b.standard ?? 100) }));
          }),
          el('td', { class: 'tk-cover' }, Object.entries(bo.cover || {}).map(([a, d]) => `${B[a]?.name || a} ${d} %`).join(', ') || '–')))));
    const bo = BO[choice];
    if (!bo) { insp.append(el('h3', {}, 'Bodenarten'), el('p', { class: 'ed-small' }, 'Jedes Feld im Bodenraster hat eine Bodenart. Sie bestimmt Tempo, Deckung, Sicht und Spuren. Umwandlungen ändern sie mitten in der Partie (Einschläge, Regen, Ketten).')); return; }
    insp.append(w.ihead('Bodenart', 'overlays', bo.name || choice, choice, newId => {
      if (BO[newId]) { w.hint(`„${newId}“ gibt es schon.`); return false; }
      w.change(file, () => renameWorld(W, 'ground', choice, newId)); w.go({ ...w.page, choice: newId });
    }),
    w.field('Name', bo, 'name', 'text', file), w.field('Farbe', bo, 'color', 'color', file),
    w.labeled('Wasser', w.selection(Object.entries(WATER), bo.water || '', v => w.change(file, () => setOrWay(bo, 'water', v)), 'kein Wasser')),
    w.field('Sichtblocker', bo, 'sightBlocker', 'checkbox', file), w.field('Spuren', bo, 'tracks', 'checkbox', file),
    el('h4', {}, 'Staub (nur Optik)'), el('p', { class: 'ed-small' }, 'Wie viel Staub Fahrzeuge hier aufwirbeln (Sand viel, Straße kaum). Ohne Staubfarbe nimmt der Staub die Bodenfarbe, aufgehellt. Wird mit der Staubfahne der Lebendigkeit multipliziert.'),
    w.field('Staub %', bo, 'dust', 'number', file), w.field('Staubfarbe', bo, 'dustColor', 'color', file),
    el('h4', {}, 'Deckung (%)'), el('p', { class: 'ed-small' }, 'So viel seltener wird getroffen, wer hier steht.'),
    ...amGround.map(([a, b]) => w.input(b.name, bo.cover?.[a], 'number', { set: v => w.change(file, () => { bo.cover = bo.cover || {}; setOrWay(bo.cover, a, v); if (!n(bo.cover)) delete bo.cover; }) })),
    w.field('Beschreibung', bo, 'description', 'textarea', file),
    el('h4', {}, 'In Umwandlungen'), el('div', { class: 'da-tags' }, ...Object.entries(W.transformations || {}).filter(([, u]) => u.to === choice || (u.from || []).includes(choice)).map(([uid, u]) =>
      el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'world', sub: 'transformations', choice: uid }) }, icon('restart', 12), ' ' + (u.name || uid)))),
    el('hr'), el('div', { class: 'ed-row' },
      w.button('duplicate', 'Duplizieren', () => { const id = freeId(choice, new Set(Object.keys(BO))); w.change(file, () => { BO[id] = { ...structuredClone(bo), name: bo.name + ' (Kopie)' }; }); w.go({ ...w.page, choice: id }); }),
      w.button('delete', 'Löschen', () => { w.change(file, () => { delete BO[choice]; renameWorld(W, 'ground', choice, null); }); w.go({ ...w.page, choice: null }); })));
  },

  // ---------- Umwandlungen ----------
  transformations(w, main, insp) {
    const W = W_(w), file = w.path('world'), U = W.transformations = W.transformations || {}, BO = W.terrains || {}, B = W.movementTypes || {}, WE = W.weather || {};
    const ground = id => el('span', { class: 'tk-groundName' }, el('i', { class: 'tk-q', style: `background:${BO[id]?.color || '#888'}` }), BO[id]?.name || id);
    const triggerText = u => u.trigger === 'weather' ? `${WE[u.weather]?.name || u.weather} ab ${u.after ?? 0} s${u.back ? `, zurück nach ${u.back} s` : ''}`
      : u.trigger === 'runOver' ? `${(u.who || []).map(a => B[a]?.name || a).join('/')} ${u.count || 1}× drüber` : u.trigger === 'impact' ? `Einschlag ab ${u.minDamage ?? 0} Schaden` : TRIGGER[u.trigger] || u.trigger;
    catalog(w, main, insp, { title: 'Umwandlungen', singular: 'Umwandlung', ic: 'restart', obj: () => U, file, new: () => ({ name: 'Neue Umwandlung', trigger: 'impact', from: ['grass'], to: 'rubble' }),
      hint: 'Ein Mechanismus für alles, was den Boden verändert: Auslöser → von Boden → zu Boden. Läuft in der Simulation, also sehen alle Spieler dieselbe Karte.',
      row: (id, u) => [icon('restart', 16), el('span', { class: 'da-name' }, u.name || id), el('small', { class: 'tk-transf' }, ...(u.from || []).flatMap((v, i) => [i ? ', ' : '', ground(v)]), ' → ', ground(u.to), ` · ${triggerText(u)}`)],
      inspector: u => {
        const set = (k, v) => w.change(file, () => setOrWay(u, k, v));
        insp.append(w.field('Name', u, 'name', 'text', file),
          w.labeled('Auslöser', w.selection(Object.entries(TRIGGER), u.trigger, v => set('trigger', v))));
        if (u.trigger === 'impact') insp.append(w.input('ab Schaden', u.minDamage, 'number', { set: v => set('minDamage', v) }));
        if (u.trigger === 'weather') insp.append(w.labeled('Wetter', w.selection(Object.entries(WE).map(([k, x]) => [k, x.name]), u.weather, v => set('weather', v))),
          w.input('nach (s)', u.after, 'number', { set: v => set('after', v) }), w.input('zurück nach (s)', u.back, 'number', { set: v => set('back', v) }),
          el('p', { class: 'ed-small' }, '„nach“: so lange muss das Wetter anhalten. „zurück nach“: so lange nach dem Ende wird der Boden wieder, was er vorher war (leer = bleibt).'));
        if (u.trigger === 'runOver') insp.append(w.labeled('Wer', w.chips(u.who, Object.entries(B).map(([k, b]) => [k, b.name]), v => set('who', v), '+ Bewegungsart', a => B[a]?.name || a)),
          w.input('Überfahrten', u.count, 'number', { set: v => set('count', v) }));
        insp.append(w.labeled('Von', w.chips(u.from, Object.entries(BO).map(([k, b]) => [k, b.name]), v => set('from', v), '+ Boden', b => BO[b]?.name || b)),
          w.labeled('Zu', w.selection(Object.entries(BO).map(([k, b]) => [k, b.name]), u.to, v => set('to', v))));
      } });
  },

  // ---------- Tag & Nacht ----------
  daytime(w, main, insp) {
    const W = W_(w), file = w.path('world'), T = W.daytime = W.daytime || { phases: [] }, P = T.phases = T.phases || [], S = w.p.data.keywords, total = cycleDuration(W);
    const M = T.muzzleFlash = T.muzzleFlash || {}, L = T.lobby = T.lobby || {};
    main.append(w.head('Tag & Nacht',
      w.button('plus', 'Phase', () => w.change(file, () => { P.push({ id: freeId('phase', new Set(P.map(p => p.id))), name: 'Neue Phase', duration: 60, sight: 100 }); })),
      w.button('export', 'JSON', () => w.jsonDialogue('Tag & Nacht als JSON', T, j => w.change(file, () => { for (const k of Object.keys(T)) delete T[k]; Object.assign(T, j); })))),
      el('p', { class: 'ed-small' }, `Ein voller Tag dauert ${minutes(total)}. Die Phasen laufen der Reihe nach im Kreis. Sicht in Prozent der normalen Sichtweite; wer Nachtsicht hat, sieht immer voll.`),
      el('div', { class: 'tk-timeline' }, ...P.map(p => el('div', { class: 'tk-zseg', style: `flex:${p.duration || 1};--f:${PHASE_COLOR[p.id] || '#888'}`, title: `${p.name}: ${minutes(p.duration)}, Sicht ${p.sight} %` }, el('b', {}, p.name), el('small', {}, `${minutes(p.duration)} · ${p.sight} %`)))),
      el('table', { class: 'tk-table tk-phases' }, el('tr', {}, ...['', 'Name', 'ID', 'Dauer (s)', 'Sicht (%)', ''].map(t => el('th', {}, t))),
        ...P.map((p, i) => {
          const txt = (k, width) => { const e = el('input', { class: 'ed-field', value: p[k] || '', style: `width:${width}px` }); e.addEventListener('change', () => w.change(file, () => { const old = p.id; p[k] = k === 'id' ? e.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() : e.value; if (k === 'id' && L.start === old) L.start = p.id; })); return e; };
          return el('tr', {}, el('td', {}, el('i', { class: 'tk-q', style: `background:${PHASE_COLOR[p.id] || '#888'}` })), el('td', {}, txt('name', 140)), el('td', {}, txt('id', 120)),
            el('td', {}, numberField(p.duration, v => w.change(file, () => { p.duration = v ?? 60; }), { min: 1 })), el('td', {}, numberField(p.sight, v => w.change(file, () => { p.sight = v ?? 100; }), { max: 100 })),
            el('td', { class: 'ed-row' }, el('button', { class: 'ed-button small', title: 'Nach oben', disabled: !i, onclick: () => w.change(file, () => { [P[i - 1], P[i]] = [P[i], P[i - 1]]; }) }, icon('up', 14)),
              el('button', { class: 'ed-button small red', title: 'Entfernen', onclick: () => { w.change(file, () => { P.splice(i, 1); }); w.hint('Gelöscht.', { undo: true }); } }, icon('delete', 14))));
        })));
    insp.append(el('h3', {}, 'Tag & Nacht'),
      w.labeled('Nachtsicht-Stichwort', w.selection(Object.entries(S).map(([k, x]) => [k, x.name]), T.ignores, v => w.change(file, () => setOrWay(T, 'ignores', v)), '—')),
      el('h4', {}, 'Mündungsfeuer'), el('p', { class: 'ed-small' }, 'Wer im Dunkeln schießt, ist kurz von weitem sichtbar.'),
      w.field('sichtbar für (s)', M, 'duration', 'number', file), w.field('sichtbar bis (m)', M, 'visibleOnto', 'number', file),
      el('h4', {}, 'Lobby (Voreinstellung)'),
      w.labeled('Startphase', w.selection(P.map(p => [p.id, p.name]), L.start, v => w.change(file, () => { L.start = v; }))),
      w.field('Zyklus an', L, 'cycle', 'checkbox', file),
      el('p', { class: 'ed-small' }, 'Ohne Zyklus bleibt die Startphase die ganze Partie, z. B. ein reines Nachtgefecht.'));
  },

  // ---------- Wetter ----------
  weather(w, main, insp) {
    const W = W_(w), file = w.path('world'), WE = W.weather = W.weather || {}, B = W.movementTypes || {}, A = W.weatherSequence = W.weatherSequence || {};
    catalog(w, main, insp, { title: 'Wetter', singular: 'Wetter', ic: 'rain', obj: () => WE, file, new: () => ({ name: 'Neues Wetter', symbol: 'cloud', color: '#9aa3ad', sight: 100, speed: 100, duration: [60, 120] }),
      hint: 'Wetter läuft in der Simulation: Jeder erlebt denselben Schauer im selben Takt. Welches Wetter wie oft kommt, legt das Klima der Karte fest.',
      renamed: (a, b) => renameWorld(W, 'weather', a, b), deleted: id => renameWorld(W, 'weather', id, null),
      row: (id, x) => [el('span', { class: 'tk-wsym', style: `--f:${x.color || '#888'}` }, icon(x.symbol || 'cloud', 16)), el('span', { class: 'da-name' }, x.name || id),
        el('small', {}, `Sicht ${x.sight ?? 100} % · Tempo ${x.speed ?? 100} %${(x.blocks || []).length ? ` · sperrt ${x.blocks.map(a => B[a]?.name || a).join(', ')}` : ''} · ${(x.duration || []).join('–')} s`)],
      inspector: (x, id) => {
        const duration = i => numberField(x.duration?.[i], v => w.change(file, () => { const d = [...(x.duration || [60, 120])]; d[i] = v ?? 60; x.duration = d; }), { min: 1, width: 72 });
        insp.append(w.field('Name', x, 'name', 'text', file),
          w.labeled('Symbol', el('div', { class: 'tk-symbols' }, ...WEATHER_SYMBOLS.map(s => el('button', { class: 'ed-button' + (x.symbol === s ? ' on' : ''), title: s, onclick: () => w.change(file, () => { x.symbol = s; }) }, icon(s, 18))))),
          w.field('Farbe', x, 'color', 'color', file), w.field('Sicht (%)', x, 'sight', 'number', file), w.field('Tempo am Boden (%)', x, 'speed', 'number', file),
          w.labeled('Dauer (s)', el('span', { class: 'ed-row' }, duration(0), ' bis ', duration(1))),
          w.labeled('Sperrt', w.chips(x.blocks, Object.entries(B).map(([k, b]) => [k, b.name]), v => w.change(file, () => { if (v.length) x.blocks = v; else delete x.blocks; }), '+ Bewegungsart', a => B[a]?.name || a)),
          w.field('Beschreibung', x, 'description', 'textarea', file),
          el('h4', {}, 'In Klimata'), el('div', { class: 'da-tags' }, ...Object.entries(W.climates || {}).filter(([, k]) => k.weather?.[id] > 0).map(([kid, k]) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'world', sub: 'climates', choice: kid }) }, `${k.name} · ${share(k, id)} %`))));
      } });
    if (w.page.choice) return;
    insp.append(el('h4', {}, 'Wetterbericht'), w.field('Ankündigung vorher (s)', A, 'announce', 'number', file), w.field('Übergang (s)', A, 'transition', 'number', file),
      el('p', { class: 'ed-small' }, 'Der Wetterbericht im Spiel kündigt jeden Wechsel an. Danach blendet das Wetter weich über, nie schlagartig.'));
  },

  // ---------- Climates with preview ----------
  climates(w, main, insp) {
    const W = W_(w), file = w.path('world'), KL = W.climates = W.climates || {}, WE = W.weather || {};
    catalog(w, main, insp, { title: 'Klimata', singular: 'Klima', ic: 'world_icon', obj: () => KL, file, new: () => ({ name: 'Neues Klima', start: 'clear', weather: { clear: 50, rain: 50 } }),
      hint: 'Ein Klima gehört zur Karte (später zum Biom) und legt fest, wie oft welches Wetter kommt. Klima wählen zeigt einen Ablauf zur Probe.',
      row: (id, k) => [icon('world_icon', 16), el('span', { class: 'da-name' }, k.name || id), el('span', { class: 'tk-shares' }, ...Object.entries(k.weather || {}).filter(([, g]) => g > 0).map(([wid]) =>
        el('i', { style: `flex:${share(k, wid)};background:${WE[wid]?.color || '#888'}`, title: `${WE[wid]?.name || wid} ${share(k, wid)} %` })))],
      inspector: k => insp.append(w.field('Name', k, 'name', 'text', file),
        w.labeled('Startwetter', w.selection(Object.entries(WE).map(([x, y]) => [x, y.name]), k.start || '', v => w.change(file, () => setOrWay(k, 'start', v)), 'zufällig')),
        el('h4', {}, 'Gewichte'), el('p', { class: 'ed-small' }, 'Je größer die Zahl, desto häufiger. Daneben der Anteil.'),
        ...Object.entries(WE).map(([wid, x]) => w.labeled(x.name, el('span', { class: 'ed-row' }, numberField(k.weather?.[wid], v => w.change(file, () => { k.weather = k.weather || {}; setOrWay(k.weather, wid, v || undefined); }), { width: 72 }), el('small', { class: 'ed-small' }, k.weather?.[wid] ? ` ${share(k, wid)} %` : ''))))) });
    const kid = w.page.choice, k = KL[kid];
    if (!k) return;
    w.weatherSeed = w.weatherSeed || 1;
    const duration = 1800, plan = weatherPlan(W, kid, w.weatherSeed, duration), P = W.daytime?.phases || [], cyc = cycleDuration(W);
    const days = []; if (cyc) for (let s = 0; s < duration;) { const ph = phaseUm(W, s); const d = Math.min(ph.rest, duration - s); days.push([ph, d]); s += d; }
    main.append(el('h3', {}, `Probe: 30 Minuten ${k.name}`),
      el('div', { class: 'ed-row' }, el('span', { class: 'ed-small' }, 'Startwert'), numberField(w.weatherSeed, v => { w.weatherSeed = v || 1; w.draw(); }, { min: 1, width: 88 }),
        w.button('cube', 'Würfeln', () => { w.weatherSeed = 1 + ((w.weatherSeed * 48271) % 2147483646); w.draw(); })),
      el('div', { class: 'tk-timeline tk-weatherBar' }, ...plan.map(x => { const d = Math.min(x.until, duration) - x.min, y = WE[x.weather] || {};
        return el('div', { class: 'tk-zseg', style: `flex:${d};--f:${y.color || '#888'}`, title: `${minutes(x.min)}–${minutes(Math.min(x.until, duration))}: ${y.name}${x.announcement != null ? ` (angesagt ab ${minutes(x.announcement)})` : ''}` }, icon(y.symbol || 'cloud', 14), d >= 90 ? el('small', {}, y.name) : null); })),
      days.length ? el('div', { class: 'tk-timeline tk-dayBar' }, ...days.map(([ph, d]) => el('div', { class: 'tk-zseg', style: `flex:${d};--f:${PHASE_COLOR[ph.id] || '#888'}`, title: `${ph.name} · Sicht ${ph.sight} %` }, d >= 120 ? el('small', {}, ph.name) : null))) : null,
      el('div', { class: 'tk-axis' }, ...[0, 5, 10, 15, 20, 25, 30].map(m => el('span', { style: `left:${m / 30 * 100}%` }, `${m}′`))),
      el('p', { class: 'ed-small' }, `${plan.length} Wechsel. Oben das Wetter, darunter Tag und Nacht. Gleicher Startwert = gleicher Ablauf auf jedem Gerät.`));
  },
};

function share(k, wid) { const s = Object.values(k.weather || {}).reduce((a, g) => a + (g > 0 ? g : 0), 0); return s ? Math.round((k.weather[wid] || 0) / s * 100) : 0; }
function hitsUnits(w, bid) {
  const W = W_(w), r = [];
  for (const [fid, f] of w.p.factions) for (const [uid, u] of Object.entries(effective(f, null).units || {})) if (movementTypes(W, u).includes(bid)) r.push({ fid, uid, name: u.name || uid });
  return r;
}
function keywordChips(w, list, for_, onChange) {
  const S = w.p.data.keywords;
  return w.chips(list, Object.entries(S).filter(([, x]) => !x.for || x.for.includes(for_)).map(([k, x]) => [k, x.name]), onChange, '+ Stichwort', k => S[k]?.name || k);
}
