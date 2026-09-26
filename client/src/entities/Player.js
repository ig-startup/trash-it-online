import Phaser from 'phaser';
import {
  ensureJackTextures, applyJackFrame, PLAYER_WIDTH, FULL_HEIGHT,
} from './drawJack';
import { PROP_ANIMS, applyPropFrame, hasProps } from './props';

/**
 * The original's physics, in its own units: pixels per frame, and pixels
 * per frame squared, at its own tick rate. Our levels are its pixels 1:1,
 * so the only conversion needed is that rate.
 *
 * `ORIGINAL_HZ` is the one number here that is not read out of the game.
 * 70Hz is mode 13h's refresh and what an action game of this vintage
 * syncs to, but it has not been confirmed in the binary — everything
 * else derives from it, so it is the single dial if the feel is off.
 */
const ORIGINAL_HZ = 70;
const GRAVITY = 0.28125 * ORIGINAL_HZ * ORIGINAL_HZ;  // VA 0x22d31: vy += 0x4800
const TERMINAL = 24 * ORIGINAL_HZ;                    // clamped at 0x180000
const JUMP = -4.5 * ORIGINAL_HZ;                      // VA 0x22bc5, out of the walk
/**
 * The hop nearly every state in the game can do: -2.0 px/frame, which
 * lifts him seven pixels. Not a jump — a stumble over a kerb. Kept here
 * because it turns up in almost every one of the 46 states and is the
 * only other upward impulse in the game, so it is worth not
 * rediscovering. Nothing uses it yet.
 */
// eslint-disable-next-line no-unused-vars
const STEP_UP = -2.0 * ORIGINAL_HZ;

const SPEED = 200;          // top speed, px/s — the original's is not known
// Reaching top speed takes about a third of a second, and letting go
// coasts down a little faster than that. The original's numbers are in
// pixels per frame at a tick rate we have not identified, so the shape
// is copied and the scale is ours.
const ACCEL = SPEED / 0.35;
const DECEL = SPEED / 0.25;
const EASE_INTO_TOP = 1 / 32;   // the original's `>> 5` as it nears the cap
const STOP_THRESHOLD = 12;      // px/s below which Jack just stops
const MAX_STEP_MS = 50;         // ignore hitches longer than this
const FALL_VELOCITY = 80;       // downward speed at which rising becomes falling
const HAT_SPEED = 120;          // the hat travels slower than Jack on his feet
const HOOVER_SPEED = 150;       // carrying it slows him down
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
 * animation does and hands over to `next`. `locks` means input is
 * ignored until then.
 */
const STATES = {
  // 0x236b9, animation slot 3 — a single standing frame
  stand: { anim: 'idle', ms: 400, loop: true },
  // 0x2266d, slot 2 — the run cycle
  walk: { anim: 'run', ms: 70, loop: true },
  // 0x23499, slot 4 — four frames, then he is standing
  skid: { anim: 'skid', ms: 45, next: 'stand' },
  // 0x2498a, slot 8 — the sideways strike, 18 frames
  strikeSide: { anim: 'hammerSide', ms: 22, next: 'stand', locks: true },
  // 0x25468, slot 9 — the overhead strike, 16 frames
  strikeOver: { anim: 'hammerOver', ms: 22, next: 'stand', locks: true },
  // 0x25bda, slot 33 — falling
  fall: { anim: 'fall', ms: 80, loop: true },
  // 0x25dfc, slot 34 — hitting the ground
  land: { anim: 'land', ms: 45, next: 'stand' },
  // Rising has no state of its own in the game's list; a mid-stride run
  // frame stands in rather than inventing a pose.
  rise: { anim: 'run', ms: 999999, loop: true, startFrame: 4 },
  // The hard hat. Its animations belong to no state in the game's graph,
  // which fits it being a mode Jack stays in rather than a pose he holds
  // a key for — so Down toggles it.
  hatIn: { anim: 'helmetIn', ms: 45, next: 'hat', locks: true },
  hat: { anim: 'helmetMove', ms: 60, loop: true },
  hatOut: { anim: 'helmetIn', ms: 45, next: 'stand', locks: true, reverse: true },

  // The hoover, and the second half of the game's state graph. Jack
  // reaches into his hard hat (0x24346), the hoover comes out, and from
  // then on he is in a carrying mode with its own standing and walking
  // states — 0x256e9 and 0x25813, the latter of which 29 transitions
  // lead to. Carrying it is a mode, not an action.
  hatReach: { anim: 'hatReach', ms: 30, next: 'hooverOut', locks: true },
  hooverOut: { anim: 'hooverOut', ms: 40, next: 'hooverIdle', locks: true },
  hooverIdle: { anim: 'hooverIdle', ms: 400, loop: true, hoover: true },
  hooverWalk: { anim: 'hooverWalk', ms: 70, loop: true, hoover: true },
  hooverAway: { anim: 'hatReach', ms: 30, next: 'stand', locks: true, reverse: true },
};

