import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';
import { floorUnder } from './blockKinds';

/**
 * UFOs — `.OB` class 31 (constructor VA 0x13079, BON/UFO.SPR). See "The
 * UFO" in scripts/formats/README.md; the routines are named in
 * scripts/ghidra/symbols.d/ufo.txt.
 *
 * The level sets how many start, how many may fly at once, how often a new
 * one comes, and the period of each of four actions (the exporter resolves
 * the preset and its overrides into `level.ufo`). A UFO drifts between
 * random points round the level's middle; four countdowns run while it
 * does, and the first to run out picks what it does next:
 *
 *   land    over a Jack, sink to the floor, sit, take off — and while it
 *           is down it can be hit from above
 *   drop    hover over a Jack and let go a bomb or spikes (not built: the
 *           clone has neither; only 5S of the 36 levels turns it on)
 *   abduct  hover over a free timmy and beam it up — gone, and counted
 *   zap     hover over a Jack and knock him flying (VA 0x1264b)
 *
 * Hit, it gives the stolen timmies back one by one and then blows up.
 *
 * Everything is in the game's units, px and px/tick at 60 Hz. Where the
 * clone guesses, the comment says so.
 */
const HZ = 60;
const ROAM_SPREAD = 512;          // random_value >> 6 of a 31-bit value, in 16.16 (VA 0x137dd)
const ROAM_FLOOR = 80;            // kept this far above the bottom
const MAX_V = 5;                  // ±0x50000 (VA 0x13adb)
const STEER_ROAM = 1 / 64;
const STEER_TIMMY = 1 / 32;       // VA 0x13ba3
const STEER_JACK = 1 / 8;         // VA 0x13c5a
const DAMP = 1 / 8;
const HOVER = 120;                // 0x780000 above what it beams
const LAND_ABOVE = 100;           // VA 0x138f3
const DROP_ABOVE = 150;           // VA 0x139d1
const AIM_SPREAD = 48;            // ours: the range of 0x2fa0d there is not read
const START_ABOVE = 100;          // VA 0x13634
const DROP_AT = 50;
const DROP_DONE = 150;
const LAND_SIT = 100;             // VA 0x1406d
const ZAP_AT = 15;
const ZAP_REACH = 10;
const ZAP_DONE = 50;
const KNOCK = 3;                  // ebx = edx = 0x30000 (VA 0x219a0)
const BEAM_LIFT_AFTER = 30;
const TAKEN_AT = 10;              // within 10 px of the UFO the timmy is gone
const GIVE_BACK_EVERY = 32;
const DIE_AFTER = 120;
const GRAVITY = 0x4800 / 65536;
const NEVER = 0x7ffe;             // a drop period this long switches drops off

/** Frames of UFO.SPR (props `ufo`, index = frame number). */
const F = {
  LEVEL: 4, LEGS_FIRST: 9, LEGS_LAST: 17, SIT_LO: 18, SIT_HI: 22,
  WRECK: 24, DEBRIS_LO: 25, DEBRIS_HI: 30, RING: 23, BOLT: 31,
};

const HITTABLE = new Set(['descend', 'landed', 'takeOff']);

export default class Ufos {
  /**
   * @param {Phaser.Scene} scene
   * @param {{start: number, respawn: number, max: number, mix: number,
   *   land: number, drop: number, abduct: number, zap: number}} params
   * @param {object} world
   * @param {{left: number, right: number, top: number, bottom: number}} world.bounds
   * @param {(x: number, y: number) => any} world.blockAt
   * @param {number} world.groundY
   * @param {() => any[]} world.jacks
   * @param {() => any[]} world.timmies   active timmy sprites
   * @param {import('./looseObjects').default} world.loose
   * @param {(x: number, y: number, vx: number, vy: number) => void} world.giveTimmy
   * @param {(x: number, y: number) => void} world.explode
   * @param {(player: any, speed: number, spill: number) => void} world.knock
   */
  constructor(scene, params, world) {
    this._scene = scene;
    this._p = params;
    this._w = world;
    this._acc = 0;
    this.all = [];
    this._bits = [];              // beam pieces, sparks and debris
    this._respawn = params.respawn;
    for (let i = 0; i < params.start; i += 1) {
      if (this.all.length < params.max) this._start();
    }
  }

