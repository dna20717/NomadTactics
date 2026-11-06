// Workshop pages SPIELREGELN › Verhalten (06.11.): how units behave without orders.
// Three sub pages: „So denkt eine Einheit“ (the rules in order, which unit uses which profile),
// Haltungen (stances the player switches in the HUD) and Profile (target weights, cover, retreat, crushing).
// Rules and maths live in engine/tactics/behavior.js, the simulation in engine/tactics/battle.js.
import { icon } from '../icons.js';
import { el } from '../ui.js';
import { WEIGHTS, WEIGHT_KEYS, FIRE, behaviorOf, profileIdOf, targetParts, targetScore, renameBehavior } from '../../engine/tactics/behavior.js';
import { catalog } from './pages.js';

const B_ = (w) => (w.p.data.behavior = w.p.data.behavior || { standardStance: 'aggressive', stances: {}, profiles: {} });
export const BEHAVIOR_SUBS = [['guide', 'So denkt eine Einheit'], ['stances', 'Haltungen'], ['profiles', 'Profile']];
const STANCE_ICONS = ['flash', 'auge', 'lock', 'muted', 'heart', 'flag', 'target', 'weapon', 'armor', 'stop', 'skull', 'star'];
// every unit of every faction with its profile (generals not included: they change it on their layer)
const allUnits = (w) => [...w.p.factions.values()].flatMap((f) => Object.entries(f.units || {}).filter(([, u]) => !(u.class === 'air' && !u.keywords?.companion)).map(([id, u]) => ({ f, id, u })));
const setOrWay = (o, k, v) => { if (v === undefined || v === '' || v === null) delete o[k]; else o[k] = v; };

export function behaviorPage(w, main, insp) {
  const sub = w.page.sub || 'guide';
  if (sub === 'stances') return stancesPage(w, main, insp);
  if (sub === 'profiles') return profilesPage(w, main, insp);
  return guidePage(w, main, insp);
}

