// NomadHouse net – a game room (lobby + lockstep relay).
// Knows no sockets and no clock: the host (Node party server, later a Cloudflare Durable Object)
// passes in connections, messages and the time, and calls tick() regularly.
// The room computes nothing of the game; it collects commands, stamps them into rounds and makes sure everyone keeps up.

import {
  PROTOCOL, ROUND_MS, SYNC_EACH, HOLD_MIN, DEAD_AFTER_MS, NEXT_TO_MS,
  MAX_COMMAND, MAX_COMMANDS_PER_ROUND, COLORS, BLUE, isBlue, REASON, name as cleanerName,
} from './protocol.js';

export class Room {
  constructor({ maxPlayer = 4, now = () => Date.now(), random = () => Math.random(), log = () => {} } = {}) {
    this.maxPlayer = maxPlayer;
    this.now = now;
    this.random = random;   // only for start value and tokens, never for the simulation
    this.log = log;
    this.connections = new Map(); // vid -> { sende, platz|null, zuletzt }
    this.seats = [];             // [{ platz, name, token, farbe, vid|null, online, ping, stand: {runde, summe}, raus }]
    this.phase = 'lobby';          // lobby | laeuft
    this.pause = null;             // null | { grund, wer?, seit }
    this.nextUm = 0;             // Countdown after a pause
    this.match = null;            // { saat, plaetze: [nr], runden: [[[platz, befehl], ...], ...] }
    this.isOpen = [];               // Commands for the next round
    this.nearestRoundUm = 0;
    this.nearestVid = 1;
    this.sums = new Map();       // round -> Map(slot -> checksum), for the desync comparison
  }

  // ---------- Verbindungen ----------
  connect(send) {
    const vid = this.nearestVid++;
    this.connections.set(vid, { send, seat: null, lastSeen: this.now() });
    return vid;
  }

  disconnect(vid) {
    const v = this.connections.get(vid);
    if (!v) return;
    this.connections.delete(vid);
    if (v.spectator) { this.sendState(); return; }
    const p = v.seat != null ? this.seats[v.seat] : null;
    if (p && p.vid === vid) {
      p.vid = null; p.online = false; p.ping = null;
      this.log(`${p.name} ist weg`);
      if (this.phase === 'lobby') { this.seats[p.seat] = { ...p, free: true }; this.moveUp(); }
      this.validatePause();
      this.sendState();
    }
  }

  msg(vid, m) {
    const v = this.connections.get(vid);
    if (!v || !m || typeof m !== 'object') return;
    v.lastSeen = this.now();
    const p = v.seat != null ? this.seats[v.seat] : null;
    if (m.t === 'ping') { v.send({ t: 'pong', z: m.z }); if (p && typeof m.ping === 'number') p.ping = Math.round(m.ping); return; }
    if (m.t === 'hello') return this.hello(vid, v, m);
    if (v.spectator) { if (m.t === 'bye') { this.connections.delete(vid); this.sendState(); } return; }
    if (!p || p.vid !== vid) return v.send({ t: 'error', text: 'Erst „hallo“ schicken.' });

    switch (m.t) {
      case 'start': return this.start(p);
      case 'color': return this.selectColor(p, m.color);
      case 'command': return this.command(p, m.b);
      case 'sync': return this.sync(p, m.round, m.sum);
      case 'pause': if (this.phase === 'running' && !this.pause) { this.pause = { reason: REASON.manual, who: p.name, since: this.now() }; this.sendState(); } return;
      case 'next': if (this.pause?.reason === REASON.manual) { this.pause = null; this.validatePause(); this.sendState(); } return;
      case 'without': return this.without(p, m.seat);
      case 'new': return this.toLobby(p);
      case 'bye': return this.leave(vid, p);
    }
  }

