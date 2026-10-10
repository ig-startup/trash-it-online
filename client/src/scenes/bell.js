import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * The bell (`.OB` class 13, VA 0x33d1d).
 *
 * It is three sprites on one spot, all from BELL.SPR: the entity itself
 * shows frame 0, the plinth; the constructor spawns a child for the tower
 * with its striker (frame 1, 2 while it rings) and one for the ball on top
 * (frame 3). The tower is drawn behind the plinth.
 *
 * It is a sprite like any other: its routine runs the shared physics and
 * friction every tick (`bell_touch_tick`, VA 0x34114), so it falls until
 * something holds it up, and again when that is smashed away. A bell held
 * back (subtype 8, see ob.py) stands still and unseen; let go, it is
 * kicked 4 px/tick upward and comes down (VA 0x340af).
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0.28125;     // px/tick², 0x4800
const TERMINAL = 24;         // px/tick
const KICK = -4;             // px/tick, 0xfffc0000
const BASE = 0;
const TOWER = 1;
const TOWER_RUNG = 2;
const BALL = 3;
/** The tower's extent around its foot, from the frames' own anchors. */
const LEFT = 15;
const RIGHT = 17;
const HEIGHT = 67;

export default class Bell {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}} at  its foot
   * @param {(x: number, from: number, to: number) => number | null} floor
   *   the top it lands on between two heights, or null
   * @param {{hidden?: boolean, fallbackColor?: number}} [opts]
   */
  constructor(scene, at, floor, opts = {}) {
    this.x = at.x;
    this.y = at.y;
    this.vy = 0;
    this.grounded = false;
    this.hidden = !!opts.hidden;
    this._floor = floor;
    this._acc = 0;
    const frames = PROP_ANIMS.bell;
    if (frames && frames.length > BALL && scene.textures.exists(frames[BALL])) {
      this._tower = scene.add.image(this.x, this.y, frames[TOWER]);
      applyPropFrame(this._tower, frames[TOWER]);
      this._parts = [this._tower, scene.add.image(this.x, this.y, frames[BASE]),
        scene.add.image(this.x, this.y, frames[BALL])];
      applyPropFrame(this._parts[1], frames[BASE]);
      applyPropFrame(this._parts[2], frames[BALL]);
    } else {
      this._parts = [scene.add.circle(this.x, this.y - 20, 20, opts.fallbackColor || 0xffcc00)];
    }
    this._frames = frames;
    this._ringing = 0;
    this._show();
  }

  /** Where Jack can touch it. */
  getBounds() {
    return new Phaser.Geom.Rectangle(this.x - LEFT, this.y - HEIGHT, LEFT + RIGHT, HEIGHT);
  }

  /** Let a held-back bell go: seen, and kicked up (VA 0x340af). */
  release() {
    this.hidden = false;
    this.grounded = false;
    this.y -= 2;
    this.vy = KICK;
    this._show();
  }

  /** Rung: the striker swings (frame 2) for a moment. */
  ring() {
    this._ringing = 30;
    this._parts.forEach((p) => p.setTint && p.setTint(0xffffff));
  }

  /** @param {number} delta  ms */
  update(delta) {
    if (this.hidden) return;
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._step();
    }
    this._show();
  }

  _step() {
    if (this._ringing > 0) this._ringing -= 1;
    if (this.grounded) {
      if (this._floor(this.x, this.y - 1, this.y + 1) !== null) return;
      this.grounded = false;
    }
    this.vy = Math.min(TERMINAL, this.vy + GRAVITY);
    if (this.vy > 0) {
      const top = this._floor(this.x, this.y, this.y + this.vy);
      if (top !== null) {
        this.y = top;
        this.vy = 0;
        this.grounded = true;
        return;
      }
    }
    this.y += this.vy;
  }

  _show() {
    this._parts.forEach((p) => {
      p.setVisible(!this.hidden);
      p.setPosition(this.x, p.type === 'Arc' ? this.y - 20 : this.y);
    });
    if (this._tower && this._frames) {
      const want = this._ringing > 0 && (this._ringing >> 2) & 1 ? TOWER_RUNG : TOWER;
      if (this._tower.texture.key !== this._frames[want]) applyPropFrame(this._tower, this._frames[want]);
    }
  }

  destroy() {
    this._parts.forEach((p) => p.destroy());
  }
}
