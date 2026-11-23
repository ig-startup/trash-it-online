/**
 * The apocalypse hammer v3's flight (hammer 29) — see docs/re/jack/apocalypse.md.
 *
 * `apocalypse_start` (VA 0x15260) turns the hammer entity over to
 * `apocalypse_script` (0x15323), which reads the flight script
 * (`apocalypse_flight`, 0x93ddc, ops 0x93d98) and, once it reaches `dive`,
 * lets the player steer the hammer down onto the level. It strikes when the
 * camera's held width falls under 170, with the force of
 * `apocalypse_blow_table` (0x93ce0), then falls and returns to its owner
 * (`apocalypse_fall` 0x15708, `apocalypse_fly` 0x1577b, `apocalypse_return`
 * 0x157f7).
 *
 * The hammer itself is a LooseHammer (looseHammer.js) that this drives.
 * Left out: the trail of `APOCS.SPR` pieces the game strews behind it
 * (`apocalypse_trail`, 0x15ac8) — a picture only.
 *
 * Positions in px, speeds in px a tick, stepped at the game's 60 Hz.
 */
import { WORD } from './combos';

const HZ = 60;

/** apocalypse_flight, the words of 0x93ddc up to its last wait. */
const SCRIPT = [
  5, 0, 0, 0, 14, 0, 61, 1, 4, 7, 450, 6, -250, 2, 73, 3,
  15, 13, 5, 0, 0, -4, 8, -60, 3,
  5, 0, 0, -15, 6, -100, 8, -1200, 3,
  7, -100, 8, -2000, 3,
  6, -350, 7, 150, 8, -3000, 3,
  6, -150, 7, -150, 8, -5000, 3,
  9, 5, -2, -2, -6, 2, 78, 3,
  5, -2, -2, -4, 8, -5300, 3,
  5, -2, -2, -2, 8, -5500, 3,
  5, -2, -2, -1, 8, -5600, 3,
  16, 5, 0, 0, 0, 10, 6, -200, 12, 3,
];

/** apocalypse_blow_table (0x93ce0): the force and rubble mask by −(fall speed) / 2. */
const BLOW_TABLE = [
  [1, 127], [1, 127], [1, 127], [1, 127], [500, 1023], [600, 4095], [700, 8191], [900, 32767],
  [1500, 32767], [2000, 32767], [4000, 32767], [8000, 65535], [16000, 65535], [32000, 131071],
  [64000, 131071], [128000, 262143], [256000, 262143], [512000, 524287], [1024000, 524287],
  [2048000, 524287], [4096000, 1048575], [8192000, 1048575], [16384000, 2097151],
];

// flag bits of the hammer's +0x6c
const F_FRAME = 1;     // stepping the frame toward +0x6a
const F_READ = 4;      // reading the script
const F_EASE_Y = 8;
const F_EASE_X = 0x10;
const F_HEIGHT = 0x20; // waiting for the height
const F_DIVE = 0x40;

const GRAVITY = 0.28125;           // 0x4800
const STRIKE_WIDTH = 170;          // 0xaa
const DIVE_STEP = 10000 / 65536;   // steering: ± this a tick
const DIVE_TOP = 4;                // …to ±4 px a tick
const DIVE_PUSH = 11000 / 65536;   // BUT2: the fall speed grows by this
const DIVE_FASTEST = 48;           // …to −48 px a tick
const DIVE_DRIFT = 50;             // +0x4e: ticks the hammer drifts to the centre
const DIVE_SLOW = 4;               // the fall speed without BUT2 once it has
const CAM_ABOVE = 250;             // the width held is height + 250
const FLY_TICKS = 120;
const RETURN_WAIT = 120;
const FLY_CAMERA = [1500, 2500];
const FLY_CAMERA_TICKS = 200;
const ABOVE_OWNER = 32;            // it returns to 32 px over its owner


export default class Apocalypse {
  /**
   * @param {import('./looseHammer').default} hammer  the hammer, already away from its owner
   * @param {object} hooks
   * @param {() => number} hooks.word  the owner's held input word
   * @param {() => {x: number, y: number, width: number}} hooks.cam  the camera now
   * @param {(hold: {x: number|null, y: number|null, width: number|null}|null) => void} hooks.hold
   *   what the camera holds where it is (options 0x98225 bits 0x40 0x80, 0x98226 bit 1)
   * @param {(follow: object) => {ticks: number}} hooks.track  camera_track with priority, for good
   * @param {(x: number, y: number, ticks: number) => void} hooks.point  camera_point
   * @param {(x: number, y: number, force: number, mask: number) => {struck: boolean, broke: boolean}} hooks.blowAt
   * @param {() => void} hooks.shake
   * @param {() => void} hooks.done  it is back: the hammer lies by its owner
   * @param {number} hooks.ground  the level's bottom
   */
  constructor(hammer, hooks) {
    this.hammer = hammer;
    this._h = hooks;
    this._acc = 0;
    this.mode = 'script';
    this._at = 0;            // the script pointer, +0x60
    this._flags = F_READ;    // +0x6c = 4
    this._timer = 0;         // +0x4a
    this._rate = 0;          // +0x64
    this._frameTo = 0;       // +0x6a
    this._dx = 0;            // +0x32, +0x36, +0x3a
    this._dy = 0;
    this._dh = 0;
    this._height = 0;        // +0x2c, the whole part is +0x2e
    this._easeX = 0;         // +0x6e
    this._easeY = 0;         // +0x70
    this._until = 0;         // +0x72
    this._hold = { x: null, y: null, width: null };
    this._lock = { x: 0, y: 0, width: 0 };
    this._drift = DIVE_DRIFT; // +0x4e
    this._vx = 0;
    this._vy = 0;
    this._vz = 0;

    hammer.mode = 'external';
    hammer.busy = true;
    hammer.frame = 61;       // 0x3d
    hammer.vx = 0;
    hammer.vy = 0;
    this._target = hooks.track(hammer);
  }