  // Log in. The room is protected (friends only), so the name serves as the key:
  // same name = same seat, even in a new window, on another device or after „Ohne … weiter“.
  // Whoever is new and gets no seat (full or game running) spectates.
  hello(vid, v, m) {
    if (m.protocol !== PROTOCOL) return v.send({ t: 'rejected', reason: 'version', text: `Andere Spielversion (Server ${PROTOCOL}, du ${m.protocol}). Seite neu laden.` });
    const name = cleanerName(m.name);
    const invKey = name.toLowerCase();
    let p = (m.token && this.seats.find((x) => x && !x.free && x.token === m.token))
      || this.seats.find((x) => x && !x.free && x.name.toLowerCase() === invKey);
    if (!p) {
      const nr = this.freeSeat();
      if (nr < 0) return this.watch(vid, v, name);
      p = this.newerSeat(nr, name);
      this.log(`${p.name} kommt dazu (Platz ${nr + 1})`);
    } else {
      p.name = name;
      if (isBlue(name) !== (p.color === BLUE)) p.color = this.startColor(name, p);
      if (p.out) { p.out = false; this.log(`${p.name} ist wieder dabei`); }
      else this.log(`${p.name} ist zurück`);
      if (p.vid != null && p.vid !== vid) { // old window is still attached: replace it
        const old = this.connections.get(p.vid);
        if (old) { old.seat = null; old.send({ t: 'rejected', reason: 'superseded', text: `„${p.name}“ spielt jetzt in einem anderen Fenster weiter.` }); }
      }
    }
    v.spectator = false;
    this.setOnto(vid, v, p);
    this.validatePause();
    this.sendState();
  }

  freeSeat() {
    if (this.phase !== 'lobby') return -1;
    let nr = this.seats.findIndex((x) => !x || x.free);
    if (nr < 0) nr = this.seats.length;
    return nr < this.maxPlayer ? nr : -1;
  }

  newerSeat(nr, name) {
    const p = { seat: nr, name, token: this.newToken(), color: this.startColor(name), vid: null, online: false, ping: null, sync: { round: -1, sum: null } };
    this.seats[nr] = p;
    return p;
  }

  // Blue for Daniel and the ghost, otherwise the first free color
  startColor(name, except = null) {
    if (isBlue(name)) return BLUE;
    const occupied = new Set(this.seats.filter((x) => x && !x.free && x !== except).map((x) => x.color));
    return COLORS.find((f) => !occupied.has(f)) || COLORS[0];
  }

  selectColor(p, color) {
    if (this.phase !== 'lobby' || isBlue(p.name) || !COLORS.includes(color)) return;
    if (this.seats.some((x) => x && !x.free && x !== p && x.color === color)) return this.on(p, { t: 'error', text: 'Die Farbe hat schon jemand.' });
    p.color = color;
    this.sendState();
  }

  setOnto(vid, v, p) {
    p.vid = vid; p.online = true; v.seat = p.seat;
    v.send({ t: 'welcome', seat: p.seat, token: p.token, protocol: PROTOCOL });
    if (this.match) v.send(this.matchMsg());
  }

  watch(vid, v, name) {
    v.spectator = true; v.name = name; v.seat = null;
    this.log(`${name} schaut zu`);
    v.send({ t: 'welcome', seat: null, spectator: true, protocol: PROTOCOL });
    if (this.match) v.send(this.matchMsg());
    this.sendState();
  }

  // In the lobby, spectators move up into free seats
  moveUp() {
    if (this.phase !== 'lobby') return;
    for (const [vid, v] of this.connections) {
      if (!v.spectator) continue;
      const nr = this.freeSeat();
      if (nr < 0) return;
      v.spectator = false;
      const p = this.newerSeat(nr, v.name);
      this.log(`${p.name} rückt auf Platz ${nr + 1}`);
      this.setOnto(vid, v, p);
    }
  }

  leave(vid, p) {
    const v = this.connections.get(vid);
    if (this.phase === 'lobby') { this.seats[p.seat] = { ...p, free: true, vid: null, online: false }; }
    else { p.out = true; p.online = false; p.vid = null; }
    if (v) v.seat = null;
    this.moveUp();
    this.validatePause();
    this.sendState();
  }

  newToken() {
    let s = '';
    for (let i = 0; i < 4; i++) s += Math.floor(this.random() * 0x100000000).toString(36);
    return s;
  }

  // ---------- Partie ----------
  active() { return this.seats.filter((p) => p && !p.free && !p.out); }

