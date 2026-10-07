import Phaser from 'phaser';
import {
  ensureJackTextures, applyJackFrame, PLAYER_WIDTH, FULL_HEIGHT,
} from './drawJack';
import { PROP_ANIMS, PROP_FRAME_INFO, HAMMER_BY_SLOT, hasProps } from './props';
import { JACK_FRAME_INFO, JACK_SCALE } from './jackSprites';
import { MAX_CHARGE } from '../../../shared/constants.mjs';

/**
 * The original's physics, in its own units: pixels per frame, and pixels
 * per frame squared, at its own tick rate. Our levels are its pixels 1:1,
 * so the only conversion needed is that rate.
 *
 * `ORIGINAL_HZ` is the game's tick: one logic frame per vertical retrace
 * (main loop VA 0x2c654 → 0x2cb6e), and both of its video set-ups are
 * 480-line modes that retrace at 60Hz. It only falls back on a 13ms
 * catch-up step when the machine cannot keep up. See "Movement and
 * gravity" in scripts/formats/README.md.
 */
const ORIGINAL_HZ = 60;
const GRAVITY = 0.28125 * ORIGINAL_HZ * ORIGINAL_HZ;  // VA 0x22d31: vy += 0x4800
const TERMINAL = 24 * ORIGINAL_HZ;                    // clamped at 0x180000
const JUMP = -4.5 * ORIGINAL_HZ;                      // VA 0x22bc5, out of the walk
/**
 * Holding the jump key lifts him further (state 0x22b91): from the eighth
 * tick on, while the key stays down and he is still rising, `vy -= boost`,
 * the boost starting at 0x5400 and shrinking by 0x6f0 a tick until it is
 * spent — about twelve ticks. A tap is the bare 36 px hop; a held jump
 * goes roughly half as high again.
 */
const JUMP_BOOST = 0x5400;
const JUMP_BOOST_DECAY = 0x6f0;
const JUMP_BOOST_AFTER = 7;      // ticks
/**
 * The hop nearly every state in the game can do: -2.0 px/frame, which
 * lifts him seven pixels. Not a jump — a stumble over a kerb. Kept here
 * because it turns up in almost every one of the 46 states and is the
 * only other upward impulse in the game, so it is worth not
 * rediscovering. Nothing uses it yet.
 */
// eslint-disable-next-line no-unused-vars
const STEP_UP = -2.0 * ORIGINAL_HZ;

/** 16.16 per tick → px/s, and per tick² → px/s². */
const perS = (v) => (v / 65536) * ORIGINAL_HZ;
const perS2 = (v) => (v / 65536) * ORIGINAL_HZ * ORIGINAL_HZ;
const TICK_MS = 1000 / ORIGINAL_HZ;

/**
 * Top speed and acceleration belong to the animation being played, not to
 * Jack: `play_anim` copies them in from a table of eight (VA 0xa10d4 →
 * 0xa1172). These are the two the clone's states use.
 */
const PROFILES = {
  // profile 1 — the run, standing, the skid
  run: { top: perS(350000), accel: perS2(12000), turn: perS2(12000) },
  // profile 0 — the windups and strikes, the hat, the hoover
  slow: { top: perS(100000), accel: perS2(4000), turn: perS2(8000) },
};
const EASE_INTO_TOP = 1 / 32;      // the original's `>> 5` above the cap
const FRICTION = perS2(2000);      // every tick, keys or not (VA 0x22d31)
const AT_REST = perS(399);         // below this the shared step stops him
const SKID_BRAKE = perS2(5000);    // the skid brakes on its own (VA 0x2266d)
const SKID_STOP = perS(10000);     // …and hands over to standing below this
const WINDUP_NUDGE = perS(0x8000); // a tap of a direction while winding up
const MAX_STEP_MS = 50;         // ignore hitches longer than this
const FALL_VELOCITY = 80;       // downward speed at which rising becomes falling
const ANIM_CATCHUP_LIMIT = 8;   // frames one tick may make up after a hitch

