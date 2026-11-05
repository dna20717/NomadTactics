#!/usr/bin/env node
// Headless test of the voxel diorama view of the battle: two browsers on the LAN party server,
// software WebGL (SwiftShader). Checks that the scene draws, the view toggle works, a .vox model loads
// and both players still compute the same game.
// Aufruf: node tools/party/view3d_test.mjs [--images]   (Bilder in output/view3d_*.png)

import { chromium } from 'playwright';
import { startServer } from './server.js';

const images = process.argv.includes('--images');
const PORT = 8900 + Math.floor(Math.random() * 90);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let error = 0;
const validate = (ok, text) => { console.log(`${ok ? '  ok ' : 'FEHLER'}  ${text}`); if (!ok) error++; };

const { stop } = startServer({ port: PORT, quiet: true, host: '127.0.0.1' });
await pause(200);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const terminal = [];
async function player(name) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('nomadtactics-view', '3d'); } catch {} });
  const p = await c.newPage();
  p.on('pageerror', (e) => terminal.push(`${name}: ${e}`)).on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) terminal.push(`${name}: ${m.text()}`); });
  await p.goto(`http://127.0.0.1:${PORT}/party.html?name=${name}&auto=1`);
  return p;
}
try {
  const A = await player('Daniel'), B = await player('Ava');
  await pause(2000);
  await A.click('#pt-start');
  await pause(4000);
  validate(await A.evaluate(() => window.party.activeView().kind) === '3d', '3D-Ansicht ist aktiv');
  const info = await A.evaluate(() => window.party.activeView().renderer.info.render);
  validate(info.triangles > 50000, `Szene wird gezeichnet (${info.triangles} Dreiecke, ${info.calls} Aufrufe)`);
  if (images) await A.screenshot({ path: 'output/view3d_start.png' });
  for (const p of [A, B]) await p.evaluate(() => { const P = window.party; P.command(128000, 128000, P.ownItems().map((u) => u.id)); });
  await pause(14000);
  // HUD: select via Ctrl+A, order with a right click, the live portrait fills
  validate(await A.evaluate(() => !!document.querySelector('.nt-hud .f-res') && !!document.querySelector('.f-party .pt-bar')), 'HUD ist da, die Partie-Leiste steckt in einem HUD-Fenster');
  await A.mouse.move(700, 450);
  await A.keyboard.down('Control'); await A.keyboard.press('a'); await A.keyboard.up('Control');
  for (let i = 0; i < 20 && !(await A.evaluate(() => window.party.selection.size)); i++) await pause(150);
  validate(await A.evaluate(() => window.party.selection.size) > 3, `Strg+A wählt über das HUD (${await A.evaluate(() => window.party.selection.size)} Einheiten)`);
  await A.mouse.click(720, 330, { button: 'right' });
  let moving = 0;
  for (let i = 0; i < 40 && !moving; i++) { await pause(200); moving = await A.evaluate(() => window.party.ls.sim.units.filter((u) => u.seat === window.party.connection.seat && u.order === 1).length); }
  validate(moving > 0, `Rechtsklick schickt sie los (${moving} fahren)`);
  await A.evaluate(() => { const u = window.hud.A.units().find((x) => x.team === window.party.connection.seat); window.hud.select([u]); });
  await A.keyboard.press('w');
  await pause(1200);
  // share of non-black pixels per live picture (wait a little, software rendering is slow here)
  const measure = () => A.evaluate(() => [...document.querySelectorAll('.nt-hud canvas.live')].map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n / (d.length / 16);
  }));
  let live = [];
  for (let i = 0; i < 30; i++) { live = await measure(); if (live.length >= 2 && live.every((v) => v > 0.3)) break; await pause(250); }
  validate(live.length >= 2 && live.every((v) => v > 0.3), `Porträt und Live-Fenster zeigen ein Bild (${live.map((v) => Math.round(v * 100) + ' %').join(', ')})`);
  if (images) await A.screenshot({ path: 'output/view3d_hud.png' });
  // picking: the centre of the screen maps back onto the board
  const [wx, wy] = await A.evaluate(() => window.party.activeView().unproject(640, 400));
  validate(wx > 0 && wy > 0 && wx < 256000 && wy < 256000, `Klick trifft die Platte (${Math.round(wx / 1000)} m, ${Math.round(wy / 1000)} m)`);
  // own model from Voxel Max
  await A.evaluate(() => window.party.views['3d'].setModels({ tank: { source: '../../prototypes/nomadtactics/models/daniel_tank.vox' } }));
  await pause(1500);
  if (images) { await A.evaluate(() => window.party.activeView().home()); await pause(400); await A.screenshot({ path: 'output/view3d_vox.png' }); }
  // toggle to 2D and back
  await A.click('#pt-view');
  validate(await A.evaluate(() => window.party.activeView().kind) === '2d', 'Umschalten auf 2D');
  await A.keyboard.press('Tab');
  validate(await A.evaluate(() => window.party.activeView().kind) === '3d', 'Tab schaltet zurück auf 3D');
  await A.evaluate(() => window.party.connection.send({ t: 'pause' }));
  const sum = (p) => p.evaluate(() => [window.party.ls.done, window.party.ls.sim.sum(), window.party.ls.rounds.length - 1]);
  let a, b;
  for (let i = 0; i < 60; i++) { await pause(250); a = await sum(A); b = await sum(B); if (a[0] === a[2] && b[0] === b[2] && a[2] === b[2]) break; }
  validate(a[0] === b[0] && a[1] === b[1], `beide rechnen gleich (Runde ${a[0]}/${b[0]}: ${a[1]} / ${b[1]})`);
  validate(terminal.length === 0, 'keine Fehler in der Browser-Konsole' + (terminal.length ? ': ' + terminal.slice(0, 3).join(' | ') : ''));
} catch (e) { console.error(e); error++; }
await browser.close(); await stop();
console.log(error ? `\n${error} Fehler` : '\nAlles grün.');
process.exit(error ? 1 : 0);
