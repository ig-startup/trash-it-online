import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * Bonuses, the dispenser and the secret panel — .OB classes 33, 8 and 46.
 * See "Bonuses, the dispenser and the panel" in scripts/formats/README.md;
 * the routines are named in scripts/ghidra/symbols.d/bonus.txt.
 *
 * The bonus git itself walks with the other gits (gits.js); when it bursts
 * it hands its prize here:
 *   clock   spins on the floor; Jack's touch puts 25 s on the level's timer
 *           (VA 0x12096); the hammer bursts it and the time is lost
 *   hoover  the super hoover (BVAC): 60 s of a hoover that takes all the
 *           rubble around (VA 0x61866)
 *   bubble  bounces about; Jack's touch doubles the points for rubble for
 *           32 s (VA 0x1a516)
 *   timmies flung up, a batch of them (VA 0x123c0)
 *
 * The dispenser (DIS.SPR) stands on what is under it; the overhead blow
 * wobbles it 40 ticks and then it lets out its small cannonballs, one a
 * tick, up and fanned out (VA 0x5f487); spent, it rises away.
 *
 * The panel is a secret: free, or locked in a block until it dies; Jack's
 * touch takes it (VA 0x1bacb).
 *
 * Units are the game's: px and px/tick, stepped at 60 Hz.
 */
const HZ = 60;
const GRAVITY = 0x4800 / 65536;
const TERMINAL = 24;
const FRICTION = 2000 / 65536;
const CLOCK_SECONDS = 25;               // BCD 0x25 onto 0x96fb0
const CLOCK_FRAME_TICKS = 3;            // a frame every 3 ticks (0x11dcc)
const CLOCK_TURNS = 10;                 // then it hops about …
const CLOCK_HOP_TICKS = 240;            // … for 240 ticks (0x11e63)
const SUPER_HOOVER_TICKS = 0xe10;       // 3600 (0x61883)
const DOUBLE_POINTS_TICKS = 0x780;      // 1920 (0x1a563)
const HOOVER_VY = -0x493e0 / 65536;     // BVAC thrown up from 20 px over (0x1b3eb)
const POP_VY = -6;                      // a pickup freed from its block (0x1b2a9)
/** The dispenser (VA 0x5f3bb, 0x5f487, table 0xa43f8). */
const DIS_WOBBLE = 40;
const DIS_LID_AT = 36;
const DIS_BALL_VY = 3;                  // the blow's force >> 5, held to 3..32
const DIS_BALL_VX = [-0.9155, 1.3733, -1.8311, 2.2888, 0.9155, -1.3733, 1.8311, -2.2888];
const DIS_LEAVE_VY = 0x24000 / 65536;

