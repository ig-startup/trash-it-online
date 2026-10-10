import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';
import { COL, floorUnder } from './blockKinds';

/**
 * The gits — timmies, king timmies and the spike gits. See "The gits" in
 * scripts/formats/README.md; the routines are named in
 * scripts/ghidra/symbols.d/git.txt.
 *
 * A placed timmy sits locked to the block under it (VA 0x2ff6b) until that
 * block dies, then springs free with a random kick (VA 0x3053f). A free git
 * walks the way it faces, its frame taken from its x; a wall turns it, an
 * edge drops it, and the block it walks onto may carry a marker (`.COL`
 * word 2) that turns it — 1 left, 2 right. At the level's bottom it hops
 * now and then. The hoover takes free timmies (category 0x200, VA 0x2fc5b)
 * and they count; a king timmy it cannot take. A spike git walks the same
 * at half speed, and the overhead blow finishes it (VA 0x32b15).
 *
 * What hurts Jack (README "What hurts Jack"): a walking spike git's touch
 * (his event outcome 11), and the needles it throws when it bristles —
 * every 1024, 512 or 64 ticks by its record, eight in a fan (VA 0x32cfb,
 * outcome 12). A bomb git hurts no one by touch: touched on the ground it
 * chases whoever did it (VA 0x33a1f), and once it has caught up and
 * stays put it lights (0x32550) and blows (0x327c8) — a blast that
 * pushes Jack and breaks blocks with the level's own force.
 *
 * Timmies can be hurt too (README "A timmy knocked, and its end"). The
 * overhead blow knocks one on the ground flat (VA 0x31504); it lies there,
 * shakes itself (0x3172b) and walks on. Hit once more — or caught by a
 * blast a second time, or turned about too often — it dies: it floats up
 * out of the level, swaying, and cannot be taken (0x3193e, 0x32164).
 *
 * Units are the game's: px and px/tick, stepped at 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0x4800 / 65536;
const TERMINAL = 24;                    // vy clamped to ±0x180000 (VA 0x30069)
/** Animation profile 0 (VA 0x30462 → 0xa406a): top speed, acceleration. */
const WALK_MAX = 0x45730 / 65536;
const WALK_ACC = 0x1ee0 / 65536;
/** Profile 1, the turning slots 6 and 7: the skid's rate. */
const TURN_RATE = 0x6000 / 65536;
const AIR_DRAG = 2000 / 65536;          // git_fall: |vx| over 9999 loses 2000 a tick
const HOP_VY = -0x48000 / 65536;        // git_hop: vy -4.5
const HOP_CHANCE = 20 / 4096;           // a tick, at the level's bottom
const EDGE = 20;                        // past the level's edge it turns back
const KICK = 2;                         // up to random_value >> 14 each way (VA 0x3053f)
const HALF_W = 6;
/** Frame lists (VA 0xa40be). The walk is indexed by x, the rest by time. */
const WALK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const FALL = [6, 7, 8, 9];
const HOP = [3, 4, 5, 6, 7, 8, 9];
const TURN = [17, 18, 19, 20, 21, 22, 23, 22, 21, 24, 25];
const SHEET = { timmy: 'timmy', king: 'ktimmy', spike: 'spk', bomb: 'bom' };
const STRUCK_TICKS = 8;
/** Slot 19: the spike bristling, the bomb's fuse — the list's index steps. */
const BRISTLE = [26, 27, 28, 29, 30, 31, 32, 33, 34];
/** How often a spike bristles: its age masked by 0x93af8[period] is 0. */
const BRISTLE_MASK = [0x7fffffff, 0x3ff, 0x1ff, 0x3f];
const BRISTLE_FIRE = 50;                // at tick 50 the needles go (VA 0x32efd)
const BRISTLE_DONE = 100;               // after 100 it settles back (0x32f39)
/** The needles (VA 0x12711, table 0x93898): from 12 px up, in a fan. */
const NEEDLES = [
  [1.8477, -1.2346], [2, -2], [1.8477, -2.7654], [0.7654, -3.8477],
  [-0.7654, -3.8477], [-1.8477, -2.7654], [-2, -2], [-1.8477, -1.2346],
];
const NEEDLE_GRAVITY = 0x2400 / 65536;  // spk_tick_127e1
const NEEDLE_FRAME = 35;                // 0x23, stepping to 42 on the way down
const NEEDLE_JITTER = 0.25;
/** The chase (git_33a1f): given up past 300 px across or 120 up or down. */
const CHASE_X = 300;
const CHASE_Y = 120;
const CHASE_MAX = 8;
const CHASE_SETTLE = 0x11fff / 65536;   // slower than this …
const CHASE_LIGHT = 21;                 // … for 21 ticks, and it lights
const BLOW_AT = 30;                     // ticks after the fuse (0x329e0)
/** How many knocks a timmy takes before the next one is its end (0xa3e38). */
const KNOCK_LIMIT = 1;
const KNOCKED = [18, 19];               // slot 8: flat, then stirring
const SHAKEN = [20, 21, 22, 23, 22, 21]; // slot 9
const ANGEL = [24, 25];                 // slot 10, every 4 ticks
const GROUND_DRAG = 8000 / 65536;       // |vx| over 9999 loses 8000 a tick
const RISE = 0x900 / 65536;             // the dead one's lift, a tick
/** Blast push by distance (table 0x98c6c): 11 px/tick under 16, 6 at 50, 0 from 76. */
const blastPush = (d) => {
  const a = Math.abs(d);
  const v = a < 16 ? 11 : a < 50 ? 11 - ((a - 16) / 34) * 5 : a < 76 ? 6 - ((a - 50) / 26) * 6 : 0;
  return Math.sign(d) * v;
};

