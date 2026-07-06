import Phaser from 'phaser';
import Player from '../entities/Player.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import SocketManager from '../network/SocketManager.js';
import { EVENTS, PLAYER_COLORS } from '../../../shared/constants.mjs';
import levelData from '../levels/level01.json';

const PLAYER_UPDATE_INTERVAL = 50; // ms

/**
 * GameScene — main gameplay scene.
 * Loads level from level01.json, renders platforms/destructibles/bell,
 * spawns the local player with Arcade Physics.
 * Network sync (RemotePlayer, SocketManager) is added in T7.
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init(data) {
    this._roomCode = data.roomCode || '';
    this._players = data.players || [];
    this._mode = data.mode || 'coop';
    this._levelId = data.levelId || 'level_01';
    this._myPlayerId = data.myPlayerId || (data.players && data.players[0] ? data.players[0].id : 'local');
    this._hostId = data.hostId || null;
  }

  preload() {
    // No assets — primitives only for MVP
  }

  create() {
    const level = levelData;
    const levelWidth = level.widthTiles * level.tileSize;   // 3200
    const levelHeight = level.heightTiles * level.tileSize; // 640

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(levelWidth / 2, levelHeight / 2, levelWidth, levelHeight, 0x1a1a2e);

    // ── Platforms (static, grey) ──────────────────────────────────────────────
    this._platforms = this.physics.add.staticGroup();
    level.platforms.forEach((p) => {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const rect = this.add.rectangle(cx, cy, p.width, p.height, 0x668866);
      this.physics.add.existing(rect, true); // isStatic = true
      this._platforms.add(rect);
    });

    // ── Destructibles (dynamic, brown) ───────────────────────────────────────
    this._destructibles = this.physics.add.staticGroup();
    this._destructibleMap = new Map(); // id → { rect, hp }
    level.destructibles.forEach((d) => {
      const cx = d.x + d.width / 2;
      const cy = d.y + d.height / 2;
      const rect = this.add.rectangle(cx, cy, d.width, d.height, 0x885533);
      this.physics.add.existing(rect, true);
      this._destructibles.add(rect);
      this._destructibleMap.set(d.id, { rect, hp: d.hp, id: d.id });
    });

    // ── Bell (yellow circle) ──────────────────────────────────────────────────
    const bell = level.bell;
    this._bellGraphics = this.add.circle(bell.x, bell.y, 20, 0xffdd00);
    this.physics.add.existing(this._bellGraphics, true);
    this._bellHit = false;

    // ── Local player ─────────────────────────────────────────────────────────
    const myPlayerData = this._players.find((p) => p.id === this._myPlayerId)
      || this._players[0]
      || { id: 'local', color: '#ff4444' };

    const spawnIndex = this._players.findIndex((p) => p.id === myPlayerData.id);
    const spawn = level.spawnPoints[Math.max(0, spawnIndex)] || level.spawnPoints[0];

    this._player = new Player(
      this,
      spawn.x,
      spawn.y,
      myPlayerData.color || '#ff4444',
      myPlayerData.id,
      true,
    );

    // Colliders
    this.physics.add.collider(this._player, this._platforms);
    this.physics.add.collider(this._player, this._destructibles);

    // ── Input ─────────────────────────────────────────────────────────────────
    this._cursors = this.input.keyboard.createCursorKeys();
    this._hammerKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    // Also support X as alt hammer key
    this._hammerKeyAlt = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    // ── Camera ────────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, levelWidth, levelHeight);
    this.cameras.main.startFollow(this._player, true, 0.1, 0.1);

    // ── HUD ───────────────────────────────────────────────────────────────────

    // Timer — centered at top
    this.timerText = this.add.text(400, 16, '3:00', {
      fontSize: '32px',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);

    // Mode label — top right
    const modeLabel = this._mode === 'race' ? 'ГОНКА' : 'КООП';
    this._modeLabelText = this.add.text(784, 16, modeLabel, {
      fontSize: '20px',
      fill: '#ffff00',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);

    // Player list — top left (colored icon + name per player)
    this._playerListObjects = [];
    const playersData = this._players || [];
    playersData.forEach((p, idx) => {
      const yPos = 16 + idx * 28;
      const colorHex = parseInt((p.color || '#ffffff').replace('#', ''), 16);
      const icon = this.add.rectangle(16, yPos + 8, 16, 16, colorHex)
        .setScrollFactor(0).setDepth(10);
      const nameLabel = this.add.text(30, yPos, p.name || p.id, {
        fontSize: '14px',
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      }).setScrollFactor(0).setDepth(10);
      this._playerListObjects.push(icon, nameLabel);
    });

    // Small room/mode debug line — top left below player list
    this._modeText = this.add.text(10, 10, `${this._mode === 'race' ? 'ГОНКА' : 'КООП'} | ${this._roomCode}`, {
      fontSize: '11px',
      color: '#555555',
    }).setScrollFactor(0);

    this._debugText = this.add.text(10, 28, '', {
      fontSize: '11px',
      color: '#556655',
    }).setScrollFactor(0);

    // ── Throttle timestamp ────────────────────────────────────────────────────
    this._lastUpdateSent = 0;

    // ── Remote players ────────────────────────────────────────────────────────
    this.remotePlayers = new Map();

    // ── Socket event handlers ─────────────────────────────────────────────────
    this._initSocketHandlers();

    console.log('[GameScene] created', {
      levelId: this._levelId,
      mode: this._mode,
      players: this._players.length,
      spawn,
    });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(time) {
    if (!this._player || !this._cursors) return;

    // Combine Z and X as hammer keys
    const hammerActive = this._hammerKey.isDown
      ? this._hammerKey
      : this._hammerKeyAlt;

    this._player.update(this._cursors, hammerActive);

    // ── Hammer interactions ───────────────────────────────────────────────────
    if (this._player.state === 'hammer') {
      this._checkHammerDestructibles();
      this._checkHammerBell();
    } else {
      this._player.bellHit = false; // reset so bell can be hit again after leaving
    }

    // ── Throttled player update (for future socket send) ──────────────────────
    if (time - this._lastUpdateSent >= PLAYER_UPDATE_INTERVAL) {
      this._lastUpdateSent = time;
      this._emitPlayerUpdate();
    }

    // ── Remote players interpolation ──────────────────────────────────────────
    this.remotePlayers.forEach((rp) => rp.update());

    // ── Debug HUD ─────────────────────────────────────────────────────────────
    const b = this._player.body;
    this._debugText.setText(
      `x:${Math.round(this._player.x)} y:${Math.round(this._player.y)} state:${this._player.state} vx:${Math.round(b.velocity.x)} vy:${Math.round(b.velocity.y)}`,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _checkHammerDestructibles() {
    this._destructibleMap.forEach((entry) => {
      if (!entry.rect.active) return;

      const playerBounds = this._player.getBounds();
      const rectBounds = entry.rect.getBounds();

      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, rectBounds)) {
        entry.hp -= 1;
        console.log(`[GameScene] hit destructible ${entry.id}, hp left: ${entry.hp}`);

        if (entry.hp <= 0) {
          entry.rect.destroy();
          this._destructibles.remove(entry.rect, true, true);
          this._destructibleMap.delete(entry.id);
          this.emit('object_hit', { objectId: entry.id });
          console.log(`[GameScene] object_destroyed: ${entry.id}`);
        } else {
          // Darken to show damage
          entry.rect.setFillStyle(0x663311);
        }
      }
    });
  }

  _checkHammerBell() {
    if (this._bellHit || !this._bellGraphics || !this._bellGraphics.active) return;

    const playerBounds = this._player.getBounds();
    const bellBounds = this._bellGraphics.getBounds();

    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, bellBounds)) {
      this._bellHit = true;
      this._bellGraphics.setFillStyle(0xffffff);
      console.log('[GameScene] bell_hit!');

      // Send to server only once (flag prevents repeat)
      const sm = SocketManager.getInstance();
      if (sm.socket) {
        sm.emit(EVENTS.BELL_HIT, { playerId: this._myPlayerId });
      }
    }
  }

  /**
   * Send local player position to server via SocketManager.
   */
  _emitPlayerUpdate() {
    if (!this._player) return;
    const sm = SocketManager.getInstance();
    if (!sm.socket) return; // not connected — skip silently
    sm.sendPlayerUpdate(
      this._player.x,
      this._player.y,
      this._player.state,
      this._player.flipX ? 'left' : 'right',
    );
  }

  /**
   * Show full-screen result overlay with countdown to MenuScene.
   * @param {string} title
   * @param {string} subtitle
   */
  showResultOverlay(title, subtitle) {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // Semi-transparent black background
    const bg = this.add.rectangle(cx, cy, width, height, 0x000000, 0.75)
      .setScrollFactor(0)
      .setDepth(100);

    // Title text
    this.add.text(cx, cy - 60, title, {
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    // Subtitle text
    this.add.text(cx, cy, subtitle, {
      fontSize: '24px',
      color: '#cccccc',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    // Countdown text
    let countdown = 3;
    const countdownText = this.add.text(cx, cy + 60, `Возврат в меню через ${countdown}...`, {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    const timer = this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        countdown -= 1;
        if (countdown > 0) {
          countdownText.setText(`Возврат в меню через ${countdown}...`);
        } else {
          timer.remove();
          this.scene.start('MenuScene');
        }
      },
    });
  }

  /**
   * Wire socket events for multiplayer sync.
   * Called once from create().
   */
  _initSocketHandlers() {
    const sm = SocketManager.getInstance();
    if (!sm.socket) return; // offline / solo play — no-op

    // Another player moved
    sm.on(EVENTS.PLAYER_UPDATE, (data) => {
      const { playerId, x, y, state, dir } = data;
      if (!playerId || playerId === this._myPlayerId) return;

      let rp = this.remotePlayers.get(playerId);
      if (!rp) {
        // Unknown player appeared — create on the fly
        const color = PLAYER_COLORS[this.remotePlayers.size % PLAYER_COLORS.length];
        rp = new RemotePlayer(this, x, y, color, playerId, playerId);
        this.remotePlayers.set(playerId, rp);
      }
      rp.applyUpdate({ x, y, state, dir });
    });

    // A player disconnected
    sm.on(EVENTS.PLAYER_LEFT, ({ playerId } = {}) => {
      const rp = this.remotePlayers.get(playerId);
      if (rp) {
        rp.destroy();
        this.remotePlayers.delete(playerId);
      }
    });

    // Game started — create RemotePlayer for each other player
    sm.on(EVENTS.GAME_STARTED, (data = {}) => {
      const players = data.players || [];
      const level = levelData;
      players.forEach((p, idx) => {
        if (p.id === this._myPlayerId) return;
        const spawn = level.spawnPoints[Math.max(0, idx)] || level.spawnPoints[0];
        const color = p.color || PLAYER_COLORS[idx % PLAYER_COLORS.length];
        const rp = new RemotePlayer(this, spawn.x, spawn.y, color, p.id, p.name || p.id);
        this.remotePlayers.set(p.id, rp);
      });
    });

    // Level outcome overlays
    sm.on(EVENTS.LEVEL_COMPLETE, (data = {}) => {
      const { winnerId } = data;
      const myPlayerId = SocketManager.getInstance().playerId;

      if (winnerId === null || winnerId === undefined) {
        // Coop mode — everyone wins together
        this.showResultOverlay('КОМАНДА ПОБЕДИЛА!', 'Уровень пройден');
      } else if (winnerId === myPlayerId) {
        // Race mode — this player won
        this.showResultOverlay('ВЫ ПОБЕДИЛИ!', 'Первый у колокольчика');
      } else {
        // Race mode — another player won
        const winner = this._players.find((p) => p.id === winnerId);
        const winnerName = winner ? (winner.name || winner.id) : winnerId;
        this.showResultOverlay('ПОРАЖЕНИЕ', `Победил ${winnerName}`);
      }
    });

    sm.on(EVENTS.LEVEL_FAILED, () => {
      this.showResultOverlay('ВРЕМЯ ВЫШЛО', 'Попробуйте ещё раз');
    });

    // Timer tick — update HUD timer display
    sm.on(EVENTS.TIMER_TICK, (data) => {
      const timeLeft = data?.timeLeft ?? 0;
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
      if (timeLeft <= 30) {
        this.timerText.setStyle({ fill: '#ff4444', stroke: '#000000', strokeThickness: 4 });
      }
    });

    // An object was destroyed on the server side
    sm.on(EVENTS.OBJECT_DESTROYED, ({ objectId } = {}) => {
      const entry = this._destructibleMap.get(objectId);
      if (entry && entry.rect.active) {
        entry.rect.destroy();
        this._destructibles.remove(entry.rect, true, true);
        this._destructibleMap.delete(objectId);
      }
    });
  }
}
