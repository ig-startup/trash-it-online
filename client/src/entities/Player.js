import Phaser from 'phaser';

const SPEED = 200;
const JUMP = -450;
const FULL_HEIGHT = 48;
const CROUCH_HEIGHT = 24;
const PLAYER_WIDTH = 32;
const HAMMER_DURATION = 300;

/**
 * Player — local player entity.
 * Rendered as a colored rectangle (no sprites for MVP).
 * Extends Phaser.Physics.Arcade.Image using a generated texture.
 */
export default class Player extends Phaser.Physics.Arcade.Image {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color, e.g. '#ff4444'
   * @param {string} playerId
   * @param {boolean} isLocal
   */
  constructor(scene, x, y, color, playerId, isLocal = true) {
    // Build a small colored texture so we can use Image
    const textureKey = `player_rect_${playerId}`;
    if (!scene.textures.exists(textureKey)) {
      const gfx = scene.make.graphics({ x: 0, y: 0, add: false });
      const colorInt = Phaser.Display.Color.HexStringToColor(color).color;
      gfx.fillStyle(colorInt, 1);
      gfx.fillRect(0, 0, PLAYER_WIDTH, FULL_HEIGHT);
      // Darker head accent
      gfx.fillStyle(colorInt & 0xaaaaaa, 1);
      gfx.fillRect(6, 4, PLAYER_WIDTH - 12, 14);
      gfx.generateTexture(textureKey, PLAYER_WIDTH, FULL_HEIGHT);
      gfx.destroy();
    }

    super(scene, x, y, textureKey);

    this.playerId = playerId;
    this.playerColor = color;
    this.isLocal = isLocal;

    /** @type {'idle'|'run'|'jump'|'crouch'|'hammer'} */
    this.state = 'idle';

    this._hammerTimer = 0;
    this._isCrouching = false;
    this._bellHit = false; // prevent repeated bell events

    // Add to scene and enable physics
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
    this.body.setOffset(0, 0);
    this.setOrigin(0.5, 1); // feet at y
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
      if (now >= this._hammerTimer) {
        this.state = onGround ? 'idle' : 'jump';
        this.clearTint();
      }
      // During hammer swing block all other input
      body.setVelocityX(0);
      return;
    }

    // ── Hammer trigger ───────────────────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(hammerKey) && onGround) {
      this.state = 'hammer';
      this._hammerTimer = now + HAMMER_DURATION;
      this.setTint(0xffffff);
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
        this.setAlpha(0.7);
      }
      this.state = 'crouch';
      body.setVelocityX(0);
      return;
    } else if (this._isCrouching) {
      this._isCrouching = false;
      body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
      body.setOffset(0, 0);
      this.setAlpha(1);
    }

    // ── Horizontal movement ───────────────────────────────────────────────────
    if (cursors.left.isDown) {
      body.setVelocityX(-SPEED);
      this.setFlipX(true);
      this.state = onGround ? 'run' : 'jump';
    } else if (cursors.right.isDown) {
      body.setVelocityX(SPEED);
      this.setFlipX(false);
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
}