export default class Gits {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} level  its `timmies` and `spikes`
   * @param {object} world
   * @param {(x: number, y: number) => any} world.blockAt
   * @param {(x: number, y: number) => (number|null)} world.blockIdAt
   * @param {(id: number) => boolean} world.blockAlive
   * @param {(x: number, y: number) => number} world.markerAt
   * @param {number} world.groundY
   * @param {number} world.width
   * @param {import('./looseObjects').default} world.loose
   * @param {() => void} world.shake
   * @param {() => any} world.jack  the Jack the gits can touch
   * @param {(x: number, y: number) => void} world.bombBlast
   */
  constructor(scene, level, world) {
    this._scene = scene;
    this._w = world;
    this._acc = 0;
    this.all = [];
    this.collected = 0;
    (level.timmies || []).forEach((t) => {
      const kind = t.king ? 'king' : 'timmy';
      const g = this._make(kind, t.x, t.y, t.flags || 0);
      if (t.locked) {
        g.state = 'locked';
        g.block = world.blockIdAt(t.x, t.y);
        if (g.block === null) this._free(g, 0, 0);
      } else {
        this._free(g, 0, 0);
      }
    });
    this.needles = [];
    (level.spikes || []).forEach((s) => {
      const g = this._make('spike', s.x, s.y, 0);
      g.period = s.period || 0;
      g.age = 500 + Math.floor(Math.random() * 1024);
      if (s.locked) {
        g.state = 'locked';
        g.block = world.blockIdAt(s.x, s.y);
        if (g.block === null) this._free(g, 0, 0);
      } else {
        this._free(g, 0, 0);
      }
    });
    (level.bombs || []).forEach((b) => {
      const g = this._make('bomb', b.x, b.y, 0);
      if (b.locked) {
        g.state = 'locked';
        g.block = world.blockIdAt(b.x, b.y);
        if (g.block === null) this._free(g, 0, 0);
      } else {
        this._free(g, 0, 0);
      }
    });
  }

  _make(kind, x, y, flags) {
    const frames = PROP_ANIMS[SHEET[kind]];
    const sprite = this._scene.add.image(x, y, frames[0]).setDepth(2);
    applyPropFrame(sprite, frames[0]);
    const g = {
      kind, sprite, frames, x, y, vx: 0, vy: 0, flags, state: 'locked', t: 0,
      left: Math.random() < 0.5, marker: -1, handle: null, block: null, frame: 0,
    };
    this.all.push(g);
    return g;
  }

  /** Sprung free (VA 0x3053f): a random kick, then it falls. */
  _free(g, vx, vy) {
    g.state = 'fall';
    g.t = 0;
    g.vx = vx;
    g.vy = vy;
    g.marker = -1;
    if ((g.kind === 'timmy' || g.kind === 'king') && !g.handle) {
      // free timmies and kings can be carried (category bit 0)
      g.handle = this._w.loose.add(g.sprite, 'timmy', true);
    }
  }

  /** A timmy given back from somewhere — a UFO's haul. */
  spawnFree(x, y, vx, vy) {
    const g = this._make('timmy', x, y, 0);
    this._free(g, vx, vy);
    return g;
  }

  /** The timmy sprites, for whoever wants to find one (a UFO). */
  timmies() {
    return this.all.filter((g) => g.kind === 'timmy' && g.state !== 'hoovered' && g.state !== 'dying')
      .map((g) => g.sprite);
  }

  /**
   * The overhead blow. A spike or bomb git it reaches is done for (VA
   * 0x32b15); a timmy or king on its feet is knocked (git_tick, VA 0x30069).
   */
  hit(reach) {
    this.all.forEach((g) => {
      if (g.kind === 'timmy' || g.kind === 'king') {
        if (g.state !== 'walk' && g.state !== 'turn' && g.state !== 'shaken') return;
        if (g.handle && (g.handle.carried || g.handle.flying)) return;
        if (Phaser.Geom.Intersects.RectangleToRectangle(reach, g.sprite.getBounds())) this._knock(g);
        return;
      }
      if (g.kind !== 'spike' && g.kind !== 'bomb') return;
      if (g.state === 'struck' || g.state === 'locked' || g.state === 'blow') return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, g.sprite.getBounds())) return;
      g.state = 'struck';
      g.t = 0;
      g.vx = 0;
    });
  }

  /**
   * @param {number} delta ms
   * @param {Phaser.Geom.Rectangle|null} hooverBox
   * @param {{x: number, y: number}} nozzle
   * @returns {number} timmies taken this frame
   */
  update(delta, hooverBox, nozzle) {
    let taken = 0;
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      for (const g of [...this.all]) {
        if (!g.sprite.active) { this._drop(g); continue; }
        if (g.state === 'hoovered') {
          if (this._suck(g, nozzle)) { taken += 1; this._drop(g); g.sprite.destroy(); }
          continue;
        }
        if (g.state === 'locked') {
          if (g.block !== null && !this._w.blockAlive(g.block)) {
            this._free(g, (Math.random() * 2 - 1) * KICK, (Math.random() * 2 - 1) * KICK);
          }
          continue;
        }
        // held, thrown, or beamed up: someone else moves it
        if (g.sprite.getData('beamed')) continue;
        if (g.handle && (g.handle.carried || g.handle.flying)) {
          g.wasLoose = true;
          continue;
        }
        if (g.wasLoose) {
          g.wasLoose = false;
          g.handle.anchored = true;
          g.x = g.sprite.x;
          g.y = g.sprite.y;
          g.vx = 0;
          g.vy = 0;
          g.state = 'walk';
        }
        if (hooverBox && (g.kind === 'timmy' || g.hooverable)
          && g.state !== 'struck' && g.state !== 'dying'
          && hooverBox.contains(g.x, g.y - 6)) {
          g.state = 'hoovered';
          g.t = 0;
          continue;
        }
        this._step(g);
        g.t += 1;
        if (g.kind === 'spike') this._spikeTick(g);
        if (g.sprite.active) this._touchJack(g);
      }
      this._needlesTick();
    }
    this.all.forEach((g) => {
      if (!g.sprite.active || g.state === 'hoovered' || g.sprite.getData('beamed')) return;
      if (g.handle && (g.handle.carried || g.handle.flying)) return;
      g.sprite.setPosition(g.x + (g.jitter || 0), g.y);
      g.sprite.setFlipX(g.left);
      applyPropFrame(g.sprite, g.frames[Math.min(g.frame, g.frames.length - 1)]);
    });
    this.collected += taken;
    return taken;
  }

  /**
   * spike_tick (VA 0x332ef): when its age masked by its period comes to 0,
   * a walking spike stops and bristles.
   */
  _spikeTick(g) {
    g.age += 1;
    if (g.state === 'bristle' || g.state === 'unbristle' || g.state === 'struck') return;
    if ((g.age & BRISTLE_MASK[g.period]) !== 0) return;
    g.state = 'bristle';
    g.t = 0;
    g.index = 0;
  }

  /**
   * Knocked by the hammer: up at -1.5, its speed quartered and jittered
   * (up to 4 px/tick either way); flat on the first knock, dead on the next.
   */
  _knock(g) {
    const n = g.knocks || 0;
    g.knocks = n + 1;
    g.vy = -1.5;
    g.vx = g.vx / 4 + (Math.random() * 2 - 1) * 4;
    this._enter(g, n < KNOCK_LIMIT ? 'knocked' : 'dying');
  }

  /**
   * A blast's shock (VA 0x32413), every free timmy within 70 px of it:
   * pushed by distance — up, if it stood — then shaken on the first, dead
   * on the next.
   */
  blasted(x, y, box) {
    this.all.forEach((g) => {
      if (g.kind !== 'timmy' && g.kind !== 'king') return;
      if (['locked', 'hoovered', 'dying'].includes(g.state)) return;
      if (g.handle && (g.handle.carried || g.handle.flying)) return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(box, g.sprite.getBounds())) return;
      g.left = !(g.x < x);
      const py = blastPush(g.y - y);
      const standing = g.state === 'walk' || g.state === 'turn' || g.state === 'shaken';
      g.vy = standing ? g.vy - Math.abs(py) - Math.random() * 2 : g.vy + py;
      g.vy = Math.max(-12, g.vy);
      g.y -= 0.5;
      g.vx += blastPush(g.x - x) / 2;
      const n = g.knocks || 0;
      g.knocks = n + 1;
      this._enter(g, n < KNOCK_LIMIT ? 'shaken' : 'dying');
    });
  }

  /** Into one of the knocked states, with what each allows. */
  _enter(g, state) {
    g.state = state;
    g.t = 0;
    g.air = true;
    if (g.handle) g.handle.noPick = state === 'knocked' || state === 'dying';
    // a knocked king gains the hooverable bit (0x31504 sets +0xd bit 1)
    if (g.kind === 'king' && state !== 'dying') g.hooverable = true;
    if (state === 'dying') {
      g.anchor = g.x;
      g.drift = (Math.random() < 0.5 ? -1 : 1) * Math.random() * 2;
      g.vx = (Math.random() < 0.5 ? -1 : 1) * Math.random() * 4;
    }
  }

  /**
   * Knocked flat (0x31504) or shaking it off (0x3172b): it falls and slides
   * to a stop; flat, from tick 160 it stirs and at 164 shakes; shaking, a
   * frame every 4 ticks, after 100 on its feet it walks the way it faces.
   */
  _knockedStep(g) {
    g.vx = Math.abs(g.vx) > 9999 / 65536 ? g.vx - Math.sign(g.vx) * GROUND_DRAG : 0;
    if (this._moveX(g)) g.vx = 0;
    if (g.air) {
      g.vy = Math.min(TERMINAL, g.vy + GRAVITY);
      const floor = g.vy > 0 ? this._floor(g.x, g.y, g.y + g.vy) : null;
      if (floor !== null) {
        g.y = floor;
        g.vy = 0;
        g.air = false;
      } else {
        g.y += g.vy;
        if (g.y > this._w.groundY + 200) { g.sprite.destroy(); return; }
      }
    } else if (this._floor(g.x, g.y - 1, g.y + 1) === null) {
      g.air = true;
    }
    if (g.state === 'knocked') {
      g.frame = KNOCKED[!g.air && g.t > 160 ? 1 : 0];
      if (!g.air && g.t > 164) this._enter(g, 'shaken');
      return;
    }
    g.frame = SHAKEN[(g.t >> 2) % SHAKEN.length];
    if (g.t > 100 && !g.air) {
      g.state = 'walk';
      g.t = 0;
      g.marker = -1;
    }
  }

  /**
   * The end (0x3193e, 0x32164): out of reach of everything, it stops
   * rising for 10 ticks, then lifts at 0x900 a tick while it sways after a
   * point that drifts away; gone once it has left the level above.
   */
  _dyingStep(g) {
    if (g.t < 10) {
      g.vy = Math.min(0, g.vy + GRAVITY);
      g.anchor = g.x;
    } else {
      g.anchor += g.drift;
      g.vy -= RISE;
      g.vx += (g.anchor - g.x) / 64;
    }
    g.x += g.vx;
    g.y += g.vy;
    g.frame = ANGEL[(g.t >> 2) & 1];
    if (g.y < -64) g.sprite.destroy();
  }

  /**
   * Dizziness (git_tick): every about-turn adds 10, every tick takes 1.
   * Over 30 a turn makes it hop 5 px; at 500 a timmy dies of it, a spike
   * is done for and a bomb lights.
   */
  _turned(g) {
    g.dizzy = (g.dizzy || 0) + 10;
    if (g.dizzy <= 30) return;
    if (g.dizzy < 500) { g.y -= 5; return; }
    if (g.kind === 'spike') { g.state = 'struck'; g.t = 0; g.vx = 0; return; }
    if (g.kind === 'bomb') { g.state = 'fuse'; g.t = 0; g.index = 0; return; }
    this._enter(g, 'dying');
  }

  /** What Jack's box overlapping a git does — by its kind (his event list). */
  _touchJack(g) {
    const jack = this._w.jack && this._w.jack();
    if (!jack || !jack.active) return;
    if (g.state === 'struck' || g.state === 'locked') return;
    if (!Phaser.Geom.Intersects.RectangleToRectangle(jack.getBounds(), g.sprite.getBounds())) return;
    if (g.kind === 'spike') {
      // outcome 11: hurt — and, unless bristling, the spike turns about
      const left = jack.hurt({ x: g.x, y: g.y, vx: g.vx, vy: g.vy });
      if (left && g.state === 'walk') {
        g.vx = 0;
        g.left = !g.left;
        g.marker = -1;
      }
    } else if (g.kind === 'bomb' && g.state === 'walk') {
      // outcome 10: on the ground it goes after whoever touched it
      g.state = 'chase';
      g.t = 0;
      g.still = 0;
      g.target = jack;
    }
  }

  /** The needles: falling, turning as they go, gone below the level. */
  _needlesTick() {
    const jack = this._w.jack && this._w.jack();
    for (let i = this.needles.length - 1; i >= 0; i -= 1) {
      const n = this.needles[i];
      n.vy += NEEDLE_GRAVITY;
      n.x += n.vx;
      n.y += n.vy;
      n.vx = Math.abs(n.vx) > 9999 / 65536 ? n.vx - Math.sign(n.vx) * AIR_DRAG : 0;
      n.t += 1;
      if (n.vy > -1 && (n.t & 3) === 0 && n.frame < 42) n.frame += 1;
      n.sprite.setPosition(n.x, n.y);
      applyPropFrame(n.sprite, this._spkFrames[n.frame]);
      if (jack && jack.active
        && Phaser.Geom.Intersects.RectangleToRectangle(jack.getBounds(), n.sprite.getBounds())) {
        jack.hurt({ x: n.x, y: n.y, vx: n.vx, vy: n.vy });   // outcome 12
      }
      if (n.y > this._w.groundY) {
        n.sprite.destroy();
        this.needles.splice(i, 1);
      }
    }
  }

  /** Eight needles in a fan from 12 px over the spike (VA 0x12711). */
  _fireNeedles(g) {
    this._spkFrames = PROP_ANIMS.spk;
    NEEDLES.forEach(([vx, vy]) => {
      const sprite = this._scene.add.image(g.x, g.y - 12, this._spkFrames[NEEDLE_FRAME]).setDepth(3);
      applyPropFrame(sprite, this._spkFrames[NEEDLE_FRAME]);
      const jitter = () => (Math.random() * 2 - 1) * NEEDLE_JITTER;
      sprite.setFlipX(vx < 0);
      this.needles.push({
        sprite, x: g.x, y: g.y - 12, vx: vx + jitter(), vy: vy + jitter(), frame: NEEDLE_FRAME, t: 0,
      });
    });
  }

  _drop(g) {
    const i = this.all.indexOf(g);
    if (i >= 0) this.all.splice(i, 1);
  }

  /** One tick of a free git. */
  _step(g) {
    const max = g.kind === 'spike' ? WALK_MAX / 2 : WALK_MAX;
    const acc = g.kind === 'spike' ? WALK_ACC / 2 : WALK_ACC;
    if (g.state === 'struck') {
      // it stops and swells, then is gone with a shake
      g.sprite.setScale(1 + g.t / STRUCK_TICKS / 2);
      if (g.t >= STRUCK_TICKS) {
        this._w.shake();
        g.sprite.destroy();
      }
      return;
    }
    if (g.dizzy) g.dizzy -= 1;
    if (g.state === 'knocked' || g.state === 'shaken') {
      this._knockedStep(g);
      return;
    }
    if (g.state === 'dying') {
      this._dyingStep(g);
      return;
    }
    if (g.state === 'bristle' || g.state === 'unbristle') {
      this._bristleStep(g);
      return;
    }
    if (g.state === 'chase') {
      this._chaseStep(g);
      return;
    }
    if (g.state === 'fuse' || g.state === 'blow') {
      this._fuseStep(g);
      return;
    }
    if (g.state === 'fall' || g.state === 'hop') {
      if (Math.abs(g.vx) > 9999 / 65536) g.vx -= Math.sign(g.vx) * AIR_DRAG;
      this._moveX(g);
      g.vy = Math.min(TERMINAL, g.vy + GRAVITY);
      if (g.vy > 0) {
        const floor = this._floor(g.x, g.y, g.y + g.vy);
        if (floor !== null) {
          g.y = floor;
          g.vy = 0;
          g.state = 'walk';
          g.t = 0;
          return;
        }
      }
      g.y += g.vy;
      const list = g.state === 'hop' ? HOP : FALL;
      g.frame = list[Math.min(list.length - 1, g.t >> 3)];
      if (g.y > this._w.groundY + 200) g.sprite.destroy();
      return;
    }
    if (g.state === 'turn') {
      // the skid (git_turn_to_*, VA 0x31299): until the speed changes sign
      g.vx += g.left ? TURN_RATE : -TURN_RATE;
      if (g.left ? g.vx >= 0 : g.vx <= 0) {
        g.left = !g.left;
        g.state = 'walk';
        this._turned(g);
      }
      this._moveX(g);
      g.frame = TURN[Math.min(TURN.length - 1, g.t >> 2)];
      if (this._floor(g.x, g.y - 1, g.y + 1) === null) { g.state = 'fall'; g.t = 0; }
      return;
    }
    // walking (VA 0x30a35 / 0x30be6)
    const dir = g.left ? -1 : 1;
    if (g.vx * dir < max) g.vx += acc * dir;
    else g.vx -= (g.vx - max * dir) / 32;
    if (this._moveX(g)) {
      g.vx = 0;
      g.left = !g.left;           // a wall turns it at once (VA 0x3000d)
      g.marker = -1;
      this._turned(g);
    }
    g.frame = WALK[(Math.floor(g.x) >> 2) & 15];
    if (this._floor(g.x, g.y - 1, g.y + 1) === null) {
      g.state = 'fall';
      g.t = 0;
      return;
    }
    if (g.x > this._w.width + EDGE && !g.left) this._turn(g);
    else if (g.x < -EDGE && g.left) this._turn(g);
    // the marker on the block underfoot (VA 0x306de)
    const m = this._w.markerAt(g.x, g.y);
    if (m !== g.marker) {
      g.marker = m;
      const goLeft = m === 1 || (m === 29 && g.flags & 2);
      const goRight = m === 2 || (m === 30 && g.flags & 2);
      if (goLeft && !g.left) this._turn(g);
      if (goRight && g.left) this._turn(g);
    }
    // a hop now and then at the bottom
    if ((g.kind === 'timmy' || g.kind === 'king')
      && Math.abs(g.y - this._w.groundY) < 1 && Math.random() < HOP_CHANCE) {
      g.state = 'hop';
      g.t = 0;
      g.vy = HOP_VY;
    }
  }

  /**
   * Bristling (spike_bristle, VA 0x32cfb): it slows to a stop and its
   * spines come out a frame every 4 ticks; it shivers from tick 30, at 50
   * the needles fly, and after 100 the spines go back in (0x32f39) and it
   * walks on the way it faces.
   */
  _bristleStep(g) {
    g.vx = Math.abs(g.vx) > 9999 / 65536 ? g.vx - Math.sign(g.vx) * (8000 / 65536) : 0;
    if (this._moveX(g)) g.vx = 0;
    if (g.state === 'bristle') {
      if ((g.t & 3) === 0 && g.index < 7) g.index += 1;
      if (g.t > 30 && g.t < BRISTLE_FIRE) g.jitter = (g.t & 1) ? 1 : 0;
      else g.jitter = 0;
      if (g.t === BRISTLE_FIRE) {
        g.index = 8;
        this._fireNeedles(g);
      }
      if (g.t > BRISTLE_DONE) {
        g.state = 'unbristle';
        g.t = 0;
      }
    } else if ((g.t & 3) === 0) {
      g.index -= 1;
      if (g.index <= 0) {
        g.state = 'walk';
        g.t = 0;
        g.marker = -1;
      }
    }
    g.frame = BRISTLE[Math.max(0, Math.min(8, g.index))];
  }

  /**
   * After its Jack (git_33a1f): his distance across, a 32nd of it a tick
   * (a 64th late in each 256), less an eighth of its speed, to 8 px/tick
   * at most. Too far and it walks again; a wall throws it back at a
   * quarter; standing all but still 21 ticks, it lights.
   */
  _chaseStep(g) {
    const jack = g.target;
    if (!jack || !jack.active) { g.state = 'walk'; return; }
    const dx = jack.x - g.x;
    if (Math.abs(dx) > CHASE_X || Math.abs(jack.y - g.y) > CHASE_Y) {
      g.state = 'walk';
      g.t = 0;
      return;
    }
    g.age = (g.age || 0) + 1;
    g.vx += (g.age & 0xff) < 0xd3 ? dx / 32 : dx / 64;
    g.left = g.vx < 0;
    g.vx -= g.vx / 8;
    g.vx = Phaser.Math.Clamp(g.vx, -CHASE_MAX, CHASE_MAX);
    const i = (Math.floor(g.x) >> 2) & 15;
    g.frame = WALK[g.left ? 15 - i : i];
    if (this._floor(g.x, g.y - 1, g.y + 1) === null) {
      g.state = 'fall';
      g.t = 0;
      return;
    }
    if (this._moveX(g)) g.vx = -g.vx / 4;
    if (Math.abs(g.vx) > CHASE_SETTLE) {
      g.still = 0;
    } else if ((g.still += 1) >= CHASE_LIGHT) {
      g.state = 'fuse';
      g.t = 0;
      g.index = 0;
    }
  }

  /**
   * The bomb's fuse (0x32550): it slows, the fuse runs a frame every 4
   * ticks, and then (0x327c8) it flickers, and at tick 30 goes off.
   */
  _fuseStep(g) {
    g.vx = Math.abs(g.vx) > 9999 / 65536 ? g.vx - Math.sign(g.vx) * (8000 / 65536) : 0;
    if (this._moveX(g)) g.vx = 0;
    if (g.state === 'fuse') {
      if ((g.t & 3) === 0 && ++g.index > 7) {
        g.index = 7;
        g.state = 'blow';
        g.t = 0;
      }
      g.frame = BRISTLE[g.index];
      return;
    }
    g.frame = 33;
    g.jitter = g.t & 1;
    if (g.t === BLOW_AT) {
      g.sprite.destroy();
      this._w.bombBlast(g.x, g.y);
    }
  }

  _turn(g) {
    g.state = 'turn';
    g.t = 0;
  }

  /** Moves along x; true when a solid block stopped it. */
  _moveX(g) {
    if (!g.vx) return false;
    const nx = g.x + g.vx;
    const ahead = nx + Math.sign(g.vx) * HALF_W;
    const b = this._w.blockAt(ahead, g.y - 8);
    if (b && b.col === COL.SOLID) return true;
    g.x = nx;
    return false;
  }

  /** The top of what is under x between from and to, the ground included. */
  _floor(x, from, to) {
    const top = floorUnder(this._w.blockAt, x, from, to);
    if (top !== null) return top;
    return to >= this._w.groundY && from <= this._w.groundY ? this._w.groundY : null;
  }

  /** Into the hoover: it trails to the nozzle and shrinks. True once in. */
  _suck(g, nozzle) {
    g.t += 1;
    const s = g.sprite;
    s.x += (nozzle.x - s.x) / 4;
    s.y += (nozzle.y - s.y) / 4;
    s.setScale(Math.max(0.1, 1 - g.t / 16));
    return g.t >= 16;
  }

  destroy() {
    this.all = [];
    this.needles = [];
  }
}
