/**
 * The arcade, played at one keyboard — the original's own (F.EXE game
 * type 2, VA 0x214c2; see "Type 2, arcade" in scripts/formats/README.md).
 *
 * The number of players is picked once (VA 0x19d2b) and teams are entered
 * one after another, up to four (VA 0x177df). Then the teams take turns on
 * one K level from the arcade list, every player of the team at once, each
 * with that row's hammer and under its mission line. The clock starts at 0
 * and counts up in tenths (G.EXE VA 0x19edb); the time a team finishes in
 * is kept (record +0x158 by team), and the best so far is handed to the
 * next team to beat (+0x104). When every team has played the times are put
 * in order, equal times sharing a place (VA 0x11e2c).
 */
import BATTLES from '../../../shared/battles.json';

export const ARCADE = BATTLES.arcade;

/** The clock stops at 60:00.0 (0x60000 in BCD, VA 0x19efa). */
export const ARCADE_MAX_TENTHS = 60 * 60 * 10;

/** The mission lines, in the clone's language. */
export function missionText(line) {
  const trash = /^trash (\d+)%/.exec(line);
  if (trash) return `РАЗНЕСИ ${trash[1]}%, ЧТОБЫ ОСВОБОДИТЬ КОЛОКОЛЬЧИК`;
  return {
    'get to the bell': 'ДОБЕРИСЬ ДО КОЛОКОЛЬЧИКА',
    'ring the bell': 'ПОЗВОНИ В КОЛОКОЛЬЧИК',
    'hit the bell': 'УДАРЬ ПО КОЛОКОЛЬЧИКУ',
    'collect the timmies': 'СОБЕРИ ТИММИ',
  }[line] || line.toUpperCase();
}

/** Tenths of a second as the panel shows them: m:ss.t */
export function formatTenths(t) {
  const m = Math.floor(t / 600);
  const s = Math.floor((t % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${t % 10}`;
}

export default class LocalArcade {
  /**
   * @param {number} row 0..14, the K level picked
   * @param {number} teams 1..4
   */
  constructor(row, teams) {
    this.row = Math.max(0, Math.min(ARCADE.length - 1, Number(row) || 0));
    this.entry = ARCADE[this.row];
    this.teams = Math.max(1, Math.min(4, Number(teams) || 1));
    this.current = 0;
    this.times = [];
    this.best = null;
  }

  /**
   * The team on now has finished — in `tenths`, or not at all (null).
   * @returns {boolean} whether another team is still to play
   */
  record(tenths) {
    this.times[this.current] = tenths;
    if (tenths !== null && (this.best === null || tenths < this.best)) this.best = tenths;
    this.current += 1;
    return this.current < this.teams;
  }

  /** Every team by its time, fastest first; equal times share a place. */
  standings() {
    const rows = this.times.map((time, team) => ({ team, time }));
    rows.sort((a, b) => (a.time === null) - (b.time === null) || a.time - b.time);
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.place = prev && prev.time === r.time ? prev.place : i + 1;
    });
    return rows;
  }
}
