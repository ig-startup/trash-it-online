import Phaser from 'phaser';
import { ensureJackTextures, applyJackFrame, FULL_HEIGHT } from './drawJack';

const RUN_FRAME_MS = 70;
const IDLE_FRAME_MS = 500;

/**
 * RemotePlayer — visual representation of another player received via network.
 * Drawn with the same real frames as the local player (see jackSprites.js),
 * in the room's per-player overalls colour.
 * Uses linear interpolation to smoothly move towards the server-reported position.
 */
export default class RemotePlayer extends Phaser.GameObjects.Image {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color string, e.g. '#4444ff' — overalls tint
   * @param {string} playerId
   * @param {string} [playerName]
   */
  constructor(scene, x, y, color, playerId, playerName = 'Player') {
    const frames = ensureJackTextures(scene, playerId, color);
    super(scene, x, y, frames.idle[0]);
    // applyJackFrame sets the origin per frame, from the sprite sheet's own
    // anchor, so Jack's feet land on (x, y) whichever pose is showing.
    applyJackFrame(this, frames.idle[0], true);

    this._frames = frames;
    this.playerId = playerId;
    this.playerName = playerName;

    /** Target position received from server */
    this.targetX = x;
    this.targetY = y;

    /** Direction: 'left' | 'right' */
    this.dir = 'right';
    /** @type {'idle'|'run'|'jump'|'crouch'|'hammer'} */
    this._remoteState = 'idle';
    this._animTimer = 0;
    this._animFrame = 0;

    // Add to scene
    scene.add.existing(this);

    // Name label above the sprite
    this.nameText = scene.add.text(x, y - FULL_HEIGHT - 10, playerName, {
      fontSize: '11px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 1);

    console.log(`[RemotePlayer] created id=${playerId} name=${playerName} color=${color}`);
  }

  /**
   * Called every frame from GameScene.update().
   * Interpolates current position towards target and advances the frame animation.
   */
  update() {
    this.x += (this.targetX - this.x) * 0.2;
    this.y += (this.targetY - this.y) * 0.2;

    // Keep name label above the sprite
    this.nameText.setPosition(this.x, this.y - FULL_HEIGHT - 4);

    // Horizontal flip based on direction
    this.setFlipX(this.dir === 'left');

    const now = this.scene.time.now;
    if (this._remoteState === 'hammer') {
      // Mid-swing: the strike's own frames are not synced, so pick the
      // middle of the sideways one rather than send 18 frames over the wire.
      this._show('hammerSide', Math.floor(this._frameCount('hammerSide') / 2));
    } else if (this._remoteState === 'jump') {
      this._show('jump');
    } else if (this._remoteState === 'helmet') {
      if (now - this._animTimer >= RUN_FRAME_MS) {
        this._animTimer = now;
        this._animFrame += 1;
      }
      this._show('helmetMove', this._animFrame);
    } else if (this._remoteState === 'skid') {
      this._show('skid');
    } else if (this._remoteState === 'run') {
      if (now - this._animTimer >= RUN_FRAME_MS) {
        this._animTimer = now;
        this._animFrame += 1;
      }
      this._show('run', this._animFrame);
    } else {
      if (now - this._animTimer >= IDLE_FRAME_MS) {
        this._animTimer = now;
        this._animFrame += 1;
      }
      this._show('idle', this._animFrame);
    }
  }

  /**
   * Shows the given pose, cycling through its frames if it has several.
   * @param {string} pose
   * @param {number} [frame=0]
   */
  _frameCount(pose) {
    const keys = this._frames[pose];
    return keys && keys.length ? keys.length : 1;
  }

  _show(pose, frame = 0) {
    const keys = this._frames[pose];
    if (keys && keys.length) applyJackFrame(this, keys[frame % keys.length]);
  }

  /**
   * Apply a position/state update received from the server.
   * @param {{ x: number, y: number, state: string, dir: string }} update
   */
  applyUpdate({ x, y, state, dir }) {
    if (x !== undefined) this.targetX = x;
    if (y !== undefined) this.targetY = y;
    if (dir !== undefined) this.dir = dir;
    if (state !== undefined) this._remoteState = state;
  }

  /**
   * Override destroy to also remove the name label.
   */
  destroy(fromScene) {
    if (this.nameText) {
      this.nameText.destroy();
      this.nameText = null;
    }
    super.destroy(fromScene);
    console.log(`[RemotePlayer] destroyed id=${this.playerId}`);
  }
}