// ---------- „So denkt eine Einheit“ ----------
function guidePage(w, main, insp) {
  const B = B_(w), file = w.path('behavior'), S = B.stances || {}, P = B.profiles || {};
  const std = S[B.standardStance];
  const step = (n, ic, title, text, link) => el('div', { class: 'tk-mind-step' },
    el('span', { class: 'tk-mind-n' }, String(n)), el('span', { class: 'tk-mind-ic' }, icon(ic, 18)),
    el('div', {}, el('b', {}, title), el('p', { class: 'ed-small' }, text), link || null));
  const go = (sub, text) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'behavior', sub }) }, icon('arrow_right', 12), ' ' + text);
  main.append(w.head('So denkt eine Einheit'),
    el('p', { class: 'ed-small' }, 'Jede Einheit prüft in jedem Takt diese Schritte von oben nach unten. Alles läuft in der Simulation, also auf allen Geräten gleich. Was eine Einheit von selbst tut, steht in ihrem Profil; wie weit sie dabei gehen darf, sagt die Haltung, die du im Spiel umschaltest.'),
    el('div', { class: 'tk-mind' },
      step(1, 'flag', 'Dein Befehl zuerst', 'Fahren, Angreifen und Halt schlagen immer die Eigenmacht. Eine Einheit mit Fahrbefehl schießt unterwegs nur, was in Reichweite kommt, und fährt weiter. Ein Befehl bricht auch Ausweichen ab.'),
      step(2, 'heart', 'Rückzug (nur Haltung „Vorsichtig“)', 'Fällt das Leben unter die Rückzugs-Schwelle des Profils, fährt die Einheit einmal zum eigenen Landeplatz zurück. Der Funk meldet „Rückzug.“'),
      step(3, 'flash', 'Ausweichen', 'Infanterie mit „Weicht Walzen aus“ springt zur Seite, wenn ein walzendes Fahrzeug direkt auf sie zufährt (nach der Reaktionszeit). Mit „Weicht Artillerie aus“ läuft die Einheit aus der Einschlagstelle von Granaten und Raketen, die auf einen Punkt fliegen. „Stellung halten“ weicht nie aus.'),
      step(4, 'target', 'Ziel wählen', 'Alle Feinde in Sicht bekommen Punkte: Konter, Gefahr, Fast tot, Nähe und Gebäude, jeweils 0–100, mal dem Gewicht im Profil. Der höchste gewinnt. Ein Ziel wird gehalten, solange es in Reichweite bleibt; alle 2 s schaut die Einheit neu und wechselt nur zu einem deutlich besseren (über 10 % mehr Punkte).', go('profiles', 'Profile und Durchrechnen')),
      step(5, 'tree', 'Deckung', 'Infanterie mit „Sucht Deckung“ läuft beim ersten Feindkontakt in die nächste Zelle mit Deckung (Wald, Schutt) im Umkreis und bleibt dort, statt hinterherzulaufen.'),
      step(6, 'auge', 'Verfolgen und zurückkehren', 'Ist das Ziel außer Reichweite, verfolgt die Einheit es bis „Sichtweite × Verfolgen %“ der Haltung, gemessen vom eigenen Platz. Haltungen mit „Kehrt zurück“ fahren danach auf ihren Platz zurück, die anderen bleiben, wo der Kampf endete.', go('stances', 'Haltungen')),
      step(7, 'vehicle', 'Walzen', 'Fahrzeuge mit „Walzt Infanterie“ fahren feindliche Infanterie gezielt an statt in Waffenreichweite stehen zu bleiben, und wer unter die Ketten kommt, ist platt (wie bei Generals).'),
      step(8, 'muted', 'Feuer', 'Haltungen mit „nur auf Befehl“ schießen nie von selbst, auch nicht zurück. Gut für Hinterhalte.')));
  // who uses what
  const rows = allUnits(w).map(({ f, id, u }) => {
    const b = behaviorOf(B, u), pid = profileIdOf(B, u);
    return el('tr', {},
      el('td', {}, el('i', { class: 'da-color rounded tk-fpoint', style: `background:${f.color || '#888'}` }), ' ', f.name),
      el('td', {}, el('button', { class: 'tk-linkish', onclick: () => w.go({ area: 'faction', faction: f.id, sub: 'units', choice: id }) }, u.name || id)),
      el('td', {}, pid ? el('button', { class: 'tk-linkish', onclick: () => w.go({ area: 'behavior', sub: 'profiles', choice: pid }) }, P[pid]?.name || pid) : '–', u.behavior ? '' : el('small', { class: 'tk-std' }, ' (nach Klasse)')),
      el('td', {}, S[b.stance]?.name || b.stance, u.behaviorOver?.stance ? el('small', {}, ' (eigene)') : ''));
  });
  main.append(el('h3', { class: 'tk-spacing' }, 'Wer nutzt welches Profil'),
    el('table', { class: 'tk-table tk-who' }, el('tr', {}, el('th', {}, 'Fraktion'), el('th', {}, 'Einheit'), el('th', {}, 'Profil'), el('th', {}, 'Haltung zu Beginn')), ...rows));
  insp.append(el('h3', {}, 'Standard'),
    el('p', { class: 'ed-small' }, 'Die Haltung, mit der neue Einheiten aufs Feld kommen, wenn ihr Profil nichts anderes sagt. Daniel 06.11.: Aggressiv wie bei Generals.'),
    w.labeled('Standard-Haltung', w.selection(Object.entries(S).map(([k, s]) => [k, s.name || k]), B.standardStance || '', (v) => w.change(file, () => { B.standardStance = v; }))),
    std ? el('p', { class: 'ed-small' }, std.description || '') : null,
    el('h4', {}, 'Wo wird das eingestellt?'),
    el('p', { class: 'ed-small' }, 'Profile und Haltungen hier. Jede Einheit wählt ihr Profil im Einheiten-Inspektor (Abschnitt Verhalten) und darf dort eine eigene Haltung zu Beginn haben. Generäle ändern beides über ihre Ebene. Ohne Profil nimmt die Einheit eins nach ihrer Klasse: Infanterie → Infanterie, Flieger → Drohne, Fahrzeuge mit Aufbauen → Artillerie, sonst Panzer.'));
}

