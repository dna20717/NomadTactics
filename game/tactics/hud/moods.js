// NomadTactics – HUD moods as design tokens.
// Each mood is a set of CSS variables (--hud-*). The same format will later move into the workshop as data
// (style guide configurable, nations/generals can inherit accents).

export const FONTS = 'https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Share+Tech+Mono&family=Special+Elite&family=Archivo+Narrow:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap';

export const MOODS = {
  terminal: {
    name: 'Militär-Konsole',
    tokens: {
      bg: 'rgba(14, 19, 12, 0.9)', bg2: 'rgba(30, 38, 24, 0.95)', head: 'rgba(36, 46, 28, 0.96)',
      border: '#4f5d3a', borderStrong: '#7c8f55', text: '#d6e2bd', text2: '#8f9c76', text3: '#5f6b4c',
      acc: '#f2b230', accText: '#1b1405', accSoft: 'rgba(242, 178, 48, 0.18)',
      good: '#86e05c', warn: '#f2c230', hostile: '#ff5a3c', info: '#6ad0ff',
      selection: '#9cff6a', selectionBorder: '#0d1a07',
      radius: '2px', radiusSmall: '1px', font: '"Share Tech Mono", ui-monospace, monospace', titleFont: '"Black Ops One", "Share Tech Mono", sans-serif',
      titleBig: 'uppercase', titleSpacing: '0.14em', shadow: '0 0 0 1px rgba(124,143,85,.35), 0 6px 18px rgba(0,0,0,.45)',
      texture: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)', blur: '0px',
      titleBg: 'transparent', titleSpin: '0deg', buttonBorder: '1px solid #4f5d3a',
    },
  },
  workbench: {
    name: 'Modellbau-Werkbank',
    tokens: {
      bg: '#e8dcc0', bg2: '#f3ead6', head: '#d9c9a4',
      border: '#a88a5c', borderStrong: '#7a5f37', text: '#33281a', text2: '#6e5a3e', text3: '#9c8762',
      acc: '#d9481c', accText: '#fff7ea', accSoft: 'rgba(217, 72, 28, 0.14)',
      good: '#3f8f2a', warn: '#c98a12', hostile: '#c42a14', info: '#2a6fa8',
      selection: '#ffffff', selectionBorder: '#2a1c0c',
      radius: '6px', radiusSmall: '3px', font: '"Archivo Narrow", "Arial Narrow", sans-serif', titleFont: '"Special Elite", "Courier New", monospace',
      titleBig: 'none', titleSpacing: '0.02em', shadow: '0 2px 0 #b59c6e, 0 8px 18px rgba(40, 28, 10, 0.35)',
      texture: 'radial-gradient(rgba(120, 90, 40, 0.08) 1px, transparent 1.4px) 0 0 / 7px 7px',
      blur: '0px', titleBg: '#f3e6a2', titleSpin: '-1.2deg', buttonBorder: '1px solid #b89c6c',
    },
  },
  modern: {
    name: 'Schlicht modern',
    tokens: {
      bg: 'rgba(24, 26, 30, 0.78)', bg2: 'rgba(40, 43, 50, 0.85)', head: 'rgba(255, 255, 255, 0.04)',
      border: 'rgba(255, 255, 255, 0.1)', borderStrong: 'rgba(255, 255, 255, 0.22)', text: '#eceef2', text2: '#a6abb5', text3: '#6e737c',
      acc: '#e0b240', accText: '#241c08', accSoft: 'rgba(240, 196, 92, 0.2)',
      good: '#8fe08a', warn: '#ffd36a', hostile: '#ff7a6a', info: '#7cc4ff',
      selection: '#ffffff', selectionBorder: '#0b0d12',
      radius: '12px', radiusSmall: '8px', font: 'Inter, -apple-system, "Segoe UI", sans-serif', titleFont: 'Inter, -apple-system, sans-serif',
      titleBig: 'none', titleSpacing: '0.01em', shadow: '0 8px 28px rgba(0, 0, 0, 0.3)',
      texture: 'none', blur: '12px', titleBg: 'transparent', titleSpin: '0deg', buttonBorder: '1px solid transparent',
    },
  },
};

const kebab = k => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

// Moods from the data (daten/ui.json) take precedence; the three built-in ones remain as a fallback for missing tokens.
let active = MOODS;
export function setMoods(data) { if (data && Object.keys(data).length) active = data; return active; }
export function moods() { return active; }

export function applyMoodOn(id, target = document.documentElement, tokens = null, accent = null) {
  const S = tokens ? { tokens } : (active[id] || active[Object.keys(active)[0]] || MOODS.modern);
  const t = { ...MOODS.modern.tokens, ...(MOODS[id]?.tokens || {}), ...(S.tokens || {}) };
  if (accent) t.acc = accent;
  for (const [k, v] of Object.entries(t)) target.style.setProperty('--hud-' + kebab(k), v);
  if (id) target.dataset.hudMood = id;
  return S;
}

export function token(name, fallback = '#fff') {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--hud-' + kebab(name)).trim();
  return v || fallback;
}

export function loadFonts() {
  if (document.getElementById('hud-fonts')) return;
  const l = document.createElement('link'); l.id = 'hud-fonts'; l.rel = 'stylesheet'; l.href = FONTS;
  document.head.appendChild(l);
}
