#!/usr/bin/env node
// Headless test of the touch control in the battle HUD (iPad without mouse): one player practises alone,
// fingers come as real touch events (CDP), so the pointers arrive with pointerType "touch".
// Checks: tap selects, tap on the ground drives, one finger moves the camera, touch bar frame selection,
// add to selection, holding a finger opens the radial menu, double tap = same type, deselect.
// Aufruf: node tools/party/touch_test.mjs [--images] [--3d]   (Bilder in output/touch_*.png)

import { chromium } from 'playwright';
import { startServer } from './server.js';

const images = process.argv.includes('--images');
const view = process.argv.includes('--3d') ? '3d' : '2d';
const PORT = 8900 + Math.floor(Math.random() * 90);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let error = 0;
const validate = (ok, text) => { console.log(`${ok ? '  ok ' : 'FEHLER'}  ${text}`); if (!ok) error++; };

const { stop } = startServer({ port: PORT, quiet: true, host: '127.0.0.1' });
await pause(200);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const terminal = [];
try {
  const c = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });
  await c.addInitScript((v) => { try { localStorage.setItem('nomadtactics-view', v); localStorage.removeItem('nt.hud.layout'); } catch {} }, view);
  const P = await c.newPage();
  P.on('pageerror', (e) => terminal.push(String(e))).on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) terminal.push(m.text()); });
  const cdp = await c.newCDPSession(P);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  // Taps are dispatched inside the page as touch pointers: CDP round trips are so slow here (software rendering)
  // that a 60 ms tap arrives as a 500 ms press. Drags, holding and two fingers go through CDP.
  const taps = async (x, y, count = 1) => { await P.evaluate(([x, y, count]) => new Promise((ok) => {
    const cv = window.hud.A.canvas; let n = 0, id = 900 + Math.floor(Math.random() * 1000);
    const one = () => {
      const o = { pointerId: ++id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, button: 0, buttons: 1 };
      cv.dispatchEvent(new PointerEvent('pointerdown', o));
      setTimeout(() => { cv.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); if (++n < count) setTimeout(one, 80); else setTimeout(ok, 60); }, 40);
    };
    one();
  }), [x, y, count]); await pause(100); };
  const tap = (x, y) => taps(x, y, 1);
  const drag = async (x0, y0, x1, y1, steps = 8) => {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); await pause(30); }
    await touch('touchEnd', []); await pause(150);
  };
  const hold = async (x, y, ms = 700) => { await touch('touchStart', [[x, y]]); await pause(ms); await touch('touchEnd', []); await pause(150); };

  await P.goto(`http://127.0.0.1:${PORT}/party.html?name=Daniel&auto=1`);
  await pause(1500);
  await P.click('#pt-start');
  await pause(4000);
  const me = () => P.evaluate(() => window.party.connection.seat);
  // own units on screen (screen position through the HUD)
  const ownOnScreen = () => P.evaluate(() => {
    const H = window.hud, w = innerWidth, h = innerHeight;
    return H.A.units().filter((u) => u.alive && u.team === H.A.team).map((u) => { const p = H.image(u.x, u.y + 1, u.z); return p && { id: u.id, kind: u.kind ?? u.type, x: p.x, y: p.y }; })
      .filter((p) => p && p.x > 240 && p.y > 190 && p.x < w - 260 && p.y < h - 200);
  });
  await P.evaluate(() => window.party.input?.home?.());
  await pause(300);
  let list = await ownOnScreen();
  for (let i = 0; i < 20 && !list.length; i++) { await pause(250); list = await ownOnScreen(); }
  validate(list.length > 0, `eigene Einheiten im Bild (${list.length})`);
  const sel = () => P.evaluate(() => window.hud.unitsSelection().size);

  // 1. tap a unit (this first one as a real touch through CDP)
  const u = list.find((x) => x.kind !== list[0].kind) ? list.find((x) => list.filter((y) => y.kind === x.kind).length > 1) || list[0] : list[0];
  await touch('touchStart', [[u.x, u.y]]); await touch('touchEnd', []); await pause(200);
  validate(await sel() === 1, `Antippen wählt eine Einheit (${await sel()})`);
  validate(await P.evaluate(() => getComputedStyle(document.querySelector('.hud-touchbar')).display !== 'none'), 'Touch-Leiste erscheint nach dem ersten Antippen');
  if (images) await P.screenshot({ path: 'output/touch_select.png' });

  // 2. tap the ground = drive
  const before = await P.evaluate(() => window.party.ls.done);
  await tap(u.x + 120, u.y - 60);
  let moving = 0;
  for (let i = 0; i < 30 && !moving; i++) { await pause(200); moving = await P.evaluate(() => window.party.ls.sim.units.filter((x) => x.seat === window.party.connection.seat && x.order === 1).length); }
  validate(moving > 0 && await sel() === 1, `Tippen auf den Boden schickt sie los (${moving} fährt, Auswahl bleibt)`);
  void before;

  // 3. one finger moves the camera and keeps the selection
  const cam = () => P.evaluate(() => window.party.activeView().unproject(590, 410));
  const c0 = await cam();
  await drag(700, 500, 520, 380);
  const c1 = await cam();
  validate(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 3000 && await sel() === 1, `ein Finger schiebt die Kamera (${Math.round(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / 1000)} m), Auswahl bleibt`);

  // 4. touch bar: frame selection
  await P.evaluate(() => window.party.input?.home?.()); await pause(300);
  list = await ownOnScreen();
  await P.click('.hud-touchbar [data-t=frame]');
  // a big frame over the free middle of the screen (units keep moving a little)
  await drag(250, 200, 1180 - 270, 820 - 210, 10);
  const framed = await sel();
  validate(framed > 0 && framed >= list.length - 1, `Rahmen über die Touch-Leiste wählt ${framed} (im Feld waren ${list.length})`);
  validate(await P.evaluate(() => !window.hud.touchFrame && !document.querySelector('.hud-touchbar [data-t=frame]').classList.contains('on')), 'Rahmen-Knopf geht nach einem Rahmen wieder aus');
  if (images) await P.screenshot({ path: 'output/touch_frame.png' });

  // 5. deselect, then double tap = same type on screen
  await P.click('.hud-touchbar [data-t=none]');
  validate(await sel() === 0, 'Abwählen leert die Auswahl');
  list = await ownOnScreen();
  const twin = list.find((x) => list.filter((y) => y.kind === x.kind).length > 1);
  if (twin) {
    await taps(twin.x, twin.y, 2);
    validate(await sel() > 1, `zweimal Antippen wählt alle „${twin.kind}“ im Bild (${await sel()})`);
  } else validate(true, 'Doppeltippen übersprungen (kein Typ doppelt im Bild)');

  // 6. add to selection
  await P.click('.hud-touchbar [data-t=none]');
  list = await ownOnScreen();
  await tap(list[0].x, list[0].y);
  await P.click('.hud-touchbar [data-t=add]');
  const other = list.find((x) => Math.hypot(x.x - list[0].x, x.y - list[0].y) > 40);
  if (other) { await tap(other.x, other.y); validate(await sel() === 2, `„Dazuwählen“ nimmt eine zweite Einheit dazu (${await sel()})`); }
  await P.click('.hud-touchbar [data-t=add]');

  // 7. hold a finger = radial menu
  await hold(list[0].x + 80, list[0].y + 40);
  const circle = await P.evaluate(() => document.querySelector('.hud-circle').classList.contains('on'));
  validate(circle, 'Finger halten öffnet das Kreismenü');
  if (images) await P.screenshot({ path: 'output/touch_circle.png' });
  if (circle) {
    const b = await P.evaluate(() => { const r = document.querySelector('.hud-circle .circle-k:not(.off)').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await tap(b[0], b[1]);
    validate(await P.evaluate(() => !document.querySelector('.hud-circle').classList.contains('on')), 'Antippen im Kreismenü löst aus und schließt es');
  }
  // 8. two fingers still zoom
  const z0 = await P.evaluate(() => window.party.activeView().pixelsPerMm(128000, 128000));
  await touch('touchStart', [[500, 400], [680, 400]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[500 - i * 20, 400], [680 + i * 20, 400]]); await pause(30); }
  await touch('touchEnd', []); await pause(150);
  const z1 = await P.evaluate(() => window.party.activeView().pixelsPerMm(128000, 128000));
  validate(z1 > z0 * 1.2, `zwei Finger zoomen (×${(z1 / z0).toFixed(2)})`);
  validate(await me() >= 0, 'noch im Spiel');
  validate(terminal.length === 0, 'keine Fehler in der Browser-Konsole' + (terminal.length ? ': ' + terminal.slice(0, 3).join(' | ') : ''));
} catch (e) { console.error(e); error++; }
await browser.close(); await stop();
console.log(error ? `\n${error} Fehler` : '\nAlles grün.');
process.exit(error ? 1 : 0);