// ---------- Haltungen ----------
function stancesPage(w, main, insp) {
  const B = B_(w), file = w.path('behavior'), S = (B.stances = B.stances || {});
  catalog(w, main, insp, { title: 'Haltungen', singular: 'Haltung', ic: 'flag', obj: () => S, file,
    new: () => ({ name: 'Neue Haltung', symbol: 'flag', description: '', chase: 100, returns: true, fire: 'free' }),
    hint: 'Haltungen schaltest du im Spiel für die gewählten Einheiten um (Befehlsleiste, zweite Reihe A S D F Z, und im Kreismenü). Sie sagen, wie weit eine Einheit ohne Befehl gehen darf: verfolgen, zurückkehren, schießen, sich zurückziehen, ausweichen. Die ersten fünf Haltungen bekommen Tasten.',
    aheadList: () => el('p', { class: 'ed-small' }, 'Reihenfolge = Tasten A, S, D, F, Z im Spiel. ★ = Standard für neue Einheiten.'),
    row: (id, s) => [icon(s.symbol || 'flag', 16), el('span', { class: 'da-name' }, (B.standardStance === id ? '★ ' : '') + (s.name || id)),
      el('small', {}, [s.chase ? `verfolgt ${s.chase} %` : 'bleibt stehen', s.returns ? 'kehrt zurück' : null, s.fire === 'order' ? 'Feuer nur auf Befehl' : null, s.retreat ? 'Rückzug' : null, s.dodges === false ? 'weicht nie aus' : null].filter(Boolean).join(' · '))],
    renamed: (old, neu) => { renameBehavior(w.p, 'stance', old, neu); for (const f of w.p.factionPaths.values()) w.changed(f); },
    deleted: (id) => { renameBehavior(w.p, 'stance', id, null); for (const f of w.p.factionPaths.values()) w.changed(f); },
    inspector: (s, id) => {
      const set = (k, v) => w.change(file, () => setOrWay(s, k, v));
      insp.append(w.field('Name', s, 'name', 'text', file), w.field('Kurzwort', s, 'short', 'text', file),
        el('p', { class: 'ed-small' }, 'Steht auf dem Knopf in der Befehlsleiste (dort ist wenig Platz).'),
        w.labeled('Symbol', el('div', { class: 'tk-icons' }, ...STANCE_ICONS.map((ic) => el('button', { class: 'ed-button small' + (s.symbol === ic ? ' on' : ''), title: ic, onclick: () => set('symbol', ic) }, icon(ic, 14))))),
        w.field('Beschreibung', s, 'description', 'textarea', file),
        el('p', { class: 'ed-small' }, 'Die Beschreibung erscheint im Spiel als Tooltip am Knopf.'),
        el('h4', {}, 'Verfolgen'),
        w.input('Verfolgen (% der Sicht)', s.chase, 'number', { set: (v) => set('chase', v == null ? undefined : Math.max(0, Math.min(1000, Math.round(v)))), live: (v) => { s.chase = Math.max(0, Math.min(1000, Math.round(v))); w.changed(file); } }),
        el('p', { class: 'ed-small' }, 'Wie weit die Einheit einem Feind hinterherfährt, gemessen von ihrem Platz: 100 % = eine Sichtweite, 0 = bleibt stehen und schießt nur, was in Reichweite kommt.'),
        w.input('Kehrt zurück', s.returns, 'checkbox', { set: (v) => set('returns', v || undefined) }),
        el('p', { class: 'ed-small' }, 'An: nach dem Kampf zurück auf den eigenen Platz. Aus: bleibt dort, wo der Kampf endete (der neue Platz).'),
        el('h4', {}, 'Feuer, Rückzug, Ausweichen'),
        w.labeled('Feuer', w.selection(Object.entries(FIRE), s.fire || 'free', (v) => set('fire', v))),
        w.input('Rückzug', s.retreat, 'checkbox', { set: (v) => set('retreat', v || undefined) }),
        el('p', { class: 'ed-small' }, 'An: unter der Rückzugs-Schwelle des Profils fährt die Einheit zum Landeplatz (einmal).'),
        w.input('Weicht aus', s.dodges !== false, 'checkbox', { set: (v) => set('dodges', v ? undefined : false) }),
        el('p', { class: 'ed-small' }, 'Aus: die Einheit rührt sich nicht, auch nicht vor Panzern oder Artillerie („Stellung halten“).'),
        B.standardStance === id ? el('p', { class: 'ed-small' }, '★ Standard für neue Einheiten.') : w.button('star', 'Als Standard', () => w.change(file, () => { B.standardStance = id; })));
    } });
}

