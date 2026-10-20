import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * The timmy bin (`.OB` classes 18-21, one per player; only 8K has one).
 * See docs/re/objects/timmy-bin.md.
 *
 * It waits (`timbin_wait`, VA 0x2f785) for a free timmy coming down
 * — vy above 0, not in anyone's hands — whose foot lands in the box at its
 * own foot (0xa361a: 19 × 8 px from x - 9, y - 8). Then it swallows it
 * (`timbin_swallow`, VA 0x2f7ea): the timmy is gone and a stand-in
 * ("obj_binned_TIMMY") is drawn just behind the bin, 52 ticks by two
 * tables — the bin's frame (0xa3622) and the stand-in's frame, offset and
 * squash (0xa368c). At tick 12 the bin hops (vy -3) with a puff and a
 * shake. At the end the timmy is the bin's player's, and once the level's
 * count (rules +0x3a) of timmies is in, the subtype-2 bell lets go.
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0x4800 / 65536;
const TERMINAL = 24;
const HOP = -3;                 // 0xfffd0000, at tick 12
const HOP_AT = 12;
/** The mouth: x, y, width, height around the bin's foot (0xa361a). */
const MOUTH = [-9, -8, 19, 8];
/** The bin's frame by tick (0xa3622); -1 is the end. */
const STAGES = [
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7,
  8, 8, 8, 8, -1,
];
/**
 * The stand-in by tick (0xa368c): TIMMY frame word (0x4000 hide from
 * here on, 0x8000 show again), dx, dy from the bin's foot, and its width
 * and height grown by so many px (+0x50, +0x52).
 */
const BINNED = [
  ...Array(8).fill([0, 0, -6, 0, 0]),
  ...Array(4).fill([0, 0, -5, 0, 0]),
  ...Array(5).fill([0x4000, 0, 0, 0, 0]),
  ...Array(8).fill([0, 0, 0, 0, 0]),
  [0x8012, 2, -7, 3, 0], [0x8012, 2, -7, 3, 0],
  [18, 2, -7, 2, 0], [18, 2, -7, 2, 0],
  [18, 2, -16, 1, 0], [18, 2, -16, 1, 0],
  [18, 2, -16, 0, 0], [18, 2, -16, 0, 0],
  ...Array(9).fill([0x4000, 0, 0, 0, 0]),
  [0x8012, 0, -39, -12, -1], [0x8012, 0, -39, -12, -1],
  ...Array(4).fill([18, 2, -36, -12, 0]),
  [18, 1, -32, -12, 0], [18, 1, -32, -12, 0],
  [0x4012, 0, 0, 0, 0], [0x4012, 0, 0, 0, 0],
];
const DEPTH = 2;

export default class TimmyBins {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, player: number}[]} bins
   * @param {object} world
   * @param {(x: number, from: number, to: number) => (number|null)} world.floor
   * @param {(player: number) => void} world.credit  a timmy for that player
   * @param {(x: number, y: number) => void} world.hop  the puff and shake
   */
  constructor(scene, bins, world) {
    this._w = world;
    this._acc = 0;
    this.all = bins.map((b) => {
      const sprite = scene.add.image(b.x, b.y, PROP_ANIMS.timbin[0]).setDepth(DEPTH);
      applyPropFrame(sprite, PROP_ANIMS.timbin[0]);
      const binned = scene.add.image(b.x, b.y, PROP_ANIMS.timmy[0])
        .setDepth(DEPTH - 0.01).setVisible(false);
      return {
        x: b.x, y: b.y, vy: 0, grounded: false, player: b.player,
        sprite, binned, tick: -1, frame: 0,
      };
    });
  }

  /**
   * Whether a bin takes a timmy whose foot is at (x, y) coming down at vy;
   * if so it starts swallowing it, and the caller lets the timmy go.
   */
  take(x, y, vy) {
    if (vy <= 0) return false;
    const bin = this.all.find((b) => b.tick < 0
      && x >= b.x + MOUTH[0] && x < b.x + MOUTH[0] + MOUTH[2]
      && y >= b.y + MOUTH[1] && y < b.y + MOUTH[1] + MOUTH[3]);
    if (!bin) return false;
    bin.tick = 0;
    applyPropFrame(bin.binned, PROP_ANIMS.timmy[0]);
    bin.binned.setScale(1).setPosition(bin.x, bin.y - 6).setVisible(true);
    return true;
  }

  /** @param {number} delta  ms */
  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this.all.forEach((b) => this._step(b));
    }
    this.all.forEach((b) => this._show(b));
  }

  _step(b) {
    if (b.tick >= 0) this._swallow(b);
    this._fall(b);
  }

  /** One tick of timbin_swallow (VA 0x2f7ea). */
  _swallow(b) {
    b.tick += 1;
    const stage = STAGES[b.tick];
    if (stage === -1) {
      b.frame = 0;
      b.tick = -1;
      b.binned.setVisible(false);
      this._w.credit(b.player);
      return;
    }
    b.frame = stage;
    const [word, dx, dy, dw, dh] = BINNED[b.tick];
    if (word & 0x8000) b.binned.setVisible(true);
    else if (word & 0x4000) b.binned.setVisible(false);
    const key = PROP_ANIMS.timmy[word & 0x3fff];
    applyPropFrame(b.binned, key);
    b.binned.setPosition(b.x + dx, b.y + dy);
    b.binned.setScale((b.binned.width + dw) / b.binned.width,
      (b.binned.height + dh) / b.binned.height);
    if (b.tick === HOP_AT) {
      this._w.hop(b.x, b.y);
      b.vy = HOP;
      b.grounded = false;
    }
  }

  /** The shared sprite physics: it falls until something holds it up. */
  _fall(b) {
    if (b.grounded) {
      if (this._w.floor(b.x, b.y - 1, b.y + 1) !== null) return;
      b.grounded = false;
    }
    b.vy = Math.min(TERMINAL, b.vy + GRAVITY);
    if (b.vy > 0) {
      const top = this._w.floor(b.x, b.y, b.y + b.vy);
      if (top !== null) {
        b.y = top;
        b.vy = 0;
        b.grounded = true;
        return;
      }
    }
    b.y += b.vy;
  }

  _show(b) {
    b.sprite.setPosition(b.x, b.y);
    const key = PROP_ANIMS.timbin[b.frame];
    if (b.sprite.texture.key !== key) applyPropFrame(b.sprite, key);
  }

  destroy() {
    this.all.forEach((b) => { b.sprite.destroy(); b.binned.destroy(); });
  }
}
