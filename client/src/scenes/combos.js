/**
 * Key combinations: the hammers' tricks and cheats — see docs/re/jack/combos.md.
 *
 * Each hammer carries a list of (key sequence, handler) pairs, registered
 * for the player by `combo_register` (VA 0x1df22). Every tick
 * `combos_check` (0x1df6c) steps each sequence against the player's input
 * word with `combo_step` (0x1dfc6), and the sequences are read out of
 * G.EXE by `scripts/formats/combos.py`.
 *
 * Input word: L R U D = 1 2 4 8, BUT1 0x10, BUT2 0x20. The pad's extra
 * buttons (0x40, 0x80) have no key here, so the sequences spelled with them
 * are left out: a browser has one spelling of each, the keyboard's.
 */

export const WORD = {
  LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, BUT1: 0x10, BUT2: 0x20,
};

/** `combo_step`: ticks a word may be held, or a gap last, before the sequence starts over. */
export const COMBO_IDLE = 10;

/**
 * The keyboard sequences of the catalogue. Each is a list of input words;
 * a 0 is a tick with nothing held, and the handler fires as the last word
 * matches. `arm` is on every hammer; the rest are named for whose they are.
 */
export const SEQUENCES = {
  // 0x1dead: BUT1, released for three ticks, three times
  arm: [0x10, 0, 0, 0, 0x10, 0, 0, 0, 0x10, 0, 0, 0],
  // 0x1e037: R R L, BUT1 five times, then a long cheat code
  warp: [2, 0, 2, 0, 1, 0, 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 32, 0, 16, 0, 32, 0, 16, 0, 16, 0,
    16, 0, 16, 0, 16, 0, 32, 0, 4, 0, 8, 0, 2, 0, 1, 0, 16, 0, 32, 0, 16, 0, 32, 0],
  // hammer 20, 0x1dead: D+BUT2, BUT2 three times, then released
  sledge: [40, 32, 40, 32, 40, 32, 0],
  // hammer 29, 0x1dead: BUT2, L, BUT2, D, BUT2, L, BUT2, U, BUT2 — BUT2 held throughout
  apocalypse: [32, 33, 32, 40, 32, 33, 32, 36, 32],
  // hammer 33, 0x204c3: the warp's start, then BUT2 BUT1 BUT2 BUT1 BUT2
  dragon: [2, 0, 2, 0, 1, 0, 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 32, 0, 16, 0, 32, 0, 16, 0, 32, 0],
  // hammer 34, 0x204f4
  moola: [2, 0, 32, 0, 1, 0, 16, 0, 4, 0, 32, 0, 8, 0, 16, 0, 1, 0, 32, 0, 2, 0, 16, 0],
};

/**
 * Which handlers a hammer's list holds, in the order the game registers
 * them (the handler of a sequence that comes first fires first). Every
 * hammer has the warp and the arm; four have more.
 * @param {number} hammer index into the catalogue
 * @returns {{name: string, words: number[]}[]}
 */
export function sequencesFor(hammer) {
  const names = {
    20: ['sledge', 'warp', 'arm'],
    29: ['apocalypse', 'warp', 'arm'],
    33: ['dragon', 'warp', 'arm'],
    34: ['moola', 'warp', 'arm'],
  }[hammer] || ['warp', 'arm'];
  return names.map((name) => ({ name, words: SEQUENCES[name] }));
}

/** One player's sequences, stepped a tick at a time. */
export class ComboWatcher {
  /**
   * @param {{name: string, words: number[]}[]} list
   * @param {(name: string) => void} fire  a sequence has been keyed in
   */
  constructor(list, fire) {
    this._fire = fire;
    this._seqs = list.map(({ name, words }) => ({
      name, words, at: 0, last: -1, idle: 0,
    }));
  }

  /** `combos_check`: every sequence against this tick's input word. */
  step(word) {
    this._seqs.forEach((s) => this._stepOne(s, word));
  }

  /** `combo_step` (VA 0x1dfc6). */
  _stepOne(s, word) {
    if (word === s.words[s.at]) {
      s.at += 1;
      if (s.at === s.words.length) {
        // the -1 that ends the list: nothing matches it, so it waits to start over
        this._fire(s.name);
      }
      s.idle = COMBO_IDLE;
      s.last = word;
      return;
    }
    // a different word than the last one, or the last held too long: start over
    const was = s.idle;
    s.idle -= 1;
    if (word !== s.last || was === 0) {
      s.last = -1;
      s.at = 0;
    }
  }
}