// ---------- Profile ----------
function profilesPage(w, main, insp) {
  const B = B_(w), file = w.path('behavior'), P = (B.profiles = B.profiles || {}), S = B.stances || {};
  const users = (id) => allUnits(w).filter(({ u }) => profileIdOf(B, u) === id);
  catalog(w, main, insp, { title: 'Profile', singular: 'Profil', ic: 'brain', obj: () => P, file,
    new: () => ({ name: 'Neues Profil', weights: { counter: 30, threat: 30, finish: 20, near: 30, buildings: -40 }, retreatAt: 30 }),
    hint: 'Ein Profil ist der Charakter einer Einheit ohne Befehl: worauf sie zuerst schießt (Gewichte), ob sie Deckung sucht, wann sie sich zurückzieht, ob sie Infanterie walzt oder ausweicht. Jede Einheit wählt ein Profil; neue Einheiten brauchen also keinen eigenen Code.',
    row: (id, x) => [icon('brain', 16), el('span', { class: 'da-name' }, x.name || id), el('small', {}, `${users(id).length} Einheiten · ${weightText(x.weights)}`)],
    renamed: (old, neu) => { renameBehavior(w.p, 'profile', old, neu); for (const f of w.p.factionPaths.values()) w.changed(f); },
    deleted: (id) => { renameBehavior(w.p, 'profile', id, null); for (const f of w.p.factionPaths.values()) w.changed(f); },
    inspector: (x, id) => {
      const set = (k, v) => w.change(file, () => setOrWay(x, k, v));
      const sub = (k, f, v) => w.change(file, () => { x[k] = { ...(x[k] || {}) }; setOrWay(x[k], f, v); if (!Object.keys(x[k]).length) delete x[k]; });
      const num = (label, v, apply, min, max, help) => [w.input(label, v, 'number', { set: (n) => apply(n == null ? undefined : Math.max(min, Math.min(max, Math.round(n)))), live: (n) => { apply(Math.max(min, Math.min(max, Math.round(n)))); } }), help ? el('p', { class: 'ed-small' }, help) : null];
      insp.append(w.field('Name', x, 'name', 'text', file), w.field('Beschreibung', x, 'description', 'textarea', file),
        w.labeled('Haltung zu Beginn', w.selection(Object.entries(S).map(([k, s]) => [k, s.name || k]), x.stance || '', (v) => set('stance', v || undefined), `— Standard (${S[B.standardStance]?.name || B.standardStance}) —`)),
        el('h4', {}, icon('target', 13), ' Zielwahl'),
        el('p', { class: 'ed-small' }, 'Jedes Ziel bekommt je Merkmal 0–100 Punkte, mal Gewicht (−100 bis 100). Der höchste Gesamtwert gewinnt. Negativ = meiden. Links im Durchrechnen siehst du sofort, wen die Einheit zuerst nimmt.'));
      for (const k of WEIGHT_KEYS) {
        const f = w.input(WEIGHTS[k].name, x.weights?.[k], 'number', {
          set: (v) => w.change(file, () => { x.weights = { ...(x.weights || {}) }; setOrWay(x.weights, k, v == null ? undefined : Math.max(-100, Math.min(100, Math.round(v)))); }),
          live: (v) => { x.weights = x.weights || {}; x.weights[k] = Math.max(-100, Math.min(100, Math.round(v))); w.changed(file); },
        });
        f.title = WEIGHTS[k].text;
        insp.append(f, el('p', { class: 'ed-small tk-weight-help' }, WEIGHTS[k].text));
      }
      insp.append(el('h4', {}, icon('heart', 13), ' Rückzug'),
        ...num('Rückzug ab (% Leben)', x.retreatAt, (v) => set('retreatAt', v), 0, 100, 'Gilt nur in Haltungen mit Rückzug (z. B. „Vorsichtig“).'),
        el('h4', {}, icon('tree', 13), ' Deckung'),
        w.input('Sucht Deckung', !!x.cover?.seek, 'checkbox', { set: (v) => sub('cover', 'seek', v || undefined) }),
        ...num('Umkreis (m)', x.cover?.radius, (v) => sub('cover', 'radius', v), 0, 60, 'So weit läuft die Einheit beim ersten Feindkontakt höchstens in Deckung (Böden mit Deckung, WELT › Bodenarten).'),
        el('h4', {}, icon('vehicle', 13), ' Walzen und Ausweichen'),
        w.input('Walzt Infanterie', !!x.crush?.crushes, 'checkbox', { set: (v) => sub('crush', 'crushes', v || undefined) }),
        el('p', { class: 'ed-small' }, 'Fährt feindliche Infanterie gezielt an und überfährt sie. Nur für Fahrzeuge.'),
        w.input('Weicht Walzen aus', !!x.crush?.dodges, 'checkbox', { set: (v) => sub('crush', 'dodges', v || undefined) }),
        ...num('Reaktionszeit (ms)', x.crush?.reaction, (v) => sub('crush', 'reaction', v), 0, 5000, 'So lange dauert es, bis die Einheit einen heranrollenden Panzer bemerkt. Kürzer = springt öfter rechtzeitig zur Seite.'),
        w.input('Weicht Artillerie aus', !!x.dodgeArtillery, 'checkbox', { set: (v) => set('dodgeArtillery', v || undefined) }),
        el('p', { class: 'ed-small' }, 'Läuft aus dem Wirkungskreis von Granaten und Raketen, die auf einen Punkt fliegen (gelenkte Geschosse treffen trotzdem).'));
      const u = users(id);
      insp.append(el('h4', {}, `Einheiten mit diesem Profil (${u.length})`),
        el('div', { class: 'da-tags' }, ...u.map(({ f, id: uid, u: x2 }) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'faction', faction: f.id, sub: 'units', choice: uid }) }, icon('vehicle', 12), ` ${x2.name || uid} (${f.name})`))));
      // „Durchrechnen“ below the list
      main.append(probe(w, id));
    } });
}
const weightText = (W = {}) => WEIGHT_KEYS.filter((k) => W[k]).map((k) => `${WEIGHTS[k].name} ${W[k]}`).join(', ') || 'keine Gewichte';

