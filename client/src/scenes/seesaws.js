import Phaser from 'phaser';
import { PROP_ANIMS, applyPropFrame } from '../entities/props';

/**
 * Seesaws and the 20-ton weights — `.OB` classes 0 (VA 0x1eb0d, BCSAW or
 * CSAW.SPR) and 1 (VA 0x1e6c3, LEAD.SPR), in 43 and 42 levels. See "The
 * seesaw and the weight" in scripts/formats/README.md.
 *
 * A seesaw has two ends, each tested with two boxes 31 px either side of
 * it, 40x24: one 21 up (table 0x9977c) that what comes down passes
 * through, and one 3 up (0x9978e) that what stands there is in. Frame 0
 * has the left end down and the right up, frame 1 the other way. Like any
 * sprite it settles onto what is under it. On the down end something can ride — Jack, or
 * a weight that came to rest there (0x28b6f, 0x1edc2). Anything coming down
 * fast into the raised end tips it (0x1ecc9), and the rider on the other
 * end goes up at the speed that came down, less half a pixel (0x1ed40) —
 * unless that is under 1.22 px/tick, when the seesaw will not move. A
 * weight that fails to tip it bounces off at three quarters, kicked aside.
 *
 * The overhead blow tips it too, from the side it lands on (0x1eba3); the
 * speed it gives the rider there comes from the blow's force, whose scale
 * on sprites is not read — the clone uses HAMMER_LAUNCH.
 */
const ENDS = [-31, 31];                 // end 0 left, 1 right
const DROP_DY = -21;                    // 0x9977c: coming down onto an end
const STAND_DY = -3;                    // 0x9978e: standing on an end
const HALF_W = 20;
const HALF_H = 12;
const MIN_LAUNCH = 0x13880 / 65536;     // VA 0x1ed58
const LAUNCH_LOSS = 0x7fff / 65536;
const LAUNCH_LIFT = 30;                 // the rider is lifted first (+0x2a -= 0x1e)
const BOUNCE = 0.75;                    // vy = -(vy/4 + vy/2)
const HAMMER_LAUNCH = 8;                // ours: see above
/** Where a weight rests on each end (lead_sub_1edc2, VA 0x1edc2), and its frame there. */
const WEIGHT_REST = [{ dx: -33, dy: -3, frame: 2 }, { dx: 47, dy: 0, frame: 1 }];