/**
 * Jack's states, and the animation each one shows.
 *
 * The game keeps 46 of these, one function apiece, and switching is a
 * single call; `scripts/formats/states.py` lifts the whole graph out of
 * `G.EXE` and `scripts/formats/anims.py` gives each state's animation.
 * The ones below are the states the clone has mechanics for, named after
 * the game's own and using its animation slots — the addresses are the
 * state functions they correspond to.
 *
 * Writing this as flags and timers instead is what made the skid play
 * twice, the strikes look wrong, and the hard hat need a key held down.
 *
 * `loop` keeps the animation running; without it the state ends when the
 * animation does and hands over to `next`, unless `hold` keeps it on its
 * last frame for the logic to end. `locks` means input is ignored until
 * then. `profile` is the movement profile the game's animation carries.
 * `slot` is the game's own animation slot, which also picks the hammer's
 * frames (a strike's is `slotFrom` + its charge).
 *
 * The slot numbers are `play_anim`'s own. Until 2026-10-06 these comments
 * used a table read eight bytes early, and named every state after the
 * animation two slots along — see scripts/formats/anims.py.
 */
/** Slot 70 / 71 as (pose, frame) pairs: hatReach is sheet frames 71-90, hooverOut 113-122. */
const range = (pose, from, to) => {
  const out = [];
  for (let i = from; from <= to ? i <= to : i >= to; i += from <= to ? 1 : -1) out.push([pose, i]);
  return out;
};
const SHEET_STRIP_DRAW = [...range('hatReach', 0, 10), ['hatReach', 10], ...range('hooverOut', 9, 0)];
const SHEET_STRIP_STOW = [...range('hooverOut', 0, 9), ['hatReach', 10], ['hatReach', 10],
  ...range('hatReach', 9, 0)];

const STATES = {
  // 0x22892, slot 1 — standing, the hub nearly everything returns to
  stand: { slot: 1, anim: 'idle', ms: 400, loop: true, profile: 'run' },
  // 0x22275, slot 0 — the run
  walk: { slot: 0, anim: 'run', ms: 70, loop: true, profile: 'run' },
  // 0x2266d, slot 2 — a frame every fourth tick, held on the last until
  // the braking has stopped him
  skid: { slot: 2, anim: 'skid', ms: 4 * TICK_MS, hold: true, profile: 'run' },
  // 0x23a27, slot 6 — the sideways windup. Its frames step with the charge,
  // not with a clock, so `ms` is unused.
  windupSide: { slot: 6, anim: 'hammerSide', ms: Infinity, hold: true, profile: 'slow' },
  // 0x23cef, slots 15-21 — the strike, one frame a tick; which of the two
  // frame lists depends on the charge (see SIDE_STRIKES)
  strikeSide: { slotFrom: 15, anim: 'hammerSide', ms: TICK_MS, next: 'stand', locks: true, brakes: true },
  // 0x23f0f, slot 7 — the overhead windup
  windupOver: { slot: 7, anim: 'hammerOver', ms: Infinity, hold: true, profile: 'slow' },
  // 0x24174, slots 24-27 — the overhead swing, padded longer the more it
  // was charged (see OVER_STRIKES)
  strikeOver: { slotFrom: 24, anim: 'hammerOver', ms: TICK_MS, next: 'stand', locks: true, brakes: true },
  // 0x25813, slot 31 — in the air
  fall: { slot: 31, anim: 'fall', ms: 80, loop: true, profile: 'slow' },
  // 0x25a3e, slot 32 — hitting the ground
  land: { slot: 32, anim: 'land', ms: 45, next: 'stand' },
  // 0x22b91, slot 5 — the jump: frames 6-12 of the sheet, which sit inside
  // the run pose, a frame every fourth tick and held on the last
  rise: { slot: 5, anim: 'run', frames: [5, 6, 7, 8, 9, 10, 11], ms: 4 * TICK_MS, hold: true, profile: 'run' },
  // The hard hat: 0x24346 (slot 12) to duck in, 0x24727 / 0x2498a (slots
  // 22, 23) still and moving, 0x244c0 (slot 13) to come back out. The
  // states loop among themselves until he does, so Down toggles it.
  hatIn: { slot: 12, anim: 'helmetIn', ms: 45, next: 'hat', locks: true },
  hat: { slot: 23, anim: 'helmetMove', ms: 60, loop: true, profile: 'slow' },
  hatOut: { slot: 13, anim: 'helmetIn', ms: 45, next: 'stand', locks: true, reverse: true },

  // The hoover. 0x2a88c draws it in one strip, slot 70: Jack reaches into
  // his hard hat (sheet frames 71-81) and pulls the hoover out (122-113);
  // the hammer goes into the hat on the way. Then he carries it — 0x24e55
  // standing (slot 28), 0x250d9 walking (slot 29), profile 0, so it slows
  // him to a walk — until 0x2ab7a puts it away, slot 71, the same strip
  // backwards. Both are frames of two of the client's poses, hence `strip`.
  hooverDraw: {
    slot: 70, strip: SHEET_STRIP_DRAW, ms: 35, next: 'hooverIdle', locks: true,
  },
  hooverIdle: { slot: 28, anim: 'hooverIdle', ms: 400, loop: true, hoover: true, profile: 'slow' },
  hooverWalk: { slot: 29, anim: 'hooverWalk', ms: 70, loop: true, hoover: true, profile: 'slow' },
  hooverStow: {
    slot: 71, strip: SHEET_STRIP_STOW, ms: 35, next: 'stand', locks: true,
  },
};

