/**
 * The bonus screens — a world's C, and its exit's D: one big object
 * mid-screen to be hammered down before the clock runs out (G.EXE VA
 * 0x10c1f; see docs/re/levels/bonus-round.md).
 *
 * The object has `count` notches of `hp` each. A sideways blow that lands
 * in its box adds its force times the hammer's `bonus` to what is owed
 * (VA 0x110b7); every tick that is taken off the notch, a notch going at a
 * time with eight ticks between (0x10e4a). Each quarter of the notches
 * shows the next of its four frames, the fourth breaking off its two
 * parts; the last but one bursts it into pieces and the round is won. A
 * meter of `count` segments stands beside it, filling up at the start.
 *
 * All in the game's units, px and px/tick, at its 60 Hz; the sums in its
 * 32-bit integers, wrapping as they do (a blow is `imul`, VA 0x1f938).
 */
const FX = 65536;
const TICK_MS = 1000 / 60;
const COOLDOWN = 8;              // ticks between notches (0xcd4f4)
const FILL_EVERY = 8;            // a meter segment appears every 8 ticks
const METER_DX = 0x70;           // the meter stands 112 px to the right
const METER_STEP = 12;           // its segments go up 12 px apart
const FLY_GRAVITY = 0x900 / FX;  // what flies off falls at this (0x11160)
const PART_LIFE = 0xf0;          // the two parts fly 240 ticks
const PIECE_LIFE = 0xf0;         // the pieces 240 + rand(32)
/** Ticks from the burst to the round's end (0xa2f16 = 300, read as a timer). */
const END_TICKS = 300;
/** Frames of the sheet. */
const STAGES = 4;
const PARTS = [5, 4];
const SEGMENT_FULL = 6;
const SEGMENT_EMPTY = 7;
const FIRST_PIECE = 8;

const rand = (n) => Math.floor(Math.random() * n);

/** The sheet's texture key. */
const keyOf = (spec) => `bonus_${spec.sheet}`;

export function preloadBonusRound(scene, spec) {
  if (!scene.textures.exists(keyOf(spec))) scene.load.atlas(keyOf(spec), spec.atlas.image, spec.atlas.data);
}

