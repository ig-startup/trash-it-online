/**
 * Four players on one keyboard, as the original plays it.
 *
 * Each Jack reads six keys — LEFT RIGHT UP DOWN BUT1 BUT2 (G.EXE VA 0x6bbef
 * tests exactly these, one scancode each, from the player's controller
 * record). The game ships four such records in TRASHIT.DAT (+0x70, 14 bytes
 * apiece: a device word and the six scancodes), and the setup screen lets
 * every one be redefined:
 *
 *   1: ISO \  Z  E  S  D  R        (device 1, the keyboard)
 *   2: arrows, right Alt, right Ctrl
 *   3: arrows, right Shift, Enter
 *   4: keypad 0 . 6 3, keypad Enter, keypad +
 *
 * (extended keys go through the table at VA 0xa4a95: 0x5e up, 0x60 left,
 * 0x61 right, 0x63 down, 0x5a right Ctrl, 0x5c right Alt, 0x59 keypad Enter.)
 *
 * Those do not carry over to a browser — a Mac has no keypad, no right Ctrl
 * and no ISO key, and Ctrl with an arrow switches desktops — so the default
 * sets below are new; what stays is the shape: six keys a player, four
 * players, each set redefinable. Keys are named by `KeyboardEvent.code`, the
 * physical key, so a set means the same keys whatever layout is switched on.
 */

export const ACTIONS = ['left', 'right', 'up', 'down', 'but1', 'but2'];

export const DEFAULT_KEY_SETS = [
  { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', but1: 'Period', but2: 'Slash' },
  { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', but1: 'KeyQ', but2: 'KeyE' },
  { left: 'KeyJ', right: 'KeyL', up: 'KeyI', down: 'KeyK', but1: 'KeyU', but2: 'KeyO' },
  { left: 'Numpad4', right: 'Numpad6', up: 'Numpad8', down: 'Numpad5', but1: 'Numpad7', but2: 'Numpad9' },
];

/**
 * Playing alone, the keys the game has always had work too: Z takes the
 * hammer out, X and Space jump and swing.
 */
export const SOLO_EXTRA = { but1: ['KeyZ'], but2: ['KeyX', 'Space'] };

const STORAGE_KEY = 'trashit.keySets';

/** The four sets, as last redefined on this browser. */
export function loadKeySets() {
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  return DEFAULT_KEY_SETS.map((def, i) => {
    const s = saved && saved[i];
    const out = {};
    ACTIONS.forEach((a) => { out[a] = (s && typeof s[a] === 'string' && s[a]) || def[a]; });
    return out;
  });
}

export function saveKeySets(sets) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  } catch {
    // private window or storage off: the sets last until the page closes
  }
}

/** A short label for a key code, for the setup screen and the hints. */
export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Period: '.', Slash: '/', Comma: ',', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
    Backquote: '`', IntlBackslash: '§', Space: 'ПРОБЕЛ', Enter: 'ENTER',
    ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
    AltLeft: 'L ALT', AltRight: 'R ALT', Tab: 'TAB', Backspace: 'BKSP',
    NumpadEnter: 'NUM ENTER', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
    NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code;
}

/**
 * What Player.update reads: `isDown`, and `_justDown` for
 * Phaser.Input.Keyboard.JustDown, which takes the latch and clears it.
 */
class PadKey {
  constructor() {
    this.isDown = false;
    this._justDown = false;
    this._held = 0;
  }
}

/**
 * The keyboard, read for any number of players at once. One listener on the
 * window sorts every key into the sets that name it.
 */
export class LocalKeys {
  constructor() {
    this._byCode = new Map(); // code → PadKey[]
    this._onDown = (e) => this._key(e, true);
    this._onUp = (e) => this._key(e, false);
    this._onBlur = () => this._byCode.forEach((keys) => keys.forEach((k) => {
      k.isDown = false;
      k._held = 0;
    }));
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  /**
   * One player's pad: `{left, right, up, down, but1, but2}` of keys, each
   * bound to one code or several.
   * @param {Record<string, string|string[]>} set
   */
  pad(set, extra = {}) {
    const pad = {};
    ACTIONS.forEach((a) => {
      const key = new PadKey();
      const codes = [].concat(set[a] || [], extra[a] || []);
      codes.forEach((code) => {
        if (!this._byCode.has(code)) this._byCode.set(code, []);
        this._byCode.get(code).push(key);
      });
      pad[a] = key;
    });
    return pad;
  }

  _key(e, down) {
    const keys = this._byCode.get(e.code);
    if (!keys) return;
    // the arrows and Space would scroll the page, Tab move the focus
    e.preventDefault();
    if (down && e.repeat) return;
    keys.forEach((k) => {
      // a key bound twice to one action (X and Space) is down while either is
      k._held = Math.max(0, k._held + (down ? 1 : -1));
      const was = k.isDown;
      k.isDown = k._held > 0;
      if (k.isDown && !was) k._justDown = true;
    });
  }

  /** Forgets presses not yet read: after a pause, they were the menu's. */
  settle() {
    this._byCode.forEach((keys) => keys.forEach((k) => { k._justDown = false; }));
  }

  destroy() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
    this._byCode.clear();
  }
}
