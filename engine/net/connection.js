// NomadHouse net – the "line" to the server over WebSocket (browser and Node 22+, both have WebSocket built in).
// Handles login, ping, reconnecting and optional artificial delay for testing.
// The simulation sees none of this; it only receives rounds.
//
// A second plug (Cloudflare) with the same interface will be added later.

import { PROTOCOL, PING_MS, DEAD_AFTER_MS } from './protocol.js';

export class Connection {
  // url: ws://host:port/netz · name · speicher: { lies(), schreib(token) } · test: { verz, zitter } in ms
  constructor({ url, name, store = null, test = {}, WS = globalThis.WebSocket, now = () => Date.now(), data = null }) {
    this.url = url; this.name = name; this.data = data; this.store = store; this.test = test; this.WS = WS; this.now = now;
    this.token = store?.lies() || null;
    this.ws = null;
    this.status = 'off';      // off | connect | there | gone | rejected
    this.attempt = 0;
    this.ping = null;
    this.lastSeen = 0;
    this.handler = {};        // t -> fn(m)
    this.onStatus = () => {};
    this.off = false;
  }

  on(t, fn) { this.handler[t] = fn; return this; }

  start() { this.off = false; this.open(); this.clock = setInterval(() => this.tick(), 250); return this; }

  stop() {
    this.off = true; clearInterval(this.clock); clearTimeout(this.again);
    if (this.ws) { try { this.sendNow({ t: 'bye' }); this.ws.close(); } catch {} }
    this.set('off');
  }

  set(s, info) { this.status = s; this.onStatus(s, info); }

  open() {
    if (this.off) return;
    this.set('connect');
    let ws;
    try { ws = new this.WS(this.url); } catch { return this.later(); }
    this.ws = ws;
    this.lastSeen = this.now();
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempt = 0;
      this.sendNow({ t: 'hello', protocol: PROTOCOL, name: this.name, token: this.token, data: this.data });
    };
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      const text = typeof e.data === 'string' ? e.data : String(e.data);
      this.delayed(() => this.receive(JSON.parse(text)));
    };
    ws.onclose = () => { if (ws === this.ws) { this.ws = null; if (this.status !== 'rejected') { this.set('way'); this.later(); } } };
    ws.onerror = () => {};
  }

  later() {
    if (this.off) return;
    clearTimeout(this.again);
    const ms = Math.min(4000, 250 * 2 ** this.attempt++);
    this.again = setTimeout(() => this.open(), ms);
  }

  receive(m) {
    this.lastSeen = this.now();
    if (m.t === 'pong') { this.ping = this.now() - m.z; return; }
    if (m.t === 'welcome') { this.token = m.token; this.store?.write(m.token); this.seat = m.seat; this.set('da'); }
    if (m.t === 'rejected') {
      this.set('rejected', m);
      if (m.reason === 'running' || m.reason === 'full') this.store?.write(null);
      try { this.ws?.close(); } catch {}
      this.ws = null;
    }
    if (m.t === 'to') { try { this.ws?.close(); } catch {} return; }
    this.handler[m.t]?.(m);
  }

  // Test helper: delay messages in both directions (order is preserved, like TCP)
  delayed(fn) {
    const { delay = 0, jitter = 0 } = this.test;
    if (!delay && !jitter) return fn();
    const thenDo = Math.max(this.lastDelivery || 0, this.now() + delay + Math.floor(Math.random() * (jitter + 1)));
    this.lastDelivery = thenDo;
    setTimeout(fn, thenDo - this.now());
  }

  send(m) { this.delayedSend(() => this.sendNow(m)); }
  delayedSend(fn) {
    const { delay = 0, jitter = 0 } = this.test;
    if (!delay && !jitter) return fn();
    const thenDo = Math.max(this.lastSend || 0, this.now() + delay + Math.floor(Math.random() * (jitter + 1)));
    this.lastSend = thenDo;
    setTimeout(fn, thenDo - this.now());
  }
  sendNow(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // Test helper: cut the connection hard (like Wi-Fi gone)
  cut() { if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch {} this.set('way'); this.later(); } }

  tick() {
    if (!this.ws || this.ws.readyState !== 1) return;
    const now = this.now();
    if (!this.lastPing || now - this.lastPing >= PING_MS) { this.lastPing = now; this.send({ t: 'ping', z: now, ping: this.ping }); }
    // Server schweigt zu lange (z. B. iPad war im Schlaf, WLAN gewechselt): neu verbinden
    if (now - this.lastSeen > DEAD_AFTER_MS) this.cut();
  }
}