export default class BonusRound {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} spec the level's `bonusRound`
   * @param {() => void} onWon
   */
  constructor(scene, spec, onWon) {
    this._scene = scene;
    this._spec = spec;
    this._onWon = onWon;
    this._key = keyOf(spec);
    this._acc = 0;
    this._ticks = 0;

    this._notch = 0;            // notches taken (0x933de)
    this._owed = 0;             // force owed (0x933e0)
    this._left = spec.hp;       // what is left of this notch (0xcd4f0)
    this._hp = spec.hp;         // 0 once burst (0xcd4e8)
    this._quarter = spec.count >> 2;  // the next notch to show a frame at (0xcd4fa)
    this._cool = 0;
    this._filled = 0;           // meter segments shown (0x933dc)
    this._filling = true;
    this._endIn = null;

    this._main = this._sprite(0, spec.x, spec.y);
    this._parts = PARTS.map((f) => ({ img: this._sprite(f, spec.x, spec.y).setVisible(false) }));
    this._segments = [];
    for (let k = 0; k < spec.count; k += 1) {
      this._segments.push(this._sprite(SEGMENT_FULL, spec.x + METER_DX, spec.y - METER_STEP * k)
        .setVisible(false));
    }
    this._flying = [];
  }

  /** An image of frame `f` with its anchor on (x, y), as the game draws it. */
  _sprite(f, x, y) {
    const img = this._scene.add.image(0, 0, this._key, String(f)).setOrigin(0, 0).setDepth(1.5);
    img.anchorX = x;
    img.anchorY = y;
    this._place(img, f);
    return img;
  }

  _place(img, f) {
    const [ox, oy] = this._spec.origins[f];
    img.setFrame(String(f)).setPosition(img.anchorX + ox, img.anchorY + oy);
    img.frameNo = f;
  }

  get burst() {
    return this._hp === 0;
  }

  /**
   * A sideways blow at (x, y) with `damage` (force x the hammer's bonus).
   * @returns {boolean} whether it landed (then no block is struck: VA 0x1f935)
   */
  hit(x, y, damage) {
    const b = this._spec.box;
    if (!(x > b.left && x < b.right && y > b.top && y < b.bottom)) return false;
    this._owed = (this._owed + damage) | 0;
    this._cool = 0;
    // every blow shakes the screen, 6 to 8 at the least (VA 0x1f97b)
    this._scene.cameras.main.shake(100, 0.004);
    return true;
  }

  update(delta) {
    this._acc += Math.min(delta, 100);
    while (this._acc >= TICK_MS) {
      this._acc -= TICK_MS;
      this._tick();
    }
  }

  _tick() {
    this._ticks += 1;
    const spec = this._spec;
    // The meter fills a segment every eight ticks (0x10e4a, 0x1110f).
    if (this._filling && (this._ticks & (FILL_EVERY - 1)) === 0) {
      if (this._filled < spec.count) this._filled += 1;
      else this._filling = false;
    }
    this._segments.forEach((s, k) => {
      if (k > this._filled) return;
      s.setVisible(true);
      // 0x1114a: a segment at or under the notches taken is spent
      if (k <= this._notch && s.frameNo !== SEGMENT_EMPTY) this._place(s, SEGMENT_EMPTY);
    });

    if (this._hp && this._owed) {
      if (this._cool === 0) {
        this._left = (this._left - this._owed) | 0;
        if (this._left < 0) {
          this._notch += 1;
          this._left = (this._left + this._hp) | 0;
          this._owed = (this._owed - this._hp) | 0;
          if (this._notch === this._quarter - 1) {
            this._quarter += spec.count >> 2;
            if (this._main.frameNo < STAGES - 1) {
              this._place(this._main, this._main.frameNo + 1);
              this._scene.cameras.main.shake(200, 0.008);
            }
          }
          this._cool = COOLDOWN;
        } else {
          this._owed = 0;
        }
        if (this._notch >= spec.count - 1) this._burstNow();
      } else {
        this._cool -= 1;
      }
    }

    // At the fourth frame the two parts break off (0x111a0).
    if (this._main.frameNo === STAGES - 1) {
      this._parts.forEach((p) => {
        if (p.flying) return;
        p.flying = true;
        p.img.setVisible(true);
        this._flying.push({
          img: p.img, vx: (0x1ffff - rand(0x40000)) / FX, vy: -rand(0x20000) / FX, life: PART_LIFE,
        });
      });
    }
    this._flying = this._flying.filter((f) => {
      f.img.anchorX += f.vx;
      f.img.anchorY += f.vy;
      f.vy += FLY_GRAVITY;
      this._place(f.img, f.img.frameNo);
      f.life -= 1;
      if (f.life < 0) f.img.destroy();
      return f.life >= 0;
    });

    if (this._endIn !== null) {
      this._endIn -= 1;
      if (this._endIn === 0) this._onWon();
    }
  }

  /** The last notch: it bursts into its pieces (VA 0x10f5d). */
  _burstNow() {
    const spec = this._spec;
    this._notch = spec.count;
    this._hp = 0;
    this._scene.cameras.main.shake(400, 0.015);
    for (let f = spec.pieces + FIRST_PIECE - 1; f >= FIRST_PIECE; f -= 1) {
      const img = this._sprite(f, spec.x, spec.y);
      this._flying.push({
        img,
        vx: (0x1ffff - rand(0x40000)) / FX,
        vy: -rand(0x40000) / FX,
        life: PIECE_LIFE + rand(32),
      });
    }
    this._main.destroy();
    this._parts.forEach((p) => { if (!p.flying) p.img.destroy(); });
    this._endIn = END_TICKS;
  }

  destroy() {
    [this._main, ...this._segments, ...this._flying.map((f) => f.img), ...this._parts.map((p) => p.img)]
      .forEach((img) => { if (img && img.active) img.destroy(); });
  }
}