// ---------- Durchrechnen: who would this unit shoot first? ----------
// One shooter (a unit with this profile), four enemies with distance, health and „shoots at me“. Same maths as the simulation.
const probeState = new Map();   // profile → { shooter, rows } (kept while the workshop is open)
function probe(w, pid) {
  const B = B_(w), K = w.p.data.combat || {}, Wd = w.p.data.weapons || {};
  const units = allUnits(w), mine = units.filter(({ u }) => profileIdOf(B, u) === pid && (u.weapons || []).length);
  const box = el('div', { class: 'tk-probe' }, el('h3', { class: 'tk-spacing' }, icon('target', 16), ' Durchrechnen'));
  if (!mine.length) { box.append(el('p', { class: 'ed-small' }, 'Keine bewaffnete Einheit nutzt dieses Profil. Wähle das Profil bei einer Einheit (Einheiten-Inspektor › Verhalten), dann kannst du hier durchrechnen.')); return box; }
  const key = (x) => `${x.f.id}/${x.id}`, byKey = new Map(units.map((x) => [key(x), x]));
  if (!probeState.has(pid)) {
    const me = mine[0], foes = units.filter((x) => x.f.id !== me.f.id && (x.u.weapons || []).length && x.u.class !== 'air');
    const pick = (cls, i = 0) => foes.filter(({ u }) => (cls === 'vehicle' ? u.class !== 'infantry' && u.class !== 'air' : u.class === cls))[i] || foes[0];
    probeState.set(pid, { shooter: key(me), rows: [
      { unit: key(pick('vehicle')), distance: 22, hp: 100, shoots: false },
      { unit: key(pick('infantry')), distance: 9, hp: 100, shoots: true },
      { unit: key(pick('vehicle', 1)), distance: 16, hp: 40, shoots: false },
      { unit: 'pad', distance: 18, hp: 100, shoots: false },
    ].filter((r) => r.unit) });
  }
  const st = probeState.get(pid), redraw = () => { box.replaceWith(probe(w, pid)); };
  const me = byKey.get(st.shooter) || mine[0];
  const myB = behaviorOf(B, me.u), wpn = Wd[(me.u.weapons || [])[0]] || {}, reach = (me.u.sight || 20) * 1000;
  const factor = (dt, ar) => Math.round((K.table?.[dt]?.[ar] ?? 1) * 100);
  const results = st.rows.map((r) => {
    const pad = r.unit === 'pad', t = pad ? { name: 'Landeplatz', armor: 'building', class: 'building' } : byKey.get(r.unit)?.u;
    if (!t) return null;
    const tw = pad ? null : Wd[(t.weapons || [])[0]];
    const parts = targetParts({ myFactor: factor(wpn.damageType, t.armor), itsFactor: tw ? factor(tw.damageType, me.u.armor) : 0, shootsMe: !!r.shoots && !!tw,
      hpPct: r.hp, distance: Math.round(r.distance * 1000), reach, building: pad });
    return { r, t, parts, score: targetScore(myB.weights, parts), inSight: r.distance <= reach / 1000, canHit: (wpn.targets || ['ground']).includes(t.class === 'air' ? 'air' : 'ground') };
  }).filter(Boolean);
  const best = results.filter((x) => x.inSight && x.canHit).sort((a, b) => b.score - a.score || a.r.distance - b.r.distance)[0];
  const unitOptions = units.map((x) => [key(x), `${x.u.name || x.id} (${x.f.name})`]);
  const numIn = (v, apply, step = 1) => { const i = el('input', { type: 'number', class: 'ed-field small', value: v, step, style: 'width:64px' }); i.addEventListener('change', () => { apply(+i.value); redraw(); }); return i; };
  box.append(el('p', { class: 'ed-small' }, `Wen nimmt die Einheit zuerst? Gleiche Rechnung wie im Spiel. Sichtweite ${reach / 1000} m, Waffe ${wpn.name || '–'}.`),
    w.labeled('Schütze', w.selection(mine.map((x) => [key(x), `${x.u.name || x.id} (${x.f.name})`]), key(me), (v) => { st.shooter = v; redraw(); })),
    el('div', { class: 'tk-probe-scroll' }, el('table', { class: 'tk-table tk-probe-table' },
      el('tr', {}, el('th', {}, 'Feind'), el('th', {}, 'Abstand', el('small', {}, 'm')), el('th', {}, 'Leben', el('small', {}, '%')), el('th', { title: 'Schießt gerade auf mich' }, 'Schießt', el('small', {}, 'auf mich')),
        ...WEIGHT_KEYS.map((k) => el('th', { title: WEIGHTS[k].text, class: 'tk-num' }, WEIGHTS[k].name, el('small', {}, `× ${myB.weights[k]}`))), el('th', { class: 'tk-num' }, 'Punkte'), el('th', {})),
      ...results.map((x, i) => el('tr', { class: x === best ? 'tk-best' : !x.inSight || !x.canHit ? 'tk-dim' : '' },
        el('td', {}, x.r.unit === 'pad' ? 'Landeplatz' : w.selection(unitOptions, x.r.unit, (v) => { st.rows[i].unit = v; redraw(); })),
        el('td', {}, numIn(x.r.distance, (v) => { st.rows[i].distance = Math.max(0, v); })),
        el('td', {}, numIn(x.r.hp, (v) => { st.rows[i].hp = Math.max(1, Math.min(100, v)); })),
        el('td', {}, (() => { const c = el('input', { type: 'checkbox', checked: !!x.r.shoots }); c.addEventListener('change', () => { st.rows[i].shoots = c.checked; redraw(); }); return c; })()),
        ...WEIGHT_KEYS.map((k) => el('td', { class: 'tk-num' }, String(x.parts[k]))),
        el('td', { class: 'tk-num' }, el('b', {}, String(x.score))),
        el('td', {}, x === best ? el('span', { class: 'tk-pill', title: 'Dieses Ziel nimmt die Einheit zuerst' }, icon('target', 12)) : !x.inSight ? el('small', {}, 'außer Sicht') : !x.canHit ? el('small', {}, 'Waffe trifft nicht') : ''))))),
    el('p', { class: 'ed-small' }, 'Zahlen in den Spalten: Merkmal 0–100. Punkte = Summe aus Merkmal × Gewicht. Gewichte rechts im Inspektor ziehen und zusehen, wie sich das Ziel ändert.'));
  return box;
}

