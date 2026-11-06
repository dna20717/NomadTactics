// NomadTactics – milestone 1 „Gefecht“: loads everything a battle needs from the game data.
// Same function for the browser (fetch) and Node (fs): json(path) reads a file below projects/nomadtactics/.

import { buildMap } from './map.js';
import { Battle } from './battle.js';
import { hasher } from './fixed.js';

export const SKIRMISH = { faction: 'usa', map: 'kreuzung', mode: 'skirmish' };

export async function loadSkirmish(json, choice = SKIRMISH) {
  const [faction, weapons, combat, world, mapDef, modes] = await Promise.all([
    json(`factions/${choice.faction}.json`), json('data/weapons.json'), json('data/combat.json'),
    json('data/world.json'), json(`maps/${choice.map}.json`), json('data/modes.json'),
  ]);
  const setup = { faction, weapons, combat, world, mapDef, mode: modes[choice.mode] || {} };
  // behaviour of units without orders: part of the simulation, so part of the data fingerprint
  try { setup.behavior = await json('data/behavior.json'); } catch { setup.behavior = null; }
  // models are only for the view (not part of the data fingerprint)
  try { setup.models = await json('data/models.json'); } catch { setup.models = {}; }
  try { setup.life = await json('data/life.json'); } catch { setup.life = null; }   // liveliness profiles (optics)
  // the same for the HUD: moods, radio texts, keyword names
  try { setup.ui = await json('data/ui.json'); } catch { setup.ui = {}; }
  try { setup.keywords = await json('data/keywords.json'); } catch { setup.keywords = {}; }
  setup.map = buildMap(mapDef, world);
  setup.version = dataVersion(setup);
  return setup;
}

// Short fingerprint of the game data: different numbers = different data = guaranteed desync
export function dataVersion(setup) {
  const h = hasher();
  const text = JSON.stringify([setup.faction, setup.weapons, setup.combat, setup.world, setup.mapDef, setup.mode, setup.behavior || null]);
  for (let i = 0; i < text.length; i++) h.mix(text.charCodeAt(i));
  return h.text();
}

// Fixed test battle for the device check: same number on PC and iPad = same simulation
export function battleRun(setup, steps = 3000) {
  const b = new Battle(4711, [0, 1], setup);
  for (let i = 0; i < steps; i++) {
    if (i % 200 === 20) for (const s of [0, 1]) {
      const ids = b.units.filter((u) => u.seat === s && !b.types[u.type].building).map((u) => u.id);
      const enemy = b.units.find((u) => u.seat !== s && b.types[u.type].building);
      if (i % 400 === 20 || !enemy) b.command(s, { kind: 'drive', ids, x: b.map.size >> 1, y: (b.map.size >> 1) + (s ? 9000 : -9000) });
      else b.command(s, { kind: 'attack', ids, target: enemy.id });
    }
    b.step();
    b.events.length = 0;
  }
  return b.sum();
}
