import Phaser from 'phaser';
import MenuScene from './scenes/MenuScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import GameScene from './scenes/GameScene.js';

class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Assets will be loaded here in future tasks
  }

  create() {
    console.log('[BootScene] ready');
    this.scene.start('MenuScene');
  }
}

const config = {
  type: Phaser.AUTO,
  // Every texture here is 1997 pixel art; without this the browser
  // smooths it and the brickwork turns to mush.
  pixelArt: true,
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 800 },
      debug: false,
    },
  },
  scene: [BootScene, MenuScene, LobbyScene, GameScene],
};

const game = new Phaser.Game(config);

// Exposed on purpose. The client is checked by driving a headless browser
// (see the session notes), and reading the real scene beats inferring the
// game's state from screenshots of the debug HUD.
window.game = game;

export default game;
