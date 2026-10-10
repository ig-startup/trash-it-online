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
 * It is loaded from behind. A cannonball coming down whose point falls in
 * the bowl at the back of the breech — 11 x 5 either side of (-19, -4) from
 * the cannon, mirrored facing left (hotspot 0xa4518, test VA 0x20e13) — is
 * taken in: it rocks in the bowl for 62 ticks (table 0xa0154) and is gone
 * into the barrel, the breech shows its frame 11, and that lights the fuse
 * (VA 0x5fd78). The spark waits 20 ticks, then runs the fuse's 29 points
 * (0xa4522), one every 5 ticks on wheels and 10 on a carriage. At its end
 * the barrel swells a frame every 6 ticks, and on frame 6 the ball leaves
 * the muzzle — 20 ahead and 32 up — at 45°, 9.6 px/tick from wheels and
 * 12.7 from a carriage (power 3 and 4, table 0xa44e0); the wheels recoil
 * at half the ball's speed (VA 0x6010e). Two frames more and, once it has
 * stopped rolling, it takes a ball again.
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

/** The bowl a ball is dropped into: centre and half-size, from the cannon. */
const BOWL = { x: -19, y: -4, hw: 11, hh: 5 };
/** The ball rocking in the bowl before it is gone: (dx, dy) a tick, VA 0xa0154. */
const ROCK = [[1, 1], [2, 2], [2, 2], [3, 3], [3, 3], [3, 3], [4, 3], [4, 3], [4, 3], [4, 3],
  [3, 3], [3, 3], [3, 3], [2, 2], [2, 2], [1, 1], [0, 0], [-1, 1], [-1, 1], [-2, 2], [-2, 2],
  [-2, 2], [-3, 3], [-3, 3], [-3, 3], [-3, 3], [-2, 2], [-2, 2], [-2, 2], [-1, 1], [-1, 1],
  [0, 0], [1, 1], [1, 1], [1, 1], [2, 2], [2, 2], [2, 2], [2, 2], [1, 1], [1, 1], [1, 1],
  [0, 0], [0, 0], [-1, 1], [-1, 1], [-1, 1], [0, 0], [0, 0], [1, 1], [1, 1], [0, 0], [0, 0],
  [-1, 1], [-1, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const ROCK_X = 19;                       // …about the bowl, either side
/** The fuse, as the spark runs it (VA 0xa4522), from the cannon. */
const FUSE = [[-24, -30], [-24, -29], [-24, -28], [-23, -27], [-22, -27], [-21, -27],
  [-20, -28], [-20, -29], [-20, -30], [-20, -31], [-19, -32], [-19, -33], [-19, -34],
  [-18, -34], [-17, -34], [-16, -34], [-15, -34], [-14, -33], [-14, -32], [-14, -31],
  [-14, -30], [-15, -30], [-15, -29], [-16, -29], [-16, -28], [-17, -28], [-17, -27],
  [-17, -26], [-17, -25]];
const FUSE_WAIT = 20;
const FIRE_STEP = 6;                     // ticks per frame of the barrel firing
const FIRE_FRAME = 6;                    // the frame the shot leaves on
const LAST_FRAME = 8;
const MUZZLE = { x: 20, y: -32 };
/** Launch speed by power (0xa44e0): wheels 3, a carriage 4. */
const SHOT = { 3: 630000 / 65536, 4: 830000 / 65536 };

export default class Cannons {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, facing: string, wheels: boolean}[]} placed
   * @param {(x: number, y: number) => ({col: number, top: number} | null)} blockAt
   * @param {number} bottom  the level's floor
   */
  constructor(scene, placed, blockAt, bottom, fire = () => {}) {
    this._fire = fire;
    this._now = 0;
    this._blockAt = blockAt;
    this._bottom = bottom;
    this._acc = 0;
    this.all = placed.map((c) => {
      const parts = [
        c.wheels ? PROP_ANIMS.cwhl[0] : PROP_ANIMS.cfix[0],
        PROP_ANIMS.barrel[0], PROP_ANIMS.cfir[1], PROP_ANIMS.cfir[2],
      ].map((key) => scene.add.image(c.x, c.y, key));
      const spark = scene.add.image(c.x, c.y, PROP_ANIMS.spark[0]).setVisible(false);
      return {
        x: c.x, y: c.y, vx: 0, vy: 0,
        left: c.facing === 'left',
        wheels: c.wheels,
        grounded: false,
        heldBy: null,
        parts,
        spark,
        // Loading and firing: null (takes a ball), 'rock', 'fuse', 'fire'.
        phase: null,
        ball: null,
        t: 0,
        step: 0,
        frame: 0,
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

  /**
   * A ball coming down: does a cannon take it? (VA 0x20c15 → 0x20e13)
   * @param {{sprite: Phaser.GameObjects.Image}} h  the ball's handle
   * @returns {boolean}
   */
  tryLoad(h) {
    const { x, y } = h.sprite;
    const c = this.all.find((k) => k.phase === null
      && Math.abs(x - (k.x + (k.left ? -BOWL.x : BOWL.x))) < BOWL.hw
      && Math.abs(y - (k.y + BOWL.y)) < BOWL.hh);
    if (!c) return false;
    c.phase = 'rock';
    c.ball = h;
    c.t = 0;
    return true;
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
    this._now = (this._now || 0) + delta;
    this.all.forEach((c) => this._draw(c));
  }

  _step(c, held) {
    this._load(c);
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

  /** One tick of a ball going in, the fuse burning, or the shot. */
  _load(c) {
    if (c.phase === 'rock') {
      const [dx, dy] = ROCK[c.t];
      c.ball.sprite.setPosition(c.x + dx + (c.left ? ROCK_X : -ROCK_X), c.y - dy);
      c.t += 1;
      if (c.t >= ROCK.length) {
        c.ball.sprite.setVisible(false);
        c.phase = 'fuse';
        c.t = FUSE_WAIT;
        c.step = 0;
      }
    } else if (c.phase === 'fuse') {
      c.t -= 1;
      if (c.t <= 0) {
        c.t = c.wheels ? 5 : 10;
        c.step += 1;
        if (c.step >= FUSE.length) {
          c.phase = 'fire';
          c.t = 0;
          c.frame = 0;
        }
      }
    } else if (c.phase === 'fire') {
      c.t -= 1;
      if (c.t > 0) return;
      c.t = FIRE_STEP;
      if (c.frame === FIRE_FRAME) this._shoot(c);
      if (c.frame < LAST_FRAME) c.frame += 1;
      else if (c.vx === 0) {
        c.frame = 0;
        c.phase = null;
      }
    }
  }

  /** The shot (VA 0x5f99d → 0x6010e): the ball out of the muzzle, the wheels back. */
  _shoot(c) {
    const h = c.ball;
    c.ball = null;
    if (!h || !h.sprite.active) return;
    const dir = c.left ? -1 : 1;
    const v = SHOT[c.wheels ? 3 : 4];
    h.sprite.setVisible(true);
    this._fire(h, c.x + dir * MUZZLE.x, c.y + MUZZLE.y, dir * v, -v, c);
    if (c.wheels) {
      c.vx = -dir * v / 2;
      c.heldBy = null;
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
    const [base, barrel, breech, lid] = c.parts;
    if (c.wheels) {
      const turn = (Math.floor(c.x) >> 1) & 3;
      base.setTexture(PROP_ANIMS.cwhl[c.left ? 3 - turn : turn]);
    }
    barrel.setTexture(PROP_ANIMS.barrel[c.frame]);
    // With a ball in, the breech shows frame 11 and its lid goes (VA
    // 0x5fe15); while the barrel fires, the breech is not drawn (0x5fdec).
    const lit = c.phase === 'fuse' || c.phase === 'fire';
    breech.setTexture(lit ? PROP_ANIMS.cfir[3] : PROP_ANIMS.cfir[1]);
    breech.setVisible(c.frame === 0);
    lid.setVisible(!lit);
    if (c.phase === 'fuse' && c.step < FUSE.length) {
      const [fx, fy] = FUSE[c.step];
      c.spark.setTexture(PROP_ANIMS.spark[Math.floor(this._now / (1000 / HZ)) % PROP_ANIMS.spark.length]);
      c.spark.setPosition(Math.round(c.x + (c.left ? -fx : fx)), Math.round(c.y + fy));
      const info = PROP_FRAME_INFO[c.spark.texture.key];
      if (info) c.spark.setOrigin(info.ax / info.w, info.ay / info.h);
      c.spark.setVisible(true);
    } else {
      c.spark.setVisible(false);
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
    this.all.forEach((c) => {
      c.parts.forEach((p) => p.destroy());
      c.spark.destroy();
    });
    this.all = [];
  }
}
