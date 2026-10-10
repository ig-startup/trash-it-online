import Phaser from 'phaser';

/**
 * What a destroyed block becomes, and the hoover that clears it.
 *
 * The game does not remove a smashed block: `remove_object_data` (VA
 * 0x68724) keeps it as rubble, drawn see-through — its draw routine
 * switches to one that blends every pixel with what is behind it through a
 * 256x256 table (VA 0x34ed8, table 0xbd4e4) — the level's `.STP`, which
 * gives for two colours the one nearest their *sum*: light, added. In state 0x60f60 it is given a
 * random push, falls at 5000 a tick *through* everything to the bottom of
 * the level, bounces a quarter back, and lies there for 2000 ticks, on the
 * list the hoover reads; then it sinks into the floor a pixel a tick
 * (0x61205). The hoover (0x61472) catches what is in its box and draws it
 * in (0x61518): an eighth of the way across and a quarter down each tick,
 * squashing it a quarter a tick, height first, then width, until it is
 * gone. See "What a destroyed block becomes" and "The hoover" in
 * scripts/formats/README.md.
 *
 * All in the game's units, px and px/tick, at its 60 Hz.
 */
const HZ = 60;
const FX = 65536;
const GRAVITY = 5000 / FX;          // px/tick², VA 0x60f86
const LIFT = 0x4e29 / FX;           // the push up every piece gets
const STILL = 0x9c40 / FX;          // a bounce slower than this stops it (0xffff63c0)
const REST_TICKS = 2000;            // +0x60 at destruction
const GONE = 4;                     // px a sucked piece shrinks to before it goes
const DEPTH = 0.5;                  // over the wall, under the blocks and Jack
const MAX_PIECES = 250;             // a guard; the game keeps every one

/** A random whole number below 2^31, the game's shift-register draw. */
const rand = () => Math.floor(Math.random() * 0x7fffffff);

export default class Rubble {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} floorY the bottom of the level, where rubble ends up
   */
  constructor(scene, floorY) {
    this._scene = scene;
    this._floorY = floorY;
    this._pieces = [];
    this._acc = 0;
  }

  /**
   * A block has gone: its artwork, at its place, becomes rubble.
   * @param {Phaser.GameObjects.Image|Phaser.GameObjects.Rectangle} src
   * @param {number} mask the blow's debris mask (hammer record +0x34 / +0x38,
   *   or the blast's 0x3ffff)
   */
  add(src, mask) {
    if (this._pieces.length >= MAX_PIECES) {
      const oldest = this._pieces.shift();
      if (oldest.img.active) oldest.img.destroy();
    }
    const b = src.getBounds();
    const img = src.texture && src.frame && src.texture.key !== '__DEFAULT'
      ? this._scene.add.image(b.x, b.y, src.texture.key, src.frame.name)
      : this._scene.add.rectangle(b.x, b.y, b.width, b.height, 0x8a6a4a);
    img.setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH);
    const vx = (rand() & mask) / FX;
    this._pieces.push({
      img,
      x: b.x,
      y: b.y,
      w0: b.width,
      h0: b.height,
      w: b.width,
      h: b.height,
      vx: rand() & 1 ? vx : -vx,
      vy: -(((rand() & mask) / FX) + LIFT),
      resting: false,
      rest: REST_TICKS,
      sucked: false,
    });
  }

  /**
   * Steps everything a tick at a time, and returns how much the hoover took
   * this frame — the game counts a piece as its area / 16 (VA 0x61327).
   * @param {number} delta ms
   * @param {Phaser.Geom.Rectangle|null} box the hoover's box, if it is on
   * @param {{x: number, y: number}} nozzle where it draws things to
   */
  update(delta, box, nozzle) {
    let taken = 0;
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      for (let i = this._pieces.length - 1; i >= 0; i -= 1) {
        const p = this._pieces[i];
        if (!p.img.active) { this._pieces.splice(i, 1); continue; }
        if (!p.sucked && p.resting && box
          && box.x < p.x + p.w && p.x < box.right && box.y < p.y + p.h && p.y < box.bottom) {
          p.sucked = true;
        }
        const done = p.sucked ? this._suck(p, nozzle) : this._fall(p);
        if (done) {
          if (p.sucked) taken += Math.floor((p.w0 * p.h0) / 16);
          p.img.destroy();
          this._pieces.splice(i, 1);
        }
      }
    }
    this._pieces.forEach((p) => this._draw(p));
    return taken;
  }

  /** The flight, the bounce, the wait and the sinking. True once gone. */
  _fall(p) {
    if (!p.resting) {
      p.x += p.vx;
      p.vy += GRAVITY;
      p.y += p.vy;
      if (p.y + p.h >= this._floorY) {
        p.y = this._floorY - p.h;
        p.vy = -(p.vy / 4);
        if (-p.vy < STILL) {
          p.vy = 0;
          p.vx = 0;
          p.resting = true;
        }
      }
      return false;
    }
    if (p.rest > 0) {
      p.rest -= 1;
      return false;
    }
    p.y += 1;
    p.h -= 1;
    return p.h <= 1;
  }

  /** Drawn in by the hoover, and squashed. True once gone. */
  _suck(p, nozzle) {
    p.x -= (p.x - nozzle.x) / 8;
    p.y -= (p.y - nozzle.y) / 4;
    if (p.h > GONE) {
      const cut = p.h / 4;
      p.y += cut;
      p.h -= cut;
      return false;
    }
    if (p.w > GONE) {
      p.w -= p.w / 4;
      return false;
    }
    return true;
  }

  _draw(p) {
    p.img.setPosition(p.x, p.y);
    if (p.sucked) {
      p.img.setDisplaySize(Math.max(1, p.w), Math.max(1, p.h));
    } else if (p.h < p.h0 && p.img.setCrop) {
      p.img.setCrop(0, 0, p.w0, p.h);
    }
  }

  destroy() {
    this._pieces.forEach((p) => p.img.active && p.img.destroy());
    this._pieces = [];
  }
}
