// Pictures of all kit vehicles (data/models.json › source "kit:…"): node tools/kit/preview.mjs [--only a,b] [--cols 6] [--yaw 0.6] [--pitch 0.55] [--dist 90] [--out output/kit.png]
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8823, '127.0.0.1');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const P = await browser.newPage({ viewport: { width: +arg('w', 1600), height: +arg('h', 1000) } });
  P.on('pageerror', (e) => console.log('pageerror', String(e))); P.on('console', (m) => m.type() === 'error' && console.log(m.text()));
  const qs = new URLSearchParams(Object.fromEntries(['only', 'cols', 'yaw', 'pitch', 'dist', 'fov', 'team', 'stride', 'gap'].filter((k) => arg(k)).map((k) => [k, arg(k)])));
  await P.goto(`http://127.0.0.1:8823/tools/kit/preview.html?${qs}`);
  await P.waitForFunction(() => window.done, null, { timeout: 120000 });
  const out = arg('out', 'output/kit.png'); await P.screenshot({ path: out });
  console.log(out, JSON.stringify(await P.evaluate(() => window.done)));
} finally { await browser.close(); srv.close(); }
