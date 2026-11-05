import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { nodeLoader } from '../tools/loader.js';
import { loadTactics, validateTactics, effective, mix, origin, withResearch, renameInFaction, renameGlobal } from '../engine/tactics/index.js';

const load = () => loadTactics(nodeLoader(path.resolve('projects/nomadtactics')));

test('Beispielprojekt ist fehlerfrei', async () => {
  const p = await load();
  assert.equal(p.factions.size, 4);
  const error = validateTactics(p).filter(m => m.kind === 'error');
  assert.deepEqual(error, []);
});

test('mische: tief, Listen ersetzt, null löscht', () => {
  const r = mix({ a: 1, k: { money: 5, schrott: 2 }, l: [1, 2], x: 3 }, { k: { money: 9 }, l: [7], x: null });
  assert.deepEqual(r, { a: 1, k: { money: 9, schrott: 2 }, l: [7] });
});

test('General: ändern, neu, ohne samt Verweisen', async () => {
  const p = await load(), ukraine = p.factions.get('ukraine');
  const e = effective(ukraine, 'brannick');
  assert.equal(e.units.schrottpanzer.health, 520);
  assert.equal(e.units.schrottpanzer.cost.schrott, 120);
  assert.equal(e.units.schrottpanzer.cost.money, 750);
  assert.ok(e.units.koloss);
  assert.equal(e.units.fpv_drohne, undefined);
  assert.ok(!e.building.workshop.produces.includes('fpv_drohne'));
  assert.equal(ukraine.units.schrottpanzer.health, 380, 'Basis bleibt unverändert');
  assert.equal(origin(ukraine, 'brannick', 'units', 'schrottpanzer', 'health'), 'general');
  assert.equal(origin(ukraine, 'brannick', 'units', 'schrottpanzer', 'speed'), 'basis');
  assert.equal(origin(ukraine, 'brannick', 'units', 'koloss'), 'new');
  assert.equal(origin(ukraine, 'brannick', 'units', 'fpv_drohne'), 'without');
});

test('Forschung wirkt auf Ziele', async () => {
  const p = await load(), usa = p.factions.get('usa');
  const e = withResearch(usa, p.data.weapons, ['verbundpanzerung', 'laserzielsuche', 'drohnenschild']);
  assert.equal(e.units.kampfpanzer.health, 625);
  assert.equal(e.units.spaeher.health, 300);
  assert.equal(e.units.soldat.health, 120);
  assert.equal(e.units.kampfpanzer.weaponsStats[0].range, 29.9);
  assert.equal(e.units.kampfdrohne.keywords.sign, 60);
});

test('Prüfung findet kaputte Verweise und Kreise', async () => {
  const p = await load(), usa = p.factions.get('usa');
  usa.units.soldat.weapons = ['gibtsnicht'];
  usa.building.kraftwerk.requires = ['waffenfabrik'];
  usa.generals.vega.without.push('phantom');
  const m = validateTactics(p).filter(x => x.kind === 'error').map(x => x.text).join('\n');
  assert.match(m, /unbekannte Waffe „gibtsnicht“/);
  assert.match(m, /Kreis in den Voraussetzungen/);
  assert.match(m, /„ohne“: „phantom“/);
});

test('Umbenennen zieht Verweise mit', async () => {
  const p = await load(), ukraine = p.factions.get('ukraine');
  renameInFaction(ukraine, 'schwarzmarkt', 'basar');
  assert.ok(ukraine.building.basar && !ukraine.building.schwarzmarkt);
  assert.deepEqual(ukraine.units.fpv_drohne.requires, ['basar']);
  assert.equal(ukraine.research.molotows.researchIn, 'basar');
  renameInFaction(ukraine, 'schrottpanzer', 'blechbuechse');
  assert.ok(ukraine.generals.sela.without.includes('blechbuechse'));
  assert.ok(ukraine.generals.brannick.modify.units.blechbuechse);
  renameGlobal(p, 'weapon', 'mg', 'mg_schwer');
  assert.deepEqual(ukraine.units.pickup.weapons, ['mg_schwer']);
  renameGlobal(p, 'keyword', 'loot', 'pluendern');
  assert.equal(ukraine.research.schrottpanzerung.effect[0].target, 'keyword:pluendern');
  p.data.weapons.mg_schwer = p.data.weapons.mg; delete p.data.weapons.mg;
  p.data.keywords.pluendern = p.data.keywords.loot; delete p.data.keywords.loot;
  assert.deepEqual(validateTactics(p).filter(x => x.kind === 'error'), []);
});

