// Collapse lab headless: demolition charges on bridges and towers, fire, repair. Images inp_*.png
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
const srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html' }); a.end(readFileSync('nomadtactics_stress_test.html')); }).listen(8816);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1280, height: 760 } });
const error = [];
s.on('pageerror', e => { error.push(e.message); console.log('ERROR:', e.message, e.stack?.split('\n')[1]); });
s.on('console', m => { if (m.type() === 'error') console.log('terminal:', m.text().slice(0, 300)); });
s.setDefaultTimeout(240000);
await s.goto('http://localhost:8816/');
await s.waitForFunction(() => window.stressTest, null, { timeout: 240000 });
const H = (f, ...a) => s.evaluate(f, ...a);
// Camera: target (x, z) and camera offset (dx, dy, dz)
const image = async (name, target, v = [3, 30, 13]) => { if (typeof target === 'number') target = await H(gi => { const c = stressTest.building[gi].box.getCenter(stressTest.mainCam.position.clone()); return [c.x, c.z]; }, target); await H(([x, z, dx, dy, dz]) => { stressTest.closeAll(); stressTest.ctl.target.set(x, 0, z); stressTest.mainCam.position.set(x + dx, dy, z + dz); stressTest.ctl.update(); }, [target[0], target[1], ...v]); await s.waitForTimeout(1800); await s.screenshot({ path: `inp_${name}.png` }); };
const run = sec => H(t => stressTest.fastForward(t), sec);
const state = async () => console.log(JSON.stringify(await H(() => ({ b: stressTest.bridges(), t: stressTest.towers(), fk: stressTest.faller.length }))));
await H(() => { stressTest.setQuality('middle'); document.getElementById('legend').classList.add('to'); stressTest.deploy(40); });
await image('0_stadt', 12, [45, 60, 66]);
await state();
// Beam bridge: blow up pillar
await H(() => stressTest.blast(10, 'p1')); await run(4.3); await run(2.5);
await image('1_gauge', 10);
// Steinbogen: Scheitel
await H(() => stressTest.blast(11, 's')); await run(4.3); await run(1.2);
await image('2_arc_fall', 11); await run(3);
// Suspension bridge: one cable
await H(() => stressTest.blast(12, 'ropeN')); await run(4.3); await run(3);
await image('3_hang_askew', 12);
// Fachwerk: zwei Felder
await H(() => stressTest.blast(13, 'f2')); await run(4.3); await run(2);
await image('4a_truss_kink', 13);
await H(() => stressTest.blast(13, 'f5')); await run(4.3); await run(3);
await image('4b_truss_breach', 13);
// Ponton
await H(() => stressTest.blast(14, 'p3')); await run(4.3); await run(1);
await image('5_pontoon', 14);
await state();
// East tower at z -27 (index 4): corner → dollhouse, then second corner of the same side → tipping over
await H(() => stressTest.blast(4, 'q0:0')); await run(4.3); await run(2);
await image('6_dollhouse', 4, [34, 26, 8]);
await state();
await H(() => stressTest.blast(4, 'q1:0')); await run(4.3); await run(3.2);
await image('7_tips', 10, [40, 34, 8]); await run(3);
await image('8_tipped', 10, [40, 40, 12]);
await state();
// West glass tower (index 0) on fire → steel gets soft → pancake
await H(() => stressTest.blazeLay(stressTest.point(0, 0, 20, 8))); await run(12);
await image('9_blaze', 0, [10, 60, 14]);
await run(15); await image('10_pancake', 0, [10, 60, 14]); await run(8);
await image('11_after', 10, [10, 60, 16]);
// Plattenbau West (Index 2): Brand → Gerippe
await H(() => stressTest.blazeLay(stressTest.point(2, 0, 12, 8))); await run(30);
await image('12_skeleton', 2, [16, 50, 16]);
// Reparieren
await H(() => { const c = stressTest.building[10].box.getCenter(stressTest.mainCam.position.clone()); stressTest.repair(c); }); await run(6);
await image('13_repaired', 10);
await state();
console.log('Fehler:', error.length);
await b.close(); srv.close();
