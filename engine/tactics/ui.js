// NomadTactics – interface as data (daten/ui.json): moods (design tokens of the game HUD),
// default HUD settings and radio texts. No DOM dependency: workshop, HUD and validation share it.

// Token groups for workshop and validation: [key, label, kind] with kind = color | text | mass | font | css
export const TOKEN_GROUPS = [
  ['Flächen', [['bg', 'Fenster', 'color'], ['bg2', 'Felder & Knöpfe', 'color'], ['head', 'Kopfzeile', 'color'], ['border', 'Rand', 'color'], ['borderStrong', 'Rand stark', 'color'], ['texture', 'Textur (CSS)', 'css'], ['blur', 'Hintergrund-Unschärfe', 'mass'], ['shadow', 'Schatten (CSS)', 'css']]],
  ['Text', [['text', 'Text', 'color'], ['text2', 'Text gedämpft', 'color'], ['text3', 'Text leise', 'color']]],
  ['Akzent & Zustände', [['acc', 'Akzent', 'color'], ['accText', 'Text auf Akzent', 'color'], ['accSoft', 'Akzent weich', 'color'], ['good', 'Gut', 'color'], ['warn', 'Warnung', 'color'], ['hostile', 'Gefahr', 'color'], ['info', 'Info', 'color']]],
  ['Markierungen', [['selection', 'Auswahl', 'color'], ['selectionBorder', 'Auswahl-Rand', 'color']]],
  ['Form & Schrift', [['radius', 'Radius Fenster', 'mass'], ['radiusSmall', 'Radius klein', 'mass'], ['font', 'Schrift', 'font'], ['titleFont', 'Titel-Schrift', 'font'],
    ['titleBig', 'Titel GROSS (uppercase/none)', 'text'], ['titleSpacing', 'Titel-Sperrung', 'mass'], ['titleBg', 'Titel-Etikett', 'color'], ['titleSpin', 'Titel-Drehung', 'mass'], ['buttonBorder', 'Knopf-Rand (CSS)', 'css']]],
];
export const TOKENS = TOKEN_GROUPS.flatMap(([, l]) => l.map(([k]) => k));
export const FONT_SELECTION = ['"Share Tech Mono", ui-monospace, monospace', '"Black Ops One", "Share Tech Mono", sans-serif', '"Special Elite", "Courier New", monospace',
  '"Archivo Narrow", "Arial Narrow", sans-serif', 'Inter, -apple-system, "Segoe UI", sans-serif', 'VT323, monospace'];

export const HUD_STANDARD_FIELDS = {
  marker: ['Markierung', [['corners', 'Ecken + Ring'], ['rings', 'Nur Ringe']]],
  march: ['Marschlinien', [['off', 'Aus'], ['selection', 'Nur Auswahl'], ['all', 'Alle eigenen']]],
  drag: ['Linksziehen', [['frame', 'Auswahlrahmen'], ['camera', 'Kamera schieben']]],
  multiple: ['Mehrfachauswahl', [['single', 'Einzeln'], ['stacked', 'Nach Typ']]],
  colors: ['Farben', [['team', 'Teamfarben'], ['ivf', 'Ich · Verbündete · Feinde']]],
};
// Funk-Texte: Platzhalter in geschweiften Klammern
export const RADIO_TEXTS = {
  ready: ['Einheit bereit', '{name} bereit.'], promoted: ['Beförderung', 'Beförderung! {name} ist jetzt {stufe}.'], lost: ['Einheit verloren', 'Einheit verloren.'],
  money: ['Zu wenig Geld', 'Nicht genug Geld.'], idle: ['Leerlauf', '{gebaeude} im Leerlauf.'], halt: ['Halt', 'Halten Position.'], attack: ['Angriff', 'Ziel erfasst.'],
  retreat: ['Rückzug', 'Rückzug.'], ability: ['Fähigkeit', '{name} ist unterwegs.'],
};

export function emptyUi() { return { standard: null, moods: {}, hud: {}, radio: { acks: [] } }; }
export const radioText = (O, id, stats = {}) => String(O?.radio?.[id] ?? RADIO_TEXTS[id]?.[1] ?? '').replace(/\{(\w+)\}/g, (_, k) => stats[k] ?? '');

export function validateUi(p, report) {
  const O = p.data.ui; if (!O) return;
  const place = p.paths.ui || 'ui';
  const S = O.moods || {};
  if (O.standard && !S[O.standard]) report('error', place, `Standard-Stimmung „${O.standard}“ gibt es nicht`);
  for (const [id, s] of Object.entries(S)) {
    if (!s.name) report('warning', `${place} stimmung ${id}`, 'ohne Namen');
    const missing = TOKENS.filter(k => s.tokens?.[k] == null || s.tokens[k] === '');
    if (missing.length) report('hint', `${place} stimmung ${id}`, `ohne Wert, nimmt Ersatz: ${missing.join(', ')}`);
    for (const k of Object.keys(s.tokens || {})) if (!TOKENS.includes(k)) report('warning', `${place} stimmung ${id}`, `unbekannter Token „${k}“`);
  }
  for (const [k, v] of Object.entries(O.hud || {})) {
    const f = HUD_STANDARD_FIELDS[k];
    if (f && !f[1].some(([w]) => w === v)) report('error', `${place} hud`, `${f[0]}: „${v}“ ist keine Wahl`);
  }
  for (const [fid, f] of p.factions) {
    const st = f.ui?.mood;
    if (st && !S[st]) report('error', `${fid}`, `Oberfläche: Stimmung „${st}“ gibt es nicht`);
  }
}
