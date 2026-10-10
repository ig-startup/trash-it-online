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
const SHEET = { timmy: 'timmy', king: 'ktimmy', spike: 'spk' };
const STRUCK_TICKS = 8;

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
    (level.spikes || []).forEach((s) => {
      const g = this._make('spike', s.x, s.y, 0);
      if (s.locked) {
        g.state = 'locked';
        g.block = world.blockIdAt(s.x, s.y);
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
    if (g.kind !== 'spike' && !g.handle) {
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
    return this.all.filter((g) => g.kind === 'timmy' && g.state !== 'hoovered')
      .map((g) => g.sprite);
  }

  /** The overhead blow: a spike git it reaches is done for (VA 0x32b15). */
  hit(reach) {
    this.all.forEach((g) => {
      if (g.kind !== 'spike' || g.state === 'struck' || g.state === 'locked') return;
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
        if (hooverBox && g.kind === 'timmy' && g.state !== 'struck'
          && hooverBox.contains(g.x, g.y - 6)) {
          g.state = 'hoovered';
          g.t = 0;
          continue;
        }
        this._step(g);
        g.t += 1;
      }
    }
    this.all.forEach((g) => {
      if (!g.sprite.active || g.state === 'hoovered' || g.sprite.getData('beamed')) return;
      if (g.handle && (g.handle.carried || g.handle.flying)) return;
      g.sprite.setPosition(g.x, g.y);
      g.sprite.setFlipX(g.left);
      applyPropFrame(g.sprite, g.frames[Math.min(g.frame, g.frames.length - 1)]);
    });
    this.collected += taken;
    return taken;
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
    if (g.kind !== 'spike' && Math.abs(g.y - this._w.groundY) < 1 && Math.random() < HOP_CHANCE) {
      g.state = 'hop';
      g.t = 0;
      g.vy = HOP_VY;
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
  }
}
