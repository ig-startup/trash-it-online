import Phaser from 'phaser';
import { JACK_SCALE } from '../entities/jackSprites';
import { hammerKey, hammerFrameInfo } from '../entities/hammers';

/**
 * A hammer that has left its Jack: the sledge hammer v3's trick, the
 * apocalypse hammer's return, a dropped one waiting to be taken back, or on
 * its way to its owner's flag. In the game it is the same entity that stands
 * on Jack (hammer_entity_tick, VA 0x20890) with another routine; see
 * docs/re/jack/sledge-trick.md and docs/re/jack/combos.md.
 *
 * Units are the game's own: px and px/tick, at its 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0.28125;              // sprite_physics: 0x4800
const SETTLE_GRAVITY = 20000 / 65536; // sledge_trick_settle (docs/re/jack/sledge-trick.md)
const TERMINAL = 24;                  // 0x180000
const SLAM_AHEAD = 62;                // sledge_v3_trick: the hammer 62 px ahead (0x2a4d8)
const DROP_VY = 0x155cc2 / 65536;     // the slam over no floor: 21.35 px a tick down
const RISE_VY = -0x155cc2 / 65536;    //   …and over a floor: 21.35 up (0xffeaa33e)
const RISE_SLOW = 12000 / 65536;      // sledge_trick_rise: slowed by this a tick
const TURN_SPEED = 260000 / 65536;    // below this it starts turning
const FRAME_LYING = 60;
const FRAME_RISING = 61;
const FRAME_LAST_TURN = 77;           // 0x4d: becomes the falling weight
const TURN_EVERY = 3;                 // timer 3 → a frame every 4 ticks
const SETTLE_VY = 2000 / 65536;
const MASS_SLAM = 6;
const MASS_WEIGHT = 12;
const CAM_RISE = 780;                 // sledge_trick_slam's camera_track
const CAM_DROP = 120;
const TO_FLAG = { spring: 1 / 64, damp: 1 / 8, max: 8, near: 5 };   // hammer_fly_to_flag (0x20a47)
const DEPTH = 7;

export default class LooseHammer {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../entities/Player').default} owner
   * @param {object} hooks
   * @param {() => any[]} hooks.solids  rectangles with `col`, as LooseObjects sees them
   * @param {(rects: any[], x: number, y: number, from: number) => any} hooks.floorAt
   * @param {number} hooks.ground  the level's bottom: nothing falls through it
   * @param {(h: {x: number, y: number, speed: number, mass: number}) => void} hooks.impact
   *   a heavy hammer coming down on a block
   * @param {(follow: object, ticks: number) => void} hooks.camTrack
   * @param {() => void} hooks.shake
   */
  constructor(scene, owner, hooks) {
    this._scene = scene;
    this.owner = owner;
    this._h = hooks;
    this.stats = owner.hammerStats;
    this.x = owner.x;
    this.y = owner.y;
    this.vx = 0;
    this.vy = 0;
    this.frame = FRAME_LYING;
    this.flip = false;
    this.mass = 0;
    /** +0x160 of the owner: he cannot take it back while it is in the air. */
    this.busy = false;
    this.mode = 'lying';
    this.active = true;
    this._timer = 0;
    this._acc = 0;
    this.sprite = scene.add.image(this.x, this.y, hammerKey(this.stats), String(this.frame))
      .setScale(JACK_SCALE).setDepth(DEPTH);
    this._draw();
  }

  /**
   * sledge_trick_slam (VA 0x34590), at the 8th tick of sledge_v3_trick: the
   * hammer 62 px ahead of him, one pixel above a floor or not.
   */
  slam() {
    const left = this.owner.facingLeft;
    this.flip = left;
    this.x = this.owner.x + (left ? -SLAM_AHEAD : SLAM_AHEAD);
    this.y = this.owner.y;
    this.frame = FRAME_LYING;
    this.mass = MASS_SLAM;
    const rects = this._h.solids();
    const under = this._floorUnder(rects, this.x, this.y + 1, this.y);
    this._timer = 1;
    if (under === null) {
      this.mode = 'drop';
      this.vy = DROP_VY;
      this._h.camTrack(this, CAM_DROP);
    } else {
      this.y = under;
      this.frame = FRAME_RISING;
      this.vy = RISE_VY;
      this.mode = 'rise';
      this.busy = true;
      this._h.camTrack(this, CAM_RISE);
      this._h.shake();
    }
    this._draw();
  }

  /** The hammer comes to rest wherever it is (hammer_dropped, VA 0x20976). */
  rest(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.frame = FRAME_LYING;
    this.mode = 'lying';
    this.busy = false;
    this._draw();
  }

  /** jack_over_dropped_hammer (VA 0x220ad): lying, not in the air, over its owner. */
  overOwner() {
    if (this.mode !== 'lying' || this.busy) return false;
    return Phaser.Geom.Intersects.RectangleToRectangle(this.sprite.getBounds(), this.owner.getBounds());
  }

  /** hammer_send_to_flag (VA 0x209ee): the hammer springs off to his flag. */
  sendToFlag() {
    if (this.mode !== 'lying' || !this.owner.flag) return false;
    this.mode = 'toFlag';
    this.vx = 0;
    this.vy = 0;
    this._timer = 0;
    return true;
  }

  /** hammer_out_pick_up (VA 0x22029): drawn over it, it is his again. */
  takenBack() {
    this.active = false;
    this.mode = 'gone';
    this.sprite.destroy();
  }

  /** @param {number} delta ms */
  update(delta) {
    if (!this.active) return;
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick && this.active) {
      this._acc -= tick;
      this._tick();
    }
    this._draw();
  }

  _tick() {
    switch (this.mode) {
      case 'rise': this._rise(); break;
      case 'settle': this._settle(); break;
      case 'toFlag': this._toFlag(); break;
      case 'drop': this._fall(GRAVITY, () => this.rest(this.x, this.y)); break;
      case 'lying': this._fall(GRAVITY, null); break;
      default: break;
    }
  }

  /**
   * sledge_trick_rise (VA 0x34686): up through anything, slowed by 12000 a
   * tick; once slow it turns over a frame at a time (61 → 77) and becomes a
   * weight of mass 12 (frame 60, vy 2000).
   */
  _rise() {
    if (this.vy < 0) {
      this.y += this.vy;
      this.vy += RISE_SLOW;
    }
    if (this.vy < -TURN_SPEED) return;
    const was = this._timer;
    this._timer -= 1;
    if (was !== 0) return;
    this.frame += 1;
    this._timer = TURN_EVERY;
    if (this.frame === FRAME_LAST_TURN) {
      this.frame = FRAME_LYING;
      this.mode = 'settle';
      this.vy = SETTLE_VY;
      this._timer = 1;
      this.mass = MASS_WEIGHT;
    }
  }

  /** sledge_trick_settle (VA 0x34747): falls as any loose sprite; on the ground it is dropped. */
  _settle() {
    if (this._timer !== 0) {
      this._timer -= 1;
      return;
    }
    this._fall(SETTLE_GRAVITY, () => {
      this.mass = 0;
      this.rest(this.x, this.y);
    });
  }

  /**
   * The shared sprite step (sprite_physics, VA 0x1f098), straight down: the
   * speed gains `g` and is capped at 24; on a solid block or a platform from
   * above it lands, and a heavy one strikes what it lands on.
   * @param {number} g
   * @param {(() => void)|null} landed
   */
  _fall(g, landed) {
    this.vy = Math.min(TERMINAL, this.vy + g);
    const from = this.y;
    this.y += this.vy;
    if (this.vy <= 0) return;
    const rects = this._h.solids();
    const top = this._floorUnder(rects, this.x, this.y, from);
    if (top === null) return;
    const speed = this.vy;
    this.y = top;
    this.vy = 0;
    if (this.mass > 0 && speed >= 1.5) {
      this._h.impact({ x: this.x, y: top + 1, speed, mass: this.mass });
    }
    if (landed) landed();
  }

  /** hammer_fly_to_flag (VA 0x20a47): a damped spring, 8 px a tick at most. */
  _toFlag() {
    const flag = this.owner.flag;
    if (!flag) {
      this.mode = 'lying';
      return;
    }
    const clamp = (v) => Math.max(-TO_FLAG.max, Math.min(TO_FLAG.max, v));
    this.vx += (flag.x - this.x) * TO_FLAG.spring;
    this.vy += (flag.y - this.y) * TO_FLAG.spring;
    this.vx = clamp(this.vx - this.vx * TO_FLAG.damp);
    this.vy = clamp(this.vy - this.vy * TO_FLAG.damp);
    this.x += this.vx;
    this.y += this.vy;
    if (Math.abs(this.x - flag.x) < TO_FLAG.near && Math.abs(this.y - flag.y) < TO_FLAG.near) {
      this.vx = 0;
      this.mode = 'lying';
    }
  }

  /** The top of what is under (x, y): the solid or the platform stepped onto, or the ground. */
  _floorUnder(rects, x, y, from) {
    const hit = this._h.floorAt(rects, x, y, from);
    if (hit) return hit.top;
    return y >= this._h.ground ? this._h.ground : null;
  }

  _draw() {
    if (!this.sprite.active) return;
    this.sprite.setFrame(String(this.frame));
    const info = hammerFrameInfo(this._scene, this.stats, this.frame);
    if (info) {
      this.sprite.setOrigin((this.flip ? info.w - info.ax : info.ax) / info.w, info.ay / info.h);
    }
    this.sprite.setFlipX(this.flip);
    this.sprite.setPosition(this.x, this.y);
  }

  destroy() {
    this.active = false;
    if (this.sprite.active) this.sprite.destroy();
  }
}
