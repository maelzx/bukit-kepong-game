/* =============================================================================
   SCORE — the after-action assessment shown when the mission ends, win or lose.

   The intent is to grade how the station was held, not how many rounds were
   sent downrange. Accounting for an attacker is worth points; the ammunition
   it cost you moves those points up or down. A section that fires carefully
   and still has men, a building and a magazine at first light scores far
   better than one that emptied the armoury into the tree line.
   ========================================================================== */
'use strict';

const SCORE = {
  KILL: 100,          // per insurgent accounted for
  PAR_ROUNDS: 14,     // rounds per attacker a steady hand should need
  AMMO_SWING: 55,     // most that discipline moves a single kill, either way
  STATION: 900,       // a building still standing at full integrity
  CONSTABLE: 250,     // each constable still on his feet
  PER_SECOND: 3,      // time held, whatever the outcome
  FIRE: 150,          // each fire beaten out rather than left to burn
  HELD: 1500,         // reaching first light
};

/* Citations, best first. Deliberately conduct rather than medals — no real
   decoration is being simulated here. */
const CITATIONS = [
  [13000, 'CONSPICUOUS GALLANTRY'],
  [9000,  'DISTINGUISHED CONDUCT'],
  [5500,  'MENTIONED IN DISPATCHES'],
  [2500,  'COMMENDED'],
  [0,     'SERVICE RECORDED'],
];

const Score = {
  /** Rounds spent per attacker accounted for. Infinity before the first kill. */
  roundsPerKill(s) { return s.kills > 0 ? s.shots / s.kills : Infinity; },

  /**
   * Full breakdown for the end-of-mission panel. Every line carries its own
   * points so the player can see exactly where a run was won or lost, and the
   * difficulty multiplier is applied once at the end — RECRUIT aims and fires
   * for you, so what it scores is worth less.
   */
  compute(g) {
    const s = g.stats;
    const held = Math.floor(g.elapsed);
    const stationFrac = clamp(g.stationHp / CFG.STATION_HP, 0, 1);
    const up = g.police.reduce((n, p) => n + (p.alive ? 1 : 0), 0);

    // At par, discipline is worth nothing either way. Drop attackers in half
    // the rounds and it pays; hose the undergrowth and it costs.
    const rpk = this.roundsPerKill(s);
    const eff = s.kills > 0 ? clamp(SCORE.PAR_ROUNDS / rpk, 0.25, 2) : 0;
    const ammo = Math.round(s.kills * SCORE.AMMO_SWING * (eff - 1));

    const lines = [
      ['Insurgents accounted for', String(s.kills), s.kills * SCORE.KILL],
      ['Ammunition discipline',
        s.kills ? `${rpk.toFixed(1)} rounds each` : 'no account taken', ammo],
      ['Accuracy', s.shots ? Math.round(100 * s.hits / s.shots) + '%' : '—', 0],
      ['Rounds drawn from the crate', String(Math.round(s.roundsDrawn)), 0],
      ['Station integrity', Math.round(stationFrac * 100) + '%',
        Math.round(stationFrac * SCORE.STATION)],
      ['Section still standing', `${up}/${s.policeTotal}`, up * SCORE.CONSTABLE],
      ['Fires beaten out', String(s.firesOut), s.firesOut * SCORE.FIRE],
      ['Time held', this.time(held), held * SCORE.PER_SECOND],
    ];
    if (g.state === 'win') lines.push(['Held to first light', 'YES', SCORE.HELD]);

    const subtotal = lines.reduce((n, l) => n + l[2], 0);
    const mult = g.difficulty.scoreMul;
    const total = Math.max(0, Math.round(subtotal * mult));

    return {
      lines, subtotal, mult, total,
      difficulty: g.difficulty,
      citation: (CITATIONS.find(c => total >= c[0]) || CITATIONS[CITATIONS.length - 1])[1],
    };
  },

  time(sec) { return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; },

  /* --- personal best, per difficulty ---------------------------------------
     Stored locally and entirely optional: opened straight from the filesystem
     some browsers refuse storage outright, so every access is guarded and a
     failure simply means no best is shown. ---------------------------------- */
  key(diff) { return `bukit-kepong-best-${diff.key}`; },

  best(diff) {
    try { return parseInt(localStorage.getItem(this.key(diff)), 10) || 0; }
    catch (e) { return 0; }
  },

  /** Records the run. Returns true when it beat the stored best. */
  record(diff, total) {
    const prev = this.best(diff);
    if (total <= prev) return false;
    try { localStorage.setItem(this.key(diff), String(total)); } catch (e) { /* no storage */ }
    return true;
  },
};
