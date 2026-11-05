#!/usr/bin/env node
// Scaffold: creates the project projects/nomadtactics with rules and two sample factions (one-time, afterwards work happens in the editor).
//   node tools/scaffolds/tactics_example.mjs [--overwrite]
import fs from 'node:fs';
import path from 'node:path';
import { pretty } from '../json.js';

const root = path.resolve('projects/nomadtactics');
if (fs.existsSync(path.join(root, 'project.json')) && !process.argv.includes('--overwrite')) { console.log('Gibt es schon. Mit --overwrite neu anlegen.'); process.exit(1); }
const write = (p, o) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, pretty(o) + '\n'); console.log('  ' + p); };

write('project.json', {
  id: 'nomadtactics', name: 'NomadTactics', genre: 'tactics', voxel: 0.4,
  resources: 'data/resources.json', combat: 'data/combat.json', keywords: 'data/keywords.json',
  weapons: 'data/weapons.json', models: 'data/models.json',
  factions: ['factions/usa.json', 'factions/china.json'],
});

write('data/resources.json', {
  money: { name: 'Geld', color: '#e0b240', kind: 'supply', symbol: '$', description: 'Kommt aus Nachschub-Lagern. Damit wird fast alles bezahlt.' },
  power: { name: 'Strom', color: '#5aa9ff', kind: 'capacity', symbol: '⚡', description: 'Kraftwerke liefern, Gebäude verbrauchen. Reicht er nicht, baut alles halb so schnell und Abwehranlagen schalten ab.' },
  schrott: { name: 'Schrott', color: '#b07a4a', kind: 'supply', symbol: '⚙', description: 'Bleibt von Wracks liegen und wird eingesammelt. China baut und verbessert damit.' },
  rank: { name: 'Rangpunkte', color: '#c07ad8', kind: 'points', symbol: '★', description: 'Gibt es für Abschüsse. Kaufen die Fähigkeiten des Generals.' },
});

write('data/combat.json', {
  damageTypes: {
    kleinkaliber: { name: 'Kleinkaliber', description: 'Gewehre und MGs' },
    panzerbrechend: { name: 'Panzerbrechend', description: 'Kanonen und Panzerfäuste' },
    explosiv: { name: 'Explosiv', description: 'Raketen, Granaten, Bomben' },
    fire: { name: 'Feuer', description: 'Flammenwerfer, Brandsätze' },
    energy: { name: 'Energie', description: 'Laser und Ionenstrahlen' },
    flugabwehr: { name: 'Flugabwehr', description: 'Flak und Abfangraketen' },
  },
  armors: {
    infantry: { name: 'Infanterie' }, leicht: { name: 'Leicht gepanzert' }, schwer: { name: 'Schwer gepanzert' },
    building: { name: 'Gebäude' }, air: { name: 'Luft' },
  },
  table: {
    kleinkaliber: { infantry: 1, leicht: 0.5, schwer: 0.1, building: 0.2, air: 0.3 },
    panzerbrechend: { infantry: 0.3, leicht: 1, schwer: 1.25, building: 0.6, air: 0 },
    explosiv: { infantry: 0.8, leicht: 0.9, schwer: 0.7, building: 1.2, air: 0 },
    fire: { infantry: 1.5, leicht: 0.6, schwer: 0.2, building: 1, air: 0 },
    energy: { infantry: 0.8, leicht: 1, schwer: 1.1, building: 0.8, air: 0.6 },
    flugabwehr: { infantry: 0.2, leicht: 0.3, schwer: 0.1, building: 0, air: 1.5 },
  },
  classes: { infantry: { name: 'Infanterie' }, vehicle: { name: 'Fahrzeug' }, air: { name: 'Luft' } },
});

