import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
const srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html' }); a.end(readFileSync('nomadtactics_stress_test.html')); }).listen(8814);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1280, height: 760 } });
s.on('pageerror', e => console.log('ERROR:', e.message));
s.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('terminal:', m.text().slice(0, 300)); });
s.setDefaultTimeout(200000);
await s.goto('http://localhost:8814/');
await s.waitForFunction(() => window.stressTest, null, { timeout: 200000 });
await s.evaluate(() => { stressTest.ctl.target.set(0, 0, -38); stressTest.camera('detail'); document.querySelectorAll('.glass').forEach(e => e.style.display = 'none'); });
await s.waitForTimeout(6000);
for (const [l, o, n] of [['hard', true, 'look_hard_on'], ['soft', false, 'look_soft_off']]) {
  await s.evaluate(([l, o]) => { stressTest.setLight(l); stressTest.setUi(o); }, [l, o]);
  await s.waitForTimeout(2500);
  await s.screenshot({ path: n + '.png' });
}
await s.evaluate(() => { stressTest.setLight('hard'); stressTest.setUi(true); stressTest.camera('game'); });
await s.waitForTimeout(3000); await s.screenshot({ path: 'look_game.png' });
await b.close(); srv.close();
