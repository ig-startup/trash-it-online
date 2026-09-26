import Phaser from 'phaser';
import {
  ensureJackTextures, applyJackFrame, PLAYER_WIDTH, FULL_HEIGHT, CROUCH_HEIGHT,
} from './drawJack';
import { PROP_ANIMS, applyPropFrame, hasProps } from './props';
import manifest from './jackFrames.json';

const SPEED = 200;          // top speed, px/s
// Reaching top speed takes about a third of a second, and letting go
// coasts down a little faster than that. The original's numbers are in
// pixels per frame at its own tick rate, which we do not know, so the
// shape is copied and the scale is ours.
const ACCEL = SPEED / 0.35;
const DECEL = SPEED / 0.25;
const EASE_INTO_TOP = 1 / 32;   // the original's `>> 5` as it nears the cap
const STOP_THRESHOLD = 12;      // px/s below which Jack just stops
const MAX_STEP_MS = 50;         // ignore hitches longer than this
const JUMP = -450;
const RUN_FRAME_MS = 70; // run-cycle frame swap interval
const IDLE_FRAME_MS = 500;
const FALL_VELOCITY = 80; // downward speed at which the jump pose becomes a fall
const RISING_RUN_FRAME = 4;  // mid-stride, stands in for a jump pose
const SWING_FRAME_MS = 22;  // a strike runs its whole frame list at this rate
const SKID_FRAME_MS = 45;   // frame rate of the skid animation
const HELMET_FRAME_MS = 45;
const HELMET_SPEED = 120;   // the hat travels slower than Jack on his feet

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

    /** @type {'idle'|'run'|'skid'|'jump'|'helmet'|'hammer'} */
    this.state = 'idle';

    /** Which strike is playing: the sideways one or the overhead one. */
    this._swingPose = 'hammerSide';
    this._swingFrame = 0;
    this._swingFrom = 0;
    this._swingTimer = 0;
    /** helmet: 'in' folding up, 'move' travelling, 'out' standing back up. */
    this._helmetPhase = null;
    this._helmetFrame = 0;
    this._helmetTimer = 0;
    this._isCrouching = false;
    this._bellHit = false; // prevent repeated bell events
    this._animTimer = 0;
    this._animFrame = 0;
    this._facingLeft = false;
    this._hammerPhase = 0;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
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

  /** True when Jack is facing left. */
  get facingLeft() {
    return this._facingLeft;
  }

  /**
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {Phaser.Input.Keyboard.Key} hammerKey  Z key
   */
  update(cursors, hammerKey, delta = 1000 / 60) {
    const body = this.body;
    const onGround = body.blocked.down;
    const now = this.scene.time.now;

    if (this.state === 'hammer' && this._advanceSwing(now, body)) return;
    if (this._helmetPhase && this._updateHelmet(cursors, now, body)) return;

    // ── Starting a strike ────────────────────────────────────────────────────
    // The original has two: sideways, and an overhead one reached through a
    // key combination. Holding the button replays the sideways strike from
    // part-way in, skipping the windup, which is its own entry in the game's
    // animation table (slot 17 is slot 8 from frame 47).
    if (onGround && hammerKey.isDown) {
      const fresh = Phaser.Input.Keyboard.JustDown(hammerKey);
      if (fresh || now >= this._swingTimer) {
        const overhead = cursors.up.isDown;
        this._startSwing(overhead ? 'hammerOver' : 'hammerSide',
          fresh ? 0 : this._heldSwingStart(), now);
        body.setVelocityX(0);
        return;
      }
    }

    // ── Down: fold up into the hard hat ──────────────────────────────────────
    if (cursors.down.isDown && onGround && !this._helmetPhase) {
      this._enterHelmet(now, body);
      return;
    }

    // ── Horizontal movement ───────────────────────────────────────────────────
    // The original does not assign a speed when you press a direction: it
    // accelerates toward a top speed and eases onto it, and coasts back
    // down when you let go (VA 0x257c0, see scripts/formats/README.md).
    // Assigning the velocity is what made this feel stiff, and it also
    // made the skid animation a lie — Jack played it while stopping dead.
    const dt = Math.min(delta, MAX_STEP_MS) / 1000;
    const vx = body.velocity.x;

    if (cursors.left.isDown || cursors.right.isDown) {
      const dir = cursors.left.isDown ? -1 : 1;
      this._facingLeft = dir < 0;
      body.setVelocityX(this._accelerate(vx, dir, dt));
      this.state = onGround ? 'run' : 'jump';
    } else {
      const slowed = Math.abs(vx) <= STOP_THRESHOLD
        ? 0
        : vx - Math.sign(vx) * DECEL * dt;
      body.setVelocityX(slowed);
      // Skidding is now a real state: it lasts exactly as long as Jack is
      // still carrying speed with nothing pressed.
      if (onGround) this.state = slowed !== 0 ? 'skid' : 'idle';
      else this.state = 'jump';
    }

    // ── Jump ─────────────────────────────────────────────────────────────────
    if ((cursors.up.isDown || cursors.space.isDown) && onGround) {
      body.setVelocityY(JUMP);
      this.state = 'jump';
    }

    this._applyAnimFrame(now);
  }

  /**
   * One step of the original's horizontal acceleration: build up at a
   * constant rate, then ease onto the top speed instead of hitting it.
   * @param {number} vx current velocity
   * @param {number} dir -1 or 1
   * @param {number} dt seconds
   */
  _accelerate(vx, dir, dt) {
    const top = dir * SPEED;
    if (Math.abs(vx) < SPEED && Math.sign(vx) !== -dir) {
      return Phaser.Math.Clamp(vx + dir * ACCEL * dt, -SPEED, SPEED);
    }
    // Turning around, or already at the cap: ease toward the target.
    const eased = vx + (top - vx) * EASE_INTO_TOP * (dt * 60);
    return Phaser.Math.Clamp(eased + dir * ACCEL * dt, -SPEED, SPEED);
  }

  /** How many frames a pose has, 1 if it is missing. */
  _frameCount(pose) {
    const keys = this._frames[pose];
    return keys && keys.length ? keys.length : 1;
  }

  /**
   * Where a held button restarts the sideways strike — the manifest carries
   * the index the game's own no-windup variant begins at.
   */
  _heldSwingStart() {
    const from = manifest.hammerHeldFrom;
    return Number.isInteger(from) ? Math.min(from, this._frameCount('hammerSide') - 1) : 0;
  }

  _startSwing(pose, from, now) {
    this.state = 'hammer';
    this._swingPose = pose;
    this._swingFrom = from;
    this._swingFrame = from;
    this._swingTimer = now + SWING_FRAME_MS;
    this.emit('hammer_swing');
  }

  /**
   * Steps a strike along one frame per tick. Returns true while it owns the
   * player, so the caller leaves input alone until the swing has played out.
   */
  _advanceSwing(now, body) {
    const total = this._frameCount(this._swingPose);
    if (now >= this._swingTimer) {
      this._swingFrame += 1;
      this._swingTimer = now + SWING_FRAME_MS;
    }
    if (this._swingFrame >= total) {
      this.state = body.blocked.down ? 'idle' : 'jump';
      this._swingTimer = now; // a held button may start the next one at once
      return false;
    }
    const done = (this._swingFrame - this._swingFrom) / Math.max(1, total - this._swingFrom);
    this._hammerPhase = done < 0.5 ? 0 : (done < 0.85 ? 1 : 2);
    this._show(this._swingPose, this._swingFrame);
    if (this.hammer) applyPropFrame(this.hammer, PROP_ANIMS.hammer[this._hammerPhase]);
    body.setVelocityX(0);
    return true;
  }

  _enterHelmet(now, body) {
    this._helmetPhase = 'in';
    this._helmetFrame = 0;
    this._helmetTimer = now + HELMET_FRAME_MS;
    this.state = 'helmet';
    this._isCrouching = true;
    body.setSize(PLAYER_WIDTH, CROUCH_HEIGHT);
    body.setOffset(0, FULL_HEIGHT - CROUCH_HEIGHT);
    body.setVelocityX(0);
    this._show('helmetIn', 0);
  }

  /**
   * Hard-hat mode: Jack folds up into his hat, travels as the hat while Down
   * is held, and unfolds when it is let go. Returns true while it owns the
   * player.
   */
  _updateHelmet(cursors, now, body) {
    const step = now >= this._helmetTimer;
    if (step) {
      this._helmetFrame += 1;
      this._helmetTimer = now + HELMET_FRAME_MS;
    }

    if (this._helmetPhase === 'in') {
      const n = this._frameCount('helmetIn');
      if (this._helmetFrame >= n) {
        this._helmetPhase = 'move';
        this._helmetFrame = 0;
      } else {
        this._show('helmetIn', this._helmetFrame);
        body.setVelocityX(0);
        return true;
      }
    }

    if (this._helmetPhase === 'move') {
      if (!cursors.down.isDown) {
        this._helmetPhase = 'out';
        this._helmetFrame = 0;
      } else {
        if (cursors.left.isDown) {
          body.setVelocityX(-HELMET_SPEED);
          this._facingLeft = true;
        } else if (cursors.right.isDown) {
          body.setVelocityX(HELMET_SPEED);
          this._facingLeft = false;
        } else {
          body.setVelocityX(0);
        }
        this._show('helmetMove', this._helmetFrame);
        return true;
      }
    }

    // Coming back up plays the fold reversed — the game keeps that as its
    // own animation (slot 15 is slot 14 backwards).
    const n = this._frameCount('helmetIn');
    if (this._helmetFrame >= n) {
      this._helmetPhase = null;
      this._isCrouching = false;
      body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
      body.setOffset(0, 0);
      this.state = 'idle';
      return false;
    }
    this._show('helmetIn', n - 1 - this._helmetFrame);
    body.setVelocityX(0);
    return true;
  }

  /**
   * Shows the given pose, cycling through its frames if it has several.
   * @param {string} pose
   * @param {number} [frame=0]
   */
  _show(pose, frame = 0) {
    const keys = this._frames[pose];
    if (!keys || !keys.length) return false;
    applyJackFrame(this.art, keys[frame % keys.length]);
    return true;
  }

  /**
   * Advances the animation clock and swaps frames for idle/run/jump.
   * @param {number} now
   */
  _applyAnimFrame(now) {
    if (this.state === 'jump') {
      // 'fall' is the game's own falling frame. The pose that used to be
      // here came out of the middle of a get-up sequence and read as
      // climbing down a ladder.
      if (this.body.velocity.y > FALL_VELOCITY) this._show('fall');
      // Going up has no pose of its own in the game's table — nothing
      // there has been identified as a jump — so a mid-stride run frame
      // stands in rather than inventing one.
      else this._show('jump', 0) || this._show('run', RISING_RUN_FRAME);
      return;
    }
    if (this.state === 'skid') {
      if (now - this._animTimer >= SKID_FRAME_MS) {
        this._animTimer = now;
        this._animFrame += 1;
      }
      this._show('skid', this._animFrame);
      return;
    }
    if (this.state === 'run') {
      if (now - this._animTimer >= RUN_FRAME_MS) {
        this._animTimer = now;
        this._animFrame += 1;
      }
      this._show('run', this._animFrame);
      return;
    }
    if (now - this._animTimer >= IDLE_FRAME_MS) {
      this._animTimer = now;
      this._animFrame += 1;
    }
    this._show('idle', this._animFrame);
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
