#!/usr/bin/env node
// NomadTactics – LAN-Party-Server.
// Serves the game page and relays commands in lockstep (WebSocket at /netz).
// Start: node tools/party/server.js [--port 8080] [--max 4]   (on Windows: double-click start_party.bat)

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { acceptConn, isUpgrade } from './websocket.js';
import { Room } from '../../engine/net/room.js';
import { PROTOCOL } from '../../engine/net/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASED = ['party.html', 'host.html', 'game/', 'engine/', 'projects/nomadtactics/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

// ANSI colors (Windows 11 Terminal and console support this)
function color(text, ...codes) { return process.stdout.isTTY ? `\x1b[${codes.join(';')}m${text}\x1b[0m` : text; }

export function addresses(port) {
  const list = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) list.push({ name, url: `http://${n.address}:${port}` });
  }
  // Home networks (192.168.x / 10.x) first, virtual adapters (vEthernet, WSL, VirtualBox) last
  const rank = (a) => (/vethernet|wsl|virtual|vmware|docker|hyper-v/i.test(a.name) ? 2 : /^http:\/\/(192\.168|10\.)/.test(a.url) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b));
}

export function startServer({ port = 8080, max = 4, quiet = false, host = '0.0.0.0', open = false } = {}) {
  const protocol = []; // the latest messages for the host page
  const started = Date.now();
  const log = (t) => {
    protocol.push({ time: Date.now(), text: t }); if (protocol.length > 200) protocol.shift();
    if (!quiet) console.log(`  ${color(new Date().toLocaleTimeString('de-DE'), 90)}  ${t}`);
  };
  const local = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
  const reply = (res, code, data) => { res.writeHead(code, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const room = new Room({ maxPlayer: max, log });

  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (p === '' ) { res.writeHead(302, { location: '/party.html' }); return res.end(); }
    if (p === 'host') { res.writeHead(302, { location: '/host.html' }); return res.end(); }
    if (p === 'host/status') {
      return reply(res, 200, { ...room.state(), addresses: addresses(port).map((a) => a.url), port, protocol: protocol.slice(-60), may: local(req), since: started });
    }
    if (p === 'host/action' && req.method === 'POST') {
      if (!local(req)) return reply(res, 403, { ok: false, text: 'Nur am Server-Rechner erlaubt.' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
      req.on('end', () => { let m; try { m = JSON.parse(body); } catch { return reply(res, 400, { ok: false }); } reply(res, 200, room.host(m)); });
      return;
    }
    // The battle page asks this to find out where it is: here it reads the game data from the served files
    if (p === 'api/session') return reply(res, 200, { lan: true });
    if (p === 'addresses') { res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify(addresses(port).map((a) => a.url))); }
    if (p === 'status') { res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify(room.state())); }
    const file = path.resolve(ROOT, p);
    const allowed = file.startsWith(ROOT + path.sep) && RELEASED.some((f) => p === f || p.startsWith(f)) && !p.includes('..');
    if (!allowed) { res.writeHead(404); return res.end('Nicht gefunden'); }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/net' || !isUpgrade(req)) { socket.destroy(); return; }
    const ws = acceptConn(req, socket);
    if (!ws) return;
    const vid = room.connect((m, shut) => { ws.send(JSON.stringify(m)); if (shut) ws.close(); });
    ws.onMessage = (text) => { let m; try { m = JSON.parse(text); } catch { return; } room.msg(vid, m); };
    ws.onClose = () => room.disconnect(vid);
  });

  const clock = setInterval(() => room.tick(), 20);
  server.listen(port, host, () => {
    if (quiet) return;
    const list = addresses(port);
    const addr = list[0]?.url || `http://localhost:${port}`;
    console.log('');
    console.log('  ' + color('NOMADTACTICS', 1, 33) + color('  ·  Party-Server läuft', 37));
    console.log('');
    console.log('  Gastgeber-Seite:  ' + color(`http://localhost:${port}/host`, 1, 36));
    console.log('  Mitspielen:       ' + color(addr, 1));
    console.log('');
    console.log(color('  Dieses Fenster offen lassen. Beenden: schließen oder Strg+C.', 90));
    console.log('');
    if (open) { // Open the host page right away too
      const url = `http://localhost:${port}/host`;
      exec(process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`, () => {});
    }
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  Port ${port} ist schon belegt. Läuft der Server schon? Sonst: start_party.bat --port 8081\n`);
    else console.error(e);
    process.exitCode = 1;
  });
  return { server, room, stop: () => new Promise((ok) => { clearInterval(clock); for (const s of room.connections.keys()) room.disconnect(s); server.closeAllConnections?.(); server.close(() => ok()); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, s) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : s; };
  startServer({ port: Number(arg('--port', 8080)), max: Number(arg('--max', 4)), open: process.argv.includes('--open') });
}
