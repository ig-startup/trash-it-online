import Phaser from 'phaser';
import Player from '../entities/Player.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import SocketManager from '../network/SocketManager.js';
import { EVENTS, PLAYER_COLORS, HAMMER_FORCE } from '../../../shared/constants.mjs';
import { getLevel, nextLevelId, DEFAULT_LEVEL_ID } from '../levels';
import { WORLD_COLORS } from '../palette';
import { buildBackground } from '../entities/drawBackground';
import { preloadRealJackFrames } from '../entities/jackSprites';
import { preloadProps, hasProps, PROP_ANIMS, applyPropFrame } from '../entities/props';

const PLAYER_UPDATE_INTERVAL = 50; // ms
const FORCE_MAX_DEPTH = 12;  // how far one blow may travel down a stack
const SUPPORT_GAP = 2;       // px of slack when deciding what rests on what
/** Player states during which a swing connects (see STATES in Player.js). */
const STRIKE_STATES = new Set(['strikeSide', 'strikeOver']);
const RUBBLE_LIMIT = 120;    // pieces kept on screen before the oldest goes
const RUBBLE_SPREAD = 90;    // px/s sideways, randomised as the game does
const RUBBLE_LIFT = 260;     // px/s upward kick


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
    this._levelId = data.levelId || DEFAULT_LEVEL_ID;
    this._myPlayerId = data.myPlayerId || (data.players && data.players[0] ? data.players[0].id : 'local');
    this._hostId = data.hostId || null;
  }

  preload() {
    preloadRealJackFrames(this);
    preloadProps(this);

    // Levels converted from the original game bring their own artwork:
    // one texture per building block plus the wall behind them.
    const level = getLevel(this._levelId);
    this._level = level;
    if (level.background) {
      this.load.image(this._bgKey(level), level.background);
    }
    if (level.shapeAtlas) {
      // All of a level's block artwork in one packed texture.
      this.load.atlas(this._atlasKey(level),
        level.shapeAtlas.image, level.shapeAtlas.data);
    }
  }

  /** @returns {string} texture key for a level's background wall */
  _bgKey(level) {
    return `lvlbg_${level.id}`;
  }

  /** @returns {string} texture key for a level's packed block artwork */
  _atlasKey(level) {
    return `shapes_${level.id}`;
  }

  create() {
    const level = this._level || getLevel(this._levelId);
    const levelWidth = level.widthTiles * level.tileSize;
    const levelHeight = level.heightTiles * level.tileSize;

    // ── Background ────────────────────────────────────────────────────────────
    if (level.background && this.textures.exists(this._bgKey(level))) {
      // The original's own wall, repeated behind the level at its own
      // scale. It is only the wall: the floor strip along the bottom of
      // the `.SCN` screen is cropped off by the exporter, because tiling
      // it laid a grey band across the level every 200 pixels.
      const src = this.textures.get(this._bgKey(level)).getSourceImage();
      for (let y = 0; y < levelHeight; y += src.height) {
        for (let x = 0; x < levelWidth; x += src.width) {
          this.add.image(x, y, this._bgKey(level)).setOrigin(0, 0).setDepth(-10);
        }
      }
    } else {
      buildBackground(this, levelWidth, levelHeight);
    }

    // ── Platforms (concrete, original palette) ──────────────────────────────────
    this._platforms = this.physics.add.staticGroup();
    level.platforms.forEach((p) => {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const rect = this.add.rectangle(cx, cy, p.width, p.height, WORLD_COLORS.concrete);
      rect.setStrokeStyle(2, WORLD_COLORS.concreteDark);
      this.physics.add.existing(rect, true); // isStatic = true
      this._platforms.add(rect);
    });

    // ── Ground ──────────────────────────────────────────────────────────────
    // Invisible: the level artwork already draws the ground. This is only
    // the body that stops the players falling out of the world, and the
    // original's own start positions sit on it.
    if (level.ground) {
      const g = level.ground;
      const floor = this.add.rectangle(
        g.x + g.width / 2, g.y + g.height / 2, g.width, g.height,
      ).setVisible(false);
      this.physics.add.existing(floor, true);
      this._platforms.add(floor);
    }

    // ── Destructibles (rubble, original palette) ────────────────────────────────
    this._destructibles = this.physics.add.staticGroup();
    this._destructibleMap = new Map(); // id → { rect, hp }
    level.destructibles.forEach((d) => {
      const cx = d.x + d.width / 2;
      const cy = d.y + d.height / 2;
      const atlasKey = this._atlasKey(level);
      const hasShape = d.shape && this.textures.exists(atlasKey)
        && this.textures.get(atlasKey).has(d.shape);

      let rect;
      if (hasShape) {
        // Real block from the original: the frame is exactly the object's
        // size, so the static body matches it without any tweaking.
        rect = this.physics.add.staticImage(cx, cy, atlasKey, d.shape);
      } else {
        rect = this.add.rectangle(cx, cy, d.width, d.height, WORLD_COLORS.rubbleBrown);
        rect.setStrokeStyle(2, WORLD_COLORS.rubbleDark);
        this.physics.add.existing(rect, true);
      }
      this._destructibles.add(rect);
      this._destructibleMap.set(d.id, {
        rect, id: d.id, hp: d.hp, solid: !!d.solid,
        // Zero for every block a level file describes; see _applyForce.
        resistance: d.resistance || 0,
        width: d.width, height: d.height,
      });
    });

    // ── Bell (original palette gold) ────────────────────────────────────────────
    const bell = level.bell;
    if (hasProps(this)) {
      this._bellGraphics = this.add.image(bell.x, bell.y, PROP_ANIMS.bell[0]);
      applyPropFrame(this._bellGraphics, PROP_ANIMS.bell[0]);
    } else {
      this._bellGraphics = this.add.circle(bell.x, bell.y, 20, WORLD_COLORS.bell);
    }
    this.physics.add.existing(this._bellGraphics, true);
    this._bellHit = false;

    // ── Local player ─────────────────────────────────────────────────────────
    const myPlayerData = this._players.find((p) => p.id === this._myPlayerId)
      || this._players[0]
      || { id: 'local', color: '#ff4444' };

    const spawnIndex = this._players.findIndex((p) => p.id === myPlayerData.id);
    const spawn = level.spawnPoints[Math.max(0, spawnIndex)] || level.spawnPoints[0];

    this._spawn = spawn;
    this._levelHeight = levelHeight;
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

    /** Debris from smashed blocks, oldest first. */
    this._rubble = [];

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

  update(time, delta) {
    if (!this._player || !this._cursors) return;

    // Combine Z and X as hammer keys
    // Either key swings, and a tap shorter than a frame still counts:
    // JustDown latches it, where testing isDown would miss a key that was
    // already back up by the time we looked.
    const swing = Phaser.Input.Keyboard.JustDown(this._hammerKey)
      || Phaser.Input.Keyboard.JustDown(this._hammerKeyAlt)
      || this._hammerKey.isDown || this._hammerKeyAlt.isDown;

    this._player.update(this._cursors, swing, delta);

    // ── Hammer interactions ───────────────────────────────────────────────────
    // Both strikes count. This used to test for a state called 'hammer',
    // which stopped existing when the player was rebuilt on the game's own
    // state names — and with it, so did every hit.
    if (STRIKE_STATES.has(this._player.state)) {
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

    // ── Fell out of the level ─────────────────────────────────────────────────
    // Levels converted from the original are open at the bottom, so a missed
    // jump drops you into nothing. Put the player back on the start ledge.
    if (this._player.y > this._levelHeight + 120) {
      this._player.setPosition(this._spawn.x, this._spawn.y);
      this._player.body.setVelocity(0, 0);
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

  /**
   * The patch of world a hammer blow reaches: a small box in front of Jack,
   * at chest height. Using his whole body would smash whatever he is
   * standing on, which on a level built from the original's own blocks means
   * knocking the floor out from under himself on every swing.
   */
  _hammerReach() {
    const b = this._player.getBounds();
    const reach = 18;
    const x = this._player.facingLeft ? b.left - reach : b.right;
    return new Phaser.Geom.Rectangle(x, b.top + b.height * 0.25, reach, b.height * 0.6);
  }

  _checkHammerDestructibles() {
    const reach = this._hammerReach();
    const struck = [];
    this._destructibleMap.forEach((entry) => {
      if (!entry.rect.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(reach, entry.rect.getBounds())) {
        struck.push(entry);
      }
    });
    struck.forEach((entry) => this._applyForce(entry, HAMMER_FORCE, 0));
  }

  /**
   * One blow, the way the original spreads it (VA 0x689e6).
   *
   * A hit is a *force*, not a kill: the block subtracts it from its hit
   * points and only goes when it runs out. Before that the force carries
   * on into whatever is holding the block up, recursively, so smashing
   * the top of a stack presses down through the supports and the weakest
   * link gives way.
   *
   * The gate is the game's own, including the part that matters: an
   * object only passes a blow on if its *resistance* is non-zero and the
   * force is more than twice it. Blocks loaded from a level never get a
   * resistance — the loader does not set that field and nothing else
   * fills it — so in the original a blow stops at the block it lands on,
   * and the recursion is there for the spawned objects that do carry
   * one. Keeping the real condition means this behaves as the game does
   * today, and starts cascading by itself if the field's source is ever
   * found and the exporter fills it in.
   *
   * @param {object} entry the block from `_destructibleMap`
   * @param {number} force
   * @param {number} depth guard against a pathological chain
   */
  _applyForce(entry, force, depth) {
    if (!entry || !entry.rect.active || entry.solid) return;
    if (depth < FORCE_MAX_DEPTH && entry.resistance > 0
        && Math.floor(force / entry.resistance) > 2) {
      this._blocksUnder(entry).forEach((below) => {
        this._applyForce(below, force, depth + 1);
      });
    }

    entry.hp -= force;
    const sm = SocketManager.getInstance();
    if (sm.socket) sm.emit(EVENTS.OBJECT_HIT, { objectId: entry.id, force });

    if (entry.hp <= 0) {
      this._throwRubble(entry);
      entry.rect.destroy();
      this._destructibles.remove(entry.rect, true, true);
      this._destructibleMap.delete(entry.id);
      // `this.emit` used to be called here. A Phaser Scene is not an
      // EventEmitter — it has `events` — so every block destroyed threw
      // "this.emit is not a function" out of the update loop.
    } else if (entry.rect.setFillStyle) {
      entry.rect.setFillStyle(WORLD_COLORS.rubbleDark); // plain rectangle
    } else {
      entry.rect.setTint(0x996655); // real block: darken the artwork
    }
  }

  /**
   * A smashed block does not vanish. The game turns it into a piece of
   * rubble with a randomised velocity and lets it fall
   * (`remove_object_data`, VA 0x68724): the block's own artwork is kept
   * and only its draw routine is swapped, and the spread comes from two
   * bit masks on the hammer's record — every value in those columns is
   * 2^n-1, which is how you mask a random number.
   *
   * The debris is what is left lying about afterwards, and in the
   * original it is what the hoover is for. Ours lands and stays; the
   * hoover is not built yet.
   */
  _throwRubble(entry) {
    if (this._rubble.length >= RUBBLE_LIMIT) {
      const oldest = this._rubble.shift();
      if (oldest && oldest.active) oldest.destroy();
    }
    const src = entry.rect;
    const piece = src.texture && src.frame
      ? this.add.image(src.x, src.y, src.texture.key, src.frame.name)
      : this.add.rectangle(src.x, src.y, entry.width, entry.height,
        WORLD_COLORS.rubbleBrown);
    piece.setDepth(1);   // in front of the blocks, behind the HUD
    this.physics.add.existing(piece);
    piece.body.setVelocity(
      Phaser.Math.Between(-RUBBLE_SPREAD, RUBBLE_SPREAD),
      Phaser.Math.Between(-RUBBLE_LIFT, -RUBBLE_LIFT / 3),
    );
    piece.body.setCollideWorldBounds(false);
    this.physics.add.collider(piece, this._platforms);
    this.physics.add.collider(piece, this._destructibles);
    this._rubble.push(piece);
  }

  /** Blocks whose top edge rests on this one's bottom edge. */
  _blocksUnder(entry) {
    const out = [];
    const bottom = entry.rect.y + entry.height / 2;
    const left = entry.rect.x - entry.width / 2;
    const right = entry.rect.x + entry.width / 2;
    this._destructibleMap.forEach((other) => {
      if (other === entry || !other.rect.active) return;
      const top = other.rect.y - other.height / 2;
      if (Math.abs(top - bottom) > SUPPORT_GAP) return;
      const oLeft = other.rect.x - other.width / 2;
      const oRight = other.rect.x + other.width / 2;
      if (oRight > left && oLeft < right) out.push(other);
    });
    return out;
  }

  _checkHammerBell() {
    if (this._bellHit || !this._bellGraphics || !this._bellGraphics.active) return;

    const playerBounds = this._player.getBounds();
    const bellBounds = this._bellGraphics.getBounds();

    // The bell is the goal, so touching it anywhere counts.
    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, bellBounds)) {
      this._bellHit = true;
      if (this._bellGraphics.setFillStyle) this._bellGraphics.setFillStyle(0xffffff);
      else this._bellGraphics.setTint(0xffffff);
      console.log('[GameScene] bell_hit!');

      // Send to server only once (flag prevents repeat)
      const sm = SocketManager.getInstance();
      if (sm.socket) {
        sm.emit(EVENTS.BELL_HIT, { playerId: this._myPlayerId });
      } else {
        // Solo / offline: nobody else is going to advance the level.
        this.showResultOverlay('УРОВЕНЬ ПРОЙДЕН', 'Колокольчик твой',
          { nextLevel: nextLevelId(this._levelId) });
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
      this._player.facingLeft ? 'left' : 'right',
    );
  }

  /**
   * Show full-screen result overlay with countdown to MenuScene.
   * @param {string} title
   * @param {string} subtitle
   */
  /**
   * Restarts this scene on another level, keeping the room's players.
   * @param {string} levelId
   */
  _startLevel(levelId) {
    this.scene.restart({
      roomCode: this._roomCode,
      players: this._players,
      mode: this._mode,
      levelId,
      myPlayerId: this._myPlayerId,
      hostId: this._hostId,
    });
  }

  /**
   * @param {string} title
   * @param {string} subtitle
   * @param {{ nextLevel?: string }} [options] when a level id is given the
   *   overlay counts down to it instead of back to the menu. Online the
   *   server's `game_started` gets there first; this is the offline path.
   */
  showResultOverlay(title, subtitle, options = {}) {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // Semi-transparent black background
    this.add.rectangle(cx, cy, width, height, 0x000000, 0.75)
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
    const { nextLevel } = options;
    const label = (n) => (nextLevel
      ? `Следующий уровень через ${n}...`
      : `Возврат в меню через ${n}...`);
    let countdown = 3;
    const countdownText = this.add.text(cx, cy + 60, label(countdown), {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    const timer = this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        countdown -= 1;
        if (countdown > 0) {
          countdownText.setText(label(countdown));
        } else if (nextLevel) {
          this._startLevel(nextLevel);
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

    // This scene restarts on every new level, so its handlers have to go
    // with it — otherwise each level would add another copy.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      [EVENTS.PLAYER_UPDATE, EVENTS.PLAYER_JOINED, EVENTS.PLAYER_LEFT,
        EVENTS.OBJECT_DESTROYED, EVENTS.GAME_STARTED, EVENTS.LEVEL_COMPLETE,
        EVENTS.LEVEL_FAILED, EVENTS.TIMER_TICK].forEach((e) => sm.off(e));
    });

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
      const level = this._level || getLevel(this._levelId);
      players.forEach((p, idx) => {
        if (p.id === this._myPlayerId) return;
        const spawn = level.spawnPoints[Math.max(0, idx)] || level.spawnPoints[0];
        const color = p.color || PLAYER_COLORS[idx % PLAYER_COLORS.length];
        const rp = new RemotePlayer(this, spawn.x, spawn.y, color, p.id, p.name || p.id);
        this.remotePlayers.set(p.id, rp);
      });
    });

    // The room moved on to another level
    sm.on(EVENTS.GAME_STARTED, (data = {}) => {
      if (data.levelId) this._startLevel(data.levelId);
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