export default class Seesaws {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number, tilt: number, big: boolean}[]} placed
   * @param {import('./looseObjects').default} loose
   * @param {(x: number, y: number) => number} floorBelow  the floor's top under a point
   */
  constructor(scene, placed, loose, floorBelow) {
    this._loose = loose;
    this.all = placed.map((p) => {
      const anim = PROP_ANIMS[p.big ? 'bcsaw' : 'csaw'];
      const y = floorBelow(p.x, p.y);
      const sprite = scene.add.image(p.x, y, anim[p.tilt]).setDepth(1);
      applyPropFrame(sprite, anim[p.tilt]);
      return { sprite, anim, x: p.x, y, down: p.tilt === 0 ? 0 : 1, riders: [null, null] };
    });
  }

  /** The end (0, 1) a point is in, or -1 — point_in_hotspot (VA 0x2dfc7). */
  _endAt(s, x, y, dy) {
    return ENDS.findIndex((dx) => Math.abs(x - (s.x + dx)) < HALF_W
      && Math.abs(y - (s.y + dy)) < HALF_H);
  }

  /** The seesaw and end a point is in. */
  _find(x, y, dy) {
    for (const s of this.all) {
      const end = this._endAt(s, x, y, dy);
      if (end >= 0) return { s, end };
    }
    return null;
  }

  /**
   * Something comes down onto `end` at `v` px/tick (0x1ecc9). The raised
   * end only; the rider of the other end — if any — is launched. False
   * when it stays put.
   */
  _tip(s, end, v, hooks) {
    if (end === s.down) return false;
    const other = s.down;
    const rider = s.riders[other];
    if (rider) {
      const speed = v - LAUNCH_LOSS;
      if (speed < MIN_LAUNCH) return false;
      s.riders[other] = null;
      if (rider.player) {
        hooks.launchJack(rider.player, rider.player.x, rider.player.y - LAUNCH_LIFT, -speed);
      } else {
        const h = rider.handle;
        h.anchored = false;
        applyPropFrame(h.sprite, PROP_ANIMS.lead[0]);
        this._loose.throw(h, h.sprite.x, h.sprite.y - LAUNCH_LIFT, 0, -speed);
      }
    }
    s.down = end;
    applyPropFrame(s.sprite, s.anim[end === 0 ? 0 : 1]);
    return true;
  }

  /**
   * A loose thing coming down (LooseObjects' `falling` hook): a weight in
   * a raised end tips it or bounces off (0x1edc2). True when it bounced.
   */
  fallingLoose(h, hooks) {
    if (h.kind !== 'lead') return false;
    const hit = this._find(h.sprite.x, h.sprite.y, DROP_DY);
    if (!hit || hit.end === hit.s.down) return false;
    if (this._tip(hit.s, hit.end, h.vy, hooks)) return false;
    h.vy = -h.vy * BOUNCE;
    if (Math.abs(h.vx) < 1) {
      const kick = ((Math.random() * 0x3fff) + 4000) / 65536;
      h.vx += hit.end === 1 ? -kick : kick;
    }
    return true;
  }

  /** The overhead blow, on whichever end it reaches. */
  hit(reach, hooks) {
    this.all.forEach((s) => {
      ENDS.forEach((dx, end) => {
        const box = new Phaser.Geom.Rectangle(s.x + dx - HALF_W, s.y + DROP_DY - HALF_H,
          HALF_W * 2, HALF_H * 2);
        if (Phaser.Geom.Intersects.RectangleToRectangle(reach, box)) {
          this._tip(s, end, HAMMER_LAUNCH + LAUNCH_LOSS, hooks);
        }
      });
    });
  }

  /**
   * Each frame: weights at rest on a down end become its rider, Jack
   * standing on one rides it, Jack dropping onto a raised end tips it.
   * @param {any} player
   * @param {{launchJack: Function}} hooks
   */
  update(player, hooks) {
    const handles = this._loose.handles();
    this.all.forEach((s) => {
      // a rider picked up or gone is no longer riding
      s.riders = s.riders.map((r) => {
        if (!r) return null;
        if (r.handle && (r.handle.carried || r.handle.flying || !r.handle.sprite.active)) {
          if (r.handle.sprite.active) applyPropFrame(r.handle.sprite, PROP_ANIMS.lead[0]);
          return null;
        }
        return r;
      });
      // a weight come to rest on the down end
      const end = s.down;
      if (!s.riders[end]) {
        const h = handles.find((k) => k.kind === 'lead' && !k.carried && !k.flying
          && !k.anchored && this._endAt(s, k.sprite.x, k.sprite.y, STAND_DY) === end);
        if (h) {
          const rest = WEIGHT_REST[end];
          h.anchored = true;
          h.sprite.setPosition(s.x + rest.dx, s.y + rest.dy);
          applyPropFrame(h.sprite, PROP_ANIMS.lead[rest.frame]);
          s.riders[end] = { handle: h };
        }
      }
    });

    if (!player || player.state === 'caught') return;
    const b = player.body;
    const feetX = player.x;
    const feetY = b.bottom;
    // Jack riding: standing on the down end of an empty seesaw (0x28b6f)
    const stand = b.blocked.down ? this._find(feetX, feetY, STAND_DY) : null;
    this.all.forEach((s) => {
      s.riders = s.riders.map((r) => (r && r.player
        && !(stand && stand.s === s && stand.end === s.down) ? null : r));
    });
    if (stand && stand.end === stand.s.down && !stand.s.riders[stand.end]) {
      stand.s.riders[stand.end] = { player };
    }
    // dropping through a raised end (0x28af9)
    const drop = !b.blocked.down && b.velocity.y > 0 ? this._find(feetX, feetY, DROP_DY) : null;
    if (drop && drop.end !== drop.s.down) this._tip(drop.s, drop.end, b.velocity.y / 60, hooks);
  }

  destroy() {
    this.all = [];
  }
}
