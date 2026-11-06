// Picture of the workshop's models page (list or gallery, with the 3D preview): node tools/kit/workshop_shot.mjs [--choice abrams] [--gallery] [--filter x] [--out output/ws_models.png]
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8824, '127.0.0.1');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const P = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  P.on('pageerror', (e) => console.log('pageerror', String(e))); P.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await P.goto('http://127.0.0.1:8824/tactics.html');
  await P.waitForFunction(() => window.workshop?.p, null, { timeout: 60000 });
  await P.evaluate(([choice, gallery, filter]) => { const w = window.workshop; w.modelGallery = gallery; w.filter = filter || ''; w.go({ area: 'models', choice }); }, [arg('choice', 'abrams'), process.argv.includes('--gallery'), arg('filter', '')]);
  await new Promise((ok) => setTimeout(ok, +arg('wait', 6000)));
  const out = arg('out', 'output/ws_models.png'); await P.screenshot({ path: out }); console.log(out);
} finally { await browser.close(); srv.close(); }
