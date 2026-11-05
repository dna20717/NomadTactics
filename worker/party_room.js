// Cloudflare Durable Object: one party room (the same Room as the LAN party server).
// The room relays commands in lockstep and computes nothing of the game. Its state lives in memory:
// if Cloudflare evicts the object (nobody connected for a while), the next visit starts with a fresh lobby.
//
// While someone is connected, a 20 ms clock drives room.tick(); with nobody left the clock stops,
// so an empty room costs nothing.

import { Room } from '../engine/net/room.js';

export class PartyRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map(); // vid -> WebSocket
    this.room = new Room({ maxPlayer: Number(env?.PARTY_MAX) || 4, log: () => {} });
    this.clock = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Erwartet WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  attach(ws) {
    const vid = this.room.connect((m, shut) => {
      try { ws.send(JSON.stringify(m)); if (shut) ws.close(1000, 'bye'); } catch { /* already closed */ }
    });
    this.sockets.set(vid, ws);
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > 4000) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.room.msg(vid, m);
    });
    const gone = () => { if (!this.sockets.has(vid)) return; this.sockets.delete(vid); this.room.disconnect(vid); this.idle(); };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
    if (!this.clock) this.clock = setInterval(() => this.room.tick(), 20);
  }

  idle() {
    if (this.sockets.size > 0 || !this.clock) return;
    clearInterval(this.clock);
    this.clock = null;
  }
}