/** States in which the hoover is out and sucking. */
const HOOVER_STATES = new Set(['hooverIdle', 'hooverWalk']);

/**
 * Where Jack's grip is through a swing, relative to his feet (x is mirrored
 * when he faces left). The original hangs the tool off its own entity; this
 * samples three points along our frame list so the sprite follows the hands.
 */
const HAMMER_GRIP = [
  { x: 2, y: -34 },   // raised
  { x: 10, y: -30 },  // coming down
  { x: 14, y: -14 },  // struck
];

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
    this._hammerPhase = 0;

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

    // The sledgehammer, shown only mid-swing.
    this.hammer = null;
    if (hasProps(scene)) {
      this.hammer = scene.add.image(x, y, PROP_ANIMS.hammer[0]);
      applyPropFrame(this.hammer, PROP_ANIMS.hammer[0]);
      this.hammer.setVisible(false);
    }

    // Follow the body only after physics has moved it, so the art never
    // trails the camera by a frame.
    this._syncArt = this._syncArt.bind(this);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this._syncArt);
    // The scene restarts on every new level; take the art and the hook with us.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Keeps the visible frame on top of the physics body. */
  _syncArt() {
    if (!this.art || !this.art.active) return;
    this.art.setPosition(this.x, this.y);
    this.art.setFlipX(this._facingLeft);

    if (!this.hammer) return;
    const swinging = this.state === 'hammer';
    this.hammer.setVisible(swinging);
    if (!swinging) return;
    const grip = HAMMER_GRIP[this._hammerPhase] || HAMMER_GRIP[0];
    const dir = this._facingLeft ? -1 : 1;
    this.hammer.setFlipX(this._facingLeft);
    this.hammer.setPosition(this.x + grip.x * dir, this.y + grip.y);
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
   * @param {boolean} swingPressed  the hammer key, latched by the scene
   * @param {number} delta  ms since the last tick
   * @param {boolean} hooverPressed  the hoover key, latched by the scene
   */
  update(cursors, swingPressed, delta = 1000 / 60, hooverPressed = false) {
    const body = this.body;
    const onGround = body.blocked.down;
    const now = this.scene.time.now;
    const dt = Math.min(delta, MAX_STEP_MS) / 1000;

    this._advanceAnim(now);
    const spec = STATES[this.state] || STATES.stand;

    // ── States that own the player until their animation is done ──────────
    if (spec.locks) {
      body.setVelocityX(0);
      return;
    }

    // ── The hard hat is a mode, not a pose: Down toggles it ───────────────
    if (Phaser.Input.Keyboard.JustDown(cursors.down) && onGround) {
      this._enter(this.state === 'hat' ? 'hatOut' : 'hatIn', now);
      body.setVelocityX(0);
      return;
    }

    if (this.state === 'hat') {
      this._steer(cursors, body, dt, HAT_SPEED);
      return;
    }

    // ── The hoover ────────────────────────────────────────────────────────
    // In the game this comes off the same Down press as the hard hat —
    // reaching into the hat is one state, and where it goes next is a
    // branch that has not been traced. Until it is, it gets a key of its
    // own so the mode can be used at all; that binding is ours, not the
    // game's.
    if (hooverPressed && onGround) {
      this._enter(HOOVER_STATES.has(this.state) ? 'hooverAway' : 'hatReach', now);
      body.setVelocityX(0);
      return;
    }

    if (HOOVER_STATES.has(this.state)) {
      const moved = this._steer(cursors, body, dt, HOOVER_SPEED);
      this._enter(moved ? 'hooverWalk' : 'hooverIdle', now);
      return;
    }

    // ── Strikes ───────────────────────────────────────────────────────────
    // Two of them, as the original has: the sideways one, and an overhead
    // one reached with Up held.
    if (onGround && swingPressed) {
      this._enter(cursors.up.isDown ? 'strikeOver' : 'strikeSide', now);
      this.emit('hammer_swing');
      body.setVelocityX(0);
      return;
    }

    // ── Moving ────────────────────────────────────────────────────────────
    const moving = this._steer(cursors, body, dt, SPEED);

    if ((cursors.up.isDown || cursors.space.isDown) && onGround) {
      body.setVelocityY(JUMP);
      this._enter('rise', now);
      return;
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
    if (this.state === 'land' || this.state === 'skid') return; // let it finish

    if (moving) this._enter('walk', now);
    else if (Math.abs(body.velocity.x) > STOP_THRESHOLD) this._enter('skid', now);
    else this._enter('stand', now);
  }

  /**
   * Applies the direction keys. Returns true while one is held.
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {Phaser.Physics.Arcade.Body} body
   * @param {number} dt seconds
   * @param {number} top px/s this state is allowed to reach
   */
  _steer(cursors, body, dt, top) {
    const vx = body.velocity.x;
    if (cursors.left.isDown || cursors.right.isDown) {
      const dir = cursors.left.isDown ? -1 : 1;
      this._facingLeft = dir < 0;
      body.setVelocityX(this._accelerate(vx, dir, dt, top));
      return true;
    }
    body.setVelocityX(Math.abs(vx) <= STOP_THRESHOLD
      ? 0
      : vx - Math.sign(vx) * DECEL * dt);
    return false;
  }

  /**
   * One step of the original's horizontal acceleration: build up at a
   * constant rate, then ease onto the top speed instead of hitting it
   * (VA 0x257c0).
   */
  _accelerate(vx, dir, dt, top) {
    const target = dir * top;
    if (Math.abs(vx) < top && Math.sign(vx) !== -dir) {
      return Phaser.Math.Clamp(vx + dir * ACCEL * dt, -top, top);
    }
    const eased = vx + (target - vx) * EASE_INTO_TOP * (dt * 60);
    return Phaser.Math.Clamp(eased + dir * ACCEL * dt, -top, top);
  }

  /** Switches state, restarting its animation. */
  _enter(name, now) {
    if (this.state === name) return;
    this.state = name;
    const spec = STATES[name] || STATES.stand;
    this._animFrame = spec.startFrame || 0;
    this._animTimer = now;
    this._showFrame(spec);
  }

  /**
   * Steps the current animation, and ends the state when a one-shot
   * animation runs out.
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

      if (this._animFrame >= this._frameCount(spec.anim)) {
        if (spec.loop) {
          this._animFrame = spec.startFrame || 0;
        } else {
          this._enter(spec.next || 'stand', now);
          return;
        }
      }
    }
    this._showFrame(STATES[this.state] || STATES.stand);
  }

  /** Draws the current frame of a state's animation. */
  _showFrame(spec) {
    const total = this._frameCount(spec.anim);
    const i = spec.reverse ? total - 1 - this._animFrame : this._animFrame;
    this._show(spec.anim, Phaser.Math.Clamp(i, 0, total - 1));
    if (this.hammer) {
      const swinging = spec.locks && spec.anim.startsWith('hammer');
      this.hammer.setVisible(!!swinging);
      if (swinging) {
        this._hammerPhase = Math.min(HAMMER_GRIP.length - 1,
          Math.floor((this._animFrame / total) * HAMMER_GRIP.length));
        applyPropFrame(this.hammer, PROP_ANIMS.hammer[this._hammerPhase]);
      }
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
