// NomadHouse net – lockstep on the client side.
// Receives rounds from the server and runs the simulation round by round.
// The simulation needs: command(platz, b), step(), sum(). It is built with newSim(saat, plaetze).
// Runs in Node (tests, headless clients) and in the browser.

import { TICKS_PER_ROUND, SYNC_EACH } from './protocol.js';

export class Lockstep {
  constructor(newSim, { reportSync = () => {} } = {}) {
    this.newSim = newSim;
    this.reportSync = reportSync; // (runde, summe) – an den Server
    this.sim = null;
    this.rounds = [];   // rounds confirmed by the server
    this.done = -1;   // last executed round
    this.seed = 0;
    this.seats = [];
  }

  // New or resumed game: all previous rounds come with it.
  match(m) {
    const same = this.sim && this.seed === m.seed && this.rounds.length <= m.rounds.length;
    if (!same) {
      this.seed = m.seed;
      this.seats = m.seats;
      this.sim = this.newSim(m.seed, m.seats);
      this.done = -1;
    }
    this.rounds = m.rounds.slice();
  }

  round(m) {
    if (!this.sim) return;
    if (m.n === this.rounds.length) this.rounds.push(m.b);
    else if (m.n < this.rounds.length) return; // doppelt, schon da
    // Gap: can only happen after a connection error; the line then fetches a new „partie“.
    else this.gap = true;
  }

  get isOpen() { return this.rounds.length - 1 - this.done; }

  // Catches up by up to maxRounds. Returns the number of rounds executed.
  progress(maxRounds = Infinity) {
    if (!this.sim) return 0;
    let n = 0;
    while (this.done < this.rounds.length - 1 && n < maxRounds) {
      const r = this.done + 1;
      for (const [seat, b] of this.rounds[r]) this.sim.command(seat, b);
      for (let i = 0; i < TICKS_PER_ROUND; i++) this.sim.step();
      this.done = r;
      n++;
      if (r % SYNC_EACH === SYNC_EACH - 1) this.reportSync(r, this.sim.sum());
    }
    return n;
  }
}