// Keywords: short rules like One Page Rules; "number": true means the keyword carries a stat (Zäh(3))
write('data/keywords.json', {
  builds: { name: 'Baut', for: ['unit'], description: 'Kann Gebäude errichten und reparieren.' },
  schnell: { name: 'Schnell', for: ['unit'], description: 'Fährt auf Straßen 50 % schneller.' },
  tough: { name: 'Zäh', number: true, for: ['unit', 'building'], description: 'Ignoriert die ersten X Schadenspunkte jedes Treffers.' },
  tarnung: { name: 'Tarnung', for: ['unit', 'building'], description: 'Unsichtbar, solange sie nicht schießt oder ein Aufklärer in der Nähe ist.' },
  scout: { name: 'Aufklärer', for: ['unit', 'building'], description: 'Sieht getarnte Gegner in Sichtweite.' },
  flies: { name: 'Fliegt', for: ['unit'], description: 'Ignoriert Gelände, nur Flugabwehr trifft.' },
  ueberrollt: { name: 'Überrollt', for: ['unit'], description: 'Fährt Infanterie einfach platt.' },
  transport: { name: 'Transport', number: true, for: ['unit'], description: 'Nimmt bis zu X Infanteristen mit.' },
  garnison: { name: 'Garnison', number: true, for: ['building'], description: 'Bis zu X Infanteristen können sich darin verschanzen und herausschießen.' },
  selfRepair: { name: 'Selbstreparatur', number: true, for: ['unit', 'building'], description: 'Heilt X Leben pro Sekunde, wenn sie 5 s keinen Treffer bekommen hat.' },
  schwarm: { name: 'Schwarm', for: ['unit'], description: 'Wird in Gruppen zu 3 gebaut (Kosten gelten für die Gruppe).' },
  loot: { name: 'Beute', for: ['unit'], description: 'Fährt über Wracks und bekommt dafür Schrott und Leben.' },
  veteran: { name: 'Veteran', for: ['unit'], description: 'Steigt doppelt so schnell im Rang.' },
  tunnel: { name: 'Tunnel', for: ['building'], description: 'Alle Tunnel sind verbunden: rein bei einem, raus bei einem anderen.' },
  selbstzerstoerung: { name: 'Selbstzerstörung', number: true, for: ['unit'], description: 'Kann sich sprengen und richtet X Flächenschaden an.' },
  stromlos: { name: 'Stromlos', for: ['building'], description: 'Braucht keinen Strom und schaltet nie ab.' },
  indirekt: { name: 'Indirekt', for: ['weapon'], description: 'Schießt im Bogen über Hindernisse, braucht aber Sicht durch Verbündete.' },
  surface: { name: 'Fläche', number: true, for: ['weapon'], description: 'Trifft alles im Umkreis von X Metern.' },
  collects: { name: 'Sammelt', number: true, for: ['unit', 'building'], description: 'Bringt X Einheiten der Ressource pro Fahrt bzw. pro 10 s.' },
  sign: { name: 'Schild', number: true, for: ['unit', 'building'], description: 'Energieschild schluckt X Schaden und lädt sich mit Strom wieder auf.' },
});

