import Phaser from 'phaser';

const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 48;

/**
 * RemotePlayer — visual representation of another player received via network.
 * Uses linear interpolation to smoothly move towards the server-reported position.
 */
export default class RemotePlayer extends Phaser.GameObjects.Rectangle {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color string, e.g. '#4444ff'
   * @param {string} playerId
   * @param {string} [playerName]
   */
  constructor(scene, x, y, color, playerId, playerName = 'Player') {
    const colorInt = Phaser.Display.Color.HexStringToColor(color).color;
    super(scene, x, y, PLAYER_WIDTH, PLAYER_HEIGHT, colorInt);

    this.playerId = playerId;
    this.playerName = playerName;

    /** Target position received from server */
    this.targetX = x;
    this.targetY = y;

    /** Direction: 'left' | 'right' */
    this.dir = 'right';

    // Add rectangle to scene
    scene.add.existing(this);

    // Name label above the rectangle
    this.nameText = scene.add.text(x, y - PLAYER_HEIGHT / 2 - 10, playerName, {
      fontSize: '11px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 1);

    console.log(`[RemotePlayer] created id=${playerId} name=${playerName} color=${color}`);
  }

  /**
   * Called every frame from GameScene.update().
   * Interpolates current position towards target.
   */
  update() {
    this.x += (this.targetX - this.x) * 0.2;
    this.y += (this.targetY - this.y) * 0.2;

    // Keep name label above the rectangle
    this.nameText.setPosition(this.x, this.y - PLAYER_HEIGHT / 2 - 4);

    // Horizontal flip based on direction
    this.scaleX = this.dir === 'left' ? -1 : 1;
  }

  /**
   * Apply a position/state update received from the server.
   * @param {{ x: number, y: number, state: string, dir: string }} update
   */
  applyUpdate({ x, y, state, dir }) {
    if (x !== undefined) this.targetX = x;
    if (y !== undefined) this.targetY = y;
    if (dir !== undefined) this.dir = dir;
    // state can be used later for animation
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
