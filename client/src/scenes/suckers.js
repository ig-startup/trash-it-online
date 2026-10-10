import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * Suckers — `.OB` class 22 (constructor VA 0x18fba, template 0x96de0). See
 * "The sucker" in scripts/formats/README.md.
 *
 * A base and a red cup on it (SUCKER.SPR frames 0 and 1; the cup sits at
 * the base's `+0x5e, +0x5c`, VA 0x193cb). It can be carried like anything
 * with category bit 0. The overhead blow arms it (VA 0x19065): for a while
 * it catches what comes down onto it — Jack, or anything of category
 * 0x800, the dynamite and the cannonballs among them (search VA 0x19121,
 * outcome 0x1947e) — and holds it 18 px up on its cup. Holding something
 * it sinks under it and soon throws it straight up at 14.2 px/tick (VA
 * 0x19173); left empty, it ends by hopping up itself (0x19264).
 */
const HZ = 60;
const ARMED = 64;            // +0x50 on the blow: the count it runs down by 2
const ARMED_STEP = 12;       // ticks per step while empty (+0x6c)
const RIDE_UP = -18;         // where it holds what it caught (+0x62)
const THROW_VY = -0xe30d0 / 65536;   // VA 0x1917e
const THROW_LIFT = -10;      // and it is lifted this much first
const HOP_VY = -0x61a80 / 65536;     // VA 0x192a1
/** Cup offsets, one a tick (0x1ce2b): the wobble on landing, sinking under a rider, the spring after a throw, the hop. */
const WOBBLE = [1, 2, 3, 4, 4, 3, 2, 1, 0, -1, -2, -3, -2, -1, 0, 1, 0, -1, 0, 1, 0];
const SINK = [6, 7, 8, 7, 6, 5, 6];
const SPRING = [-10, -5, -10, -5, -10, -5, -10, -5, -10, -10, -6, -10, -6, -10, -6, -10, -6,
  -10, -10, -7, -10, -7, -10, -7, -10, -7, -10, -10, -8, -10, -8, -10, -8, -10, -8, -10, -10,
  -9, -10, -9, -10, -9, -10, -9, -10, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9,
  -9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -10, -10, -9, -8, -7, -6, -5, -4, -4, -4, -4];
const HOP = [0, -8, -15, -21, -26, -30, -33, -35, -36, -37, -37, -38, -38, -38, -39, -39,
  -39, -39, -39, -39, -39, -39, -40, -39, -40, -39, -40, -39, -40, -39, -40, -39, -40, -39,
  -40, -39, -40, -39, -40, -39, -40];
const HALF_W = 12;
const HEIGHT = 30;

export default class Suckers {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}[]} placed
   * @param {import('./looseObjects').default} loose
   */
  constructor(scene, placed, loose) {
    this._loose = loose;
    this._acc = 0;
    this.all = placed.map((p) => {
      const base = scene.add.image(p.x, p.y, PROP_ANIMS.sucker[0]);
      applyPropFrame(base, PROP_ANIMS.sucker[0]);
      const cup = scene.add.image(p.x, p.y, PROP_ANIMS.sucker[1]);
      applyPropFrame(cup, PROP_ANIMS.sucker[1]);
      const handle = loose.add(base, 'sucker');
      return {
        handle, base, cup,
        // idle, armed (counting down), throwing (the spring after), hopping
        state: 'idle', count: 0, wait: 0, cupY: 0, table: null, t: 0,
        rider: null, wasDown: false,
      };
    });
  }

  /** The box it catches in and is struck in. */
  box(s) {
    const { x, y } = s.base;
    return new Phaser.Geom.Rectangle(x - HALF_W, y - HEIGHT, HALF_W * 2, HEIGHT);
  }

  /** On its feet and in nobody's hands. */
  _down(s) {
    return !s.handle.carried && !s.handle.flying;
  }

  /** The overhead blow arms one it reaches (VA 0x19065). */
  hit(reach) {
    this.all.forEach((s) => {
      if (s.state !== 'idle' || !this._down(s)) return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, this.box(s))) return;
      s.state = 'armed';
      s.count = ARMED;
      s.wait = ARMED_STEP;
      s.table = null;
    });
  }

  /**
   * Something coming down onto an armed one, empty (outcome 0x1947e): in
   * the air, falling, overlapping it. Returns the sucker that caught it.
   */
  _catch(bounds, falling) {
    if (!falling) return null;
    const s = this.all.find((k) => k.state === 'armed' && !k.rider && this._down(k)
      && Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.box(k)));
    if (!s) return null;
    s.table = SINK;
    s.t = 0;
    return s;
  }

  /** Jack landing on one. */
  catchJack(player) {
    const b = player.body;
    const s = this._catch(player.getBounds(), !b.blocked.down && b.velocity.y > 0);
    if (s) s.rider = { player };
    return !!s;
  }

  /** A loose thing landing on one (LooseObjects' `falling` hook). */
  catchLoose(h) {
    if (h.kind === 'sucker' || h.kind === 'timmy') return false;
    const s = this._catch(h.sprite.getBounds(), h.vy > 0);
    if (s) s.rider = { handle: h };
    return !!s;
  }

  /** Where its rider is held. */
  ridePoint(s) {
    return { x: s.base.x, y: s.base.y + RIDE_UP + s.cupY };
  }

  /**
   * @param {number} delta ms
   * @param {(player: any, x: number, y: number) => void} holdJack
   * @param {(player: any, x: number, y: number, vy: number) => void} throwJack
   */
  update(delta, holdJack, throwJack) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this.all.forEach((s) => this._step(s, throwJack));
    }
    this.all.forEach((s) => {
      if (!s.base.active) return;
      s.cup.setPosition(s.base.x, s.base.y + s.cupY);
      s.cup.setDepth(s.base.depth);
      if (!s.rider) return;
      const p = this.ridePoint(s);
      if (s.rider.player) holdJack(s.rider.player, p.x, p.y);
      else s.rider.handle.sprite.setPosition(p.x, p.y);
    });
  }

  _step(s, throwJack) {
    if (!s.base.active) return;
    // Landing sets the cup wobbling (VA 0x190a9).
    const down = this._down(s);
    if (down && !s.wasDown && s.state === 'idle') {
      s.table = WOBBLE;
      s.t = 0;
    }
    s.wasDown = down;

    if (s.state === 'armed' && down) {
      // Counts down by 2 every 12 ticks while empty; with a rider it sinks
      // and then runs down a step every tick (VA 0x19209-0x1924f).
      s.wait -= 1;
      if (s.wait <= 0) {
        s.count -= 2;
        s.wait = s.rider && !s.table ? 1 : ARMED_STEP;
        if (s.count <= 0) this._release(s, throwJack);
      }
    }
    if (s.table) {
      s.cupY = s.table[s.t];
      s.t += 1;
      if (s.t >= s.table.length) {
        const ended = s.table;
        s.table = null;
        if (ended === SPRING) this._reset(s);
        if (ended === HOP) {
          this._loose.throw(s.handle, s.base.x, s.base.y - 1, 0, HOP_VY);
          this._reset(s);
        }
      }
    }
  }

  /** Time's up: throw the rider up (VA 0x19169), or hop if there is none. */
  _release(s, throwJack) {
    if (s.rider) {
      const p = this.ridePoint(s);
      if (s.rider.player) throwJack(s.rider.player, p.x, p.y + THROW_LIFT, THROW_VY);
      else {
        s.rider.handle.inside = null;
        this._loose.throw(s.rider.handle, p.x, p.y + THROW_LIFT, 0, THROW_VY);
      }
      s.rider = null;
      s.state = 'throwing';
      s.table = SPRING;
    } else {
      s.state = 'hopping';
      s.table = HOP;
    }
    s.t = 0;
  }

  /** Back to waiting (VA 0x19347). */
  _reset(s) {
    s.state = 'idle';
    s.cupY = 0;
    s.count = 0;
  }

  destroy() {
    this.all.forEach((s) => s.cup.destroy());
    this.all = [];
  }
}
