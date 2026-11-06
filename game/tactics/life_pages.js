// Workshop page SPIELREGELN › Lebendigkeit (Fidelity step 2, 06.11.): profiles that make units and buildings
// come alive in the 3D view (suspension, recoil, dust, damage stages). Models pick a profile and their voxel size.
import { icon } from '../icons.js';
import { el } from '../ui.js';
import { DRIVES, LIFE_GROUPS, STAGE_FIELDS, LIFE_NONE, renameLife } from '../../engine/tactics/life.js';
import { catalog } from './pages.js';

const L_ = (w) => (w.p.data.life = w.p.data.life || { profiles: {} });
const users = (w, id) => Object.entries(w.p.data.models || {}).filter(([, m]) => m.life === id);

export function lifePage(w, main, insp) {
  const file = w.path('life'), L = L_(w), P = (L.profiles = L.profiles || {}), modelsFile = w.path('models');
  catalog(w, main, insp, { title: 'Lebendigkeit', singular: 'Profil', ic: 'particles', obj: () => P, file,
    new: () => ({ name: 'Neues Profil', ...structuredClone(LIFE_NONE), drive: 'track' }),
    hint: 'Ein Profil sagt, wie lebendig ein Modell wirkt: Federung und Gelände, Rückstoß und Mündungsfeuer, Staub und Abgas, Schadensstufen. Jedes Modell (SPIELREGELN › Modelle) wählt ein Profil – so bekommen alle künftigen Einheiten und Gebäude dasselbe Verhalten, ohne eigenen Code. Nur Optik, die Simulation sieht nichts davon. Im Launcher schaltet der Knopf mit dem Laster alt/neu.',
    row: (id, x) => [icon('particles', 16), el('span', { class: 'da-name' }, x.name || id), el('small', {}, `${DRIVES[x.drive] || '–'} · ${users(w, id).length} Modelle`)],
    renamed: (old, neu) => { renameLife(w.p, old, neu); w.changed(modelsFile); },
    deleted: (id) => { renameLife(w.p, id, null); w.changed(modelsFile); },
    inspector: (x, id) => {
      insp.append(w.field('Name', x, 'name', 'text', file), w.field('Beschreibung', x, 'description', 'textarea', file),
        w.labeled('Antrieb', w.selection(Object.entries(DRIVES), x.drive || 'none', (v) => w.change(file, () => { x.drive = v; }))));
      for (const g of LIFE_GROUPS) {
        insp.append(el('h4', {}, icon(g.icon, 13), ' ', g.name));
        for (const [k, label, min, max, , unit, help] of g.fields) {
          const f = w.input(`${label}${unit ? ` (${unit})` : ''}`, x[k], 'number', {
            set: (v) => w.change(file, () => { if (v == null) delete x[k]; else x[k] = Math.max(min, Math.min(max, v)); }),
            live: (v) => { x[k] = Math.max(min, Math.min(max, Math.round(v * 10) / 10)); w.changed(file); },
          });
          if (help) f.title = help;
          insp.append(f);
        }
      }
      insp.append(el('h4', {}, icon('warning', 13), ' Schadensstufen'),
        el('p', { class: 'ed-small' }, 'Von leicht nach schwer. Fällt das Leben unter den Wert, fehlen Würfel, Ruß färbt das Modell, Rauch und Feuer steigen auf (je Sekunde). Das Wrack zeigt die schwerste Stufe.'),
        stagesTable(w, x, file));
      const u = users(w, id);
      insp.append(el('h4', {}, `Modelle mit diesem Profil (${u.length})`),
        el('div', { class: 'da-tags' }, ...u.map(([mid, m]) => el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'models', choice: mid }) }, icon('cube', 12), ' ' + (m.name || mid)))));
    } });
}

function stagesTable(w, x, file) {
  const S = (x.stages = x.stages || []);
  const cell = (s, [k, , min, max]) => {
    const inp = el('input', { type: 'number', class: 'ed-field small', value: s[k] ?? '', min, max, step: 'any', style: 'width:58px' });
    inp.addEventListener('change', () => w.change(file, () => { const v = inp.value === '' ? 0 : Math.max(min, Math.min(max, +inp.value)); s[k] = v; }));
    return el('td', {}, inp);
  };
  return el('div', {},
    el('table', { class: 'tk-table tk-stages' },
      el('tr', {}, ...STAGE_FIELDS.map(([, label, , , , unit]) => el('th', {}, `${label}${unit ? ` ${unit}` : ''}`)), el('th', {})),
      ...S.map((s, i) => el('tr', {}, ...STAGE_FIELDS.map((f) => cell(s, f)),
        el('td', {}, el('button', { class: 'ed-button small red', title: 'Stufe löschen', onclick: () => w.change(file, () => { S.splice(i, 1); }) }, icon('x', 12)))))),
    el('button', { class: 'ed-button wide', onclick: () => w.change(file, () => {
      const last = S[S.length - 1];
      S.push(last ? { below: Math.max(1, Math.round(last.below / 2)), missing: Math.min(40, (last.missing || 0) + 5), soot: Math.min(100, (last.soot || 0) + 25), smoke: Math.min(10, (last.smoke || 0) + 2), fire: last.fire || 0 }
        : { below: 70, missing: 3, soot: 30, smoke: 0, fire: 0 });
    }) }, icon('plus', 14), ' Stufe'));
}

// Fields in the model inspector: voxel size (Daniel 05.11.: „Voxel-Maßstab je Modell wählbar“) and the profile
export function modelLifeFields(w, x, file) {
  const P = L_(w).profiles || {};
  return [
    w.input('Voxel-Größe (m)', x.scale, 'number', { set: (v) => w.change(file, () => { if (v == null || v <= 0) delete x.scale; else x.scale = Math.max(0.05, Math.min(2, v)); }) }),
    el('p', { class: 'ed-small' }, `Leer = Standard (${w.p.def.voxel ?? 0.4} m wie das Gelände). Kleiner = feinere Modelle; ein 10 Würfel langer Panzer braucht 0,8 m, um so groß wie der Kampfpanzer zu sein.`),
    w.labeled('Lebendigkeit', w.selection(Object.entries(P).map(([k, p]) => [k, p.name || k]), x.life || '', (v) => w.change(file, () => { if (v) x.life = v; else delete x.life; }), '— steht still —')),
    x.life && P[x.life] ? el('button', { class: 'da-tag tk-leap', onclick: () => w.go({ area: 'life', choice: x.life }) }, icon('particles', 12), ' Profil öffnen') : null,
  ].filter(Boolean);
}
