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

  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._all = this._all.filter((p) => (p.kind === 'got' ? this._gotTick(p) : this._puffTick(p)));
    }
    this._all.forEach((p) => {
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