write('data/weapons.json', {
  sturmgewehr: { name: 'Sturmgewehr', damageType: 'kleinkaliber', damage: 6, range: 15, reload: 0.8, projectile: 'gewehr', targets: ['ground'] },
  scharfschuetzengewehr: { name: 'Scharfschützengewehr', damageType: 'kleinkaliber', damage: 60, range: 30, reload: 3, projectile: 'gewehr', targets: ['ground'] },
  mg: { name: 'Schweres MG', damageType: 'kleinkaliber', damage: 3, range: 18, reload: 0.14, projectile: 'mg', targets: ['ground', 'air'] },
  kanone_120: { name: '120-mm-Kanone', damageType: 'panzerbrechend', damage: 45, range: 26, reload: 2.4, projectile: 'granate', targets: ['ground'] },
  kanone_alt: { name: 'Alte Panzerkanone', damageType: 'panzerbrechend', damage: 30, range: 22, reload: 2.8, projectile: 'granate', targets: ['ground'] },
  doppelkanone: { name: 'Doppelrohr', damageType: 'panzerbrechend', damage: 40, range: 24, reload: 2, salvo: 2, projectile: 'granate', targets: ['ground'] },
  panzerfaust: { name: 'Panzerfaust', damageType: 'panzerbrechend', damage: 35, range: 16, reload: 3, projectile: 'rakete', targets: ['ground', 'air'] },
  lenkrakete: { name: 'Lenkraketen', damageType: 'explosiv', damage: 30, range: 46, reload: 7, salvo: 4, projectile: 'rakete', targets: ['ground'], keywords: { indirekt: true, surface: 3 } },
  raketenbatterie: { name: 'Raketenbatterie', damageType: 'explosiv', damage: 14, range: 40, reload: 9, salvo: 12, projectile: 'rakete', targets: ['ground'], keywords: { indirekt: true, surface: 4 } },
  bordkanone: { name: 'Bordkanone', damageType: 'panzerbrechend', damage: 20, range: 20, reload: 0.5, projectile: 'mg', targets: ['ground'] },
  air_ground: { name: 'Luft-Boden-Raketen', damageType: 'explosiv', damage: 70, range: 22, reload: 6, salvo: 2, projectile: 'rakete', targets: ['ground'] },
  abfangrakete: { name: 'Abfangrakete', damageType: 'flugabwehr', damage: 40, range: 40, reload: 2, salvo: 2, projectile: 'rakete', targets: ['air'] },
  flak: { name: 'Flak', damageType: 'flugabwehr', damage: 8, range: 30, reload: 0.3, projectile: 'mg', targets: ['air'] },
  laser: { name: 'Laser', damageType: 'energy', damage: 25, range: 28, reload: 1.2, projectile: 'laser', targets: ['ground', 'air'] },
  laserkanone: { name: 'Laserkanone', damageType: 'energy', damage: 50, range: 28, reload: 2.2, projectile: 'laser', targets: ['ground'] },
  flammenwerfer: { name: 'Flammenwerfer', damageType: 'fire', damage: 12, range: 9, reload: 0.25, projectile: 'flame', targets: ['ground'], keywords: { surface: 2 } },
  molotow: { name: 'Molotow', damageType: 'fire', damage: 20, range: 12, reload: 4, projectile: 'granate', targets: ['ground'], keywords: { surface: 2 } },
  bomb: { name: 'Bombenschacht', damageType: 'explosiv', damage: 220, range: 2, reload: 20, projectile: 'bomb', targets: ['ground'], keywords: { surface: 6 } },
  ionenstrahl: { name: 'Ionenstrahl', damageType: 'energy', damage: 2500, range: 9999, reload: 300, projectile: 'laser', targets: ['ground'], keywords: { surface: 14 } },
  raketenhagel: { name: 'Raketenhagel', damageType: 'explosiv', damage: 120, range: 9999, reload: 280, salvo: 30, projectile: 'rakete', targets: ['ground'], keywords: { surface: 5, indirekt: true } },
});

// Models: "prototype:<name>" are the voxel models from the stress test, ".vox" are Daniel's models from Voxel Max
write('data/models.json', {
  tank: { name: 'Kampfpanzer', source: 'prototype:tank' }, werfer: { name: 'Raketenwerfer', source: 'prototype:werfer' },
  spaeher: { name: 'Spähwagen', source: 'prototype:spaeher' }, soldat: { name: 'Soldat', source: 'prototype:soldat' },
  dozer: { name: 'Dozer', source: 'prototype:dozer' }, kaserne: { name: 'Kaserne', source: 'prototype:kaserne' },
  highrise: { name: 'Hochhaus', source: 'prototype:highrise' }, daniel_tank: { name: 'Daniels Panzer', source: '../../prototypes/nomadtactics/models/daniel_tank.vox' },
});