// ---------- unit inspector › Verhalten ----------
export function behaviorSection(w, x, B) {
  const D = B_(w), P = D.profiles || {}, S = D.stances || {}, b = behaviorOf(D, x), pid = profileIdOf(D, x);
  return [el('h4', {}, 'Verhalten'),
    B('Profil', 'behavior', (v, s) => w.selection(Object.entries(P).map(([k, p]) => [k, p.name || k]), v || '', (n) => s(n || undefined), `— nach Klasse (${P[pid]?.name || pid || '–'}) —`)),
    B('Haltung zu Beginn', 'behaviorOver', (v, s) => w.selection(Object.entries(S).map(([k, st]) => [k, st.name || k]), v?.stance || '', (n) => {
      const o = { ...(v || {}) }; if (n) o.stance = n; else delete o.stance; s(Object.keys(o).length ? o : undefined);
    }, `— wie Profil (${S[b.stance]?.name || b.stance}) —`)),
    el('p', { class: 'ed-small' }, `Zielwahl: ${weightText(b.weights)}.${b.cover.seek ? ' Sucht Deckung.' : ''}${b.crush.crushes ? ' Walzt Infanterie.' : ''}${b.crush.dodges ? ' Weicht Walzen aus.' : ''}${b.dodgeArtillery ? ' Weicht Artillerie aus.' : ''}`),
    pid ? el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'behavior', sub: 'profiles', choice: pid }) }, icon('brain', 12), ' Profil öffnen und durchrechnen') : null].filter(Boolean);
}
