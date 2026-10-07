import Phaser from 'phaser';
import { COL } from './blockKinds';

/**
 * The things Jack can pick up, carry and throw, and how they fly.
 *
 * Which sprites can be picked up is the template's business, not the
 * level's: bit 0 of the template's category word (`+0xc`), which Jack's
 * search asks for (VA 0x26971 → 0x2f0ab). In the shipped cast that is the
 * hammer-lit dynamite (0x98c84), `LEAD`, the saws, the fire extinguisher
 * dynamite and the timmies — and not the dynamite that lights at a touch.
 * Of those the clone has the dynamite and the timmies.
 *
 * In flight an object goes through the sprites' shared step (VA 0x1f098):
 * off a wall it comes back at a quarter of the speed, `vx = -vx/4`; on
 * landing slower than 1.5 px/tick it settles, faster and it bounces (the
 * game hands that to the object's own routine, which is not traced — the
 * bounce here is ours). In the air `vx` loses 2000 a tick and `vy` gains
 * 0x4800, which is also how the aim's arc is drawn (VA 0x15bcb).
 *
 * What stops them is what stops any sprite (0x1f098 → the tile probes):
 * sideways and overhead only a solid block, underneath a solid block or a
 * platform it comes down onto from above — the same collision kinds as
 * Jack's (see blockKinds.js). Scenery they pass through.
 *
 * Everything is in the game's own units, px and px/tick, stepped at its
 * 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0.28125;           // px/tick², 0x4800
const AIR_DRAG = 2000 / 65536;     // px/tick off vx each tick
const DRAG_FLOOR = 9999 / 65536;   // below this vx is simply dropped
const TERMINAL = 24;               // px/tick, 0x180000
const SETTLE = 1.5;                // px/tick, 0x18000 — slower than this and it stays down
const ARC_POINTS = 68;             // the arc stops after this many ticks (VA 0x15bcb)
const ARC_EVERY = 4;               // …and a dot is drawn every fourth
const CARRIED_DEPTH = 5;

export default class LooseObjects {
  /**
   * @param {Phaser.Scene} scene
   * @param {() => Phaser.GameObjects.GameObject[]} solids  what objects land
   *   on; each may carry a collision kind as its `col` data (none is solid)
   * @param {number} floorY  below this an object is gone from the level
   * @param {{falling?: Function, impact?: Function}} hooks  `falling(h)`
   *   each tick it comes down, true when something took it out of the air;
   *   `impact(h, {x, y, speed, side, dir})` when it strikes a block
   */
  constructor(scene, solids, floorY, hooks = {}) {
    this._scene = scene;
    this._solids = solids;
    this._floorY = floorY;
    this._hooks = hooks;
    /** @type {Set<{sprite: any, kind: string, vx: number, vy: number, flying: boolean, carried: boolean}>} */
    this._all = new Set();
    this._acc = 0;
    this._arc = scene.add.graphics().setDepth(CARRIED_DEPTH);
  }

  /** Registers a sprite that can be picked up. Returns its handle. */
  add(sprite, kind, anchored = false) {
    const h = {
      sprite, kind, vx: 0, vy: 0, flying: false, carried: false, depth: sprite.depth,
      // Held where the level put it until someone moves it — the timmies
      // are locked to their block (VA 0x33ef2's twin), not resting on it.
      anchored,
      inside: null,   // what has taken it in — a cannon — while it does
    };
    this._all.add(h);
    return h;
  }

  /** True while a sprite is in someone's hands or in the air. */
  isBusy(sprite) {
    for (const h of this._all) if (h.sprite === sprite) return h.carried || h.flying;
    return false;
  }

  /**
   * The first object whose frame holds the grab point and overlaps Jack —
   * the two tests 0x21d51 and 0x2ef85 make.
   */
  find(x, y, jackBounds) {
    for (const h of this._all) {
      if (h.carried || h.inside || !h.sprite.active) continue;
      const b = h.sprite.getBounds();
      if (b.contains(x, y) && Phaser.Geom.Intersects.RectangleToRectangle(b, jackBounds)) return h;
    }
    return null;
  }

  pick(h) {
    h.anchored = false;
    h.carried = true;
    h.flying = false;
    h.sprite.setDepth(CARRIED_DEPTH);
  }

  /** Puts it down where he set it, and lets it settle from there. */
  place(h, x, y) {
    this._release(h, x, y, 0, 0);
  }

  /** Lets fly from (x, y) at (vx, vy) px/tick. */
  throw(h, x, y, vx, vy) {
    this._release(h, x, y, vx, vy);
  }

  _release(h, x, y, vx, vy) {
    h.carried = false;
    h.flying = true;
    h.vx = vx;
    h.vy = vy;
    h.sprite.setPosition(x, y);
    h.sprite.setDepth(h.depth);
  }

  /**
   * Moves what is carried with its carrier and what is loose through the
   * air, and draws the aim's arc if there is one.
   * @param {number} delta ms
   * @param {{x: number, y: number}|null} carryPoint
   * @param {{x: number, y: number, vx: number, vy: number}|null} aim
   */
  update(delta, carryPoint, aim) {
    for (const h of this._all) {
      if (!h.sprite.active) { this._all.delete(h); continue; }
      if (h.carried && carryPoint) h.sprite.setPosition(carryPoint.x, carryPoint.y);
    }

    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      const solids = this._solidRects();
      for (const h of this._all) {
        if (h.carried || h.inside || h.anchored) continue;
        // These are physical sprites in the game: the level's placements
        // settle onto what is under them, and once that goes, they fall.
        if (!h.flying && !this._floorAt(solids, h.sprite.x, h.sprite.y + 1, h.sprite.y)) {
          h.flying = true;
        }
        if (h.flying) this._step(h, solids);
      }
    }

    this._drawArc(aim);
  }

  /** One tick of the shared sprite step. */
  _step(h, solids) {
    const s = h.sprite;
    const half = s.displayHeight / 2;

    s.x += h.vx;
    const wall = this._wallAt(solids, s.x, s.y - half);
    if (wall) {
      if (this._hooks.impact) {
        this._hooks.impact(h, {
          x: s.x, y: s.y - half, speed: Math.abs(h.vx), side: true, dir: Math.sign(h.vx),
        });
      }
      s.x -= h.vx;
      h.vx = -h.vx / 4;
    }
    if (Math.abs(h.vx) > DRAG_FLOOR) h.vx -= Math.sign(h.vx) * AIR_DRAG;
    else h.vx = 0;

    h.vy = Math.min(TERMINAL, h.vy + GRAVITY);
    const from = s.y;
    s.y += h.vy;
    if (h.vy > 0 && this._hooks.falling && this._hooks.falling(h)) return;
    if (h.vy > 0) {
      const under = this._floorAt(solids, s.x, s.y, from);
      if (under) {
        if (this._hooks.impact) {
          this._hooks.impact(h, { x: s.x, y: under.top + 1, speed: h.vy, side: false, dir: 1 });
        }
        s.y = under.top;
        if (h.vy < SETTLE) {
          h.vy = 0;
          h.vx = 0;
          h.flying = false;
        } else {
          h.vy = -h.vy / 4;
        }
      }
    } else if (h.vy < 0 && this._wallAt(solids, s.x, s.y - 2 * half)) {
      h.vy = 0;
    }

    if (s.y > this._floorY) s.destroy();
  }

  _solidRects() {
    return this._solids()
      .filter((o) => o.active && o.body)
      .map((o) => {
        const r = new Phaser.Geom.Rectangle(o.body.x, o.body.y, o.body.width, o.body.height);
        const col = o.getData ? o.getData('col') : undefined;
        r.col = col === undefined || col === null ? COL.SOLID : col;
        return r;
      })
      .filter((r) => r.col !== COL.NONE && r.col !== COL.LADDER);
  }

  /** A solid block at a point: what stops it sideways and overhead. */
  _wallAt(rects, x, y) {
    return rects.find((r) => r.col === COL.SOLID && r.contains(x, y)) || null;
  }

  /** What it lands on: solid, or a platform it was above a tick ago. */
  _floorAt(rects, x, y, from) {
    return rects.find((r) => r.contains(x, y)
      && (r.col === COL.SOLID || from <= r.top)) || null;
  }

  /** The dotted arc 0x15bcb draws once the aim has wound up. */
  _drawArc(aim) {
    this._arc.clear();
    if (!aim) return;
    this._arc.fillStyle(0xffffff, 0.9);
    let { x, y, vx, vy } = aim;
    for (let i = 0; i < ARC_POINTS && y <= this._floorY; i += 1) {
      if (i % ARC_EVERY === 0) this._arc.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      x += vx;
      y += vy;
      if (Math.abs(vx) > DRAG_FLOOR) vx -= Math.sign(vx) * AIR_DRAG;
      else vx = 0;
      vy += GRAVITY;
    }
  }

  destroy() {
    this._arc.destroy();
    this._all.clear();
  }
}
