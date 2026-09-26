/**
 * Offline dev harness — runs the real GameScene without the game server.
 *
 * Useful for checking artwork and feel: it boots straight into a level with
 * a fake player list, and GameScene's socket handlers no-op when there is no
 * connection, so nothing else is needed.
 *
 * Build and serve it with esbuild alone (no npm needed):
 *
 *   ./node_modules/@esbuild/darwin-arm64/bin/esbuild dev/preview.js \
 *       --bundle --format=iife --outfile=/tmp/preview/preview.js
 *   cp -r public/* /tmp/preview/ && python3 -m http.server -d /tmp/preview
 *
 * Pass ?level=level_01 to load the hand-built level instead.
 */
import Phaser from 'phaser';
import GameScene from '../src/scenes/GameScene.js';
import { DEFAULT_LEVEL_ID } from '../src/levels/index.js';
import { PLAYER_COLORS } from '../../shared/constants.mjs';

const levelId = new URLSearchParams(window.location.search).get('level')
  || DEFAULT_LEVEL_ID;

const players = PLAYER_COLORS.map((color, i) => ({
  id: `p${i}`, name: `Jack ${i + 1}`, color,
}));

class DevBoot extends Phaser.Scene {
  constructor() { super({ key: 'DevBoot' }); }

  create() {
    this.scene.start('GameScene', {
      roomCode: 'DEV', players, mode: 'coop', levelId, myPlayerId: 'p0',
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  physics: { default: 'arcade', arcade: { gravity: { y: 800 }, debug: false } },
  scene: [DevBoot, GameScene],
});
