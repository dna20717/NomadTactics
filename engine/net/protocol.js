// NomadHouse net – shared constants for party server, browser and later Cloudflare.
// Runs in Node and in the browser, no dependencies.
//
// Flow (deterministic lockstep with server tick):
//   The server emits a round every ROUND_MS. It contains all commands that arrived since the last round,
//   in a fixed order. Each client runs exactly TICKS_PER_ROUND steps of its simulation
//   round by round. Same rounds + same start value = same game on every device.

export const PROTOCOL = 5;          // increase on incompatible changes; server rejects foreign versions
export const ROUND_MS = 100;         // one round = 100 ms
export const TICKS_PER_ROUND = 2;    // simulation runs at 20 steps per second
export const SYNC_EACH = 5;         // clients report their checksum every 5 rounds (= heartbeat of the simulation)
export const HOLD_MIN = 30;         // if a player falls more than 30 rounds (3 s) behind, the server waits
export const PING_MS = 1000;         // Clients pingen jede Sekunde
export const DEAD_AFTER_MS = 4500;     // a connection counts as dead after this long without a message
export const NEXT_TO_MS = 2000;  // after a pause, play only resumes after this grace period (countdown)
export const MAX_NAME = 20;
export const MAX_COMMAND = 2000;      // Zeichen JSON je Befehl
export const MAX_COMMANDS_PER_ROUND = 20;

// Team colors: blue belongs to Daniel (and the ghost). Everyone else picks from 8 colors, none of them blue.
export const BLUE = '#4a90e2';
export const COLORS = ['#e2524a', '#f2994a', '#f2c94c', '#b5d33d', '#4caf50', '#9b6ade', '#e46fb4', '#a0714f'];
export const COLOR_NAMES = { '#4a90e2': 'Blau', '#e2524a': 'Rot', '#f2994a': 'Orange', '#f2c94c': 'Gelb', '#b5d33d': 'Limette', '#4caf50': 'Grün', '#9b6ade': 'Lila', '#e46fb4': 'Pink', '#a0714f': 'Braun' };
export function isBlue(name) {
  const n = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  return n === 'daniel' || n === 'geist';
}

// Pause reasons
export const REASON = {
  disconnected: 'disconnected',   // a player is gone (connection dropped)
  manual: 'manual', // someone pressed pause
  desync: 'desync',       // checksums differ, the game can no longer be saved
};

export function name(s) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME) || 'Spieler';
}