// ---------- Faction Blue: few expensive high-tech units, air power, everything depends on electricity ----------
write('factions/usa.json', {
  id: 'usa', name: 'USA', color: '#3a78d8',
  description: 'Hochgerüstete Berufsarmee. Wenige, teure Einheiten mit Reichweite und Luftüberlegenheit. Jedes Gebäude braucht Strom: fällt das Netz, steht die Armee.',
  playstyle: 'Halten und präzise zuschlagen',
  resources: ['money', 'power', 'rank'],
  start: { money: 10000, building: ['hauptquartier'], units: ['bautrupp', 'bautrupp'] },
  building: {
    hauptquartier: { name: 'Hauptquartier', function: 'hq', model: 'kaserne', cost: { money: 2000 }, buildTime: 40, health: 3000, armor: 'building', size: [8, 8], power: 5, produces: ['bautrupp'], keywords: { scout: true }, pos: [0, 0] },
    kraftwerk: { name: 'Fusionskraftwerk', function: 'power', cost: { money: 800 }, buildTime: 15, health: 1200, armor: 'building', size: [5, 5], power: 10, requires: ['hauptquartier'], pos: [-1, 1], description: 'Explodiert heftig, wenn es zerstört wird.' },
    kaserne: { name: 'Kaserne', function: 'production', model: 'kaserne', cost: { money: 600 }, buildTime: 12, health: 1500, armor: 'building', size: [6, 5], power: -1, produces: ['soldat', 'scharfschuetze'], requires: ['kraftwerk'], keywords: { garnison: 10 }, pos: [-1.5, 2] },
    depot: { name: 'Nachschubdepot', function: 'resource', cost: { money: 1500 }, buildTime: 20, health: 1600, armor: 'building', size: [7, 6], power: -1, produces: ['versorger'], requires: ['kraftwerk'], pos: [-0.5, 2] },
    waffenfabrik: { name: 'Waffenfabrik', function: 'production', cost: { money: 2000 }, buildTime: 25, health: 2400, armor: 'building', size: [9, 7], power: -3, produces: ['spaeher', 'kampfpanzer', 'lenkwerfer'], requires: ['depot'], pos: [-0.5, 3] },
    flugfeld: { name: 'Flugfeld', function: 'production', cost: { money: 1800 }, buildTime: 25, health: 1800, armor: 'building', size: [10, 8], power: -4, produces: ['kampfdrohne', 'jaeger', 'transporter'], requires: ['waffenfabrik'], pos: [1, 4] },
    forschungszentrum: { name: 'Forschungszentrum', function: 'research', cost: { money: 1500 }, buildTime: 20, health: 1400, armor: 'building', size: [6, 6], power: -3, requires: ['waffenfabrik'], pos: [-0.5, 4] },
    abwehrlaser: { name: 'Abwehrlaser', function: 'defense', cost: { money: 900 }, buildTime: 10, health: 1000, armor: 'building', size: [2, 2], power: -2, weapons: ['laser'], requires: ['kaserne'], pos: [-2.5, 3] },
    raketenabwehr: { name: 'Raketenabwehr', function: 'defense', cost: { money: 800 }, buildTime: 10, health: 900, armor: 'building', size: [2, 2], power: -2, weapons: ['abfangrakete'], requires: ['kaserne'], pos: [-1.5, 3] },
    ionenkanone: { name: 'Ionenkanone', function: 'superweapon', cost: { money: 5000 }, buildTime: 60, health: 4000, armor: 'building', size: [6, 6], power: -10, weapons: ['ionenstrahl'], requires: ['forschungszentrum', 'satellitennetz'], pos: [0, 6], description: 'Einmal alle 5 Minuten: Ein Strahl aus dem Orbit.' },
  },
  units: {
    bautrupp: { name: 'Bautrupp', role: 'Bauen', class: 'vehicle', model: 'dozer', cost: { money: 1000 }, buildTime: 10, health: 250, armor: 'leicht', speed: 4.5, sight: 20, keywords: { builds: true } },
    versorger: { name: 'Versorgungslaster', role: 'Sammeln', class: 'vehicle', model: 'spaeher', cost: { money: 600 }, buildTime: 10, health: 200, armor: 'leicht', speed: 6, sight: 20, keywords: { collects: 300 } },
    soldat: { name: 'Soldat', role: 'Grundtruppe', class: 'infantry', model: 'soldat', cost: { money: 225 }, buildTime: 5, health: 120, armor: 'infantry', speed: 2.8, sight: 24, weapons: ['sturmgewehr'] },
    scharfschuetze: { name: 'Scharfschütze', role: 'Infanterie-Jäger', class: 'infantry', model: 'soldat', cost: { money: 600 }, buildTime: 10, health: 90, armor: 'infantry', speed: 2.6, sight: 36, weapons: ['scharfschuetzengewehr'], keywords: { tarnung: true }, requires: ['forschungszentrum'] },
    spaeher: { name: 'Späher', role: 'Aufklärung', class: 'vehicle', model: 'spaeher', cost: { money: 700 }, buildTime: 8, health: 240, armor: 'leicht', speed: 10, sight: 34, weapons: ['mg'], keywords: { scout: true, transport: 4, schnell: true } },
    kampfpanzer: { name: 'Kampfpanzer', role: 'Panzerbrecher', class: 'vehicle', model: 'tank', cost: { money: 1200 }, buildTime: 14, health: 500, armor: 'schwer', speed: 5.5, sight: 26, weapons: ['kanone_120'], keywords: { tough: 4 } },
    lenkwerfer: { name: 'Lenkraketenwerfer', role: 'Artillerie', class: 'vehicle', model: 'werfer', cost: { money: 1400 }, buildTime: 16, health: 220, armor: 'leicht', speed: 5, sight: 24, weapons: ['lenkrakete'], requires: ['forschungszentrum'] },
    kampfdrohne: { name: 'Kampfdrohne', role: 'Schwarm', class: 'air', cost: { money: 900 }, buildTime: 10, health: 80, armor: 'air', speed: 12, sight: 26, weapons: ['bordkanone'], keywords: { flies: true, schwarm: true } },
    jaeger: { name: 'Jagdbomber', role: 'Luftschlag', class: 'air', cost: { money: 1400 }, buildTime: 14, health: 200, armor: 'air', speed: 24, sight: 30, weapons: ['air_ground'], keywords: { flies: true } },
    transporter: { name: 'Transporthubschrauber', role: 'Transport', class: 'air', cost: { money: 900 }, buildTime: 10, health: 300, armor: 'air', speed: 14, sight: 24, keywords: { flies: true, transport: 8 } },
  },
  research: {
    verbundpanzerung: { name: 'Verbundpanzerung', symbol: 'V', cost: { money: 1500 }, time: 30, researchIn: 'forschungszentrum', requires: ['forschungszentrum'], pos: [-1, 5],
      description: 'Alle Fahrzeuge halten 25 % mehr aus.', effect: [{ kind: 'stat', target: 'class:vehicle', field: 'health', times: 1.25 }] },
    laserzielsuche: { name: 'Laser-Zielsuche', symbol: 'L', cost: { money: 1000 }, time: 25, researchIn: 'forschungszentrum', requires: ['forschungszentrum'], pos: [0, 5],
      description: 'Panzer und Abwehrlaser schießen 15 % weiter.', effect: [{ kind: 'stat', target: 'unit:kampfpanzer', field: 'range', times: 1.15 }, { kind: 'stat', target: 'building:abwehrlaser', field: 'range', times: 1.15 }] },
    drohnenschild: { name: 'Drohnenschild', symbol: 'S', cost: { money: 1200 }, time: 25, researchIn: 'flugfeld', requires: ['flugfeld'], pos: [1.5, 5],
      description: 'Kampfdrohnen bekommen ein Energieschild.', effect: [{ kind: 'keyword', target: 'unit:kampfdrohne', keyword: 'sign', stat: 60 }] },
    satellitennetz: { name: 'Satellitennetz', symbol: '◎', cost: { money: 2500 }, time: 45, researchIn: 'forschungszentrum', requires: ['laserzielsuche'], pos: [0.5, 5.5],
      description: 'Voraussetzung für die Ionenkanone. Alle Gebäude werden Aufklärer.', effect: [{ kind: 'keyword', target: 'all_building', keyword: 'scout' }] },
    praezisionsschlag: { name: 'Präzisionsschlag', symbol: '✦', cost: { rank: 3 }, time: 0, requires: ['hauptquartier'], pos: [1, 1],
      description: 'General-Fähigkeit: Ein Marschflugkörper auf ein Ziel nach Wahl.', effect: [{ kind: 'ability', name: 'Präzisionsschlag', cooldown: 180, description: '400 Schaden, Fläche 4 m.' }] },
  },
  generals: {
    vega: { name: 'Generalin Vega', title: 'Luftmarschall', motto: 'Wer oben ist, hat recht.',
      description: 'Alles, was fliegt, ist billiger und besser. Schwere Panzer gibt es kaum.',
      modify: {
        units: {
          jaeger: { cost: { money: 1050 }, health: 260 },
          kampfdrohne: { cost: { money: 700 } },
          kampfpanzer: { cost: { money: 1500 }, buildTime: 18 },
          tarnbomber: { name: 'Tarnkappenbomber', role: 'Bunkerbrecher', class: 'air', cost: { money: 2500 }, buildTime: 25, health: 250, armor: 'air', speed: 22, sight: 26, weapons: ['bomb'], keywords: { flies: true, tarnung: true }, requires: ['nachbrenner'] },
        },
        building: { flugfeld: { produces: ['kampfdrohne', 'jaeger', 'transporter', 'tarnbomber'], cost: { money: 1400 } } },
        research: {
          nachbrenner: { name: 'Nachbrenner', symbol: 'N', cost: { money: 1500 }, time: 30, researchIn: 'flugfeld', requires: ['flugfeld'], pos: [2.5, 5],
            description: 'Flugzeuge 30 % schneller. Schaltet den Tarnkappenbomber frei.', effect: [{ kind: 'stat', target: 'class:air', field: 'speed', times: 1.3 }] },
        },
      },
      without: ['lenkwerfer'] },
    okafor: { name: 'General Okafor', title: 'Lichtbringer', motto: 'Strom ist Munition.',
      description: 'Laser statt Kanonen. Mächtig, solange das Netz hält – und es braucht viel mehr Strom.',
      modify: {
        units: { kampfpanzer: { name: 'Laserpanzer', weapons: ['laserkanone'], cost: { money: 1400 } } },
        building: {
          kraftwerk: { power: 14, cost: { money: 900 } },
          abwehrlaser: { health: 1400, keywords: { sign: 300 } },
          waffenfabrik: { power: -5 },
        },
      },
      without: ['raketenabwehr'] },
  },
});

