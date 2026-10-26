/**
 * The palette tint (`palette_tint_update`, VA 0x14fe4): a brightness for
 * each of R, G and B, 128 the level's own colours, eased toward a target
 * by a fixed step a tick (`ease_toward_by_speed` 0x150be, step 0xcd832).
 * The game rebuilds the palette with each channel moved by (level − 128)
 * / 2 in VGA units, 0…63, clamped (`palette_tint` 0x14f24) — so 0 is
 * black and 255 white. Here that is an offset on the world camera.
 *
 * `start_game` (0x2ca9a) begins every level at 100 eased up to 128 by 4
 * (`palette_tint_reset` 0x14edf): a short fade in.
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const NEUTRAL = 128;
/** One VGA step (of 63) in the 0…255 a colour matrix offsets by. */
const VGA = 255 / 63;

export default class Tint {
  /** @param {Phaser.Cameras.Scene2D.Camera} cam */
  constructor(cam) {
    this.cur = { r: 100, g: 100, b: 100 };
    this.target = { r: NEUTRAL, g: NEUTRAL, b: NEUTRAL };
    this.speed = 4;
    // WebGL only; on canvas there is no tint
    this._fx = cam.postFX ? cam.postFX.addColorMatrix() : null;
    this._acc = 0;
    this._shown = null;
    this._apply();
  }

  /** Targets for each channel; any left out stay. */
  to({ r = this.target.r, g = this.target.g, b = this.target.b } = {}, speed = this.speed) {
    this.target = { r, g, b };
    this.speed = speed;
  }

  /** The current levels at once, no easing (a flash). */
  set({ r = this.cur.r, g = this.cur.g, b = this.cur.b }) {
    this.cur = { r, g, b };
  }

  update(delta) {
    for (this._acc += (delta * 60) / 1000; this._acc >= 1; this._acc -= 1) {
      ['r', 'g', 'b'].forEach((k) => {
        const d = this.target[k] - this.cur[k];
        this.cur[k] += Math.sign(d) * Math.min(Math.abs(d), this.speed);
      });
    }
    this._apply();
  }

  _apply() {
    if (!this._fx) return;
    const { r, g, b } = this.cur;
    const key = `${r},${g},${b}`;
    if (key === this._shown) return;
    this._shown = key;
    const off = (v) => ((v - NEUTRAL) >> 1) * VGA;
    this._fx.active = r !== NEUTRAL || g !== NEUTRAL || b !== NEUTRAL;
    this._fx.set([
      1, 0, 0, 0, off(r),
      0, 1, 0, 0, off(g),
      0, 0, 1, 0, off(b),
      0, 0, 0, 1, 0,
    ]);
  }
}
