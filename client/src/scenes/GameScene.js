import Phaser from 'phaser';
import Player from '../entities/Player.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import SocketManager from '../network/SocketManager.js';
import {
  EVENTS, PLAYER_COLORS, HAMMER, hammerForce,
} from '../../../shared/constants.mjs';
import { getLevel, nextLevelId, DEFAULT_LEVEL_ID } from '../levels';
import { WORLD_COLORS } from '../palette';
import { buildBackground } from '../entities/drawBackground';
import { preloadRealJackFrames } from '../entities/jackSprites';
import { preloadProps, hasProps, PROP_ANIMS, applyPropFrame } from '../entities/props';

const PLAYER_UPDATE_INTERVAL = 50; // ms
const FORCE_MAX_DEPTH = 12;  // how far one blow may travel down a stack
const FORCE_MAX_VISITS = 600; // guard: a blow decays fast, but not in one frame
const TILE = 8;              // px — the original's collision-map cell
/** Player states during which a swing connects (see STATES in Player.js). */
const STRIKE_STATES = new Set(['strikeSide', 'strikeOver']);
const RUBBLE_LIMIT = 120;    // pieces kept on screen before the oldest goes
const RUBBLE_SPREAD = 90;    // px/s sideways, randomised as the game does
const RUBBLE_LIFT = 260;     // px/s upward kick
const TIMMY_FRAME_MS = 120;  // timmy walk-cycle rate
const HOOVER_HEIGHT = 20;    // px above his feet the nozzle sits
const HOOVER_REACH = 110;    // px the suction reaches — ours, not the game's
const HOOVER_SWALLOW = 16;   // px at which a timmy is taken
const HOOVER_PULL = 3.2;     // px per tick a caught timmy is drawn in
const FUSE_MS = 900;         // how long the fuse burns — ours
// What the blast puts into each block it catches. Not traced: it is the
// figure the hammer used before the hammer's own was recovered, kept so
// dynamite still flattens what it did.
const BLAST_FORCE = 36864;
const BLAST_RADIUS = 96;     // px the blast reaches — ours
const BLAST_FRAME_MS = 45;


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
    // The original's collision map: one cell per 8x8 px holding the id of
    // the block occupying it (VA 0x40f330). A blow divides itself among the
    // *cells* under a block, so counting objects is not the same thing.
    this._tile = level.tileSize || TILE;
    this._gridW = (level.widthTiles || 1) + 2;
    this._cellOwner = new Map(); // ty * _gridW + tx → block id
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
      const entry = {
        rect, id: d.id, hp: d.hp, solid: !!d.solid,
        width: d.width, height: d.height,
        tx: Math.round(d.x / this._tile), ty: Math.round(d.y / this._tile),
        tw: Math.max(1, Math.round(d.width / this._tile)),
        th: Math.max(1, Math.round(d.height / this._tile)),
        mass: d.mass || 1,
      };
      this._destructibleMap.set(d.id, entry);
      this._stampCells(entry);
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

    // ── Timmies ───────────────────────────────────────────────────────────
    // The most common object in the game: about 2000 records across the
    // archive, from three classes that all spawn TIMMY.SPR. They are
    // drawn and counted here; collecting them is the hoover's job and
    // the hoover is not built, so nothing picks them up yet.
    this._timmies = [];
    (level.timmies || []).forEach((t) => {
      if (!hasProps(this)) return;
      const sprite = this.add.image(t.x, t.y, PROP_ANIMS.timmy[0]).setDepth(2);
      applyPropFrame(sprite, PROP_ANIMS.timmy[0]);
      sprite.setData('phase', Math.random() * 1000);
      this._timmies.push(sprite);
    });

    // ── Dynamite ──────────────────────────────────────────────────────────
    // 202 placements across 42 levels. The chain in the game is: a blow
    // arms it (VA 0x1d405, which also plays a sound), a fuse burns
    // (0x1d4ec), and the fuse spawns a blast that expands through its
    // own animation (0x1d584). The stages are the game's; the fuse
    // length and the blast's reach are ours.
    this._dynamite = [];
    (level.dynamite || []).forEach((d) => {
      if (!hasProps(this)) return;
      const stick = this.add.image(d.x, d.y, PROP_ANIMS.dyna[0]).setDepth(2);
      applyPropFrame(stick, PROP_ANIMS.dyna[0]);
      this._dynamite.push({ sprite: stick, lit: 0, pair: !!d.pair });
    });

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
    this._player.on('hammer_impact', (blow) => this._checkHammerDestructibles(blow));

    // Colliders
    this.physics.add.collider(this._player, this._platforms);
    this.physics.add.collider(this._player, this._destructibles);

    // ── Input ─────────────────────────────────────────────────────────────────
    this._cursors = this.input.keyboard.createCursorKeys();
    this._hammerKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    // Also support X as alt hammer key
    this._hammerKeyAlt = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    // The hoover. Ours, not the game's — see the note in Player.js STATES.
    this._hooverKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

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

    /** Timmies hoovered up. The game keeps this tally too. */
    this._timmyCount = 0;
    this._timmyText = this.add.text(16, 100, `ТИММИ ${this._timmyCount}`, {
      fontSize: '16px',
      fill: '#ffcc33',
      stroke: '#000000',
      strokeThickness: 3,
    }).setScrollFactor(0).setDepth(10);

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

    const hoover = Phaser.Input.Keyboard.JustDown(this._hooverKey);
    this._player.update(this._cursors, swing, delta, hoover);

    if (this._player.hooverOut) this._suckTimmies();

    // ── Hammer interactions ───────────────────────────────────────────────────
    // Blocks take the blow once, on the frame it lands (the player's
    // `hammer_impact`, wired in create). The bell only needs a touch.
    if (STRIKE_STATES.has(this._player.state)) {
      this._checkHammerBell();
    } else {
      this._player.bellHit = false; // reset so bell can be hit again after leaving
    }

    this._tickDynamite(time);

    // Timmies mill about on the spot; each keeps its own phase so they
    // do not step in unison.
    if (this._timmies.length) {
      const frames = PROP_ANIMS.timmy;
      this._timmies.forEach((t) => {
        if (!t.active) return;
        const i = Math.floor((time + t.getData('phase')) / TIMMY_FRAME_MS)
          % frames.length;
        applyPropFrame(t, frames[i]);
      });
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
   * The cells a blow lands in, in the order the original visits them
   * (VA 0x1f905): from Jack's own point — his feet, which is where the
   * client's body and the original's entity both sit — out by the hammer's
   * reach, then outward in steps of 8 (0, +8, -8, +16, …) for as far as its
   * extent allows, across before down. The sledge's extent is under one
   * step either way, so its blow is the single 8x8 cell just past the
   * hammer's head.
   * @returns {{x: number, y: number}[]} cell centres, level pixels
   */
  _hammerCells() {
    const { dx, dy, w, h } = HAMMER.reach;
    const dir = this._player.facingLeft ? -1 : 1;
    const ox = Math.round(this._player.x) + dir * dx;
    const oy = Math.round(this._player.y) + dy;
    const steps = (extent) => {
      const out = [0];
      for (let k = 8; k <= extent; k += 8) out.push(k, -k);
      return out;
    };
    const cells = [];
    steps(h).forEach((sy) => steps(w).forEach((sx) => {
      cells.push({
        x: Math.floor((ox + sx) / 8) * 8 + 4,
        y: Math.floor((oy + sy) / 8) * 8 + 4,
      });
    }));
    return cells;
  }

  /**
   * The overhead strike's box: from Jack's feet, `HAMMER.overBox` ahead
   * and down, mirrored when he faces left (VA 0x2f1d7).
   */
  _overheadBox() {
    const { dx, dy, w, h } = HAMMER.overBox;
    const x = Math.round(this._player.x);
    const left = this._player.facingLeft ? x - dx - w + 1 : x + dx;
    return new Phaser.Geom.Rectangle(left, Math.round(this._player.y) + dy, w, h);
  }

  /**
   * A blow landing. The sideways blow carries the hammer's ramp at the
   * charge it was let go with into the blocks under its cells, until
   * `HAMMER.strikes` have been struck. The overhead blow strikes no blocks
   * — in the game it goes to sprites only (VA 0x1fd94) — so here it only
   * reaches what is not a block.
   * @param {{charge: number, overhead: boolean}} blow
   */
  _checkHammerDestructibles({ charge, overhead }) {
    let reach;
    if (overhead) {
      reach = this._overheadBox();
    } else {
      const force = hammerForce(charge);
      const cells = this._hammerCells();
      const blocks = [...this._destructibleMap.values()].filter((e) => e.rect.active);
      let left = HAMMER.strikes;
      for (const c of cells) {
        if (left <= 0) break;
        const hit = blocks.find((e) => e.rect.active && e.rect.getBounds().contains(c.x, c.y));
        if (!hit) continue;
        this._applyForce(hit, force, 0);
        left -= 1;
      }
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      reach = new Phaser.Geom.Rectangle(Math.min(...xs) - 4, Math.min(...ys) - 4,
        Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8);
    }

    // A blow arms any dynamite it reaches. Ours: how the game lights a
    // stick has not been traced — its dynamite does not read the hit flag.
    this._dynamite.forEach((d) => {
      if (d.lit || !d.sprite.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(reach, d.sprite.getBounds())) {
        d.lit = this.time.now + FUSE_MS;
      }
    });
  }

  /** Burns the lit fuses and sets off the ones that run out. */
  _tickDynamite(time) {
    for (let i = this._dynamite.length - 1; i >= 0; i -= 1) {
      const d = this._dynamite[i];
      if (!d.lit || !d.sprite.active) continue;
      // While it burns the stick blinks, which is the fuse animation's job
      // in the game.
      d.sprite.setAlpha(Math.floor(time / 80) % 2 ? 1 : 0.45);
      if (time < d.lit) continue;
      this._blast(d.sprite.x, d.sprite.y, d.pair ? BLAST_RADIUS * 1.5 : BLAST_RADIUS);
      d.sprite.destroy();
      this._dynamite.splice(i, 1);
    }
  }

  /**
   * The blast: the expanding animation the game plays, and the force it
   * puts into everything around it. The radius is ours — the game's
   * blast grows through its own frames and what it touches has not been
   * traced — but the force is the same model a hammer blow uses.
   */
  _blast(x, y, radius) {
    if (hasProps(this)) {
      const boom = this.add.image(x, y, PROP_ANIMS.blast[0]).setDepth(6);
      applyPropFrame(boom, PROP_ANIMS.blast[0]);
      let frame = 0;
      this.time.addEvent({
        delay: BLAST_FRAME_MS,
        repeat: PROP_ANIMS.blast.length - 1,
        callback: () => {
          frame += 1;
          if (frame >= PROP_ANIMS.blast.length) { boom.destroy(); return; }
          applyPropFrame(boom, PROP_ANIMS.blast[frame]);
        },
      });
    }
    const caught = [];
    this._destructibleMap.forEach((entry) => {
      if (!entry.rect.active || entry.solid) return;
      if (Phaser.Math.Distance.Between(x, y, entry.rect.x, entry.rect.y) <= radius) {
        caught.push(entry);
      }
    });
    caught.forEach((entry) => this._applyForce(entry, BLAST_FORCE, 0));
  }

  /**
   * One blow, the way the original spreads it (VA 0x689e6).
   *
   * A hit is a *force*, not a kill: the block subtracts it from its hit
   * points and only goes when it runs out. Before that the force carries
   * on into whatever holds the block up — so smashing the top of a stack
   * presses down through the supports and the weakest link gives way.
   *
   * The division is the mechanic. The force is split among the *cells*
   * directly beneath the block, and each occupied cell is struck with
   * that share, which means a block spanning six cells below a narrow one
   * takes six hits from a single blow. The chain stops when a share drops
   * to 2 or less, so a wide base soaks up a hit that a single pillar
   * passes straight down.
   *
   * These notes used to say a blow stops at the block it lands on,
   * because the level files never fill the field being divided by. They
   * do not: the engine recomputes it from the collision map every fifth
   * frame (VA 0x69c07). See `scripts/formats/ccs.py`.
   *
   * @param {object} entry the block from `_destructibleMap`
   * @param {number} force
   * @param {number} depth guard against a pathological chain
   * @param {object} blow bookkeeping shared by one blow: `{ tally, visits }`
   */
  _applyForce(entry, force, depth, blow = { tally: new Map(), visits: 0 }) {
    if (!entry || !entry.rect.active) return;
    if (entry.solid) return;          // indestructible: absorbs it, passes nothing
    if (blow.visits >= FORCE_MAX_VISITS) return;
    blow.visits += 1;

    const under = this._cellsUnder(entry);
    if (depth < FORCE_MAX_DEPTH && under.length > 0) {
      const share = Math.floor(force / under.length);
      if (share > 2) {
        under.forEach((id) => {
          this._applyForce(this._destructibleMap.get(id), share, depth + 1, blow);
        });
      }
    }

    entry.hp -= force;
    blow.tally.set(entry.id, (blow.tally.get(entry.id) || 0) + force);

    if (entry.hp <= 0) {
      this._throwRubble(entry);
      this._forgetBlock(entry);
    } else if (entry.rect.setFillStyle) {
      entry.rect.setFillStyle(WORLD_COLORS.rubbleDark); // plain rectangle
    } else {
      entry.rect.setTint(0x996655); // real block: darken the artwork
    }

    if (depth === 0) this._reportBlow(blow);
  }

  /**
   * Tell the server what one blow did — once per block, not once per visit.
   *
   * A cascade visits the same block several times; sending each visit would
   * put hundreds of messages on the wire for one swing, so the shares are
   * added up first. The server subtracts the same total either way.
   */
  _reportBlow(blow) {
    const sm = SocketManager.getInstance();
    if (!sm.socket) return;
    blow.tally.forEach((force, objectId) => {
      sm.emit(EVENTS.OBJECT_HIT, { objectId, force });
    });
  }

  /** Write a block's cells into the collision map (VA 0x69de9). */
  _stampCells(entry) {
    for (let dy = 0; dy < entry.th; dy += 1) {
      for (let dx = 0; dx < entry.tw; dx += 1) {
        const key = (entry.ty + dy) * this._gridW + entry.tx + dx;
        // First write wins, as the game's own loader does — it complains
        // "overwritten block" rather than replacing one.
        if (!this._cellOwner.has(key)) this._cellOwner.set(key, entry.id);
      }
    }
  }

  /** Take a destroyed block out of the world and out of the map. */
  _forgetBlock(entry) {
    for (let dy = 0; dy < entry.th; dy += 1) {
      for (let dx = 0; dx < entry.tw; dx += 1) {
        const key = (entry.ty + dy) * this._gridW + entry.tx + dx;
        if (this._cellOwner.get(key) === entry.id) this._cellOwner.delete(key);
      }
    }
    if (entry.rect.active) {
      entry.rect.destroy();
      this._destructibles.remove(entry.rect, true, true);
    }
    this._destructibleMap.delete(entry.id);
  }

  /**
   * Ids in the row of cells directly under a block — one per occupied cell,
   * repeats included, because the original walks cells and not objects.
   */
  _cellsUnder(entry) {
    const row = (entry.ty + entry.th) * this._gridW;
    const out = [];
    for (let dx = 0; dx < entry.tw; dx += 1) {
      const id = this._cellOwner.get(row + entry.tx + dx);
      if (id !== undefined) out.push(id);
    }
    return out;
  }

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

  /**
   * The hoover pulls nearby timmies in and swallows them.
   *
   * The game's own reach and pull strength are not decoded — the sucker
   * is its own object class, 154 of them across 72 levels — so the
   * numbers here are ours. What is the game's is that the hoover is what
   * collects timmies at all, and that they are counted: the level state
   * keeps a timmy tally alongside rubble and the clock.
   */
  _suckTimmies() {
    if (!this._timmies.length) return;
    const jx = this._player.x;
    const jy = this._player.y - HOOVER_HEIGHT;
    for (let i = this._timmies.length - 1; i >= 0; i -= 1) {
      const t = this._timmies[i];
      if (!t.active) { this._timmies.splice(i, 1); continue; }
      const dx = jx - t.x;
      const dy = jy - t.y;
      const dist = Math.hypot(dx, dy);
      if (dist > HOOVER_REACH) continue;
      if (dist < HOOVER_SWALLOW) {
        t.destroy();
        this._timmies.splice(i, 1);
        this._timmyCount += 1;
        if (this._timmyText) this._timmyText.setText(`ТИММИ ${this._timmyCount}`);
        continue;
      }
      t.x += (dx / dist) * HOOVER_PULL;
      t.y += (dy / dist) * HOOVER_PULL;
    }
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
      if (entry && entry.rect.active) this._forgetBlock(entry);
    });
  }
}