  start(p) {
    if (this.phase !== 'lobby') return;
    const da = this.active().filter((x) => x.online);
    if (da.length < 2) return this.on(p, { t: 'error', text: 'Es braucht mindestens zwei Spieler.' });
    // Close gaps: whoever is offline is dropped from the lobby
    for (const x of this.active()) if (!x.online) this.seats[x.seat] = { ...x, free: true };
    this.phase = 'running';
    this.pause = null;
    this.match = { seed: (Math.floor(this.random() * 0xFFFFFFFF) >>> 0) || 1, seats: this.active().map((x) => x.seat), rounds: [] };
    for (const x of this.active()) x.sync = { round: -1, sum: null };
    this.isOpen = [];
    this.sums.clear();
    this.nextUm = this.now() + NEXT_TO_MS;   // short countdown so everyone is ready
    this.nearestRoundUm = this.nextUm;
    this.log(`Partie startet (Startwert ${this.match.seed}, ${this.match.seats.length} Spieler)`);
    this.sendAll(this.matchMsg());
    this.sendState();
  }

  matchMsg() {
    return { t: 'match', seed: this.match.seed, seats: this.match.seats, rounds: this.match.rounds };
  }

  command(p, b) {
    if (this.phase !== 'running' || p.out) return;
    let text;
    try { text = JSON.stringify(b); } catch { return; }
    if (!text || text.length > MAX_COMMAND) return;
    const ownItems = this.isOpen.filter(([nr]) => nr === p.seat).length;
    if (ownItems >= MAX_COMMANDS_PER_ROUND) return;
    this.isOpen.push([p.seat, JSON.parse(text)]);
  }

  sync(p, round, sum) {
    if (this.phase !== 'running' || typeof round !== 'number') return;
    if (round > p.sync.round) p.sync = { round, sum };
    if (sum == null) return;
    let m = this.sums.get(round);
    if (!m) { m = new Map(); this.sums.set(round, m); }
    m.set(p.seat, sum);
    const stats = new Set(m.values());
    if (stats.size > 1) {
      const sums = Object.fromEntries(m);
      this.log(`DESYNC in Runde ${round}: ${JSON.stringify(sums)}`);
      this.pause = { reason: REASON.desync, round, sums, since: this.now() };
      this.sendAll({ t: 'desync', round, sums });
      this.sendState();
    }
    // Clean up old entries once everyone has reported
    const bottom = Math.min(...this.active().map((x) => x.sync.round));
    for (const r of this.sums.keys()) if (r < bottom - SYNC_EACH * 4) this.sums.delete(r);
  }

  without(p, seat) {
    const x = this.seats[seat];
    if (this.phase !== 'running' || !x || x.out || x.online) return;
    x.out = true;
    this.log(`${p.name}: weiter ohne ${x.name}`);
    this.validatePause();
    this.sendState();
  }

  toLobby(p) {
    if (this.phase === 'lobby') return;
    this.log(`${p.name}: zurück zur Lobby`);
    this.phase = 'lobby';
    this.match = null;
    this.pause = null;
    this.isOpen = [];
    for (const x of this.seats) if (x && (x.out || !x.online)) this.seats[x.seat] = { ...x, free: true, out: false, vid: null };
    this.sendAll({ t: 'lobby' });
    this.moveUp();
    this.sendState();
  }

  // ---------- Gastgeber (Server-Rechner) ----------
  // Actions from the host side. Who may use them is decided by the host process (party server: only the local machine).
  host(m) {
    const g = { name: 'Gastgeber', seat: -1 };
    switch (m?.t) {
      case 'start': {
        const da = this.active().filter((x) => x.online);
        if (this.phase !== 'lobby' || da.length < 2) return { ok: false, text: 'Es braucht mindestens zwei Spieler.' };
        this.start(da[0]); return { ok: true };
      }
      case 'pause': if (this.phase === 'running' && !this.pause) { this.pause = { reason: REASON.manual, who: g.name, since: this.now() }; this.sendState(); } return { ok: true };
      case 'next': if (this.pause?.reason === REASON.manual) { this.pause = null; this.validatePause(); this.sendState(); } return { ok: true };
      case 'lobby': this.toLobby(g); return { ok: true };
      // Game master: a command that enters the next round like a player command (slot −1).
      // All devices execute it in the same round, so everything stays deterministic.
      case 'command': {
        if (this.phase !== 'running') return { ok: false, text: 'Es läuft keine Partie.' };
        let text; try { text = JSON.stringify(m.b); } catch { return { ok: false }; }
        if (!text || text.length > MAX_COMMAND) return { ok: false };
        this.isOpen.push([-1, JSON.parse(text)]);
        this.log(`Spielleiter: ${({ wind: 'Windstoß' })[m.b?.kind] ?? m.b?.kind ?? 'Befehl'}`);
        return { ok: true };
      }
      case 'out': {
        const x = this.seats[m.seat];
        if (!x || x.free) return { ok: false, text: 'Diesen Platz gibt es nicht.' };
        this.log(`Gastgeber wirft ${x.name} raus`);
        const v = x.vid != null && this.connections.get(x.vid);
        if (v) { v.seat = null; v.send({ t: 'rejected', reason: 'out', text: 'Der Gastgeber hat dich aus dem Raum genommen. Mit deinem Namen kannst du wieder beitreten.' }); }
        if (this.phase === 'lobby') { this.seats[x.seat] = { ...x, free: true, vid: null, online: false }; this.moveUp(); }
        else { x.out = true; x.online = false; x.vid = null; }
        this.validatePause(); this.sendState();
        return { ok: true };
      }
    }
    return { ok: false, text: 'Unbekannte Aktion.' };
  }

