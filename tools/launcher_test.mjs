#!/usr/bin/env node
// Headless test of the launcher (start page): diorama with the real simulation, menu, live dials, options.
// Aufruf: node tools/launcher_test.mjs [--images]   (Bilder in output/launcher_*.png)
import { chromium } from 'playwright';
import { startServer } from './party/server.js';

const images = process.argv.includes('--images');
const PORT = 8800 + Math.floor(Math.random() * 90);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let error = 0;
const validate = (ok, text) => { console.log(`${ok ? '  ok ' : 'FEHLER'}  ${text}`); if (!ok) error++; };

const { stop } = startServer({ port: PORT, quiet: true, host: '127.0.0.1' });
await pause(200);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const terminal = [];
try {
  const P = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  P.on('pageerror', (e) => terminal.push(String(e))).on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) terminal.push(m.text()); });
  await P.goto(`http://127.0.0.1:${PORT}/launcher`);
  for (let i = 0; i < 80 && !(await P.evaluate(() => window.launcher?.ready)); i++) await pause(250);
  validate(await P.evaluate(() => !!window.launcher?.ready), 'Launcher lädt die Spieldaten und startet das Diorama');
  const t0 = await P.evaluate(() => window.launcher.ls.sim.tick);
  await pause(3000);
  const s = await P.evaluate(() => { const sim = window.launcher.ls.sim; return { tick: sim.tick, seats: sim.seats.length, units: sim.units.filter((u) => !sim.types[u.type].building).length, moving: sim.units.filter((u) => u.order).length }; });
  validate(s.tick > t0, `Simulation läuft (${t0} → ${s.tick})`);
  validate(s.seats === 4 && s.units > 8 && s.moving > 0, `vier Seiten, ${s.units} Einheiten, ${s.moving} mit Befehl (KI)`);
  validate(await P.evaluate(() => { const r = document.querySelector('#scene').getBoundingClientRect(); return r.width > 1000 && getComputedStyle(document.querySelector('#scene')).display !== 'none'; }), '3D-Szene füllt den Bildschirm');
  validate(await P.locator('#ln-play').isVisible() && await P.locator('#ln-options').isVisible(), 'Menü: Spiel und Optionen sichtbar');
  validate(await P.locator('#ln-workshop').count() === 0, 'im Heimnetz ohne Werkstatt-Knopf (die gibt es nur online)');
  if (images) await P.screenshot({ path: 'output/launcher_start.png', timeout: 90000 });
  // dials
  await P.click('#ln-dials [data-w=snow]');
  await P.click('#ln-dials [data-c=winter]');
  await P.locator('#ln-hour').fill('22');
  await pause(1500);
  const atm = await P.evaluate(() => JSON.parse(localStorage.getItem('nomadtactics-launcher')));
  validate(atm.weather === 'snow' && atm.climate === 'winter' && Math.abs(atm.hour - 22) < 0.5 && atm.running === false, `Regler: Schnee, Winter, 22 Uhr, Zeit steht (${JSON.stringify(atm)})`);
  let shown = '';
  for (let i = 0; i < 20 && !shown.startsWith('22:'); i++) { shown = await P.evaluate(() => document.querySelector('.ln-time').textContent); await pause(250); }
  validate(shown.startsWith('22:'), `Uhrzeit-Anzeige folgt dem Schieber (${shown})`);
  if (images) await P.screenshot({ path: 'output/launcher_winter.png', timeout: 90000 });
  // options
  await P.click('#ln-options');
  validate(await P.locator('.ln-panel').isVisible(), 'Optionen öffnen sich');
  await P.fill('#ln-name', 'Daniel');
  await P.click('.ln-panel .ln-seg button:has-text("Schnell")');
  await P.click('.ln-panel .ln-seg button:has-text("115 %")');
  const opt = await P.evaluate(() => [localStorage.getItem('nomadtactics-party-name'), localStorage.getItem('nomadtactics-quality'), JSON.parse(localStorage.getItem('nt.hud.settings') || '{}').scale]);
  validate(opt[0] === 'Daniel' && opt[1] === 'fast' && opt[2] === 1.15, `Optionen gemerkt (${opt.join(', ')})`);
  // play leads to the battle page
  const req = P.waitForRequest(/party/, { timeout: 30000 }).catch(() => null);
  await P.evaluate(() => document.querySelector('#ln-play').click());
  const r = await req;
  validate(!!r, `„Spiel“ führt zum Gefecht (${r ? new URL(r.url()).pathname : 'keine Anfrage'})`);
  validate(terminal.length === 0, 'keine Fehler in der Browser-Konsole' + (terminal.length ? ': ' + terminal.slice(0, 3).join(' | ') : ''));
} catch (e) { console.error(e); error++; }
await browser.close(); await stop();
console.log(error ? `\n${error} Fehler` : '\nAlles grün.');
process.exit(error ? 1 : 0);