/** States in which the hoover is out and sucking. */
const HOOVER_STATES = new Set(['hooverIdle', 'hooverWalk']);

/**
 * Holding the hammer key winds up; letting go strikes. The frame index of
 * the windup *is* the charge: it steps when the frame timer reaches a
 * threshold that grows with every step (VA 0x23a66, 0x23f4d).
 */
const WINDUPS = {
  // sideways: steps 1, 2, 3 … ticks apart, full (6) after 21 ticks
  windupSide: { first: 1, grow: 1, max: MAX_CHARGE, strike: 'strikeSide' },
  // overhead: 5, 10, 15 ticks apart, full (3) after 30
  windupOver: { first: 5, grow: 5, max: 3, strike: 'strikeOver' },
};

/**
 * The strikes' frame lists, as indices into the client's pose, and the
 * frames on which the blow lands. Sideways: slots 15-18 share the short
 * list and 19-21 the long one, so charge picks one (VA 0x23cef plays slot
 * 15 + charge); the blow lands on the first frame 54. Overhead: slot
 * 24 + charge, and the blow lands on every frame the list flags (0x8000).
 * All read out of the animation table by scripts/formats/anims.py.
 */
const SIDE_SHORT = [10, 12, 14, 17, 17, 17, 17, 14, 12];
const SIDE_LONG = [10, 12, 14, 16, 17, 17, 17, 17, 17, 16, 15, 14, 13, 12, 11, 10, 9];
const SIDE_STRIKES = (charge) => (charge <= 3
  ? { seq: SIDE_SHORT, impacts: [3] }
  : { seq: SIDE_LONG, impacts: [4] });
