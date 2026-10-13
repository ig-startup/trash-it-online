import { PROP_ANIMS, applyPropFrame } from '../entities/props';
import { variantForColor } from '../entities/jackSprites';

/**
 * The players' flags (`.OB` classes 2-5, FLAG.SPR): where a flattened Jack
 * flies home to. See "Flattened, and home to the flag" in
 * docs/re/jack/falling-block.md.
 *
 * One per Jack in the game, in his colour (initialise_a_player, VA 0x21337,
 * templates 0xa34ec…). Each turns through FLAG.SPR 0-7 a frame every two
 * ticks and bobs 0-10 px below its point by the table at 0x997c0, each
 * flag a quarter of the way further through it (flag_tick, VA 0x1f5aa).
 */
const HZ = 60;
const BOB = [0, 1, 2, 4, 6, 8, 9, 10, 10, 9, 8, 6, 4, 2, 1, 0];
const DEPTH = 1;

export default class Flags {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}[]} points  the level's, by player
   * @param {string[]} colours  each Jack's, by player
   */
  constructor(scene, points, colours) {
    this._acc = 0;
    this._t = 0;
    this.all = colours.map((colour, i) => {
      const at = points[i] || points[0];
      const frames = PROP_ANIMS[`flag_${variantForColor(colour)}`] || PROP_ANIMS.flag_blue;
      const sprite = frames ? scene.add.image(at.x, at.y, frames[0]).setDepth(DEPTH) : null;
      if (sprite) applyPropFrame(sprite, frames[0]);
      return { x: at.x, y: at.y, i, frames, sprite, frame: 0 };
    });
  }

  /** @param {number} delta  ms */
  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._t += 1;
      if ((this._t & 1) === 0) this.all.forEach((f) => { f.frame = (f.frame + 1) & 7; });
    }
    this.all.forEach((f) => {
      if (!f.sprite) return;
      applyPropFrame(f.sprite, f.frames[f.frame]);
      f.sprite.setPosition(f.x, f.y + BOB[((this._t >> 1) + f.i * 4) & 15]);
    });
  }

  destroy() {
    this.all.forEach((f) => f.sprite && f.sprite.destroy());
  }
}
