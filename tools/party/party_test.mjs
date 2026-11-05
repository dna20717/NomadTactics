#!/usr/bin/env node
// Headless end-to-end test for the party server: real server, real WebSockets,
// two Chromium windows and a Node client, with artificial delay, dropouts and reloads.
// Aufruf: node tools/party/party_test.mjs [--images]   (Bilder landen in output/party_*.png)
//
// WebKit (iPad) doesn't run here, Playwright can't load it in this environment. Substitute:
// test/net.test.js forbids engine-dependent math in the simulation, and the device check
// on the start page shows a check number that must be the same on every device.

import { chromium } from 'playwright';
import fs from 'node:fs';
import { startServer } from './server.js';
import { Connection } from '../../engine/net/connection.js';
import { Lockstep } from '../../engine/net/lockstep.js';
import { probeRun } from '../../engine/tactics/probe.js';
import { Battle } from '../../engine/tactics/battle.js';
import { loadSkirmish, battleRun } from '../../engine/tactics/skirmish.js';

const setup = await loadSkirmish(async (p) => JSON.parse(fs.readFileSync(new URL('../../projects/nomadtactics/' + p, import.meta.url), 'utf8')));
const newSim = (seed, seats) => new Battle(seed, seats, setup);
import { REASON } from '../../engine/net/protocol.js';

const images = process.argv.includes('--images');
const PORT = 8700 + Math.floor(Math.random() * 200);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let error = 0;
const validate = (ok, text) => { console.log(`${ok ? '  ok ' : 'FEHLER'}  ${text}`); if (!ok) error++; };
async function until(fn, ms = 8000, text = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await pause(50); }
  console.log(`  (Zeit abgelaufen: ${text})`); return false;
}

const { room, stop } = startServer({ port: PORT, quiet: true, host: '127.0.0.1' });
await pause(200);
const basis = `http://127.0.0.1:${PORT}`;

