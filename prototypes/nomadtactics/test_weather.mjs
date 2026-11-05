import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
const srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html' }); a.end(readFileSync('nomadtactics_stress_test.html')); }).listen(8815);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1100, height: 650 } });
s.on('pageerror', e => console.log('ERROR:', e.message));
s.on('console', m => { if (m.type() === 'error') console.log('terminal:', m.text()); });
s.setDefaultTimeout(240000);
await s.goto('http://localhost:8815/');
await s.waitForFunction(() => window.stressTest);
await s.evaluate(() => { stressTest.setQuality('middle'); stressTest.camera('far'); });
for (const kind of (process.argv[2] || 'bewoelkt,regen,schnee,sturm').split(',')) {
  // Shortcut the transition: set values directly
  await s.evaluate(a => { stressTest.setWeather(a); const W = stressTest.W; W.wet = a === 'rain' || a === 'storm' ? 1 : 0; W.ceiling = a === 'snow' ? 1 : 0; }, kind);
  await s.waitForFunction(() => { const W = stressTest.W; return Math.abs(W.cover - ({ clear: 0, cloudy: .5, rain: .82, fog: .3, snow: .7, storm: .95, wind: .4 })[W.kind]) < 0.05; }, null, { timeout: 240000 });
  await s.screenshot({ path: `/tmp/weather_${kind}.png` });
  console.log('Bild', kind);
}
await b.close(); srv.close();
