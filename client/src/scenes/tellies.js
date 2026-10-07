import Phaser from 'phaser';
import { PROP_ANIMS, PROP_FRAME_INFO, applyPropFrame } from '../entities/props';
import { COL } from './blockKinds';

/**
 * Teleporters — `.OB` class 27 (constructor VA 0x347c1, state 0x34890).
 * See "The teleporter" in scripts/formats/README.md.
 *
 * A pad (TELLY.SPR 0-9) that opens, and while it is open a beam stands
 * over it (frame 10, its own sprite, VA 0x34a26) growing to full size.
 * Something in the air that meets the beam (category 0x10000 — Jack's)
 * is sent to the pad whose number this one names, if that one is open and
 * not about to close: it is held over this pad, squeezed thin a pixel a
 * tick, moved over the other, and let out the same way (VA 0x34b5b,
 * 0x34bcb). A pad not kept on cycles: shut 180 ticks, opening, open 180
 * ticks, closing. The pad is a physical sprite (VA 0x34d3e → 0x1f098):
 * placed in the air, it comes down onto what is under it.
 */
const HZ = 60;
const OPEN_TICKS = 180;          // +0x4a, either way
const FRAME_EVERY = 4;           // the pad's frames step on the frame counter & 3 (0x3187ee)
const LAST_FRAME = 9;
const SEND_AFTER = 30;           // the far pad must stay open longer than this
const HOLD_UP = -8;              // where it holds him, over the beam
const ARRIVE_UP = -12;           // and where he comes out, over the other pad
const THIN = 6;                  // squeezed down to this many px wide
/** The beam growing (0xa41f6, 0xa41cc) and shrinking (0xa4262, 0xa421e), a tick each, as offsets to its size. */
const GROW_W = [-26, -25, -24, -23, -22, -20, -19, -18, -17, -16, -14, -12, -10, -9, -8, -4, -2, -1, 0];
const GROW_H = [-63, -54, -45, -37, -30, -24, -19, -15, -12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
const SHRINK_W = [0, -1, -2, -4, -8, -9, -10, -12, -14, -16, -17, -18, -19, -20, -22, -23, -24, -24, -24];
const SHRINK_H = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9,
  -10, -12, -15, -19, -24, -30, -37, -45, -54, -63];