  /** @param {number} delta ms */
  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick && this.mode !== 'over') {
      this._acc -= tick;
      this._tick();
    }
  }

  _tick() {
    switch (this.mode) {
      case 'script': this._script(); break;
      case 'fall': this._fall(); break;
      case 'fly': this._fly(); break;
      case 'return': this._return(); break;
      default: break;
    }
  }

  /** apocalypse_script (VA 0x15323). */
  _script() {
    const hm = this.hammer;
    const word = this._h.word();
    if (!(this._flags & F_READ)) {
      // the frame ramp: every `rate` + 1 ticks one step toward the target
      if (this._timer === 0) {
        this._timer = this._rate;
        if (this._flags & F_FRAME) {
          if (hm.frame < this._frameTo) hm.frame += 1;
          else if (hm.frame > this._frameTo) hm.frame -= 1;
          else this._flags = (this._flags & ~(F_FRAME | F_READ)) | F_READ;
        }
      } else {
        this._timer -= 1;
      }
    } else {
      let stop = false;
      while (!stop) {
        const op = SCRIPT[this._at];
        this._at += 1;
        stop = this._op(op);
      }
    }

    if (!(this._flags & F_DIVE)) {
      if ((this._flags & F_EASE_Y) && this._ease('y', this._easeY)) this._flags &= ~F_EASE_Y;
      if ((this._flags & F_EASE_X) && this._ease('x', this._easeX)) this._flags &= ~F_EASE_X;
      if ((this._flags & F_HEIGHT) && -this._until < Math.floor(this._height)) {
        this._flags = (this._flags & ~(F_HEIGHT | F_READ)) | F_READ;
      }
      hm.x += this._dx;
      this._height -= this._dh;
      hm.y += this._dy;
      this._lock.width = Math.floor(this._height) + CAM_ABOVE;
      if (this._hold.width !== null) this._hold.width = this._lock.width;
      this._publish();
      return;
    }
    this._dive(word);
  }

  /** One opcode of the script (table 0x93d98). Returns true to stop reading (wait). */
  _op(op) {
    const arg = () => { const v = SCRIPT[this._at]; this._at += 1; return v; };
    const hm = this.hammer;
    switch (op) {
      case 0: hm.frame = arg(); return false;                       // frame n
      case 1: this._rate = arg(); this._timer = 0; return false;    // rate n
      case 2: this._frameTo = arg(); this._flags |= F_FRAME; return false;   // frame_to n
      case 3: this._flags &= ~F_READ; return true;                  // wait
      case 4: this._timer = arg(); return false;                    // timer n
      case 5: this._dx = arg(); this._dy = arg(); this._dh = arg(); return false;   // vel
      case 6: this._flags |= F_EASE_Y; this._easeY = this._h.ground + arg(); return false;
      case 7: this._flags |= F_EASE_X; this._easeX = Math.floor(hm.x) + arg(); return false;
      case 8: this._flags |= F_HEIGHT; this._until = arg(); return false;     // until_height
      case 9: this._holdXY(); return false;
      case 10: this._startDive(); return false;
      case 11: this._hold.x = null; this._hold.y = null; this._publish(); return false;
      case 12: this._holdXY(); this._holdWidth(); return false;
      case 13: this._holdWidth(); return false;
      case 14: return false;                                         // 0x28bfa4: nothing reads it
      case 15: case 16: return false;                                // the trail on / off
      default: return true;
    }
  }

  _holdXY() {
    const cam = this._h.cam();
    this._lock.x = cam.x;
    this._lock.y = cam.y;
    this._hold.x = this._lock.x;
    this._hold.y = this._lock.y;
    this._publish();
  }

  _holdWidth() {
    this._lock.width = this._h.cam().width;
    this._hold.width = this._lock.width;
    this._publish();
  }

  _publish() {
    this._h.hold({ ...this._hold });
  }

  /**
   * ease_by_sixteenth (VA 0x158b3): a sixteenth of the way to the target a
   * tick, at most 6 px; true on arrival (the whole pixels agree).
   */
  _ease(axis, target) {
    const hm = this.hammer;
    const diff = target - Math.floor(hm[axis]);
    let step = diff / 16;
    let arrived = false;
    if (step < 0) step = Math.max(step, -6);
    else if (step === 0) arrived = true;
    else step = Math.min(step, 6);
    hm[axis] += step;
    return arrived;
  }

  /** apo_op_dive (0x15a7f): frame 0x4f and the steered dive. */
  _startDive() {
    this.hammer.frame = 0x4f;
    this._drift = DIVE_DRIFT;
    this._flags |= F_DIVE;
  }

  /** The dive: the player's keys steer the held camera, the hammer is drawn on it. */
  _dive(word) {
    const hm = this.hammer;
    if (!(word & WORD.RIGHT)) {
      if ((word & WORD.LEFT) && this._vx > -DIVE_TOP) this._vx -= DIVE_STEP;
    } else if (this._vx < DIVE_TOP) {
      this._vx += DIVE_STEP;
    }
    if (!(word & WORD.UP)) {
      if ((word & WORD.DOWN) && this._vy > -DIVE_TOP) this._vy -= DIVE_STEP;
    } else if (this._vy < DIVE_TOP) {
      this._vy += DIVE_STEP;
    }
    if (word & WORD.BUT2) {
      this._vz -= DIVE_PUSH;
      if (this._vz < -DIVE_FASTEST) this._vz = -DIVE_FASTEST;
    }
    this._lock.x += this._vx;
    this._lock.y += this._vy;
    this._lock.width += this._vz;
    this._hold = { x: this._lock.x, y: this._lock.y, width: this._lock.width };
    this._publish();
    hm.x = Math.floor(this._lock.x);
    hm.y = Math.floor(this._lock.y) + this._drift + 15;
    if (this._drift !== 0) {
      this._drift -= 1;
      if (this._drift === 1) this._vz = -DIVE_SLOW;
    }
    if (Math.floor(this._lock.width) < STRIKE_WIDTH) this._strike();
  }

  /** The blow: all holds are let go, and the table gives its force by the fall speed. */
  _strike() {
    const hm = this.hammer;
    this._hold = { x: null, y: null, width: null };
    this._h.hold(null);
    // index = −(whole part of the fall speed) / 2; 23 and 24 would read the
    // opcode table as a force in the game, so the table's last entry stands in
    const idx = Math.min(BLOW_TABLE.length - 1, -(Math.floor(this._vz) >> 1));
    const [force, mask] = BLOW_TABLE[Math.max(0, idx)];
    const res = this._h.blowAt(hm.x, hm.y, force, mask);
    if (res.struck && !res.broke) {
      this.mode = 'fall';
      this._h.shake();
      hm.vy = -4;
    } else {
      this.mode = 'fly';
      this._timer = FLY_TICKS;
      hm.vx = 0;
      this._target.ticks = 0;
      FLY_CAMERA.forEach((over) => this._h.point(hm.x, hm.y - over, FLY_CAMERA_TICKS));
    }
  }

  /** apocalypse_fall (VA 0x15708): gravity, bouncing at half speed off the level's bottom. */
  _fall() {
    const hm = this.hammer;
    hm.y += hm.vy;
    hm.vy += GRAVITY;
    if (hm.y > this._h.ground) {
      hm.y = this._h.ground;
      const half = Math.floor((hm.vy * 65536) / 2) / 65536;
      hm.vy = -half;
      if (half !== 60000 / 65536 && half < 60000 / 65536) this._toReturn();
    }
  }

  /** apocalypse_fly (VA 0x1577b): up 12 px a tick, speeding off sideways. */
  _fly() {
    const hm = this.hammer;
    hm.y -= 12;
    const was = hm.vx;
    hm.vx += 20000 / 65536;
    hm.x += was;
    this._timer -= 1;
    if (this._timer < 0) this._toReturn();
  }

  _toReturn() {
    this.mode = 'return';
    this.hammer.frame = 61;
    this._timer = RETURN_WAIT;
    this._target.ticks = 0;
  }

  /**
   * apocalypse_return (VA 0x157f7): after 120 ticks it eases back to 32 px
   * over its owner — a quarter of the way a tick, in the game's 16.16 — and
   * is the owner's again (lying, to be drawn back) once both whole speeds
   * are 0.
   */
  _return() {
    const hm = this.hammer;
    if (this._timer !== 0) {
      this._timer -= 1;
      return;
    }
    const fx = (v) => Math.round(v * 65536);
    const owner = this.hammer.owner;
    const vx = (-(fx(hm.x) - fx(owner.x))) >> 2;
    const vy = (-(fx(hm.y) - fx(owner.y - ABOVE_OWNER))) >> 2;
    hm.x += vx / 65536;
    hm.y += vy / 65536;
    hm.flip = vx < 0 ? true : (vx > 0 ? false : hm.flip);
    if ((vx >> 16) === 0 && (vy >> 16) === 0) {
      this.mode = 'over';
      hm.busy = false;
      hm.rest(hm.x, hm.y);
      this._h.done();
    }
  }
}
