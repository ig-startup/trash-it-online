/**
 * A battle played at one keyboard — the original's own (F.EXE game type 1,
 * "battle framework", VA 0x212d2). The rules are the server's (GameRoom's
 * startBattle / _endLevel / nextBattleStep), kept here for when there is
 * no server; see "Type 1, battle" in scripts/formats/README.md.
 *
 * Up to four players play a battle set, a fixed list of B levels each with
 * the hammer everyone gets for it. The order of the rings is the place;
 * places score 2/1, 4/2/1 or 8/4/2/1 by how many play (VA 0x13fa1), and a
 * player who never rang scores nothing. After the last level the most
 * points win (VA 0x13e80); a tie is played off by the tied players alone,
 * on the level just played, all with the guitar.
 */
import BATTLES from '../../../shared/battles.json';

/** The last one left to ring has a minute at most. */
export const LAST_ONE_SECONDS = 60;

export default class LocalBattle {
  /**
   * @param {number} setIndex 0..4
   * @param {string[]} ids the players, in order
   */
  constructor(setIndex, ids) {
    this.set = Math.max(0, Math.min(BATTLES.sets.length - 1, Number(setIndex) || 0));
    this.levels = BATTLES.sets[this.set];
    this.index = 0;
    this.ids = [...ids];
    this.points = Object.fromEntries(ids.map((id) => [id, 0]));
    this.tieBreak = false;
    this.active = null;
  }

  /** The level to play now, and what the panel shows of the battle. */
  current() {
    const step = this.levels[this.index];
    return {
      level: step.level,
      active: this.active,
      battle: {
        set: this.set, level: this.index + 1, of: this.levels.length,
        tieBreak: this.tieBreak, hammer: step.hammer, points: { ...this.points },
      },
    };
  }

  /**
   * The level is over (F.EXE VA 0x13fa1): the places score.
   * @param {string[]} places who rang, in order
   * @param {boolean} timeout whether the clock ran out
   */
  endLevel(places, timeout) {
    const table = BATTLES.points[String(Math.min(4, Math.max(2, this.ids.length)))];
    const award = {};
    places.forEach((id, i) => {
      award[id] = table[i] || 0;
      this.points[id] = (this.points[id] || 0) + award[id];
    });
    return {
      places, award, points: { ...this.points }, timeout,
      battle: { level: this.index + 1, of: this.levels.length, tieBreak: this.tieBreak },
    };
  }

  /**
   * What follows (F.EXE VA 0x13e80): the next level of the set; after the
   * last, the winner — or a tie-break for those sharing the top.
   * @returns {ReturnType<LocalBattle['current']>|{over: true, winners: string[], points: object}}
   */
  next() {
    this.index += 1;
    if (this.index < this.levels.length) return this.current();
    const top = Math.max(...this.ids.map((id) => this.points[id]));
    const winners = this.ids.filter((id) => this.points[id] === top);
    if (winners.length > 1) {
      const last = this.levels[this.levels.length - 1];
      this.levels = [{ level: last.level, hammer: BATTLES.tieBreakHammer }];
      this.index = 0;
      this.tieBreak = true;
      this.active = winners;
      return this.current();
    }
    return { over: true, winners, points: { ...this.points } };
  }
}