export default class Tellies {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, id: number, target: number, alwaysOn: boolean}[]} placed
   */
  constructor(scene, placed, blockAt, bottom) {
    this._blockAt = blockAt;
    this._bottom = bottom;
    this._acc = 0;
    this._ticks = 0;
    this.all = placed.map((t) => {
      const pad = scene.add.image(t.x, t.y, PROP_ANIMS.telly[0]);
      applyPropFrame(pad, PROP_ANIMS.telly[0]);
      const beam = scene.add.image(t.x, t.y, PROP_ANIMS.telly[10]).setVisible(false);
      applyPropFrame(beam, PROP_ANIMS.telly[10]);
      beam.setAlpha(0.85);
      return {
        ...t, pad, beam,
        // shut → opening → open → closing → shut
        state: t.alwaysOn ? 'opening' : 'shut',
        timer: OPEN_TICKS,
        frame: 0,
        beamT: -1, beamGrow: true,
        vy: 0,
        passenger: null,
        // Who came out here and is still in the beam: it does not take
        // them back until they have left it (VA 0x34aa4-0x34b15).
        arrived: null,
      };
    });
    this._byId = new Map(this.all.map((t) => [t.id, t]));
  }

  /** The beam's box at its present size, or null while it has none. */
  _beamBox(t) {
    if (t.beamT < 0) return null;
    const info = PROP_FRAME_INFO[PROP_ANIMS.telly[10]];
    const [w, h] = this._beamSize(t);
    return new Phaser.Geom.Rectangle(t.x - info.ax + (info.w - w) / 2,
      t.y - info.ay + (info.h - h), w, h);
  }

  _beamSize(t) {
    const info = PROP_FRAME_INFO[PROP_ANIMS.telly[10]];
    const tw = t.beamGrow ? GROW_W : SHRINK_W;
    const th = t.beamGrow ? GROW_H : SHRINK_H;
    const i = Math.min(t.beamT, th.length - 1);
    return [info.w + tw[Math.min(i, tw.length - 1)], info.h + th[i]];
  }

  /**
   * Jack meeting a beam in the air (VA 0x34a8b → 0x34b5b). Returns the
   * transfer to run, or null.
   * @param {any} player
   */
  meet(player) {
    if (this.all.some((t) => t.passenger)) return null;
    const b = player.body;
    const bounds = player.getBounds();
    // Leaving a beam he came out of lets it take him again.
    this.all.forEach((t) => {
      const box = this._beamBox(t);
      if (t.arrived === player && !(box && Phaser.Geom.Intersects.RectangleToRectangle(bounds, box))) {
        t.arrived = null;
      }
    });
    if (b.blocked.down) return null;          // the flag 0x10: on the ground, no
    for (const t of this.all) {
      const box = this._beamBox(t);
      const inBeam = !!box && Phaser.Geom.Intersects.RectangleToRectangle(bounds, box);
      if (t.arrived === player) {
        if (!inBeam) t.arrived = null;
        continue;
      }
      if (!inBeam || t.state !== 'open' || !t.beamGrow) continue;
      const far = this._byId.get(t.target);
      if (!far || far.state !== 'open' || far.passenger) continue;
      if (!far.alwaysOn && far.timer <= SEND_AFTER) continue;
      far.passenger = {
        player, from: t, squeeze: 0, arrived: false,
        width: player.width,
      };
      return far.passenger;
    }
    return null;
  }

  /**
   * @param {number} delta ms
   * @param {(player: any, x: number, y: number, sx: number, sy: number) => void} hold
   * @param {(player: any) => void} release
   */
  update(delta, hold, release) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._ticks += 1;
      this.all.forEach((t) => this._step(t, hold, release));
    }
    this.all.forEach((t) => this._draw(t));
  }

  /** Down onto a solid block or a platform, as any sprite (0x1f098 → 0x606eb). */
  _fall(t) {
    const floor = (from, to) => {
      if (to >= this._bottom) return this._bottom;
      // Across its box, ± 10 (0xa41c8), as the probe walks it.
      for (let cy = Math.floor((from + 1) / 8) * 8; cy <= to; cy += 8) {
        for (let cx = Math.floor((t.x - 10) / 8) * 8; cx <= t.x + 10; cx += 8) {
          const b = this._blockAt(cx, cy);
          if (b && (b.col === COL.SOLID
            || ((b.col === COL.PLATFORM || b.col === COL.LADDER_TOP) && from <= b.top))) return b.top;
        }
      }
      return null;
    };
    if (t.vy === 0 && floor(t.y, t.y + 1) !== null) return;
    t.vy = Math.min(24, t.vy + 0x4800 / 65536);
    const land = floor(t.y, t.y + t.vy);
    if (land !== null) { t.y = land; t.vy = 0; } else t.y += t.vy;
  }

  _step(t, hold, release) {
    this._fall(t);
    // The pad's cycle (VA 0x34961-0x34a1c).
    const onBeat = this._ticks % FRAME_EVERY === 0;
    if (t.state === 'opening' && onBeat) {
      if (t.frame === 0) { t.beamT = 0; t.beamGrow = true; }
      if (t.frame < LAST_FRAME) t.frame += 1;
      else { t.state = 'open'; t.timer = OPEN_TICKS; }
    } else if (t.state === 'closing' && onBeat) {
      if (t.frame > 0) t.frame -= 1;
      else { t.state = 'shut'; t.timer = OPEN_TICKS; }
    } else if (t.state === 'open' && !t.alwaysOn) {
      t.timer -= 1;
      if (t.timer <= 0) {
        t.state = 'closing';
        t.beamT = 0;
        t.beamGrow = false;
      }
    } else if (t.state === 'shut') {
      t.timer -= 1;
      if (t.timer <= 0) t.state = 'opening';
    }
    if (t.beamT >= 0) {
      t.beamT += 1;
      if (!t.beamGrow && t.beamT >= SHRINK_H.length) t.beamT = -1;
    }

    // A passenger on his way here (VA 0x34bcb): thinner a px a tick over
    // the pad he left, then over this one, back to his width, and out.
    const p = t.passenger;
    if (!p) return;
    if (!p.arrived) {
      p.squeeze += 1;
      if (p.width - p.squeeze <= THIN) p.arrived = true;
    } else {
      p.squeeze -= 1;
    }
    const at = p.arrived ? { x: t.x, y: t.y + ARRIVE_UP } : { x: p.from.x, y: p.from.y + HOLD_UP };
    const sx = (p.width - p.squeeze) / p.width;
    const sy = 1 + p.squeeze / p.width;
    if (p.arrived && p.squeeze <= 0) {
      t.passenger = null;
      t.arrived = p.player;
      release(p.player);
    } else {
      hold(p.player, at.x, at.y, sx, sy);
    }
  }

  _draw(t) {
    t.pad.setPosition(t.x, t.y);
    t.beam.setPosition(t.x, t.y);
    const key = PROP_ANIMS.telly[t.frame];
    t.pad.setTexture(key);
    applyPropFrame(t.pad, key);
    if (t.beamT < 0) {
      t.beam.setVisible(false);
      return;
    }
    const info = PROP_FRAME_INFO[PROP_ANIMS.telly[10]];
    const [w, h] = this._beamSize(t);
    // Its size offsets cut the frame down from the sides and the top.
    t.beam.setCrop((info.w - w) / 2, info.h - h, Math.max(0, w), Math.max(0, h));
    t.beam.setVisible(w > 0 && h > 0);
  }

  destroy() {
    this.all.forEach((t) => { t.pad.destroy(); t.beam.destroy(); });
    this.all = [];
  }
}