export default class Bonuses {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} level  its `dispensers` and `panels`
   * @param {object} world
   * @param {(x: number, from: number, to: number) => (number|null)} world.floor
   * @param {(x: number, y: number) => (number|null)} world.blockIdAt
   * @param {(id: number) => boolean} world.blockAlive
   * @param {number} world.groundY
   * @param {() => any} world.jack
   * @param {(x: number, y: number, vx: number, vy: number) => void} world.ball
   * @param {(x: number, y: number, vx: number, vy: number) => void} world.timmy
   * @param {(seconds: number) => void} world.addTime
   * @param {(ticks: number) => void} world.superHoover
   * @param {(ticks: number) => void} world.doublePoints
   * @param {() => void} world.secret
   * @param {() => void} world.shake
   */
  constructor(scene, level, world) {
    this._scene = scene;
    this._w = world;
    this._acc = 0;
    this.prizes = [];
    this.dispensers = [];
    this.panels = [];
    (level.dispensers || []).forEach((d) => this._addDispenser(d));
    (level.panels || []).forEach((p) => this._addPanel(p));
  }

  _image(sheet, i, x, y, depth = 2) {
    const key = PROP_ANIMS[sheet][i];
    const sprite = this._scene.add.image(x, y, key).setDepth(depth);
    applyPropFrame(sprite, key);
    return sprite;
  }

  _show(sprite, sheet, i) {
    applyPropFrame(sprite, PROP_ANIMS[sheet][i]);
  }

  // ── Prizes ───────────────────────────────────────────────────────────────

  /** What a burst bonus git leaves (bonus_prize, VA 0x123c0). */
  prize(kind, count, x, y, facingLeft) {
    if (kind === 1) {
      // timmies, at least one: up at -6 less a little, across up to 4
      for (let i = 0; i < Math.max(1, count); i += 1) {
        const vx = Math.random() * 4 * (facingLeft ? -1 : 1);
        this._w.timmy(x, y, vx, -6 - Math.random() * 2);
      }
      return;
    }
    if (kind === 0) {
      this.prizes.push({ kind: 'clock', sprite: this._image('clok', 0, x, y), x, y, vx: 0, vy: 0, t: 0 });
    } else if (kind === 2) {
      this.prizes.push({ kind: 'hoover', sprite: this._image('bvac', 0, x, y - 20), x, y: y - 20, vx: 0, vy: HOOVER_VY, t: 0 });
    } else if (kind === 3) {
      this.prizes.push({ kind: 'bubble', sprite: this._image('bubble', 0, x, y), x, y, vx: 0, vy: 0, t: 0 });
    }
  }

  // ── The dispenser ────────────────────────────────────────────────────────

  _addDispenser(d) {
    const body = this._image('dis', 0, d.x, d.y);
    const lid = this._image('dis', 1, d.x, d.y);
    this.dispensers.push({
      body, lid, x: d.x, y: d.y, vx: 0, vy: 0, state: 'idle', t: 0,
      balls: d.balls, goes: d.goes, gap: d.gap, left: 0, wait: 0, turn: 0, w: 0, h: 0,
    });
  }

  // ── The panel ────────────────────────────────────────────────────────────

  _addPanel(p) {
    const sprite = this._image('panel', 0, p.x, p.y);
    const twinkle = this._image('panel', 1, p.x, p.y, 3).setVisible(false);
    const panel = { sprite, twinkle, x: p.x, y: p.y, vx: 0, vy: 0, block: null, wait: 1 };
    if (p.locked) panel.block = this._w.blockIdAt(p.x, p.y);
    this.panels.push(panel);
  }

  /**
   * The overhead blow: a dispenser at rest starts its wobble; a clock
   * bursts and its time is lost (VA 0x11edd).
   */
  hit(reach) {
    this.dispensers.forEach((d) => {
      if (d.state !== 'idle') return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, d.body.getBounds())) return;
      d.state = 'wobble';
      d.t = 0;
      d.w = 0x60;
      d.h = -0x10;
      d.left = d.balls;
    });
    for (let i = this.prizes.length - 1; i >= 0; i -= 1) {
      const p = this.prizes[i];
      if (p.kind !== 'clock') continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, p.sprite.getBounds())) continue;
      p.sprite.destroy();
      this.prizes.splice(i, 1);
      this._w.shake();
    }
  }

  /** @param {number} delta ms */
  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._tick();
    }
    this.prizes.forEach((p) => p.sprite.setPosition(p.x, p.y));
    this.panels.forEach((p) => p.sprite.setPosition(p.x, p.y));
    this.dispensers.forEach((d) => {
      d.body.setPosition(d.x, d.y);
      d.lid.setPosition(d.x, d.y);
      d.body.setScale(1 + d.w / 256, 1 + d.h / 256);
      d.lid.setScale(1 + d.w / 256, 1 + d.h / 256);
    });
  }

  _tick() {
    const jack = this._w.jack();
    const jackBox = jack && jack.active ? jack.getBounds() : null;
    const touches = (s) => jackBox && Phaser.Geom.Intersects.RectangleToRectangle(jackBox, s.getBounds());

    for (let i = this.prizes.length - 1; i >= 0; i -= 1) {
      const p = this.prizes[i];
      p.t += 1;
      if (p.kind === 'hoover') {
        // it drops to the level's bottom, through everything (0x1b44f)
        if (p.y < this._w.groundY) {
          p.y = Math.min(this._w.groundY, p.y + p.vy);
          p.vy += GRAVITY;
        }
      } else {
        const landed = this._fall(p);
        if (p.kind === 'clock') this._clockStep(p, landed);
        if (p.kind === 'bubble' && p.grounded) {
          // it will not keep still (0x1b220)
          p.grounded = false;
          p.vy = -Math.random() * 8;
          p.vx = (Math.random() < 0.5 ? -1 : 1) * Math.random() * 4;
        }
      }
      if (touches(p.sprite)) {
        if (p.kind === 'clock') this._w.addTime(CLOCK_SECONDS);
        if (p.kind === 'hoover') this._w.superHoover(SUPER_HOOVER_TICKS);
        if (p.kind === 'bubble') this._w.doublePoints(DOUBLE_POINTS_TICKS);
        p.sprite.destroy();
        this.prizes.splice(i, 1);
      }
    }

    this.dispensers = this.dispensers.filter((d) => this._dispenserStep(d));

    for (let i = this.panels.length - 1; i >= 0; i -= 1) {
      const p = this.panels[i];
      if (p.block !== null) {
        if (this._w.blockAlive(p.block)) continue;
        p.block = null;
        p.vy = POP_VY;
        p.grounded = false;
      }
      this._fall(p);
      // the twinkle: a frame at a random spot, now and then (0x1b6f5)
      p.wait -= 1;
      if (p.wait <= 0) {
        p.wait = 4 + Math.floor(Math.random() * 64);
        p.spark = 0;
        p.twinkle.setVisible(true);
        p.twinkle.setPosition(p.x - 20 + Math.random() * 40, p.y - 34 + Math.random() * 32);
      }
      if (p.spark !== undefined && p.spark < 16) {
        this._show(p.twinkle, 'panel', 1 + Math.min(15, p.spark));
        p.spark += 1;
        if (p.spark >= 16) p.twinkle.setVisible(false);
      }
      if (touches(p.sprite)) {
        p.sprite.destroy();
        p.twinkle.destroy();
        this.panels.splice(i, 1);
        this._w.secret();
      }
    }
  }

  /** Gravity, a floor, friction on it. True on the tick it lands. */
  _fall(o) {
    o.x += o.vx;
    if (o.grounded) {
      o.vx = Math.abs(o.vx) > 9999 / 65536 ? o.vx - Math.sign(o.vx) * FRICTION : 0;
      if (this._floorAt(o.x, o.y - 1, o.y + 1) === null) o.grounded = false;
      return false;
    }
    o.vy = Math.min(TERMINAL, o.vy + GRAVITY);
    if (o.vy > 0) {
      const top = this._floorAt(o.x, o.y, o.y + o.vy);
      if (top !== null) {
        o.y = top;
        o.vy = 0;
        o.grounded = true;
        return true;
      }
    }
    o.y += o.vy;
    return false;
  }

  _floorAt(x, from, to) {
    const top = this._w.floor(x, from, to);
    if (top !== null) return top;
    return to >= this._w.groundY && from <= this._w.groundY ? this._w.groundY : null;
  }

  /**
   * The clock (0x11dcc): it spins, a frame every 3 ticks, ten turns; then
   * for 240 ticks it jumps about, and spins again.
   */
  _clockStep(p) {
    const spin = 24 * CLOCK_FRAME_TICKS * CLOCK_TURNS;
    const phase = p.t % (spin + CLOCK_HOP_TICKS);
    if (phase < spin) {
      this._show(p.sprite, 'clok', Math.floor(phase / CLOCK_FRAME_TICKS) % 24);
      return;
    }
    this._show(p.sprite, 'clok', 0);
    p.x += (p.t & 1) ? 1 : -1;
    if (p.grounded) {
      p.grounded = false;
      p.vy = -(120000 + Math.random() * 0x3ffff) / 65536;
    }
  }

  /**
   * One tick of a dispenser. Returns false once it has gone.
   */
  _dispenserStep(d) {
    d.t += 1;
    if (d.state === 'leave') {
      // off it goes, up and away (0x5f5ba)
      d.y += d.vy;
      d.vy -= GRAVITY;
      if (d.y < -120) {
        d.body.destroy();
        d.lid.destroy();
        return false;
      }
      return true;
    }
    this._fall(d);
    if (d.state === 'idle') return true;
    // the wobble dies away by a quarter every other tick
    if (d.t & 1) {
      d.w -= Math.trunc(d.w / 4);
      d.h -= Math.trunc(d.h / 4);
    }
    if (d.state === 'wobble') {
      if (d.t === DIS_WOBBLE - DIS_LID_AT) this._show(d.lid, 'dis', 2);
      if (d.t >= DIS_WOBBLE) {
        d.state = 'fire';
        d.wait = 0;
      }
      return true;
    }
    // firing: a ball every gap + 1 ticks
    if (d.wait > 0) { d.wait -= 1; return true; }
    if (d.left > 0) {
      this._w.ball(d.x - 17, d.y - 16, DIS_BALL_VX[d.turn & 7], -DIS_BALL_VY);
      d.turn += 1;
      d.left -= 1;
      d.wait = d.gap;
      return true;
    }
    this._show(d.lid, 'dis', 1);
    d.w = 0;
    d.h = 0;
    if (d.goes > 0) {
      d.goes -= 1;
      if (d.goes === 0) {
        d.state = 'leave';
        d.vy = DIS_LEAVE_VY;
        return true;
      }
    }
    d.state = 'idle';
    return true;
  }

  destroy() {
    this.prizes = [];
    this.dispensers = [];
    this.panels = [];
  }
}
