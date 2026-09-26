import Phaser from 'phaser';
import {
  ensureJackTextures, applyJackFrame, PLAYER_WIDTH, FULL_HEIGHT, CROUCH_HEIGHT,
} from './drawJack';
import { PROP_ANIMS, applyPropFrame, hasProps } from './props';

const SPEED = 200;
const JUMP = -450;
const HAMMER_DURATION = 300;
const RUN_FRAME_MS = 70; // run-cycle frame swap interval
const IDLE_FRAME_MS = 500;
const FALL_VELOCITY = 80; // downward speed at which the jump pose becomes a fall

/**
 * Where Jack's grip is during each phase of the swing, relative to his feet
 * (x is mirrored when he faces left). The original draws the tool as its own
 * entity spinning through a 61-frame arc; this is a three-pose stand-in that
 * hangs the same sprite off his hands.
 */
const HAMMER_GRIP = [
  { x: 2, y: -34 },   // raised overhead
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

    /** @type {'idle'|'run'|'jump'|'crouch'|'hammer'} */
    this.state = 'idle';

    this._hammerTimer = 0;
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
  update(cursors, hammerKey) {
    const body = this.body;
    const onGround = body.blocked.down;
    const now = this.scene.time.now;

    // ── Hammer cooldown ──────────────────────────────────────────────────────
    if (this.state === 'hammer') {
      const progress = 1 - Math.max(0, this._hammerTimer - now) / HAMMER_DURATION;
      this._hammerPhase = progress < 0.5 ? 0 : (progress < 0.85 ? 1 : 2);
      this._show(['hammerUp', 'hammerMid', 'hammerDown'][this._hammerPhase]);
      if (this.hammer) applyPropFrame(this.hammer, PROP_ANIMS.hammer[this._hammerPhase]);

      if (now >= this._hammerTimer) {
        this.state = onGround ? 'idle' : 'jump';
      }
      // During hammer swing block all other input
      body.setVelocityX(0);
      return;
    }

    // ── Hammer trigger ───────────────────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(hammerKey) && onGround) {
      this.state = 'hammer';
      this._hammerTimer = now + HAMMER_DURATION;
      this.emit('hammer_swing');
      body.setVelocityX(0);
      return;
    }

    // ── Crouch ───────────────────────────────────────────────────────────────
    if (cursors.down.isDown && onGround) {
      if (!this._isCrouching) {
        this._isCrouching = true;
        body.setSize(PLAYER_WIDTH, CROUCH_HEIGHT);
        body.setOffset(0, FULL_HEIGHT - CROUCH_HEIGHT);
      }
      this.state = 'crouch';
      this._show('crouch');
      body.setVelocityX(0);
      return;
    } else if (this._isCrouching) {
      this._isCrouching = false;
      body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
      body.setOffset(0, 0);
    }

    // ── Horizontal movement ───────────────────────────────────────────────────
    if (cursors.left.isDown) {
      body.setVelocityX(-SPEED);
      this._facingLeft = true;
      this.state = onGround ? 'run' : 'jump';
    } else if (cursors.right.isDown) {
      body.setVelocityX(SPEED);
      this._facingLeft = false;
      this.state = onGround ? 'run' : 'jump';
    } else {
      body.setVelocityX(0);
      this.state = onGround ? 'idle' : 'jump';
    }

    // ── Jump ─────────────────────────────────────────────────────────────────
    if ((cursors.up.isDown || cursors.space.isDown) && onGround) {
      body.setVelocityY(JUMP);
      this.state = 'jump';
    }

    this._applyAnimFrame(now);
  }

  /**
   * Shows the given pose, cycling through its frames if it has several.
   * @param {string} pose
   * @param {number} [frame=0]
   */
  _show(pose, frame = 0) {
    const keys = this._frames[pose];
    if (keys && keys.length) applyJackFrame(this.art, keys[frame % keys.length]);
  }

  /**
   * Advances the animation clock and swaps frames for idle/run/jump.
   * @param {number} now
   */
  _applyAnimFrame(now) {
    if (this.state === 'jump') {
      this._show(this.body.velocity.y > FALL_VELOCITY ? 'fall' : 'jump');
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
