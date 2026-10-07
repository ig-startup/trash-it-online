import Phaser from 'phaser';
import { PROP_ANIMS, PROP_FRAME_INFO } from '../entities/props';
import { COL } from './blockKinds';

/**
 * Cannons — `.OB` class 6 (constructor VA 0x5f69a). See "The cannon" in
 * scripts/formats/README.md.
 *
 * One cannon is four sprites on one spot: what it stands on — a wheel,
 * CWHL (template 0xa4470), or a fixed carriage, CFIX (0xa448c) — and three
 * parts of CFIR following it: the barrel with its fuse and the two halves
 * of the breech. On wheels it is the one thing in the game Jack can push
 * (category bit 1, which only his push search looks for); while he has
 * hold of it, it takes his speed every tick (VA 0x27f96). Let go, it rolls
 * on with 2000 of friction a tick (VA 0x5fd1e). The wheel's frame is its x
 * (`(x >> 1) & 3`, run backwards facing left), and the overhead blow —
 * which sets its hit flag, category bit 2 — bounces it up at -3.05 px/tick
 * and turns it round (VA 0x5f923). A cannon on a carriage does neither.
 *
 * Not built: it firing. What lights its fuse is not traced.
 */
const HZ = 60;
const GRAVITY = 0x4800 / 65536;          // per tick², the shared sprite step
const TERMINAL = 24;
const FRICTION = 2000 / 65536;           // VA 0x5fd1e
const AT_REST = 10000 / 65536;
const HOP = -0x30d40 / 65536;            // VA 0x5f94a
const WALL_BOUNCE = -1 / 4;
const BOTTOM = 2;                        // its feet: the wheel's lowest row, under (x, y)
const HALF_W = 12;                       // the box Jack's push search overlaps
const HEIGHT = 40;

export default class Cannons {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, facing: string, wheels: boolean}[]} placed
   * @param {(x: number, y: number) => ({col: number, top: number} | null)} blockAt
   * @param {number} bottom  the level's floor
   */
  constructor(scene, placed, blockAt, bottom) {
    this._blockAt = blockAt;
    this._bottom = bottom;
    this._acc = 0;
    this.all = placed.map((c) => {
      const parts = [
        c.wheels ? PROP_ANIMS.cwhl[0] : PROP_ANIMS.cfix[0],
        PROP_ANIMS.cfir[0], PROP_ANIMS.cfir[1], PROP_ANIMS.cfir[2],
      ].map((key) => scene.add.image(c.x, c.y, key));
      return {
        x: c.x, y: c.y, vx: 0, vy: 0,
        left: c.facing === 'left',
        wheels: c.wheels,
        grounded: false,
        heldBy: null,
        parts,
      };
    });
    this.all.forEach((c) => this._draw(c));
  }

  /** The box Jack's push search tests against (VA 0x2ddd6). */
  box(c) {
    return new Phaser.Geom.Rectangle(c.x - HALF_W, c.y + BOTTOM - HEIGHT, HALF_W * 2, HEIGHT);
  }

  /**
   * Jack's push search (VA 0x28771): a cannon on wheels his box overlaps,
   * not rolling away from the way he faces. The game takes one coming at
   * him (`vx <= 0` facing right, `vx > 0` facing left); a cannon at rest
   * counts either way here — the game's strict `>` would leave one at rest
   * unpushable to the left, which reads as a slip, not a rule.
   */
  find(bounds, facingLeft) {
    return this.all.find((c) => c.wheels
      && (facingLeft ? c.vx >= 0 : c.vx <= 0)
      && Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.box(c))) || null;
  }

  /** Still touching him? A hold lasts only while it does (VA 0x2885f). */
  touches(c, bounds) {
    return Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.box(c));
  }

  /** The overhead blow: bounce up and turn round, on wheels and on the ground. */
  hit(reach) {
    this.all.forEach((c) => {
      if (!c.wheels || !c.grounded) return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, this.box(c))) return;
      c.vy = HOP;
      c.left = !c.left;
      c.grounded = false;
      c.heldBy = null;
    });
  }

  /**
   * @param {number} delta ms
   * @param {(c: object) => (number | null)} pusherVx  the speed of whoever
   *   holds it, px/tick, or null to let go
   */
  update(delta, pusherVx) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this.all.forEach((c) => this._step(c, pusherVx(c)));
    }
    this.all.forEach((c) => this._draw(c));
  }

  _step(c, held) {
    if (!c.wheels) {
      // A carriage only settles.
      if (!c.grounded) this._fall(c);
      return;
    }
    // His speed first (VA 0x27f96), then its own friction on top of it
    // (VA 0x5fd1e) — so a pushed cannon lags him a little, and he stays
    // up against it.
    if (held !== null) c.vx = held;
    if (Math.abs(c.vx) < AT_REST) c.vx = 0;
    else c.vx -= Math.sign(c.vx) * FRICTION;

    if (c.vx) {
      const x = c.x + c.vx;
      const ahead = x + Math.sign(c.vx) * HALF_W;
      if (this._wall(ahead, c.y + BOTTOM - HEIGHT / 2)) c.vx *= WALL_BOUNCE;
      else c.x = x;
    }
    // Rolled off what it stood on?
    if (c.grounded && !this._floor(c.x, c.y + BOTTOM, c.y + BOTTOM + 1)) c.grounded = false;
    if (!c.grounded) this._fall(c);
  }

  _fall(c) {
    c.vy = Math.min(TERMINAL, c.vy + GRAVITY);
    const from = c.y + BOTTOM;
    const to = from + c.vy;
    const land = c.vy > 0 ? this._floor(c.x, from, to) : null;
    if (land !== null) {
      c.y = land - BOTTOM;
      c.vy = 0;
      c.grounded = true;
    } else {
      c.y += c.vy;
    }
  }

  /** The floor between two heights: solid, or a platform it is above. */
  _floor(x, from, to) {
    if (to >= this._bottom) return this._bottom;
    for (let cy = Math.floor((from + 1) / 8) * 8; cy <= to; cy += 8) {
      const b = this._blockAt(x, cy);
      if (!b) continue;
      if (b.col === COL.SOLID) return b.top;
      if ((b.col === COL.PLATFORM || b.col === COL.LADDER_TOP) && from <= b.top) return b.top;
    }
    return null;
  }

  _wall(x, y) {
    const b = this._blockAt(x, y);
    return !!b && b.col === COL.SOLID;
  }

  _draw(c) {
    const [base] = c.parts;
    if (c.wheels) {
      const turn = (Math.floor(c.x) >> 1) & 3;
      base.setTexture(PROP_ANIMS.cwhl[c.left ? 3 - turn : turn]);
    }
    c.parts.forEach((img) => {
      img.setPosition(Math.round(c.x), Math.round(c.y));
      // Mirrored about its own anchor, as the game draws a sprite facing left.
      const info = PROP_FRAME_INFO[img.texture.key];
      if (info) img.setOrigin((c.left ? info.w - info.ax : info.ax) / info.w, info.ay / info.h);
      img.setFlipX(c.left);
    });
  }

  destroy() {
    this.all.forEach((c) => c.parts.forEach((p) => p.destroy()));
    this.all = [];
  }
}
