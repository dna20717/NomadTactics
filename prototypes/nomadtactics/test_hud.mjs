// Kopfloser HUD-Test: node test_hud.mjs → /tmp/hud_*.png
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
const srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html' }); a.end(readFileSync('nomadtactics_stress_test.html')); }).listen(8817);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1366, height: 820 } });
s.on('pageerror', e => console.log('ERROR:', e.message, e.stack?.split('\n')[1]));
s.on('console', m => { if (m.type() === 'error') console.log('terminal:', m.text().slice(0, 300)); });
s.setDefaultTimeout(240000);
await s.goto('http://localhost:8817/?hud');
await s.waitForFunction(() => window.hud && window.stressTest);
await s.evaluate(() => { stressTest.setQuality('low'); localStorage.clear(); });
const world2image = (x, y, z) => s.evaluate(([x, y, z]) => { const v = new stressTest.THREE.Vector3(x, y, z).project(stressTest.mainCam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }, [x, y, z]);
const pause = ms => s.waitForTimeout(ms);
// Camera to the base
await s.evaluate(() => { stressTest.camera('near'); const t = stressTest.ctl.target; stressTest.ctl.target.set(0, 0, -50); stressTest.mainCam.position.set(30, 45, -10); stressTest.ctl.update(); });
await pause(3000);
// Click the factory and build
const fab = await world2image(-24, 2, -60);
await s.mouse.click(fab.x, fab.y);
await pause(1500);
await s.keyboard.press('w'); await s.keyboard.press('w'); await s.keyboard.press('q');
await pause(2500);
await s.screenshot({ path: '/tmp/hud_1_factory.png' });
console.log('Fabrik-Treffer:', await s.evaluate(([x, y]) => { const t = hud.A.hit(x, y); return t && t.kind; }, [fab.x, fab.y]));
console.log('Schlange:', await s.evaluate(() => hud.selection.building?.name + ' ' + hud.selection.building?.queue.map(x => x.type).join(',')));
// Right-click into the terrain: rally point
const sp = await world2image(-10, 0, -30);
await s.mouse.click(sp.x, sp.y, { button: 'right' });
// Select units with a box
await s.evaluate(() => { stressTest.ctl.target.set(0, 0, -30); stressTest.mainCam.position.set(25, 70, 20); stressTest.ctl.update(); });
await pause(1500);
await s.mouse.move(300, 200); await s.mouse.down(); await s.mouse.move(700, 450, { steps: 5 }); await s.mouse.move(1000, 650, { steps: 5 }); await s.mouse.up();
await pause(800);
console.log('Auswahl nach Rahmen:', await s.evaluate(() => hud.unitsSelection().size));
// Fahrbefehl
const target = await world2image(8, 0, -22);
console.log('Ziel', JSON.stringify(target), await s.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName + '.' + document.elementFromPoint(x, y)?.className, [target.x, target.y]), 'Treffer Ziel:', await s.evaluate(([x, y]) => { const t = hud.A.hit(x, y); return t && t.kind + (t.e ? ':' + t.e.team : ''); }, [target.x, target.y]));
await s.evaluate(() => { window._log = []; addEventListener('pointerup', e => _log.push([e.button, e.target.tagName, e.timeStamp]), true); addEventListener('pointerdown', e => _log.push(['d', e.button, e.target.tagName, e.timeStamp]), true); });
await s.mouse.click(target.x, target.y, { button: 'right' });
console.log('Ereignisse:', JSON.stringify(await s.evaluate(() => _log)));
await pause(5000);
await s.screenshot({ path: '/tmp/hud_2_march.png' });
await s.mouse.move(target.x + 60, target.y - 40); await s.mouse.down({ button: 'right' }); await pause(1200); await s.mouse.up({ button: 'right' });
await pause(3000); await s.screenshot({ path: '/tmp/hud_2b_circle.png' });
console.log('Kreis offen:', await s.evaluate(() => hud.circle.classList.contains('on')));
console.log('Befehle:', await s.evaluate(() => [...hud.unitsSelection()].filter(u => u.command).length));
// Groups: Ctrl+1, then click a unit and Ctrl+2 with group 1 + unit
await s.keyboard.down('Control'); await s.keyboard.press('Digit1'); await s.keyboard.up('Control');
await s.keyboard.press('Digit1');
console.log('Gruppe 1:', await s.evaluate(() => hud.groupsUnits(1).size));
// Single unit
const one = await s.evaluate(() => { const u = stressTest.units().find(u => u.alive && u.team === 0 && u.type === 'tank'); hud.select([u]); u.xp = 70; return true; });
await pause(6000);
await s.screenshot({ path: '/tmp/hud_3_unit.png' });
for (const st of ['workbench', 'modern']) { await s.evaluate(st => hud.set('mood', st), st); await pause(5000); await s.screenshot({ path: `/tmp/hud_4_${st}.png` }); }
await s.evaluate(() => hud.set('mood', 'terminal'));
await b.close(); srv.close();
