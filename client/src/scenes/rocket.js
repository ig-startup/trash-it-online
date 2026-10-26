import Phaser from 'phaser';
import { PROP_ANIMS, PROP_FRAME_INFO, applyPropFrame } from '../entities/props';
import { COL } from './blockKinds';
import { playSfx } from '../audio/sfx';

/**
 * The rocket levels (0L 2D 5L 9L): the crawler-transporter that stacks an
 * Apollo rocket on its pad, the nine pieces of it, and the forklift Jack
 * brings them on. See docs/re/objects/crawler.md and forklift.md.
 *
 * A piece cannot be picked up by hand (its category has no bit 0); the
 * forklift's forks take it. Laid on the ground against the crawler, the
 * piece the crawler wants next is driven to the pad and a crane arm sets
 * it on the stack; the last one sets option 0x800, which lets the bell go.
 *
 * Not here: the forklift's engine sound (0x14, a looping voice whose rate
 * follows the revs), its dust, and the gear lever on the driver's panel.
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0.28125;     // px/tick², 0x4800
const TERMINAL = 24;         // px/tick
const FIX = 65536;           // the game's 16.16

// ── The crawler (.OB class 44, VA 0x111fb) ───────────────────────────────
const PAD_DX = 256;          // its pad, right of its home
const CREEP = 10000 / FIX;   // px/tick to line up with a piece (VA 0x11683)
const DRIVE = 0xc864 / FIX;  // px/tick to the pad and home (VA 0x115ae, 0x115f2)
const HOLD_DX = 14;          // a piece rides this far left of it
const LIFT_DOWN = 18;        // the lift's rest, below the crawler (0x120000)
const LIFT_EASE = { fast: 0xb798 / FIX, slow: 0x3d54 / FIX, near: 6 };   // VA 0x118d4
const ON_LIFT = 48;          // a piece's foot, over the lift (VA 0x1184d)
const ARM_BASE = 48;         // the arm's rest, over the pad
const ARM_GRIP = -10;        // where it goes to take a piece (VA 0x115ae)
const ARM_EASE = { fast: 0xffff / FIX, slow: 0x4e20 / FIX, near: 12 };    // VA 0x116c9
const ARM_WAIT = 35;         // ticks it waits before moving (0x23)
const IN_HAND = 8;           // a piece hangs this far under it (VA 0x118a4)
/** Where each piece's foot goes, over the pad less 40 (rocket_stack_heights, 0x9369e). */
const STACK = [8, -8, -68, -141, -177, -253, -272, -318, -348];
const STACK_BASE = 40;
const TOWER_DX = -41;        // its tower, left of the pad
const TOWER_STEP = 61;       // seven segments up it
const TOWER_SEGMENTS = 7;
const BLINK = { mask: 0x1f, from: 0x18 };   // the next piece wanted (VA 0x11a43)

// ── The forklift (.OB class 23, VA 0x1bbc3) ──────────────────────────────
const RATIO = [25, 50, 80, 100, 120];    // per gear (0x98474)
const PUSH = [200, 60, 30, 15, 7];       // per gear (0x98488)
const REV_LIMIT = 8500;                  // forklift_rev_limit, VA 0x1c319
const TURN = 70000;                      // past it backwards, it turns round
const COAST = 2000;                      // off the pedal, a tick
const STOP = 6000;                       // and under this it stops
const DROP = 8;                          // px in a tick that throws the driver off
const JOLT = 6;                          // ticks of the jolted frame
const FORKS_TOP = -80;                   // px over the body the forks rise to
const FORKS_SFX = 0x15;
/** Jack's point must be in the seat (0x9842a), the forks' load's on the forks (0x9837a): centre and half size. */
const SEAT = { dx: 6, dy: -16, hw: 10, hh: 16 };
const FORKS = { dx: 55, dy: -4, hw: 20, hh: 6 };
const LOAD_DY = -4;                      // a load rides this far over the forks
const SIT = { dx: -2, dy: -17 };         // the driver, from the body (VA 0x2b86b)
const BOARD_VY = -190000 / FIX;          // not rising faster than this (VA 0x1c19f)
const WALL = { dx: 23, dy: -12 };        // where it meets a wall (ours: the body's front)

/** The value moved toward a target: `fast` while further than `near`, else `slow` (ease_toward, VA 0x1190c). */
function ease(v, target, { fast, slow, near }) {
  if (v < target) {
    const n = target - v > near ? v + fast : v + slow;
    return n > target ? target : n;
  }
  if (v > target) {
    const n = v - target > near ? v - fast : v - slow;
    return n < target ? target : n;
  }
  return v;
}