test('Ausrüstung: Plätze, mehrfach, Waffentausch, Begleiter, General-Preise', async () => {
  const { withEquipment } = await import('../engine/tactics/index.js');
  const p = await load(), ukraine = p.factions.get('ukraine'), usa = p.factions.get('usa');
  const k = withEquipment(ukraine, p, 'kaempfer', ['mg_shooter', 'anfuehrer', 'verstaerkung', 'verstaerkung']);
  assert.equal(k.unit.squad, 7); assert.equal(k.unit.health, 130); assert.deepEqual(k.unit.weapons, ['sturmgewehr', 'mg']);
  assert.equal(k.total.money, 520); assert.deepEqual(k.problems, []);
  const zuviel = withEquipment(ukraine, p, 'kaempfer', ['mg_shooter', 'panzerfaust_mann', 'verstaerkung', 'verstaerkung', 'verstaerkung', 'verstaerkung']);
  assert.equal(zuviel.problems.length, 2);
  const pu = withEquipment(ukraine, p, 'pickup', ['flakaufbau']);
  assert.deepEqual(pu.unit.weapons, ['flak']);
  const kp = withEquipment(effective(usa, 'vega'), p, 'kampfpanzer', ['gefechtsdrohne']);
  assert.deepEqual(kp.companion, [{ unit: 'drohne_gefecht', count: 1 }]); assert.equal(kp.cost.money, 180);
  assert.match(withEquipment(effective(usa, 'okafor'), p, 'kampfpanzer', ['raketendrohne']).problems[0], /passt nicht/);
});

test('Ebene: kleinster Unterschied beim General, zurück zur Basis erbt wieder', async () => {
  const { Overlay } = await import('../engine/tactics/overlay.js');
  const p = await load(), ukraine = p.factions.get('ukraine');
  const eb = new Overlay(ukraine, 'brannick');
  eb.set('units', 'schrottpanzer', 'cost', { money: 750 });
  assert.deepEqual(ukraine.generals.brannick.modify.units.schrottpanzer.cost, { money: 750, schrott: null });
  eb.set('units', 'pickup', 'speed', 11);
  assert.equal(ukraine.generals.brannick.modify.units.pickup, undefined, 'gleicher Wert wie die Basis wird nicht gespeichert');
  assert.equal(eb.remove('units', 'pickup'), 'without');
  assert.equal(new Overlay(ukraine, 'brannick').obj('units', 'pickup'), undefined);
  const basis = new Overlay(ukraine);
  basis.remove('equipment', 'panzerplatten');
  assert.ok(!ukraine.units.pickup.equipment.includes('panzerplatten'));
  assert.ok(!ukraine.generals.brannick.modify.units.koloss.equipment?.includes('panzerplatten'));
});

test('nt: setze --trocken ändert nichts auf der Platte und meldet die Prüfung', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = (await import('node:fs')).readFileSync('projects/nomadtactics/factions/ukraine.json', 'utf8');
  const off = execFileSync('node', ['tools/nt.js', 'set', 'ukraine', 'schrottpanzer', 'speed', '4', '--general', 'brannick', '--dry'], { encoding: 'utf8' });
  assert.match(off, /eigener Wert/); assert.match(off, /0 Fehler/);
  assert.equal((await import('node:fs')).readFileSync('projects/nomadtactics/factions/ukraine.json', 'utf8'), before);
});
