import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const srv = createServer((q, a) => {
  try { const p = join(process.cwd(), decodeURIComponent(q.url.split('?')[0])); a.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); a.end(readFileSync(p)); }
  catch { a.writeHead(404); a.end(); }
}).listen(8811);

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage({ viewport: { width: 1600, height: 500 } });
s.on('console', m => console.log('terminal:', m.text()));
s.on('pageerror', e => console.log('error:', e.message));
await s.goto(`http://localhost:8811/${process.argv[2]||'index'}.html`);
await s.waitForFunction(() => window.done, null, { timeout: 60000 });
await s.locator('canvas').last().screenshot({ path: `${process.argv[3]||'leopard'}.png` });
const { triangles, glb, info } = await s.evaluate(() => ({ triangles: window.triangles, glb: window.glb, info: window.info }));
if (info) { console.log(JSON.stringify(info)); await b.close(); srv.close(); process.exit(0); }
writeFileSync(`${process.argv[3]||'leopard'}.glb`, Buffer.from(glb, 'base64'));
console.log('Dreiecke:', triangles, '| glb:', Buffer.from(glb, 'base64').length, 'Bytes');
await b.close(); srv.close();