/** Draw a part at (x, y), mirrored about its own anchor when facing left. */
function place(img, key, x, y, left = false) {
  if (img.texture.key !== key) img.setTexture(key);
  const info = PROP_FRAME_INFO[key];
  if (info) img.setOrigin((left ? info.w - info.ax : info.ax) / info.w, info.ay / info.h);
  img.setFlipX(left);
  img.setPosition(Math.round(x), Math.round(y));
}

/** A frame's box round (x, y), from its anchor. */
function frameBox(key, x, y) {
  const info = PROP_FRAME_INFO[key];
  return new Phaser.Geom.Rectangle(x - info.ax, y - info.ay, info.w, info.h);
}

export default class Rocket {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, stacked: number}} crawler  its home
   * @param {Array<{x: number, y: number, index: number}>} bits  the pieces
   * @param {Array<{x: number, y: number}>} forklifts
   * @param {(x: number, from: number, to: number) => number | null} floor
   *   the top a thing lands on between two heights, or null
   * @param {(x: number, y: number) => {col: number} | null} blockAt
   * @param {() => void} done  the last piece is on: option 0x800
   */
  constructor(scene, crawler, bits, forklifts, floor, blockAt, done) {
    this._floor = floor;
    this._blockAt = blockAt;
    this._done = done;
    this._acc = 0;
    this._tick = 0;
    const C = PROP_ANIMS.crawl;
    const img = (key, depth) => {
      const i = scene.add.image(0, 0, key).setDepth(depth);
      applyPropFrame(i, key);
      return i;
    };

    // The crawler and what belongs to it.
    const padX = crawler.x + PAD_DX;
    const padY = crawler.y;
    this.crawler = {
      x: crawler.x, y: crawler.y, home: crawler.x, state: 0, frameBase: 0,
      lift: LIFT_DOWN, liftTo: LIFT_DOWN, piece: null, riding: 0,
      padX, padY, prestack: crawler.stacked, next: crawler.stacked,
      sprite: img(C[0], 1.6), liftSprite: img(C[8], 1.5),
    };
    this.arm = {
      y: padY - ARM_BASE, to: 0, flags: 0x10, wait: 0,
      sprite: img(C[9], 1.7), hand: img(C[11], 1.75),
    };
    this._fixed = [img(C[13], 1.4)];
    place(this._fixed[0], C[13], padX, padY);
    const towerX = padX + TOWER_DX;
    const foot = img(C[14], 1.3);
    place(foot, C[14], towerX, padY);
    this._fixed.push(foot);
    for (let i = 0; i < TOWER_SEGMENTS; i += 1) {
      // a segment is a 4 px post, drawn 64 high (+0x52 = 0x40)
      const seg = img(C[15], 1.2);
      place(seg, C[15], towerX, padY - i * TOWER_STEP);
      seg.setDisplaySize(PROP_FRAME_INFO[C[15]].w, 64);
      this._fixed.push(seg);
    }
    const light = img(C[16], 1.3);
    place(light, C[16], towerX - 1, padY - TOWER_SEGMENTS * TOWER_STEP - 8);
    this._fixed.push(light);

    // The pieces: loose, on the forks, on the crawler, in the hand, stacked.
    this.pieces = bits.map((b) => ({
      x: b.x, y: b.y, vy: 0, index: b.index, state: 'loose', grounded: false,
      sprite: img(PROP_ANIMS.apollo[b.index], 1.55),
    }));
    this._left = this.pieces.length;

    const F = PROP_ANIMS.fork;
    this.forklifts = forklifts.map((f) => ({
      x: f.x, y: f.y, vx: 0, vy: 0, left: false, gear: 0, forks: 0, forksWas: 0,
      moving: false, load: null, loadDx: 0, driver: null, out: null, jolt: 0, dropped: 0,
      parts: [img(F[0], 2.1), img(F[4], 2.1), img(F[10], 1.9), img(F[8], 2), img(F[11], 2.05)],
    }));
    this._show();
  }

  // ── Jack and the forklift ──────────────────────────────────────────────

  /** The forklift Jack drives, if any. */
  drivenBy(pl) {
    return this.forklifts.find((f) => f.driver === pl) || null;
  }

  /**
   * Jack's outcome 6 (VA 0x1c19f): jumping or falling, not rising faster
   * than 2.9 px/tick, with his point in the seat, he gets in. The forklift
   * takes half his speed.
   * @returns {boolean} whether he got in
   */
  board(pl) {
    if (pl.state !== 'rise' && pl.state !== 'fall') return false;
    const vy = pl.body.velocity.y / HZ;
    if (vy <= BOARD_VY) return false;
    // (ours) one who has just got out, or been thrown, must leave the seat
    // before he can get back in — he falls from where he sat
    this.forklifts.forEach((k) => {
      if (k.out === pl && !this._inBox(k, SEAT, pl.x, pl.y, k.y)) k.out = null;
    });
    const f = this.forklifts.find((k) => !k.driver && k.out !== pl
      && this._inBox(k, SEAT, pl.x, pl.y, k.y));
    if (!f) return false;
    f.driver = pl;
    f.vx = Math.trunc((pl.body.velocity.x / HZ / 2) * FIX);
    f.jolt = 0;
    this._seat(f);
    return true;
  }

  /** BUT2 pressed: he gets out where he sits (VA 0x2b7e4, 0x1c266). */
  leave(f) {
    const pl = f.driver;
    f.driver = null;
    f.out = pl;
    if (pl) pl.letGo();
  }

  _seat(f) {
    f.driver.seat(f.x + (f.left ? -SIT.dx : SIT.dx), f.y + SIT.dy, f.left);
  }

  _inBox(f, box, px, py, cy) {
    const cx = f.x + (f.left ? -box.dx : box.dx);
    return Math.abs(px - cx) < box.hw && Math.abs(py - (cy + box.dy)) < box.hh;
  }

  // ── The frame ──────────────────────────────────────────────────────────

  /**
   * @param {number} delta  ms
   * @param {(f: object) => {left: boolean, right: boolean, up: boolean,
   *   down: boolean, shift: boolean}} controls  a driven forklift's keys
   */
  update(delta, controls) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._tick += 1;
      this.forklifts.forEach((f) => this._forkliftTick(f, f.driver ? controls(f) : null));
      this._crawlerTick();
      this._armTick();
      this.pieces.forEach((p) => this._pieceTick(p));
    }
    this._show();
  }

  // ── The crawler (crawler_tick, VA 0x114ed) ─────────────────────────────

  _crawlerTick() {
    const c = this.crawler;
    if (c.prestack) {
      // crawler_prestack (VA 0x11539): the pieces of earlier levels go
      // straight onto the pad, each one off the count.
      this.pieces.forEach((p) => {
        if (p.index >= c.prestack) return;
        p.state = 'stacked';
        p.x = c.padX;
        p.y = c.padY - STACK_BASE + STACK[p.index];
        this._left -= 1;
      });
      c.prestack = 0;
    }
    const p = c.piece;
    switch (c.state) {
      case 0: {
        // an APOLLO sprite touching it, lying on the ground, the one it
        // wants next (crawler_take_part, VA 0x11803)
        const box = frameBox(PROP_ANIMS.crawl[0], c.x, c.y);
        const want = this.pieces.find((k) => k.state === 'loose' && k.grounded && k.index === c.next
          && Phaser.Geom.Intersects.RectangleToRectangle(box, frameBox(k.sprite.texture.key, k.x, k.y)));
        if (!want) break;
        c.next += 1;
        want.state = 'crawler';
        c.piece = want;
        c.state = 1;
        break;
      }
      case 1: {
        const at = Math.floor(c.x) - HOLD_DX;
        if (Math.floor(p.x) < at) c.x -= CREEP;
        else if (Math.floor(p.x) > at) c.x += CREEP;
        else {
          c.liftTo = 0;
          c.state = 2;
          c.riding = 1;
        }
        break;
      }
      case 2:
        if (Math.trunc(c.lift) !== 0) break;
        if (Math.floor(c.x) < c.padX + HOLD_DX) {
          c.x += DRIVE;
          break;
        }
        this.arm.to = ARM_GRIP;
        this.arm.flags = 1;
        c.state = 3;
        break;
      case 3:
        if (!(this.arm.flags & 2)) break;
        // the hand has it: up to its place on the stack (VA 0x1162a)
        this.arm.flags = (this.arm.flags & ~2) | 4;
        this.arm.to = STACK[p.index];
        p.state = 'hand';
        c.riding = 0;
        c.piece = null;
        this._inHand = p;
        c.liftTo = LIFT_DOWN;
        c.state = 4;
        c.frameBase = 4;
        break;
      case 4:
        if (c.lift !== LIFT_DOWN) break;
        if (c.x > c.home) {
          c.x -= DRIVE;
          break;
        }
        c.state = 0;
        c.frameBase = 0;
        break;
      default:
    }
    // the lift (crawler_lift_tick, VA 0x118d4)
    c.lift = ease(c.lift, c.liftTo, LIFT_EASE);
    // a piece riding it (part_on_crawler, VA 0x1184d)
    if (c.piece) {
      const top = c.y + c.lift - ON_LIFT;
      if (c.riding === 1 && top < c.piece.y) c.riding = 2;
      if (c.riding === 2) {
        c.piece.x = Math.floor(c.x) - HOLD_DX;
        c.piece.y = top;
      }
    }
  }

  /** The crane arm (crane_arm_tick, VA 0x116c9). */
  _armTick() {
    const a = this.arm;
    const c = this.crawler;
    const target = c.padY - ARM_BASE + a.to;
    if (!(a.flags & 4)) {
      if (a.flags & 1) {
        if (a.wait === 0) {
          a.y = ease(a.y, target, ARM_EASE);
          if (a.y === target) a.flags = (a.flags & ~3) | 2;
        } else a.wait -= 1;
      }
    } else {
      if (!(a.flags & 8)) {
        a.wait = ARM_WAIT;
        a.flags |= 8;
      }
      if (a.wait === 0) {
        a.y = ease(a.y, target, ARM_EASE);
        if (a.y === target) {
          // set down: the piece stays, and the arm goes back
          a.to = 0;
          a.flags = (a.flags & 0xe2) | 0x11;
          a.wait = ARM_WAIT;
          this._left -= 1;
          if (this._inHand) {
            this._inHand.state = 'stacked';
            this._inHand = null;
          }
          if (this._left === 0) this._done();
        }
      } else a.wait -= 1;
    }
    if (this._inHand) this._inHand.y = a.y + IN_HAND;
  }

  /** A loose piece: the shared physics (rocket_bit_tick, VA 0x11a1b). */
  _pieceTick(p) {
    if (p.state !== 'loose') return;
    if (p.grounded) {
      if (this._floor(p.x, p.y - 1, p.y + 1) !== null) return;
      p.grounded = false;
    }
    p.vy = Math.min(TERMINAL, p.vy + GRAVITY);
    if (p.vy > 0) {
      const top = this._floor(p.x, p.y, p.y + p.vy);
      if (top !== null) {
        p.y = top;
        p.vy = 0;
        p.grounded = true;
        return;
      }
    }
    p.y += p.vy;
  }

  // ── The forklift (forklift_tick, VA 0x1c09b) ───────────────────────────

  _forkliftTick(f, keys) {
    // the driver's keys (jack_drive_controls, VA 0x2b86b)
    if (keys) {
      if (keys.up && f.forks > FORKS_TOP) {
        f.forks -= 1;
        f.jolt = JOLT;
      } else if (keys.down && !keys.up && f.forks < 0) {
        f.forks += 1;
        f.jolt = JOLT;
      }
    }

    // physics: it falls, and stops at a wall
    const wasY = f.y;
    f.vy = Math.min(TERMINAL, f.vy + GRAVITY);
    const top = this._floor(f.x, f.y, f.y + f.vy);
    if (top !== null) {
      f.y = top;
      f.vy = 0;
    } else f.y += f.vy;
    f.dropped = Math.abs(f.y - wasY) > DROP ? Math.round(f.y - wasY) : 0;
    const dx = f.vx / FIX;
    if (dx) {
      const front = f.x + dx + Math.sign(dx) * WALL.dx;
      const b = this._blockAt(front, f.y + WALL.dy);
      if (b && b.col === COL.SOLID) f.vx = 0;
      else f.x += dx;
    }

    if (this._gearbox(f, keys)) f.jolt = JOLT;
    if (f.jolt > 0) f.jolt -= 1;

    this._forksTick(f);

    if (f.driver) {
      if (f.dropped) {
        // dropped more than 8 px: thrown off with its fall
        const pl = f.driver;
        f.driver = null;
        f.out = pl;
        pl.letGo();
        pl.body.setVelocity(pl.body.velocity.x, f.dropped * HZ);
      } else this._seat(f);
    }
  }

  /**
   * The gearbox (forklift_gearbox, VA 0x1c331): the way it faces
   * accelerates, the other brakes and, past 1.07 px/tick backwards, turns
   * it round in first. BUT1 shifts up. `rpm = |vx| / ratio`; over the
   * limit it brakes. Off the pedal it coasts down. Returns true on a shift.
   */
  _gearbox(f, keys) {
    const k = keys || {};
    let accel = f.left ? k.left : k.right;
    let brake = !accel && (f.left ? k.right : k.left);
    let shifted = false;
    if (k.shift && f.gear < 4) {
      f.gear += 1;
      shifted = true;
    }
    const ratio = RATIO[f.gear];
    const rpm = Math.trunc(Math.abs(f.vx) / ratio);
    if (rpm > REV_LIMIT) {
      accel = false;
      brake = true;
    }
    let push = 0;
    if (accel) {
      push = PUSH[f.gear];
      if (rpm > 0x1964) push += push >> 1;
      if (rpm > 13000) push >>= 2;
    } else if (brake) {
      push = PUSH[f.gear] * -2;
    }
    if (f.left) push = -push;
    f.vx += push * ratio;
    if (f.vx < -TURN && !f.left) {
      f.gear = 0;
      f.left = true;
    } else if (f.vx > TURN && f.left) {
      f.gear = 0;
      f.left = false;
    }
    if (!accel) {
      if (Math.abs(f.vx) >= STOP) f.vx += f.vx < 0 ? COAST : -COAST;
      else f.vx = 0;
    }
    return shifted;
  }

  /**
   * The forks (forklift_forks_tick, VA 0x1bd87): raised off the ground,
   * they take a piece whose point lies on them; it rides 4 px over them.
   * Lowered to the ground, or onto something it then rests on, it is let
   * go — and so it is when the forklift drops.
   */
  _forksTick(f) {
    const fy = f.y + f.forks;
    if (!f.load && f.forks !== 0) {
      const p = this.pieces.find((k) => k.state === 'loose' && this._inBox(f, FORKS, k.x, k.y, fy));
      if (p) {
        f.load = p;
        p.state = 'forks';
        p.vy = 0;
        f.loadDx = p.x - f.x;
        f.loadLeft = f.left;
      }
    }
    const moving = f.forks !== f.forksWas;
    if (moving && !f.moving) playSfx(FORKS_SFX);
    f.moving = moving;
    const lowering = f.forks > f.forksWas;
    f.forksWas = f.forks;
    const p = f.load;
    if (!p) return;
    if (f.loadLeft !== f.left) {
      // turned round: the load goes to the other side (VA 0x1bd87, +0x80)
      f.loadDx = -f.loadDx;
      f.loadLeft = f.left;
    }
    p.x = f.x + f.loadDx;
    p.y = fy + LOAD_DY;
    const rests = this._floor(p.x, p.y - 1, p.y + 1) !== null;
    if (f.dropped || (lowering && (f.forks === 0 || rests)) || (!moving && rests)
      || !this._inBox(f, FORKS, p.x, p.y, fy)) {
      f.load = null;
      p.state = 'loose';
      p.grounded = false;
      p.vy = f.dropped ? Math.max(0, f.dropped) : 0;
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  _show() {
    const C = PROP_ANIMS.crawl;
    const c = this.crawler;
    place(c.sprite, C[c.frameBase + (Math.floor(c.x) & 3)], c.x, c.y);
    place(c.liftSprite, C[8], c.x, c.y + c.lift);
    const a = this.arm;
    place(a.sprite, C[9 + ((Math.floor(a.y) >> 2) & 1)], c.padX, a.y);
    if (a.flags & 8) place(a.hand, C[12], c.padX, a.y);
    else place(a.hand, C[11], c.padX, a.y);

    const blink = (this._tick & BLINK.mask) >= BLINK.from;
    this.pieces.forEach((p) => {
      place(p.sprite, PROP_ANIMS.apollo[p.index], p.x, p.y);
      if (p.state === 'loose' && p.index === c.next && blink) p.sprite.setTintFill(0xffffff);
      else p.sprite.clearTint();
    });

    const F = PROP_ANIMS.fork;
    this.forklifts.forEach((f) => {
      const turn = (Math.floor(f.x) >> 1) & 3;
      const roll = f.left ? 3 - turn : turn;
      const [rear, front, mast, body, forks] = f.parts;
      place(rear, F[roll], f.x, f.y, f.left);
      place(front, F[4 + roll], f.x, f.y, f.left);
      place(mast, F[10], f.x, f.y, f.left);
      place(body, F[f.jolt > 0 ? 9 : 8], f.x, f.y, f.left);
      place(forks, F[11], f.x, f.y + f.forks, f.left);
    });
  }

  destroy() {
    const c = this.crawler;
    [c.sprite, c.liftSprite, this.arm.sprite, this.arm.hand, ...this._fixed,
      ...this.pieces.map((p) => p.sprite), ...this.forklifts.flatMap((f) => f.parts)]
      .forEach((s) => s.destroy());
  }
}
