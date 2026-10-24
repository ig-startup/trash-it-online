import { playSfx, SFX } from '../audio/sfx';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * What G.EXE leaves in the air when something is taken (see "What a timmy
 * is worth" in docs/re/front/level-record.md and docs/re/objects/gits.md):
 *
 * - **GOT** (spawn_got_popup 0x11a92): a timmy hoovered says +1, +2 or
 *   +20 — GOT.SPR frames 0, 3 or 6, each stepping through its three a frame
 *   every 4 ticks — at the timmy, 0-3 px to the right. For 30 to 45 ticks
 *   it moves one of four ways (table 0x9372c): rises 1-4 px a tick (two of
 *   the four), eases up to a point 64-191 px above, 1/32 of the way a tick,
 *   or bounces under that point, falling at first and pulled up 0x3a98 a
 *   tick, a quarter of its speed kept at each bounce. Then it goes in a
 *   puff (die_after_timer_puff 0x1cebe).
 * - **the puff** (spawn_at_frame_centre 0x11c6e, puff_tick 0x11d4b):
 *   BLOI.SPR's seven frames, three ticks each, at the thing's point,
 *   stretched by as much as the thing's frame is over 32 px — also where a
 *   panel, a clock or the super hoover is picked up.
 * - **panel sparks** (spawn_panel_spark 0x1bb20, 32 at a time — a panel
 *   taken, `jack_touch_panel` 0x1bacb, and a life for 10000 of rubble,
 *   `rubble_extra_life_tick` 0x1a9b0): each starts at a random 16-bit
 *   point and eases onto an orbit of Jack (orbit_wobble 0x1d252) — his
 *   feet plus a 64-step sine of 73 px (table 0x98b96), x and y each from a
 *   random step, x a quarter of the way a tick, y an eighth. It twinkles
 *   through PANEL.SPR 21-36 a frame a tick, sounding 0x88 each time its x
 *   step comes round (panel_spark_twinkle 0x1b9f3); after 50-177 ticks it
 *   flies off sideways, 0.5-1 px/tick faster each tick (spark_fly 0x1b9c9).
 *
 * Units are the game's: px and px/tick, stepped at 60 Hz.
 */
const HZ = 60;
const GOT_FRAMES = PROP_ANIMS.got;
const PUFF_FRAMES = PROP_ANIMS.bloi;
/** GOT's first frame for a worth: +1, +2, +20 (popups 0, 3, 6). */
const GOT_BASE = { 1: 0, 2: 3, 20: 6 };
const BOUNCE_PULL = 0x3a98 / 65536;
const PUFF_TICKS = 3;
const PUFF_SIZE = 32;
const SPARK_FRAMES = PROP_ANIMS.panel;   // 0: frame 17; 1-16: frames 21-36
/** orbit_wobble's offsets, table 0x98b96: a sine of 73 px in 64 steps. */
const ORBIT = [0, 8, 16, 23, 30, 36, 42, 47, 53, 57, 61, 64, 67, 69, 71, 72, 73, 72,
  71, 69, 67, 64, 61, 57, 53, 47, 42, 36, 30, 23, 16, 8];
ORBIT.push(...ORBIT.map((v) => -v));
const SPARK_SOUND = 0x88;
const rand16 = () => Math.floor(Math.random() * 65536);

export default class Popups {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this._scene = scene;
    this._all = [];
    this._acc = 0;
  }

  /** "+1", "+2" or "+20" at (x, y). */
  got(x, y, worth) {
    playSfx(SFX.GOT, { delay: 0 });   // spawn_got_popup → play_sound_then_step
    const base = GOT_BASE[worth] ?? 0;
    const sprite = this._scene.add.image(0, 0, GOT_FRAMES[base]).setDepth(6);
    applyPropFrame(sprite, GOT_FRAMES[base]);
    const top = y - (64 + Math.floor(Math.random() * 128));
    this._all.push({
      kind: 'got', sprite, base, frame: base, step: 2,
      x: x + Math.floor(Math.random() * 4), y,
      life: 30 + Math.floor(Math.random() * 16),
      how: Math.floor(Math.random() * 4),
      rise: -(1 + Math.floor(Math.random() * 4)),
      top, v: Math.random() * 4,
    });
  }

  /** The puff, at (x, y), stretched for a thing `w` by `h` px. */
  puff(x, y, w = 0, h = 0) {
    const sprite = this._scene.add.image(x, y, PUFF_FRAMES[0]).setDepth(6);
    applyPropFrame(sprite, PUFF_FRAMES[0]);
    this._all.push({
      kind: 'puff', sprite, frame: 0, wait: PUFF_TICKS - 1,
      grow: [Math.max(0, w - PUFF_SIZE), Math.max(0, h - PUFF_SIZE)],
    });
  }

  /**
   * Panel sparks round `owner` (a Jack, followed by his x and y): `n` of
   * them, as spawn_panel_spark puts each.
   */
  sparks(owner, n = 32) {
    if (!SPARK_FRAMES) return;
    for (let i = 0; i < n; i += 1) {
      const rx = rand16();
      const ry = rand16();
      const sprite = this._scene.add.image(0, 0, SPARK_FRAMES[1]).setDepth(6);
      this._all.push({
        kind: 'spark', sprite, owner, frame: 21,
        // the same random is its point and its step (0x1bb20)
        x: (rx << 16) >> 16, y: (ry << 16) >> 16, ix: rx & 63, iy: ry & 63,
        life: (rand16() & 127) + 50, vx: 0, vy: 0, flying: false,
      });
    }
  }

  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._all = this._all.filter((p) => {
        if (p.kind === 'got') return this._gotTick(p);
        if (p.kind === 'spark') return this._sparkTick(p);
        return this._puffTick(p);
      });
    }
    this._all.forEach((p) => {
      if (p.kind === 'spark') {
        applyPropFrame(p.sprite, SPARK_FRAMES[p.frame - 20]);
        p.sprite.setPosition(Math.round(p.x), Math.round(p.y));
        return;
      }
      const list = p.kind === 'got' ? GOT_FRAMES : PUFF_FRAMES;
      applyPropFrame(p.sprite, list[p.frame]);
      if (p.kind === 'got') {
        p.sprite.setPosition(p.x, Math.round(p.y));
      } else {
        const { width: w, height: h } = p.sprite;
        p.sprite.setScale((w + p.grow[0]) / w, (h + p.grow[1]) / h);
      }
    });
  }

  /** One tick of GOT: its motion, its frames, its time (0x11b99 …). */
  _gotTick(p) {
    if (p.how === 1) {
      p.y -= (p.y - p.top) / 32;
    } else if (p.how === 2) {
      if (p.y > p.top) {
        p.v -= BOUNCE_PULL;
      } else {
        p.y = p.top;
        p.v = -p.v / 4;
      }
      p.y += p.v;
    } else {
      p.y += p.rise;
    }
    // die_after_timer_puff: its time out, a puff where it was
    p.life -= 1;
    if (p.life < 0) {
      this.puff(p.x, p.y, p.sprite.width, p.sprite.height);
      p.sprite.destroy();
      return false;
    }
    // got_animate 0x11bf9: every 4 ticks the next of its three frames
    if ((p.life & 3) === 0) {
      p.step -= 1;
      if (p.step < 0) {
        p.frame = p.base;
        p.step = 2;
      } else {
        p.frame += 1;
      }
    }
    return true;
  }

  /** One tick of a panel spark: twinkling round its Jack, or flying off. */
  _sparkTick(p) {
    if (p.flying) {
      // spark_fly: gone when it is off the screen
      p.x += p.vx;
      p.vx += p.vy;
      const view = this._scene.cameras.main.worldView;
      if (p.x < view.x - 64 || p.x > view.right + 64) {
        p.sprite.destroy();
        return false;
      }
      return true;
    }
    // orbit_wobble: eases to his feet plus the table's offsets
    const o = p.owner;
    p.x -= Math.trunc(p.x - (Math.trunc(o.x) + ORBIT[p.ix])) >> 2;
    p.y -= Math.trunc(p.y - (ORBIT[p.iy] + Math.trunc(o.y))) >> 3;
    p.ix = (p.ix + 1) & 63;
    p.iy = (p.iy + 1) & 63;
    if (p.ix === 0) playSfx(SPARK_SOUND);
    p.frame = p.frame === 36 ? 21 : p.frame + 1;
    p.life -= 1;
    if (p.life < 0) {
      p.flying = true;
      const r = rand16();
      p.vy = ((r & 1) ? -0x7fff - (rand16() & 0x7fff) : (rand16() & 0x7fff) + 0x7fff) / 65536;
      p.vx = 0;
    }
    return true;
  }

  _puffTick(p) {
    if (p.wait > 0) {
      p.wait -= 1;
      return true;
    }
    p.frame += 1;
    p.wait = PUFF_TICKS - 1;
    if (p.frame >= PUFF_FRAMES.length) {
      p.sprite.destroy();
      return false;
    }
    return true;
  }

  destroy() {
    this._all.forEach((p) => p.sprite.destroy());
    this._all = [];
  }
}
