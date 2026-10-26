import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * The red, green and blue buttons (`.OB` classes 28-30, VA 0x1722b) — see
 * docs/re/objects/buttons.md.
 *
 * A button is a sprite like the bell: its routine (`button_tick`, VA
 * 0x172a9) runs the shared physics and friction every tick, so it falls
 * until something holds it up. Struck from above — the overhead blow, a
 * blast, a lead weight landing (`+0x40` bit 0x80) — it ORs its bit into the
 * level's options, shows its pressed frame and hops (vy −3). It can be
 * struck again; the bit is already set.
 *
 * A hidden one (`button_hidden`, VA 0x17350) hangs unseen and untouchable,
 * without physics, until its colour's bit is in the options; then it
 * appears, kicked up at −1.53 px/tick, and the camera takes it in for 120
 * ticks.
 *
 * The game also counts down `+0x50` (40 by 4) and `+0x4a` (6, every fourth
 * tick) on a press; nothing that draws the button reads them, so they are
 * left out. Its frame goes up by one on every press (VA 0x172a9), so a
 * second blow would show the next colour's frame; here it stays pressed.
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0.28125;           // px/tick², 0x4800, as the bell
const TERMINAL = 24;               // px/tick
const HOP = -3;                    // px/tick, 0xfffd0000
const POP = -0x186a0 / 0x10000;    // px/tick, 0xfffe7960
const SHOW_TICKS = 120;            // camera_track on appearing (VA 0x17390)
const FRAME = { red: 0, green: 2, blue: 4 };
/** Its extent round its foot, from the up frame's own anchor (38 x 21). */
const HALF = 19;
const HEIGHT = 20;

export default class Buttons {
  /**
   * @param {Phaser.Scene} scene
   * @param {Array<{x: number, y: number, colour: string, sets: number,
   *   hidden: boolean, revealedBy?: number}>} list  from the level
   * @param {(x: number, from: number, to: number) => number | null} floor
   *   the top it lands on between two heights, or null
   */
  constructor(scene, list, floor) {
    this._floor = floor;
    this._acc = 0;
    this.all = list.map((b) => {
      const frame = FRAME[b.colour] || 0;
      const sprite = scene.add.image(b.x, b.y, PROP_ANIMS.button[frame]).setDepth(2);
      applyPropFrame(sprite, PROP_ANIMS.button[frame]);
      return {
        x: b.x, y: b.y, vy: 0, grounded: false, sprite, frame, pressed: false,
        sets: b.sets, hidden: !!b.hidden, revealedBy: b.revealedBy || 0,
      };
    });
    this._show();
  }

  /** Where a blow reaches it. */
  static bounds(b) {
    return new Phaser.Geom.Rectangle(b.x - HALF, b.y - HEIGHT, HALF * 2, HEIGHT);
  }

  /**
   * A blow from above over `reach`: each visible button it touches is
   * pressed. Returns the option bits they set.
   * @param {Phaser.Geom.Rectangle} reach
   */
  hit(reach) {
    let bits = 0;
    this.all.forEach((b) => {
      if (b.hidden || !Phaser.Geom.Intersects.RectangleToRectangle(reach, Buttons.bounds(b))) return;
      bits |= b.sets;
      b.pressed = true;
      b.vy = HOP;
      b.grounded = false;
    });
    if (bits) this._show();
    return bits;
  }

  /**
   * One frame. The hidden ones watch the options; each that comes out is
   * passed to `appeared` with the ticks the camera should hold it.
   * @param {number} delta  ms
   * @param {number} options  the level's option bits
   * @param {(b: object, ticks: number) => void} appeared
   */
  update(delta, options, appeared) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this.all.forEach((b) => {
        if (b.hidden) {
          if (!(b.revealedBy & options)) return;
          b.hidden = false;
          b.vy = POP;
          appeared(b, SHOW_TICKS);
        }
        this._step(b);
      });
    }
    this._show();
  }

  _step(b) {
    if (b.grounded) {
      if (this._floor(b.x, b.y - 1, b.y + 1) !== null) return;
      b.grounded = false;
    }
    b.vy = Math.min(TERMINAL, b.vy + GRAVITY);
    if (b.vy > 0) {
      const top = this._floor(b.x, b.y, b.y + b.vy);
      if (top !== null) {
        b.y = top;
        b.vy = 0;
        b.grounded = true;
        return;
      }
    }
    b.y += b.vy;
  }

  _show() {
    this.all.forEach((b) => {
      b.sprite.setVisible(!b.hidden);
      b.sprite.setPosition(b.x, b.y);
      const key = PROP_ANIMS.button[b.frame + (b.pressed ? 1 : 0)];
      if (b.sprite.texture.key !== key) applyPropFrame(b.sprite, key);
    });
  }

  destroy() {
    this.all.forEach((b) => b.sprite.destroy());
  }
}