  // Is there a reason to pause? (Desync and manual pause stay until they are resolved.)
  validatePause() {
    if (this.phase !== 'running') return;
    if (this.pause && this.pause.reason !== REASON.disconnected) return;
    const way = this.active().filter((x) => !x.online);
    if (way.length) {
      if (!this.pause) this.log(`Pause: ${way.map((x) => x.name).join(', ')} getrennt`);
      this.pause = { reason: REASON.disconnected, who: way.map((x) => x.name).join(', '), seats: way.map((x) => x.seat), since: this.pause?.since ?? this.now() };
    } else if (this.pause) {
      this.pause = null;
      this.nextUm = this.now() + NEXT_TO_MS;
    }
  }

  // Who is lagging too far behind? (e.g. an iPad that recomputes everything after waking up)
  straggler() {
    const n = this.match ? this.match.rounds.length : 0;
    return this.active().filter((x) => x.online && n - 1 - x.sync.round > HOLD_MIN);
  }

  // ---------- Takt ----------
  tick() {
    const now = this.now();
    // close dead connections
    for (const [vid, v] of this.connections) if (now - v.lastSeen > DEAD_AFTER_MS) { this.log(`Verbindung ${vid} antwortet nicht mehr`); v.send({ t: 'to' }, true); this.disconnect(vid); }
    if (this.phase !== 'running' || this.pause) return;
    if (now < this.nextUm) return;
    const waiting = this.straggler();
    const alreadyWaiting = this.waitsOnto || '';
    const nowWaiting = waiting.map((x) => x.seat).join(',');
    if (nowWaiting !== alreadyWaiting) { this.waitsOnto = nowWaiting; this.sendState(); }
    if (waiting.length) { this.nearestRoundUm = now + ROUND_MS; return; }
    // Emit rounds; after a delay catch up at most a few, otherwise restart the schedule
    if (this.nearestRoundUm < now - ROUND_MS * 3) this.nearestRoundUm = now;
    while (now >= this.nearestRoundUm) {
      const n = this.match.rounds.length;
      const b = this.isOpen; this.isOpen = [];
      this.match.rounds.push(b);
      this.sendAll({ t: 'round', n, b });
      this.nearestRoundUm += ROUND_MS;
    }
  }

  // ---------- Senden ----------
  on(p, m) { const v = p.vid != null && this.connections.get(p.vid); if (v) v.send(m); }
  sendAll(m) { for (const v of this.connections.values()) if (v.seat != null || v.spectator) v.send(m); }

  state() {
    const waits = this.phase === 'running' ? this.straggler().map((x) => x.seat) : [];
    this.waitsOnto = waits.join(',');
    return {
      t: 'state',
      phase: this.phase,
      max: this.maxPlayer,
      pause: this.pause,
      nextUm: this.nextUm,
      now: this.now(),
      round: this.match ? this.match.rounds.length : 0,
      waits,
      spectator: [...this.connections.values()].filter((v) => v.spectator).map((v) => ({ name: v.name })),
      player: this.seats.filter((p) => p && !p.free).map((p) => ({
        seat: p.seat, name: p.name, color: p.color, online: p.online, ping: p.ping, out: !!p.out, round: p.sync.round,
      })),
    };
  }
  sendState() { this.sendAll(this.state()); }
}