  /** start_ufo (VA 0x13634): 100 px over a random Jack, timers jittered. */
  _start() {
    const jack = this._randomJack();
    if (!jack) return;
    const sprite = this._scene.add.image(jack.x, jack.y - START_ABOVE, PROP_ANIMS.ufo[F.LEVEL])
      .setDepth(6);
    const p = this._p;
    const u = {
      sprite, x: jack.x, y: jack.y - START_ABOVE, vx: 0, vy: 0, tx: 0, ty: 0,
      state: 'roam', t: 1, frame: F.LEVEL, dir: 1, stolen: 0, timmy: null, jack: null,
      // the countdowns, each started somewhere in its period (0x2fad0 — the
      // exact jitter is ours)
      left: {
        land: jitter(p.land), drop: jitter(p.drop),
        abduct: jitter(p.abduct), zap: jitter(p.zap),
      },
    };
    this._pickRoamPoint(u);
    this.all.push(u);
  }

  /** The overhead blow: a UFO on its way down, down or going up is hit. */
  hit(reach) {
    this.all.forEach((u) => {
      if (!HITTABLE.has(u.state)) return;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, u.sprite.getBounds())) return;
      this._go(u, 'hit');
    });
  }

  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._tick();
    }
    this.all.forEach((u) => {
      u.sprite.setPosition(u.x, u.y);
      applyPropFrame(u.sprite, PROP_ANIMS.ufo[u.frame]);
    });
  }

  _tick() {
    // A new one every `respawn` ticks while fewer than the most are up
    // (ufo_respawn_tick, VA 0x135fc — the first call of every frame).
    if (this.all.length < this._p.max) {
      this._respawn -= 1;
      if (this._respawn < 0) {
        this._respawn = this._p.respawn;
        this._start();
      }
    }
    for (const u of [...this.all]) {
      this[`_${u.state}`](u);
      u.t += 1;
    }
    this._tickBits();
  }

  _go(u, state) {
    u.state = state;
    u.t = 0;
  }

  // ── flying ───────────────────────────────────────────────────────────────

  /** ufo_roam (VA 0x13ca1). */
  _roam(u) {
    if (u.t === 1) {
      u.frame = F.LEVEL;
      this._pickRoamPoint(u);
    }
    const d = this._steer(u, u.tx, u.ty, STEER_ROAM);
    if (Math.abs(d.x) < 10 && Math.abs(d.y) < 10) this._pickRoamPoint(u);
    this._tilt(u);
    // The countdowns, in this order; one running out stops the rest for
    // the tick.
    const { left } = u;
    const p = this._p;
    if ((left.land -= 1) < 1) {
      left.land = p.land;
      this._go(u, 'goLand');
    } else if ((left.drop -= 1) < 1) {
      left.drop = p.drop;
      if (p.drop !== NEVER) this._go(u, 'goDrop');
    } else if ((left.abduct -= 1) < 1) {
      left.abduct = p.abduct;
      this._go(u, 'goAbduct');
    } else if ((left.zap -= 1) < 1) {
      left.zap = p.zap;
      this._go(u, 'goZap');
    }
  }

  /** ufo_pick_roam_point (VA 0x137dd). */
  _pickRoamPoint(u) {
    const b = this._w.bounds;
    u.tx = (b.left + b.right) / 2 + spread(ROAM_SPREAD);
    u.ty = Math.min((b.top + b.bottom) / 2 + spread(ROAM_SPREAD), b.bottom - ROAM_FLOOR);
  }

  /**
   * ufo_steer (VA 0x13adb) and its two stiffer copies: a damped spring
   * toward the point, at most 5 px/tick each way. Returns how far off it was.
   */
  _steer(u, tx, ty, k) {
    const dx = tx - u.x;
    const dy = ty - u.y;
    u.vx = clamp((u.vx + dx * k) * (1 - DAMP), MAX_V);
    u.vy = clamp((u.vy + dy * k) * (1 - DAMP), MAX_V);
    u.x += u.vx;
    u.y += u.vy;
    return { x: dx, y: dy };
  }

  /** ufo_speed_band (VA 0x13a48): it leans with its speed, a frame a tick. */
  _tilt(u) {
    const s = Math.abs(u.vx);
    const band = s < 1.5 ? 0 : s < 2.5 ? 1 : s < 3.5 ? 2 : s < 4.5 ? 3 : 4;
    const want = F.LEVEL + (u.vx >= 0 ? -band : band);
    u.frame += Math.sign(want - u.frame);
  }

  // ── 1: land ──────────────────────────────────────────────────────────────

  /** ufo_go_land (VA 0x13dd2): over a Jack, ~100 px up. */
  _goLand(u) {
    if (u.t === 1) {
      const jack = this._randomJack();
      if (!jack) { this._go(u, 'roam'); return; }
      u.tx = jack.x + spread(AIM_SPREAD);
      u.ty = jack.y + Math.floor(Math.random() * 16) - LAND_ABOVE;
    }
    const d = this._steer(u, u.tx, u.ty, STEER_ROAM);
    this._tilt(u);
    if (Math.abs(d.x) < 1 && Math.abs(d.y) < 1 && u.frame === F.LEVEL
      && u.vx < 1 && u.vy < 1) {
      u.x = u.tx;
      u.y = u.ty;
      this._go(u, 'descend');
    }
  }

  /** ufo_descend (VA 0x13ee3): 2.5 px/tick braking to 1, legs out after 40 ticks. */
  _descend(u) {
    if (u.t === 1) {
      u.vx = 0;
      u.vy = 2.5;
      u.frame = F.LEGS_FIRST;
    }
    const floor = this._floor(u.x, u.y, u.y + u.vy);
    if (floor !== null) {
      u.y = floor;
      this._go(u, 'landed');
      return;
    }
    u.y += u.vy;
    u.vy = Math.max(1, u.vy - u.vy / 32);
    if (u.t > 40 && u.t % 4 === 0) u.frame = Math.min(u.frame + 1, F.LEGS_LAST);
  }

  /** ufo_landed (VA 0x14013): rocks on its legs; leaves after 100 ticks, or when the floor goes. */
  _landed(u) {
    if (u.t === 1) {
      u.vx = 0;
      u.frame = F.SIT_LO;
      u.dir = 1;
    }
    if (u.t % 4 === 0) {
      u.frame += u.dir;
      if (u.frame === F.SIT_HI || u.frame === F.SIT_LO) u.dir = -u.dir;
    }
    const gone = this._floor(u.x, u.y - 1, u.y + 1) === null;
    if (gone || (u.t > LAND_SIT && u.frame === F.SIT_LO)) {
      u.frame = F.SIT_LO;
      this._go(u, 'takeOff');
    }
  }

  /** ufo_take_off (VA 0x140d8): up, faster after 40 ticks; level again at 50, flying at 60. */
  _takeOff(u) {
    if (u.t === 1) {
      u.vx = 0;
      u.vy = -1;
      u.frame = F.LEGS_LAST;
    }
    if (u.t % 4 === 0 && u.frame > F.LEGS_FIRST) u.frame -= 1;
    u.y += u.vy;
    if (u.t < 40) {
      u.vy = Math.max(u.vy + u.vy / 32, -3);
    } else {
      u.vy = Math.max(u.vy + u.vy / 16, -5);
      if (u.t > 50) u.frame = F.LEVEL;
      if (u.t > 60) this._go(u, 'roam');
    }
  }

  // ── 2: drop ──────────────────────────────────────────────────────────────

  /** ufo_go_drop (VA 0x13e6b): 150 px over a Jack. */
  _goDrop(u) {
    if (u.t === 1) {
      const jack = this._randomJack();
      if (!jack) { this._go(u, 'roam'); return; }
      u.tx = jack.x + spread(AIM_SPREAD);
      u.ty = jack.y + Math.floor(Math.random() * 16) - DROP_ABOVE;
    }
    const d = this._steer(u, u.tx, u.ty, STEER_ROAM);
    this._tilt(u);
    if (Math.abs(d.x) < 1 && Math.abs(d.y) < 1 && u.frame === F.LEVEL) {
      u.x = u.tx;
      u.y = u.ty;
      this._go(u, 'drop');
    }
  }

  /**
   * ufo_drop (VA 0x14211): still, and at tick 50 a bomb or spikes by the
   * level's mix. Neither exists in the clone yet, so it only hovers.
   */
  _drop(u) {
    if (u.t === 1) {
      u.vx = 0;
      u.vy = 0;
      u.frame = F.LEVEL;
    }
    if (u.t === DROP_AT) u.t = DROP_DONE - 1;     // spawn failed → done
    if (u.t >= DROP_DONE) this._go(u, 'roam');
  }

  // ── 3: abduct ────────────────────────────────────────────────────────────

  /** ufo_go_abduct (VA 0x14354): to 120 px over the first timmy nobody has. */
  _goAbduct(u) {
    if (u.t === 1) {
      u.timmy = this._w.timmies().find((t) => t.active && !this._w.loose.isBusy(t)
        && !this.all.some((o) => o !== u && o.timmy === t)) || null;
      if (!u.timmy) { this._go(u, 'roam'); return; }
    }
    const t = u.timmy;
    if (!t || !t.active || this._w.loose.isBusy(t)) {
      u.timmy = null;
      this._go(u, 'roam');
      return;
    }
    const d = this._steer(u, t.x, t.y - HOVER, STEER_TIMMY);
    this._tilt(u);
    if (Math.abs(d.x) < 1 && Math.abs(d.y) < 1 && u.frame === F.LEVEL) {
      this._go(u, 'beamTimmy');
    }
  }

  /**
   * ufo_beam_timmy (VA 0x144b9): over it, a ring every 8 ticks; after 30
   * ticks the timmy rises a pixel a tick, thinner as it goes, and within
   * 10 px of the UFO it is gone. If Jack picks it up, it lets go.
   */
  _beamTimmy(u) {
    const t = u.timmy;
    if (u.t === 1) {
      u.vx = 0;
      u.vy = 0;
      u.x = t.x;
      u.y = t.y - HOVER;
      t.setData('beamed', true);
    }
    if (u.t % 8 === 0) this._bit(F.RING, u.x, u.y + HOVER, 0, 0, { rise: u, life: 60 });
    if (!t.active || this._w.loose.isBusy(t)) {
      if (t.active) { t.setScale(1); t.setData('beamed', false); }
      u.timmy = null;
      this._go(u, 'roam');
      return;
    }
    if (u.t > BEAM_LIFT_AFTER) {
      t.y -= 1;
      const thin = Math.max(0.2, 1 - (u.t >> 4) / 16);
      t.setScale(thin, 1);
    }
    if (t.y < u.y + TAKEN_AT) {
      t.destroy();
      u.timmy = null;
      u.stolen += 1;
      this._go(u, 'roam');
    }
  }

  // ── 4: zap ───────────────────────────────────────────────────────────────

  /** ufo_go_zap_jack (VA 0x14427): to 120 px over a Jack who is not busy. */
  _goZap(u) {
    if (u.t === 1) {
      u.jack = this._randomJack();
      if (!u.jack || u.jack.state === 'caught') { u.jack = null; this._go(u, 'roam'); return; }
    }
    const d = this._steer(u, u.jack.x, u.jack.y - HOVER, STEER_JACK);
    this._tilt(u);
    if (Math.abs(d.x) < 1 && Math.abs(d.y) < 1) this._go(u, 'zap');
  }

  /**
   * ufo_zap_jack (VA 0x1462c): 15 ticks locked over him, a bolt every 4;
   * then, if he is still within 10 px across, he is knocked flying —
   * 3 px/tick up, and across at least 3 — backwards from standing — his
   * load dropped and eight timmies spilt (+0x15e = 8, VA 0x1264b).
   */
  _zap(u) {
    const jack = u.jack;
    if (u.t === 1) {
      u.frame = F.LEVEL;
      u.vx = 0;
      u.vy = 0;
    }
    if (u.t < ZAP_AT) {
      u.x = jack.x;
      u.y = jack.y - HOVER;
    }
    if (u.t % 4 === 0) this._bit(F.BOLT, u.x, u.y + 10 + (HOVER - 10) / 2, 0, 0, { life: 4, stretch: (HOVER - 10) / 32 });
    if (u.t === ZAP_AT) {
      if (jack.state === 'caught') { this._go(u, 'roam'); return; }
      if (Math.abs(u.x - jack.x) < ZAP_REACH) {
        this._w.knock(jack, KNOCK, 8);
      }
    }
    if (u.t > ZAP_DONE) {
      u.jack = null;
      this._go(u, 'roam');
    }
  }

  // ── hit and gone ─────────────────────────────────────────────────────────

  /**
   * ufo_hit (VA 0x14935): wrecked, it halves its haul (rounding up) and
   * drops one timmy back every 32 ticks, sparking; with none left, it dies.
   */
  _hit(u) {
    if (u.t === 1) {
      u.frame = F.WRECK;
      u.stolen = (u.stolen + 1) >> 1;
      if (u.timmy && u.timmy.active) { u.timmy.setScale(1); u.timmy.setData('beamed', false); }
      u.timmy = null;
    }
    if (u.t % 4 === 0) this._spark(u);
    if (u.t % GIVE_BACK_EVERY === 0) {
      if (u.stolen === 0) {
        this._go(u, 'dying');
      } else {
        u.stolen -= 1;
        this._w.giveTimmy(u.x, u.y - 8, spread(2), -6);
      }
    }
    this._fall(u);
  }

  /** ufo_dying (VA 0x14a11): shakes for 120 ticks, then blows up. */
  _dying(u) {
    if (u.t % 4 === 0) this._spark(u);
    u.sprite.x = u.x + (u.t % 2 ? 2 : -2);
    if (u.t > DIE_AFTER) {
      this._w.explode(u.x, u.y);
      for (let i = 0; i < 6; i += 1) {
        this._bit(F.DEBRIS_LO + (i % 6), u.x, u.y - 8, spread(3), -1 - Math.random() * 3,
          { gravity: true, life: 120 });
      }
      u.sprite.destroy();
      this.all.splice(this.all.indexOf(u), 1);
    }
  }

  /** sprite_physics, roughly: a wreck falls and stops on what is under it. */
  _fall(u) {
    u.vx = 0;
    u.vy += GRAVITY;
    const floor = this._floor(u.x, u.y, u.y + u.vy);
    if (floor !== null) {
      u.y = floor;
      u.vy = 0;
    } else {
      u.y += u.vy;
    }
  }

  /** ufo_spark (VA 0x14897): a chip flung up at random. */
  _spark(u) {
    const frame = F.DEBRIS_LO + Math.floor(Math.random() * (F.DEBRIS_HI - F.DEBRIS_LO + 1));
    this._bit(frame, u.x + spread(16), u.y - 8, spread(2), -1 - Math.random() * 2,
      { gravity: true, life: 45 });
  }

  // ── pieces ───────────────────────────────────────────────────────────────

  _bit(frame, x, y, vx, vy, opts) {
    const s = this._scene.add.image(x, y, PROP_ANIMS.ufo[frame]).setDepth(5);
    applyPropFrame(s, PROP_ANIMS.ufo[frame]);
    if (opts.stretch) s.setScale(1, opts.stretch);
    this._bits.push({ s, x, y, vx, vy, age: 0, ...opts });
  }

  _tickBits() {
    for (let i = this._bits.length - 1; i >= 0; i -= 1) {
      const b = this._bits[i];
      b.age += 1;
      if (b.rise) {
        // a ring of the beam climbs from the timmy to its UFO (ours: the
        // original's two beam routines stretch one piece)
        b.y -= HOVER / b.life;
        b.x = b.rise.x;
      }
      if (b.gravity) b.vy += GRAVITY;
      b.x += b.vx;
      b.y += b.vy;
      b.s.setPosition(b.x, b.y);
      if (b.age >= b.life || b.y > this._w.bounds.bottom + 64) {
        b.s.destroy();
        this._bits.splice(i, 1);
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  _randomJack() {
    const jacks = this._w.jacks().filter(Boolean);
    return jacks.length ? jacks[Math.floor(Math.random() * jacks.length)] : null;
  }

  /** The top of a floor between from and to under x, the ground included. */
  _floor(x, from, to) {
    const top = floorUnder(this._w.blockAt, x, from, to);
    if (top !== null) return top;
    return to >= this._w.groundY && from <= this._w.groundY ? this._w.groundY : null;
  }

  destroy() {
    this.all.forEach((u) => u.sprite.destroy());
    this._bits.forEach((b) => b.s.destroy());
    this.all = [];
    this._bits = [];
  }
}

function clamp(v, m) {
  return Math.max(-m, Math.min(m, v));
}

function spread(n) {
  return (Math.random() * 2 - 1) * n;
}

function jitter(period) {
  return Math.round(period / 2 + Math.random() * (period / 2));
}
