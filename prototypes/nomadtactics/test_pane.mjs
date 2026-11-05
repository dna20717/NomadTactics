import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
const srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html' }); a.end(readFileSync('nomadtactics_stress_test.html')); }).listen(8814);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1280, height: 760 } });
s.on('pageerror', e => console.log('ERROR:', e.message));
s.on('console', m => { if (m.type() === 'error') console.log('terminal:', m.text()); });
s.setDefaultTimeout(180000);
await s.goto('http://localhost:8814/');
await s.waitForFunction(() => window.stressTest);
await s.evaluate(() => stressTest.setQuality('middle'));
await s.waitForTimeout(3000);
// Click on a unit in the main view: compute the screen position of a tank
const pos = await s.evaluate(() => { const u = stressTest.units().find(u => u.alive && u.type === 'tank' && u.team === 0); const v = { x: u.x, y: u.y + 1, z: u.z }; const T = stressTest.mainCam; const p = new (T.position.constructor)(v.x, v.y, v.z).project(T); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; });
await s.mouse.click(pos.x, pos.y);
await s.waitForTimeout(500);
console.log('Fenster nach Klick:', await s.evaluate(() => stressTest.pane.map(f => f.kind + ':' + f.el.querySelector('.lf-title').textContent)));
await s.evaluate(() => { const r = stressTest.units().find(u => u.alive && u.type === 'werfer' && u.team === 1); stressTest.openFollow(r); stressTest.openPost({ x: -60, y: 0, z: 0, clone() { return this; } }); });
await s.evaluate(() => stressTest.event(-55, 30, 'Einsturz', 'Gebäude stürzt ein'));
await s.waitForTimeout(2500);
await s.screenshot({ path: '/tmp/lf_1.png' });
// Granate im Wachposten-Fenster abfeuern
await s.click('[data-weapon=rakete]');
const r = await s.evaluate(() => { const f = stressTest.pane.find(f => f.kind === 'post'); const b = f.image.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await s.mouse.click(r.x, r.y); await s.waitForTimeout(300); await s.mouse.click(r.x + 20, r.y + 10);
await s.waitForTimeout(1200);
await s.screenshot({ path: '/tmp/lf_2.png' });
console.log(await s.evaluate(() => document.getElementById('details').innerText));
// Connection lost: destroy the tracked unit
await s.evaluate(() => { const f = stressTest.pane.find(f => f.kind === 'follow'); stressTest.die(f.u); });
await s.waitForFunction(() => stressTest.pane.some(f => f.kind === 'lost'), null, { timeout: 30000 });
await s.waitForTimeout(2500);
console.log('Nach Zerstörung:', await s.evaluate(() => stressTest.pane.map(f => f.kind + ':' + f.el.querySelector('.lf-info').textContent)));
await s.screenshot({ path: '/tmp/lf_3.png' });
await s.screenshot({ path: '/tmp/lf_3z.png', clip: await s.evaluate(() => { const b = stressTest.pane.find(f => f.kind === 'lost').el.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }) });
await s.screenshot({ path: '/tmp/lf_4z.png', clip: await s.evaluate(() => { const b = stressTest.pane.find(f => f.kind === 'post').el.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }) });
await b.close(); srv.close();
