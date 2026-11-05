// Experience (evolution tiers) and UI as data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loadTactics, validateTactics, tiersFrom, tierAt, withTier, tiersFactors, tiersText, hasOwnItemsTiers, radioText, TOKENS } from '../engine/tactics/index.js';

const root = path.resolve('projects/nomadtactics');
const loader = { json: async d => JSON.parse(fs.readFileSync(path.join(root, d), 'utf8')) };

test('eigene Stufen gehen vor, sonst der Standard', async () => {
  const p = await loadTactics(loader);
  const usa = p.factions.get('usa');
  assert.ok(hasOwnItemsTiers(usa.units.kampfpanzer));
  assert.equal(tiersFrom(p, usa.units.kampfpanzer)[0].name, 'Veteran');
  assert.equal(tiersFrom(p, usa.units.jaeger), p.data.experience.tiers);
});

test('Stufe nach Erfahrungspunkten und Wirkungen', async () => {
  const p = await loadTactics(loader);
  const kp = p.factions.get('usa').units.kampfpanzer, st = tiersFrom(p, kp);
  assert.equal(tierAt(st, 0), 0); assert.equal(tierAt(st, 80), 1); assert.equal(tierAt(st, 449), 2); assert.equal(tierAt(st, 9999), 3);
  const elite = withTier(p, kp, 2);
  assert.equal(elite.health, Math.round(kp.health * 1.2 * 100) / 100);
  assert.equal(elite.keywords.selfRepair, true);
  const f = tiersFactors(p, kp, 2);
  assert.ok(Math.abs(f.damage - 1.15 * 1.13) < 0.02, 'Schaden wächst über beide Stufen');
  assert.deepEqual(f.keywords, ['selfRepair']);
  assert.match(tiersText(p, st[0]), /Schaden \+15 %/);
});

test('Prüfung findet falsche Stufen', async () => {
  const p = await loadTactics(loader);
  assert.equal(validateTactics(p).filter(m => m.kind === 'error').length, 0);
  p.factions.get('usa').units.kampfpanzer.experience.tiers[1].min = 50;
  p.data.experience.tiers[0].effect.push({ kind: 'keyword', keyword: 'gibtsnicht' });
  p.data.ui.standard = 'way';
  const f = validateTactics(p).filter(m => m.kind === 'error').map(m => m.text).join(' | ');
  assert.match(f, /nicht größer/); assert.match(f, /gibtsnicht/); assert.match(f, /Standard-Stimmung/);
});

test('Oberfläche: alle Stimmungen haben alle Tokens, Funk-Texte füllen Platzhalter', async () => {
  const p = await loadTactics(loader), O = p.data.ui;
  for (const [id, s] of Object.entries(O.moods)) for (const k of TOKENS) assert.ok(s.tokens[k] != null, `${id}.${k}`);
  assert.equal(radioText(O, 'ready', { name: 'Kampfpanzer' }), 'Kampfpanzer bereit.');
  assert.equal(radioText({}, 'money'), 'Nicht genug Geld.');
});