// ---------- Faction Red: cheap masses, no electricity, scrap and tunnels, everything improvised ----------
write('factions/china.json', {
  id: 'china', name: 'China', color: '#d8473a',
  description: 'Improvisierte Volksarmee. Billig, zahlreich und zäh. Kein Strom, dafür Tunnel, Tarnung und Schrott: Aus jedem Wrack wird etwas Neues.',
  playstyle: 'Überrennen und ausbluten lassen',
  resources: ['money', 'schrott', 'rank'],
  start: { money: 8000, schrott: 200, building: ['kommandobunker'], units: ['arbeiter', 'arbeiter', 'arbeiter'] },
  building: {
    kommandobunker: { name: 'Kommandobunker', function: 'hq', cost: { money: 1500 }, buildTime: 35, health: 3500, armor: 'building', size: [7, 7], produces: ['arbeiter'], keywords: { stromlos: true, tunnel: true, tough: 10 }, pos: [0, 0] },
    shelter: { name: 'Unterschlupf', function: 'production', model: 'kaserne', cost: { money: 400 }, buildTime: 8, health: 1100, armor: 'building', size: [5, 4], produces: ['kaempfer', 'raketenschuetze', 'bombenleger'], requires: ['kommandobunker'], keywords: { stromlos: true, garnison: 6 }, pos: [-1, 1] },
    schrottplatz: { name: 'Schrottplatz', function: 'resource', cost: { money: 600 }, buildTime: 12, health: 1300, armor: 'building', size: [8, 6], produces: ['sammler'], requires: ['kommandobunker'], keywords: { stromlos: true, collects: 20 }, pos: [1, 1],
      description: 'Zieht langsam Schrott aus dem Boden und nimmt Wracks an.' },
    workshop: { name: 'Hinterhof-Werkstatt', function: 'production', cost: { money: 1200, schrott: 200 }, buildTime: 18, health: 1600, armor: 'building', size: [8, 7], produces: ['pickup', 'schrottpanzer', 'raketenlaster', 'bombenlaster'], requires: ['shelter', 'schrottplatz'], keywords: { stromlos: true }, pos: [0, 2] },
    tunnelnetz: { name: 'Tunnelnetz', function: 'movement', cost: { money: 800 }, buildTime: 12, health: 1000, armor: 'building', size: [3, 3], weapons: ['sturmgewehr'], requires: ['shelter'], keywords: { stromlos: true, tunnel: true, garnison: 10 }, pos: [-2, 2] },
    stellung: { name: 'MG-Stellung', function: 'defense', cost: { money: 500 }, buildTime: 6, health: 700, armor: 'building', size: [2, 2], weapons: ['mg'], requires: ['shelter'], keywords: { stromlos: true, tarnung: true }, pos: [-1, 2] },
    flakstellung: { name: 'Flakstellung', function: 'defense', cost: { money: 600 }, buildTime: 8, health: 700, armor: 'building', size: [2, 2], weapons: ['flak'], requires: ['shelter'], keywords: { stromlos: true }, pos: [-3, 2] },
    schwarzmarkt: { name: 'Schwarzmarkt', function: 'research', cost: { money: 1500, schrott: 300 }, buildTime: 20, health: 1200, armor: 'building', size: [6, 5], requires: ['workshop'], keywords: { stromlos: true, collects: 15 }, pos: [1, 3],
      description: 'Erforscht Verbesserungen und tauscht ein wenig Geld pro Minute.' },
    raketensilo: { name: 'Raketenhagel-Silo', function: 'superweapon', cost: { money: 4000, schrott: 800 }, buildTime: 55, health: 3500, armor: 'building', size: [6, 6], weapons: ['raketenhagel'], requires: ['schwarzmarkt'], keywords: { stromlos: true }, pos: [1, 5],
      description: 'Einmal alle 4,5 Minuten: 30 Raketen auf ein Gebiet.' },
  },
  units: {
    arbeiter: { name: 'Arbeiter', role: 'Bauen', class: 'infantry', model: 'soldat', cost: { money: 200 }, buildTime: 5, health: 80, armor: 'infantry', speed: 3, sight: 18, keywords: { builds: true, collects: 100 } },
    sammler: { name: 'Schrottsammler', role: 'Sammeln', class: 'vehicle', model: 'dozer', cost: { money: 400 }, buildTime: 8, health: 220, armor: 'leicht', speed: 5, sight: 18, keywords: { collects: 60, loot: true } },
    kaempfer: { name: 'Kämpfer', role: 'Masse', class: 'infantry', model: 'soldat', cost: { money: 150 }, buildTime: 3, health: 90, armor: 'infantry', speed: 3, sight: 22, weapons: ['sturmgewehr'], keywords: { schwarm: true } },
    raketenschuetze: { name: 'Raketenschütze', role: 'Panzerjäger', class: 'infantry', model: 'soldat', cost: { money: 300 }, buildTime: 5, health: 90, armor: 'infantry', speed: 2.8, sight: 22, weapons: ['panzerfaust'] },
    bombenleger: { name: 'Bombenleger', role: 'Selbstmordkommando', class: 'infantry', model: 'soldat', cost: { money: 250 }, buildTime: 5, health: 70, armor: 'infantry', speed: 3.6, sight: 18, keywords: { selbstzerstoerung: 300, tarnung: true }, requires: ['schwarzmarkt'] },
    pickup: { name: 'Pickup mit MG', role: 'Überfall', class: 'vehicle', model: 'spaeher', cost: { money: 500 }, buildTime: 6, health: 180, armor: 'leicht', speed: 11, sight: 26, weapons: ['mg'], keywords: { schnell: true, loot: true, transport: 5 } },
    schrottpanzer: { name: 'Schrottpanzer', role: 'Linie', class: 'vehicle', model: 'daniel_tank', cost: { money: 600, schrott: 100 }, buildTime: 9, health: 380, armor: 'schwer', speed: 5, sight: 22, weapons: ['kanone_alt'], keywords: { loot: true, ueberrollt: true } },
    raketenlaster: { name: 'Raketenlaster', role: 'Artillerie', class: 'vehicle', model: 'werfer', cost: { money: 900, schrott: 150 }, buildTime: 12, health: 160, armor: 'leicht', speed: 5.5, sight: 22, weapons: ['raketenbatterie'] },
    bombenlaster: { name: 'Bombenlaster', role: 'Rammbock', class: 'vehicle', model: 'spaeher', cost: { money: 1000, schrott: 200 }, buildTime: 12, health: 260, armor: 'leicht', speed: 8, sight: 20, keywords: { selbstzerstoerung: 900, loot: true }, requires: ['schwarzmarkt'] },
  },
  research: {
    schrottpanzerung: { name: 'Schrottpanzerung', symbol: 'S', cost: { money: 800, schrott: 300 }, time: 25, researchIn: 'schwarzmarkt', requires: ['schwarzmarkt'], pos: [0, 4],
      description: 'Fahrzeuge mit Beute werden Zäh(3).', effect: [{ kind: 'keyword', target: 'keyword:loot', keyword: 'tough', stat: 3 }] },
    molotows: { name: 'Molotows', symbol: 'M', cost: { money: 600 }, time: 20, researchIn: 'schwarzmarkt', requires: ['schwarzmarkt'], pos: [-1, 4],
      description: 'Kämpfer werfen Brandflaschen.', effect: [{ kind: 'weapon', target: 'unit:kaempfer', weapon: 'molotow' }] },
    tarnnetze: { name: 'Tarnnetze', symbol: 'T', cost: { money: 1000 }, time: 25, researchIn: 'schwarzmarkt', requires: ['molotows'], pos: [-1, 5],
      description: 'Alle Abwehrstellungen sind getarnt.', effect: [{ kind: 'keyword', target: 'function:defense', keyword: 'tarnung' }] },
    fanatismus: { name: 'Fanatismus', symbol: 'F', cost: { money: 900 }, time: 20, researchIn: 'shelter', requires: ['shelter'], pos: [-2, 3],
      description: 'Infanterie 20 % mehr Leben, Veteran.', effect: [{ kind: 'stat', target: 'class:infantry', field: 'health', times: 1.2 }, { kind: 'keyword', target: 'class:infantry', keyword: 'veteran' }] },
    hinterhalt: { name: 'Hinterhalt', symbol: '!', cost: { rank: 2 }, time: 0, requires: ['kommandobunker'], pos: [2, 1],
      description: 'General-Fähigkeit: 10 Kämpfer tauchen aus dem Boden auf.', effect: [{ kind: 'ability', name: 'Hinterhalt', cooldown: 150, description: '10 getarnte Kämpfer an einem erkundeten Ort.' }] },
  },
  generals: {
    brannick: { name: 'General Brannick', title: 'Der Panzerbaron', motto: 'Mehr Stahl, weniger Fragen.',
      description: 'Schwere Schrottpanzer statt Selbstmordkommandos. Langsamer, teurer, aber kaum zu stoppen.',
      modify: {
        units: {
          schrottpanzer: { health: 520, cost: { money: 750, schrott: 120 } },
          koloss: { name: 'Koloss', role: 'Durchbruch', class: 'vehicle', model: 'tank', cost: { money: 2200, schrott: 400 }, buildTime: 25, health: 1400, armor: 'schwer', speed: 3.5, sight: 22, weapons: ['doppelkanone'], keywords: { tough: 8, ueberrollt: true, selfRepair: 5 }, requires: ['schrottpanzerung'] },
        },
        building: { workshop: { produces: ['pickup', 'schrottpanzer', 'raketenlaster', 'koloss'] } },
      },
      without: ['bombenleger', 'bombenlaster'] },
    sela: { name: 'Kommandantin Sela', title: 'Schattenmutter', motto: 'Sie sehen uns erst, wenn es zu spät ist.',
      description: 'Alles getarnt, alles unter der Erde. Billige Tunnel, Saboteure, kaum Panzer.',
      modify: {
        units: {
          kaempfer: { keywords: { schwarm: true, tarnung: true } },
          raketenschuetze: { keywords: { tarnung: true } },
          saboteur: { name: 'Saboteurin', role: 'Sabotage', class: 'infantry', model: 'soldat', cost: { money: 800 }, buildTime: 12, health: 80, armor: 'infantry', speed: 4, sight: 26, keywords: { tarnung: true, scout: true },
            description: 'Schleicht in Gebäude und legt sie für 30 s lahm.' },
        },
        building: {
          tunnelnetz: { cost: { money: 480 }, buildTime: 8 },
          shelter: { produces: ['kaempfer', 'raketenschuetze', 'bombenleger', 'saboteur'] },
        },
      },
      without: ['schrottpanzer'] },
  },
});
console.log('done');