// Node client (like a third device), with delay
function nodeClient(name, test = {}) {
  const c = { name };
  c.ls = new Lockstep(newSim, { reportSync: (round, sum) => c.l.send({ t: 'sync', round, sum }) });
  c.l = new Connection({ url: `ws://127.0.0.1:${PORT}/net`, name, test, data: setup.version, store: { lies: () => c.token, write: (t) => { c.token = t; } } });
  c.l.on('match', (m) => c.ls.match(m)).on('round', (m) => c.ls.round(m)).on('state', (m) => { c.state = m; });
  c.l.start();
  c.clock = setInterval(() => c.ls.progress(), 16);
  c.stop = () => { clearInterval(c.clock); c.l.stop(); };
  return c;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const pageA = await context.newPage();
const pageB = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage(); // „iPad“
const terminal = [];
for (const s of [pageA, pageB]) s.on('console', (m) => { if (m.type() === 'error') terminal.push(m.text()); }).on('pageerror', (e) => terminal.push(String(e)));

try {
  // 1) Device check in the browser = Node
  await pageA.goto(basis + '/');
  await pageA.waitForSelector('#pt-name');
  if (images) await pageA.screenshot({ path: 'output/party_start.png' });
  await pageA.click('#pt-check');
  const sumBrowser = await pageA.evaluate(() => window.party.check.sum);
  validate(sumBrowser === probeRun(), `Geräte-Check Chromium = Node (${sumBrowser})`);
  const battleBrowser = await pageA.evaluate(() => window.party.check.battle);
  validate(battleBrowser === battleRun(setup), `Gefechts-Check Chromium = Node (${battleBrowser})`);

  // 2) Join: Daniel (PC), iPad (with 120 ms delay + jitter), Node client with 60 ms
  await pageA.fill('#pt-name', 'Daniel');
  await pageA.click('#pt-join');
  await pageB.goto(basis + '/party.html?name=iPad&auto=1&verz=120&zitter=60');
  const c = nodeClient('Kumpel', { delay: 60, jitter: 30 });
  await until(() => room.active().filter((p) => p.online).length === 3, 5000, 'drei in der Lobby');
  validate(room.active().length === 3, 'drei Spieler in der Lobby');
  await pageA.waitForFunction(() => document.querySelectorAll('.pt-player li:not(.empty)').length === 3);
  validate(room.seats[0].color === '#4a90e2', 'Daniel ist automatisch blau');
  validate(await pageA.locator('.pt-colors').innerText().then((t) => t.includes('Wie immer')), 'Daniel sieht keine Farbwahl, nur „Blau. Wie immer.“');
  const ipadSeat = room.seats.find((p) => p.name === 'iPad').seat; // Order depends on who was faster
  await pageB.click('.pt-dab[data-color="#e46fb4"]');
  await until(() => room.seats[ipadSeat].color === '#e46fb4', 3000, 'iPad wird pink');
  validate(room.seats[ipadSeat].color === '#e46fb4', 'iPad wählt Pink');
  validate(await pageB.locator('.pt-dab').count() === 8, 'acht Farben zur Wahl, keine blau');
  if (images) { await pageA.screenshot({ path: 'output/party_lobby.png' }); await pageB.screenshot({ path: 'output/party_colors.png' }); }

  // 3) Start and commands
  await pageA.click('#pt-start');
  await until(() => room.match && room.match.rounds.length > 20, 6000, 'Partie läuft');
  validate(room.phase === 'running' && room.match.rounds.length > 20, `Partie läuft (${room.match?.rounds.length} Runden)`);
  await pageA.evaluate(() => { const p = window.party; p.command(30000, 14000, p.ownItems().map((e) => e.id)); });
  await pageB.evaluate(() => { const p = window.party; p.command(12000, 6000, p.ownItems().slice(0, 3).map((e) => e.id)); });
  c.l.send({ t: 'command', b: { kind: 'drive', ids: c.ls.sim.units.filter((e) => e.seat === c.l.seat).map((e) => e.id), x: 128000, y: 100000 } });
  await pause(4000);
  if (images) await pageA.screenshot({ path: 'output/party_game.png' });

  // Check for sync: halt, everyone catches up, then compare checksums directly
  async function tie(text) {
    c.l.send({ t: 'pause' });
    await until(() => room.pause?.reason === REASON.manual, 3000, 'Pause');
    await pause(1200);
    const n = room.match.rounds.length - 1;
    const sync = async (s) => s.evaluate(() => ({ r: window.party.ls.done, s: window.party.ls.sim.sum() }));
    await until(async () => (await sync(pageA)).r === n && (await sync(pageB)).r === n && c.ls.done === n, 5000, 'alle auf gleicher Runde');
    const a = await sync(pageA), b = await sync(pageB);
    validate(a.r === n && b.r === n && c.ls.done === n, `${text}: alle bei Runde ${n} (A ${a.r}, iPad ${b.r}, Node ${c.ls.done})`);
    validate(a.s === b.s && b.s === c.ls.sim.sum(), `${text}: gleiche Prüfsumme ${a.s} / ${b.s} / ${c.ls.sim.sum()}`);
    c.l.send({ t: 'next' });
    await until(() => !room.pause, 2000, 'next');
  }
  await tie('Nach Befehlen');
  validate(room.pause?.reason !== REASON.desync, 'kein Desync gemeldet');
  const moved = await pageA.evaluate(() => window.party.ownItems().filter((u) => u.order === 1 || Math.abs(u.x - u.ax) > 2000 || Math.abs(u.y - u.ay) > 2000).length);
  validate(moved > 0, `Befehl kam an (${moved} Einheiten unterwegs)`);

  // 3b) Host page: see players, trigger a gust of wind, everyone stays identical
  const pageG = await context.newPage();
  pageG.on('pageerror', (e) => terminal.push(String(e)));
  await pageG.goto(basis + '/host');
  await pageG.waitForSelector('.gg-table tbody tr');
  validate(await pageG.locator('.gg-table tbody tr').count() === 3, 'Gastgeber-Seite zeigt drei Spieler');
  validate(await pageG.locator('.gg-qr > svg').count() === 1, 'Gastgeber-Seite zeigt den QR-Code');
  await pageG.click('.gg-wind button[data-direction="0"]');
  await until(async () => (await pageA.evaluate(() => window.party.ls.sim.wind.rest)) > 0, 3000, 'Windstoß');
  const wind = await pageA.evaluate(() => window.party.ls.sim.wind.x);
  validate(wind > 0, 'Windstoß vom Spielleiter kommt in der Simulation an');
  await pause(3500);
  if (images) await pageG.screenshot({ path: 'output/party_host.png', fullPage: true });
  await tie('Nach Windstoß');

  // 4) Node client loses connection → pause → comes back on its own
  await pause(1500);
  c.l.cut();
  await until(() => room.pause?.reason === REASON.disconnected, 3000, 'Pause wegen Trennung');
  validate(room.pause?.reason === REASON.disconnected, 'Abbruch → Pause „getrennt“');
  await pageA.waitForSelector('#pt-banner');
  if (images) await pageA.screenshot({ path: 'output/party_pause.png' });
  await until(() => !room.pause && room.seats[c.l.seat]?.online, 8000, 'wieder da');
  validate(!room.pause, 'Wiederverbunden, Pause aufgehoben');

  // 5) iPad reloads the page (token in sessionStorage) → recomputes everything
  await pause(1500);
  await pageB.reload();
  await until(async () => (await pageB.evaluate(() => window.party?.view)) === 'game', 8000, 'iPad zurück im Spiel');
  await until(() => !room.pause && room.straggler().length === 0, 8000, 'iPad aufgeholt');
  validate((await pageB.evaluate(() => window.party.connection.seat)) === ipadSeat, 'iPad sitzt wieder auf seinem Platz');
  await pause(2500);
  await tie('Nach Neuladen');

  // 6) Daniel's case: close the tab entirely, new tab, type only the name → same seat
  await pause(1000);
  const tabB = pageB.context();
  await pageB.close();
  await until(() => room.pause?.reason === REASON.disconnected, 6000, 'Pause nach Tab zu');
  const pageB2 = await tabB.newPage();
  pageB2.on('pageerror', (e) => terminal.push(String(e)));
  await pageB2.goto(basis + '/');
  await pageB2.fill('#pt-name', 'ipad'); // andere Schreibweise
  await pageB2.click('#pt-join');
  await until(async () => (await pageB2.evaluate(() => window.party?.view)) === 'game', 8000, 'neuer Tab im Spiel');
  validate((await pageB2.evaluate(() => window.party.connection.seat)) === ipadSeat, 'Neuer Tab ohne Token, nur mit Namen: wieder auf seinem Platz');
  await until(() => !room.pause && room.straggler().length === 0, 8000, 'weiter nach Rückkehr');
  validate(!room.pause, 'Partie läuft weiter');

  // 7) A stranger arrives during the match: spectator
  const pageZ = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  pageZ.on('pageerror', (e) => terminal.push(String(e)));
  await pageZ.goto(basis + '/party.html?name=Oma&auto=1');
  await until(async () => (await pageZ.evaluate(() => window.party?.view)) === 'game', 8000, 'Zuschauer sieht das Spiel');
  validate(await pageZ.evaluate(() => window.party.spectator === true), 'Neuer Name während der Partie → Zuschauer');
  await pause(2500);
  if (images) await pageZ.screenshot({ path: 'output/party_spectator.png' });
  const zs = await pageZ.evaluate(() => window.party.ls.sim.sum());
  validate(typeof zs === 'string' && !room.pause, `Zuschauer rechnet mit, ohne zu bremsen (#${zs})`);

  // 8) Back to the lobby
  await pageA.click('text=Lobby');
  await until(() => room.phase === 'lobby', 3000, 'Lobby');
  validate(room.phase === 'lobby', 'zurück in der Lobby');
  await pageB2.waitForFunction(() => window.party.view === 'lobby');
  validate(true, 'iPad sieht die Lobby');
  await until(() => room.state().player.length === 4, 3000, 'Oma rückt nach');
  validate(await pageZ.evaluate(() => window.party.spectator === false && window.party.connection.seat === 3), 'Zuschauerin rückt in der Lobby auf den freien Platz');
  if (images) await pageA.screenshot({ path: 'output/party_lobby2.png' });
  validate(terminal.length === 0, `keine Fehler in der Browser-Konsole${terminal.length ? ': ' + terminal.join(' | ') : ''}`);
  c.stop();
} catch (e) {
  console.error(e); error++;
} finally {
  await browser.close();
  await stop();
}
console.log(error ? `\n${error} Fehler` : '\nAlles grün.');
process.exit(error ? 1 : 0);
