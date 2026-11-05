// Small dependency-free WebSocket server (RFC 6455, text messages only).
// This way the party server needs nothing but Node itself on Windows – no npm install.

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 1 << 20; // 1 MB is enough for everything except huge matches on reconnect (those go out, not in)

export function isUpgrade(req) {
  return (req.headers.upgrade || '').toLowerCase() === 'websocket';
}

// Accepts the HTTP upgrade request and returns a slim socket object
// { sende(text), schliesse(), onnachricht, onzu }.
export function acceptConn(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 10000);

  const ws = { onMessage: () => {}, onClose: () => {}, isOpen: true };
  let buffer = Buffer.alloc(0);
  let parts = [];

  const to = () => { if (!ws.isOpen) return; ws.isOpen = false; try { socket.destroy(); } catch {} ws.onClose(); };

  function frame(op, data) {
    const n = data.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    return Buffer.concat([head, data]);
  }

  ws.send = (text) => { if (ws.isOpen) { try { socket.write(frame(0x1, Buffer.from(text, 'utf8'))); } catch { to(); } } };
  ws.close = () => { if (ws.isOpen) { try { socket.write(frame(0x8, Buffer.alloc(0))); } catch {} socket.end(); to(); } };

  socket.on('data', (piece) => {
    buffer = Buffer.concat([buffer, piece]);
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const op = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let n = buffer[1] & 0x7f, pos = 2;
      if (n === 126) { if (buffer.length < 4) return; n = buffer.readUInt16BE(2); pos = 4; }
      else if (n === 127) { if (buffer.length < 10) return; n = Number(buffer.readBigUInt64BE(2)); pos = 10; }
      if (n > MAX_MSG || !masked) { to(); return; } // Clients must mask
      if (buffer.length < pos + 4 + n) return;
      const mask = buffer.subarray(pos, pos + 4); pos += 4;
      const data = Buffer.from(buffer.subarray(pos, pos + n));
      for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
      buffer = buffer.subarray(pos + n);

      if (op === 0x8) { ws.close(); return; }
      if (op === 0x9) { try { socket.write(frame(0xA, data)); } catch {} continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        parts.push(data);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; ws.onMessage(text); }
      }
    }
  });
  socket.on('close', to);
  socket.on('error', to);
  socket.on('end', to);
  return ws;
}
