#!/usr/bin/env node
// Screenshots of the launcher diorama from fixed cameras (for looking at terrain, lights, drones …).
// Aufruf: node tools/shot.mjs name:x,z,dist,yaw,pitch[,hour] … [--wait ms] [--sim ticks]
//   x, z in metres on the board; hour = time of day (optional). Bilder: output/shot_<name>.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startServer } from './party/server.js';

const args = process.argv.slice(2);
const wait = +(args[args.indexOf('--wait') + 1] || 0) || 1500;
// x may be a unit type instead (e.g. drohne_gefecht): the camera then looks at the first such unit
const shots = args.filter((a) => /^[\w-]+:/.test(a)).map((a) => { const [name, v] = a.split(':'); const p = v.split(','); const [x, z, dist, yaw, pitch, hour] = p.map(Number); return { name, unit: Number.isFinite(x) ? null : p[0], x, z, dist, yaw, pitch, hour }; });
const PORT = 8700 + Math.floor(Math.random() * 90);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
mkdirSync('output', { recursive: true });
const { stop } = startServer({ port: PORT, quiet: true, host: '127.0.0.1' });
await pause(200);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const P = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  P.on('pageerror', (e) => console.log('pageerror', String(e)));
  await P.goto(`http://127.0.0.1:${PORT}/launcher`);
  for (let i = 0; i < 80 && !(await P.evaluate(() => window.launcher?.ready)); i++) await pause(250);
  await P.addStyleTag({ content: '.ln-menu,.ln-dials,.ln-hero,.np-launcher,#ln-hero{display:none!important}' }).catch(() => {});
  for (const s of shots) {
    await P.evaluate((s) => {
      const L = window.launcher; L.hold(true);
      if (s.unit) { const sim = L.ls.sim, u = sim.units.find((q) => q.type === s.unit) || sim.units.find((q) => !sim.types[q.type].building); s.x = u.x / 1000; s.z = u.y / 1000; }
      Object.assign(L.cam, { tx: s.x, tz: s.z, dist: s.dist, yaw: s.yaw, pitch: s.pitch });
      if (Number.isFinite(s.hour)) L.setHour(s.hour);
    }, s);
    await pause(wait);
    await P.screenshot({ path: `output/shot_${s.name}.png`, timeout: 120000 });
    console.log(`output/shot_${s.name}.png`);
  }
} finally { await browser.close(); stop(); }