const OVER_FAST = [4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const OVER_STRIKES = [
  { seq: OVER_FAST, impacts: [2, 3] },
  { seq: OVER_FAST, impacts: [2, 3] },
  { seq: [4, 4, 5, 6, 7, 7, 7, 7, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15, 15], impacts: [3, 4] },
  {
    seq: [4, 4, 4, 5, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 10, 10, 11, 12, 13,
      14, 14, 15, 15, 15, 15],
    impacts: [5, 6],
  },
];

// A hammer-list word: the SPA.SPR frame, and two sticky switches.
const HAMMER_FRAME = 0x3fff;
const HAMMER_HIDE = 0x4000;
const HAMMER_SHOW = 0x8000;

const HITBOX_TEXTURE = 'jack_hitbox';

/**
 * A blank texture the exact size of Jack's body. The player object itself
 * wears it and stays invisible: its only job is physics and hit tests, so
 * its size never changes. The visible frames live on a separate image (see
 * `art` below), because the real sheet frames differ in size from pose to
 * pose and would otherwise drag the physics body around with them.
 */
function ensureHitboxTexture(scene) {
  if (scene.textures.exists(HITBOX_TEXTURE)) return;
  const gfx = scene.make.graphics({ x: 0, y: 0, add: false });
  gfx.generateTexture(HITBOX_TEXTURE, PLAYER_WIDTH, FULL_HEIGHT);
  gfx.destroy();
}

/**
 * Player — local player entity, "Jack" the construction worker.
 *
 * Drawn with the real frames decoded from the original 1997 sprite sheet
 * (see jackSprites.js), recoloured per player; falls back to the hand-drawn
 * frame set in drawJack.js if those aren't loaded.
 */
export default class Player extends Phaser.Physics.Arcade.Image {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color, e.g. '#ff4444' — the overalls colour
   * @param {string} playerId
   * @param {boolean} isLocal
   */
  constructor(scene, x, y, color, playerId, isLocal = true) {
    ensureHitboxTexture(scene);
    super(scene, x, y, HITBOX_TEXTURE);

    /** @type {Record<string, string[]>} pose name → texture keys */
    this._frames = ensureJackTextures(scene, playerId, color);
    this.playerId = playerId;
    this.playerColor = color;
    this.isLocal = isLocal;

    /** Current state — a key of STATES, named after the game's own. */
    this.state = 'stand';

    this._bellHit = false; // prevent repeated bell events
    this._animTimer = 0;
    this._animFrame = 0;
    this._facingLeft = false;
    this._seq = null;          // a strike's own frame list, while it plays
    this._impacts = null;      // …and the frames its blow lands on
    this._strikeCharge = 0;
    this._charge = 0;          // the windup's charge, which is its frame
    this._chargeTicks = 0;
    this._chargeStep = 0;
    this._skidVx = 0;          // the skid's speed last tick, for the bounce
    this._jumpBoost = 0;       // what is left of a held jump's extra lift
    this._hammerHidden = false; // in the hat, per the game's list flags
    this._jumpTicks = 0;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
    // The game clamps falling at 24 px/frame (0x180000 in 16.16).
    this.body.setMaxVelocityY(TERMINAL);
    if (scene.physics.world.gravity.y !== GRAVITY) {
      scene.physics.world.gravity.y = GRAVITY;
    }
    this.body.setOffset(0, 0);
    this.setOrigin(0.5, 1); // feet at y
    this.setVisible(false); // the body is a hit box; `art` is what you see

    this.art = scene.add.image(x, y, this._frames.idle[0]);
    applyJackFrame(this.art, this._frames.idle[0], true);

    // The hammer is its own sprite, as in the game: Jack's frames do not
    // include it. It stands on his position and shows the frame the game's
    // list for the current animation names (see HAMMER_BY_SLOT).
    this.hammer = null;
    this._hammerKey = null;
    if (hasProps(scene)) {
      this.hammer = scene.add.image(x, y, PROP_ANIMS.hammer[0]).setScale(JACK_SCALE);
      this.hammer.setVisible(false);
    }

    // Follow the body only after physics has moved it, so the art never
    // trails the camera by a frame.
    this._syncArt = this._syncArt.bind(this);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this._syncArt);
    // The scene restarts on every new level; take the art and the hook with us.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Keeps the visible frames on top of the physics body.
   *
   * Both images are mirrored about their anchor, Jack's feet, as the game
   * draws them. Phaser's own flip mirrors a frame about its middle instead,
   * which shifts it by `w - 2 * anchor` — up to 20 px on a strike frame,
   * and far more on a hammer frame whose anchor lies outside it.
   */
  _syncArt() {
    if (!this.art || !this.art.active) return;
    const flip = this._facingLeft;
    this.art.setPosition(this.x, this.y);
    this.art.setFlipX(flip);
    Player._anchor(this.art, JACK_FRAME_INFO[this.art.texture.key + '|' + this.art.frame.name]
      || JACK_FRAME_INFO[this.art.texture.key], flip);

    if (!this.hammer || !this.hammer.visible) return;
    this.hammer.setPosition(this.x, this.y);
    this.hammer.setFlipX(flip);
    Player._anchor(this.hammer, PROP_FRAME_INFO[this._hammerKey], flip);
  }

  /** Puts a frame's anchor on the object's position, mirrored if `flip`. */
  static _anchor(obj, info, flip) {
    if (!info) return;
    obj.setOrigin((flip ? info.w - info.ax : info.ax) / info.w, info.ay / info.h);
  }

  /**
   * The SPA.SPR frame the hammer shows now, or null where the game's
   * animation carries no hammer list (the hoover's).
   */
  _hammerFrame(spec) {
    const slot = spec.slotFrom !== undefined ? spec.slotFrom + this._strikeCharge : spec.slot;
    const list = HAMMER_BY_SLOT[slot];
    if (!list || !list.length) return null;
    return list[Math.min(this._animFrame, list.length - 1)];
  }

  /** True while the hoover is out and able to suck. */
  get hooverOut() {
    return HOOVER_STATES.has(this.state);
  }

  /** True when Jack is facing left. */
  get facingLeft() {
    return this._facingLeft;
  }

  /**
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {boolean} swingHeld  the hammer key — down now, or tapped since
   *   the last tick (the scene latches taps)
   * @param {number} delta  ms since the last tick
   * @param {boolean} hooverPressed  the hoover key, latched by the scene
   * @param {boolean} jumpHeld  the jump key (the game's BUT2), latched too
   */
  update(cursors, swingHeld, delta = 1000 / 60, hooverPressed = false, jumpHeld = false) {
    const body = this.body;
    const onGround = body.blocked.down;
    const now = this.scene.time.now;
    const ms = Math.min(delta, MAX_STEP_MS);
    const dt = ms / 1000;

    this._advanceAnim(now);
    const spec = STATES[this.state] || STATES.stand;

    // ── States that own the player until their animation is done ──────────
    if (spec.locks) {
      body.setVelocityX(spec.brakes ? this._brake(body.velocity.x, dt) : 0);
      return;
    }

    // ── Winding up: the key held charges, letting go strikes ──────────────
    const windup = WINDUPS[this.state];
    if (windup) {
      this._windup(windup, cursors, body, ms, swingHeld, now);
      return;
    }

    // ── The hard hat is a mode, not a pose: Down toggles it ───────────────
    if (Phaser.Input.Keyboard.JustDown(cursors.down) && onGround) {
      this._enter(this.state === 'hat' ? 'hatOut' : 'hatIn', now);
      body.setVelocityX(0);
      return;
    }

    if (this.state === 'hat') {
      this._steer(cursors, body, dt, PROFILES.slow);
      return;
    }

    // ── The hoover ────────────────────────────────────────────────────────
    // In the game this comes off the same Down press as the hard hat —
    // reaching into the hat is one state, and where it goes next is a
    // branch that has not been traced. Until it is, it gets a key of its
    // own so the mode can be used at all; that binding is ours, not the
    // game's.
    if (hooverPressed && onGround) {
      this._enter(HOOVER_STATES.has(this.state) ? 'hooverStow' : 'hooverDraw', now);
      body.setVelocityX(0);
      return;
    }

    if (HOOVER_STATES.has(this.state)) {
      const moved = this._steer(cursors, body, dt, PROFILES.slow);
      this._enter(moved ? 'hooverWalk' : 'hooverIdle', now);
      return;
    }

    // ── Strikes ───────────────────────────────────────────────────────────
    // The key starts a windup; the strike comes when it is let go. Up held
    // picks the overhead one — the game's direction-with-the-button.
    if (onGround && swingHeld) {
      this._charge = 0;
      this._chargeTicks = 0;
      this._chargeStep = 0;
      // Swinging takes the hammer back out of the hat if it was in there:
      // the game shows it again on the way into a swing (VA 0x234c3).
      this._hammerHidden = false;
      this._enter(cursors.up.isDown ? 'windupOver' : 'windupSide', now);
      this.emit('hammer_swing');
      return;
    }

    // ── The skid brakes by itself; a direction key runs again ─────────────
    if (this.state === 'skid' && onGround && !cursors.left.isDown && !cursors.right.isDown) {
      // Skidding into a wall bounces him back a quarter as fast (VA 0x227ea).
      // Physics has already stopped him by now, so it is last tick's speed.
      const into = (this._skidVx > 0 && body.blocked.right) || (this._skidVx < 0 && body.blocked.left);
      if (into) body.setVelocityX(-this._skidVx / 4);
      const vx = body.velocity.x;
      this._skidVx = vx;
      if (Math.abs(vx) < SKID_STOP) {
        body.setVelocityX(0);
        this._enter('stand', now);
      } else {
        body.setVelocityX(vx - Math.sign(vx) * SKID_BRAKE * dt);
      }
      return;
    }

    // ── Moving ────────────────────────────────────────────────────────────
    const profile = PROFILES[spec.profile] || PROFILES.run;
    const moving = this._steer(cursors, body, dt, profile);

    if (jumpHeld && onGround) {
      body.setVelocityY(JUMP);
      this._jumpBoost = JUMP_BOOST;
      this._jumpTicks = 0;
      this._enter('rise', now);
      return;
    }

    if (this.state === 'rise' && this._jumpBoost > 0) {
      if (!jumpHeld || body.velocity.y >= 0) {
        this._jumpBoost = 0;
      } else {
        this._jumpTicks += dt * ORIGINAL_HZ;
        if (this._jumpTicks > JUMP_BOOST_AFTER) {
          body.setVelocityY(body.velocity.y - perS2(this._jumpBoost) * dt);
          this._jumpBoost = Math.max(0, this._jumpBoost - JUMP_BOOST_DECAY * dt * ORIGINAL_HZ);
        }
      }
    }

    if (!onGround) {
      this._enter(body.velocity.y > FALL_VELOCITY ? 'fall' : 'rise', now);
      return;
    }

    // Landing after a fall plays its own short animation.
    if (this.state === 'fall') {
      this._enter('land', now);
      return;
    }
    if (this.state === 'land') return; // let it finish

    if (moving) this._enter('walk', now);
    else if (Math.abs(body.velocity.x) >= SKID_STOP) {
      this._skidVx = body.velocity.x;
      this._enter('skid', now);
    }
    else {
      body.setVelocityX(0);
      this._enter('stand', now);
    }
  }

  /**
   * One tick of a windup. While the key is held the charge steps each time
   * the frame timer reaches a threshold, and the threshold grows by `grow`
   * after every step. Letting go strikes with whatever has built up.
   */
  _windup(w, cursors, body, ms, swingHeld, now) {
    body.setVelocityX(this._brake(body.velocity.x, ms / 1000));
    if (Phaser.Input.Keyboard.JustDown(cursors.left)) body.setVelocityX(body.velocity.x - WINDUP_NUDGE);
    if (Phaser.Input.Keyboard.JustDown(cursors.right)) body.setVelocityX(body.velocity.x + WINDUP_NUDGE);

    if (swingHeld) {
      this._chargeTicks += ms / TICK_MS;
      const threshold = w.first + this._chargeStep * w.grow;
      if (this._charge < w.max && this._chargeTicks >= threshold) {
        this._chargeTicks = 0;
        this._chargeStep += 1;
        this._charge += 1;
        this._animFrame = this._charge;
        this._showFrame(STATES[this.state]);
      }
      return;
    }

    const charge = this._charge;
    const { seq, impacts } = w.strike === 'strikeSide'
      ? SIDE_STRIKES(charge)
      : OVER_STRIKES[charge];
    this._enter(w.strike, now, { seq, impacts, charge });
  }

  /** The braking a windup, a strike and the skid share: ∓5000 a tick. */
  _brake(vx, dt) {
    if (Math.abs(vx) < SKID_STOP) return 0;
    return vx - Math.sign(vx) * SKID_BRAKE * dt;
  }

  /**
   * Applies the direction keys the way the original does (VA 0x257c0):
   * build up at the profile's rate, push back at its turn rate when the key
   * is against the motion, and ease off by an eighth-of-a-quarter of the
   * excess when above the cap. Friction comes off on top, every tick, keys
   * or not (VA 0x22d31). Returns true while a key is held.
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {Phaser.Physics.Arcade.Body} body
   * @param {number} dt seconds
   * @param {{top: number, accel: number, turn: number}} profile px/s, px/s²
   */
  _steer(cursors, body, dt, profile) {
    let vx = body.velocity.x;
    const held = cursors.left.isDown || cursors.right.isDown;
    if (held) {
      const dir = cursors.left.isDown ? -1 : 1;
      this._facingLeft = dir < 0;
      if (Math.sign(vx) === -dir) {
        vx += dir * profile.turn * dt;
      } else if (Math.abs(vx) < profile.top) {
        vx = dir * Math.min(profile.top, Math.abs(vx) + profile.accel * dt);
      } else {
        vx -= (vx - dir * profile.top) * Math.min(1, EASE_INTO_TOP * dt * ORIGINAL_HZ);
      }
    }
    if (Math.abs(vx) <= AT_REST) vx = 0;
    else vx -= Math.sign(vx) * Math.min(Math.abs(vx), FRICTION * dt);
    body.setVelocityX(vx);
    return held;
  }

  /**
   * Switches state, restarting its animation. A strike brings its own
   * frame list (`seq`), the frames its blow lands on, and the charge.
   */
  _enter(name, now, strike = null) {
    if (this.state === name) return;
    this.state = name;
    const spec = STATES[name] || STATES.stand;
    this._seq = strike ? strike.seq : (spec.frames || null);
    this._impacts = strike ? strike.impacts : null;
    this._strikeCharge = strike ? strike.charge : 0;
    this._animFrame = spec.startFrame || 0;
    this._animTimer = now;
    this._showFrame(spec);
  }

  /**
   * Steps the current animation, and ends the state when a one-shot
   * animation runs out. A strike announces its blow on the frames that
   * carry it — once each, which is what makes the force worth anything.
   */
  _advanceAnim(now) {
    // Consume the elapsed time rather than stepping one frame per tick:
    // a 22ms frame on a 60Hz display would otherwise take 33ms, and an
    // eighteen-frame strike would run half again as long as it should.
    let guard = 0;
    for (;;) {
      const spec = STATES[this.state] || STATES.stand;
      if (now - this._animTimer < spec.ms || guard > ANIM_CATCHUP_LIMIT) break;
      guard += 1;
      this._animTimer += spec.ms;
      this._animFrame += 1;

      if (this._animFrame >= this._length(spec)) {
        if (spec.loop) {
          this._animFrame = spec.startFrame || 0;
        } else if (spec.hold) {
          this._animFrame = this._length(spec) - 1;
        } else {
          this._enter(spec.next || 'stand', now);
          return;
        }
      }
      if (this._impacts && this._impacts.includes(this._animFrame)) {
        this.emit('hammer_impact', {
          charge: this._strikeCharge,
          overhead: this.state === 'strikeOver',
        });
      }
    }
    this._showFrame(STATES[this.state] || STATES.stand);
  }

  /** Frames in the current state: its strike list, or its whole pose. */
  _length(spec) {
    if (spec.strip) return spec.strip.length;
    return this._seq ? this._seq.length : this._frameCount(spec.anim);
  }

  /** Draws the current frame of a state's animation. */
  _showFrame(spec) {
    if (spec.strip) {
      const [pose, at] = spec.strip[Math.min(this._animFrame, spec.strip.length - 1)];
      this._show(pose, at);
    } else {
      const total = this._frameCount(spec.anim);
      let i = spec.reverse ? total - 1 - this._animFrame : this._animFrame;
      if (this._seq) i = this._seq[Math.min(this._animFrame, this._seq.length - 1)];
      this._show(spec.anim, Phaser.Math.Clamp(i, 0, total - 1));
    }
    if (this.hammer) {
      const word = this._hammerFrame(spec);
      if (word !== null) {
        // The list's flag bits switch the hammer off and on, and stay
        // switched (VA 0x20905); ducking into the hat puts it away too
        // (slot 12, VA 0x20940).
        if (word & HAMMER_HIDE) this._hammerHidden = true;
        if (word & HAMMER_SHOW) this._hammerHidden = false;
        if (spec.slot === 12 && (word & HAMMER_FRAME) <= 15) this._hammerHidden = true;
        this._hammerKey = PROP_ANIMS.hammer[word & HAMMER_FRAME];
        this.hammer.setTexture(this._hammerKey);
      }
      this.hammer.setVisible(word !== null && !this._hammerHidden);
    }
  }

  /** How many frames a pose has, 1 if it is missing. */
  _frameCount(pose) {
    const keys = this._frames[pose];
    return keys && keys.length ? keys.length : 1;
  }

  /**
   * Shows one frame of a pose.
   * @returns {boolean} false when the pose is not in the frame set
   */
  _show(pose, frame = 0) {
    const keys = this._frames[pose];
    if (!keys || !keys.length) return false;
    applyJackFrame(this.art, keys[frame % keys.length]);
    return true;
  }

  resetBellHit() {
    this._bellHit = false;
  }

  get bellHit() {
    return this._bellHit;
  }

  set bellHit(v) {
    this._bellHit = v;
  }

  /** Also tears down the separate art image and its post-update hook. */
  destroy(fromScene) {
    if (this.scene) {
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this._syncArt);
    }
    if (this.art) {
      this.art.destroy();
      this.art = null;
    }
    if (this.hammer) {
      this.hammer.destroy();
      this.hammer = null;
    }
    super.destroy(fromScene);
  }
}
