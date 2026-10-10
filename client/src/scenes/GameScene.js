import Phaser from 'phaser';
import Player from '../entities/Player.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import SocketManager from '../network/SocketManager.js';
import {
  EVENTS, PLAYER_COLORS, HAMMER, hammerForce,
} from '../../../shared/constants.mjs';
import {
  BUNDLED, levelIdOr, levelUrl, nextLevelId, DEFAULT_LEVEL_ID,
} from '../levels';
import { WORLD_COLORS } from '../palette';
import { buildBackground } from '../entities/drawBackground';
import { preloadRealJackFrames } from '../entities/jackSprites';
import { preloadProps, hasProps, PROP_ANIMS, applyPropFrame } from '../entities/props';
import LooseObjects from './looseObjects';
import Rubble from './rubble';
import Collapse from './collapse';
import Cannons from './cannons';
import Suckers from './suckers';
import Tellies from './tellies';
import Ufos from './ufos';
import Seesaws from './seesaws';
import Gits from './gits';
import Bonuses from './bonuses';
import {
  COL, applyCollisionKind, ladderAt, ladderTopUnder, floorUnder,
} from './blockKinds';

const PLAYER_UPDATE_INTERVAL = 50; // ms
const FORCE_MAX_DEPTH = 12;  // how far one blow may travel down a stack
const FORCE_MAX_VISITS = 600; // guard: a blow decays fast, but not in one frame
const TILE = 8;              // px — the original's collision-map cell
const VIEW_WIDTH = 320;      // px of the level on screen at once, as in the original
const VIEW_HEIGHT = 200;
/** Player states during which a swing connects (see STATES in Player.js). */
const STRIKE_STATES = new Set(['strikeSide', 'strikeOver']);
// The debris masks a blow throws rubble with: the sledge v1's record
// +0x34 / +0x38 for the hammer, 0x3ffff for the blast (VA 0x1f8c5).
const HAMMER_RUBBLE_MASK = 4095;
const BLAST_RUBBLE_MASK = 0x3ffff;
// Dynamite, all from the original (see "Dynamite" in scripts/formats/README.md).
// The fuse: 35 ticks of the lit stick hopping, 25 of the flame, then ten
// steps of eleven ticks counting down (VA 0x1d4ec → 0x1d584 → 0x1d60b).
const FUSE_MS = (170 * 1000) / 60;
const BLAST_FORCE = 20000000; // VA 0x1d6aa — through anything that can break
const BLAST_STRIKES = 4;      // blocks the blast may strike (ecx = 4)
const BLAST_SPREAD = 8;       // 3x3 cells around the stick: 0, +8, -8 each way
const BLAST_SHOCK = 70;       // px either way the shock lights other sticks (VA 0x1d8d1)
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
    this._levelId = levelIdOr(data.levelId || DEFAULT_LEVEL_ID);
    this._level = null;
    this._myPlayerId = data.myPlayerId || (data.players && data.players[0] ? data.players[0].id : 'local');
    this._hostId = data.hostId || null;
  }

  preload() {
    preloadRealJackFrames(this);
    preloadProps(this);

    // A converted level is served, not bundled: its data comes first, and
    // then the artwork it names — one texture of building blocks plus the
    // wall behind them.
    const id = this._levelId;
    const key = `leveldata_${id}`;
    if (BUNDLED[id]) {
      this._useLevel(BUNDLED[id]);
    } else if (this.cache.json.exists(key)) {
      this._useLevel(this.cache.json.get(key));
    } else {
      this.load.once(`filecomplete-json-${key}`, (_k, _t, data) => this._useLevel(data));
      this.load.json(key, levelUrl(id));
    }
  }

  /** Takes a level's data, and queues the artwork it names. */
  _useLevel(level) {
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
    const level = this._level;
    const levelWidth = level.widthTiles * level.tileSize;
    const levelHeight = level.heightTiles * level.tileSize;
    // The street the map stands in: the floor runs past both side edges,
    // and players start and bells stand on it (see export_level.STREET).
    const streetLeft = level.ground ? level.ground.x : 0;
    const streetRight = level.ground ? level.ground.x + level.ground.width : levelWidth;

    // ── Background ────────────────────────────────────────────────────────────
    if (level.background && this.textures.exists(this._bgKey(level))) {
      // The original's own wall, repeated behind the level at its own
      // scale. It is only the wall: the floor strip along the bottom of
      // the `.SCN` screen is cropped off by the exporter, because tiling
      // it laid a grey band across the level every 200 pixels.
      const src = this.textures.get(this._bgKey(level)).getSourceImage();
      const x0 = Math.floor(streetLeft / src.width) * src.width;
      for (let y = 0; y < levelHeight; y += src.height) {
        for (let x = x0; x < streetRight; x += src.width) {
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

      // A post closes each end of the street (VA 0x2f623), the right one
      // mirrored, and nobody walks past it.
      if (hasProps(this) && PROP_ANIMS.post) {
        [[streetLeft, false], [streetRight, true]].forEach(([x, flip]) => {
          const post = this.add.image(x, g.y, PROP_ANIMS.post[0]).setDepth(-5);
          applyPropFrame(post, PROP_ANIMS.post[0]);
          post.setFlipX(flip);
        });
      }
      [streetLeft - 16, streetRight].forEach((x) => {
        const wall = this.add.rectangle(x + 8, levelHeight / 2, 16, levelHeight * 2)
          .setVisible(false);
        this.physics.add.existing(wall, true);
        this._platforms.add(wall);
      });
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
      const col = d.col === undefined ? COL.SOLID : d.col;
      applyCollisionKind(rect.body, col);
      rect.setData('col', col);
      const entry = {
        rect, id: d.id, hp: d.hp, solid: !!d.solid, col,
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

    // ── Dynamite ──────────────────────────────────────────────────────────
    // 202 placements across 42 levels, of two kinds: 63 that a hammer
    // lights — the overhead strike, which is the blow that reaches sprites
    // (VA 0x1d405) — and 139 that light when Jack walks into them (outcome
    // 5 of his event list, VA 0x1d7e1). Either way a fuse burns and the
    // blast goes through the blocks around it and lights the sticks near it.
    this._dynamite = [];
    (level.dynamite || []).forEach((d) => {
      if (!hasProps(this)) return;
      const stick = this.add.image(d.x, d.y, PROP_ANIMS.dyna[0]).setDepth(2);
      applyPropFrame(stick, PROP_ANIMS.dyna[0]);
      this._dynamite.push({ sprite: stick, lit: 0, litBy: d.lit_by || 'touch' });
    });

    // ── Cannons ───────────────────────────────────────────────────────────
    // On wheels they are what his pushing stance takes hold of. Made
    // before him, so he is drawn in front of what he pushes.
    this._cannons = hasProps(this) && PROP_ANIMS.cwhl
      ? new Cannons(this, level.cannons || [], (x, y) => this._blockAt(x, y),
        level.ground ? level.ground.y : levelHeight,
        (h, x, y, vx, vy) => {
          h.inside = null;
          this._loose.throw(h, x, y, vx, vy);
        })
      : null;

    // ── Teleporters (.OB class 27) ────────────────────────────────────────
    // Made before him too: he stands in their beams, not behind them.
    this._tellies = hasProps(this) && PROP_ANIMS.telly && (level.tellies || []).length
      ? new Tellies(this, level.tellies, (x, y) => this._blockAt(x, y),
        level.ground ? level.ground.y : levelHeight)
      : null;
    if (this._tellies) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._tellies.destroy());

    // ── Cannonballs (.OB class 7) ─────────────────────────────────────────
    // Things to pick up, like the dynamite — and what a cannon fires.
    this._balls = [];
    (level.balls || []).forEach((b) => {
      if (!hasProps(this) || !PROP_ANIMS.ball) return;
      const key = PROP_ANIMS.ball[b.big ? 1 : 0];
      const sprite = this.add.image(b.x, b.y, key).setDepth(2);
      applyPropFrame(sprite, key);
      this._balls.push({ sprite, big: !!b.big });
    });
    if (this._cannons) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cannons.destroy());

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

    // ── What can be picked up ─────────────────────────────────────────────
    this._loose = new LooseObjects(this,
      () => [...this._platforms.getChildren(), ...this._destructibles.getChildren()],
      levelHeight + 120, {
        // A ball coming down into a cannon's bowl is taken in (VA 0x20c15).
        falling: (h) => {
          if (this._seesaws && this._seesaws.fallingLoose(h, this._seesawHooks)) return true;
          const taken = (h.kind === 'ball' && this._cannons && this._cannons.tryLoad(h))
            || (this._suckers && this._suckers.catchLoose(h));
          if (!taken) return false;
          h.inside = true;
          h.flying = false;
          h.vx = 0;
          h.vy = 0;
          return true;
        },
        impact: (h, hit) => this._ballImpact(h, hit),
      });
    this._dynamite.forEach((d) => {
      if (d.litBy === 'hammer') d.handle = this._loose.add(d.sprite, 'dynamite');
    });
    this._balls.forEach((b) => { this._loose.add(b.sprite, 'ball').big = b.big; });
    this._suckers = hasProps(this) && PROP_ANIMS.sucker
      ? new Suckers(this, level.suckers || [], this._loose)
      : null;
    if (this._suckers) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._suckers.destroy());

    // ── Seesaws and the 20-ton weights ────────────────────────────────────
    // .OB classes 0 and 1, in 43 and 42 levels. See seesaws.js.
    this._seesawHooks = {
      launchJack: (pl, x, y, vy) => pl.thrownUp(x, y, vy),
    };
    (level.weights || []).forEach((w) => {
      if (!hasProps(this) || !PROP_ANIMS.lead) return;
      const sprite = this.add.image(w.x, w.y, PROP_ANIMS.lead[0]).setDepth(2);
      applyPropFrame(sprite, PROP_ANIMS.lead[0]);
      this._loose.add(sprite, 'lead');
    });
    this._seesaws = hasProps(this) && PROP_ANIMS.bcsaw && (level.seesaws || []).length
      ? new Seesaws(this, level.seesaws, this._loose,
        (x, y) => {
          const ground = level.ground ? level.ground.y : levelHeight;
          const top = floorUnder((bx, by) => this._blockAt(bx, by), x, y - 1, Math.min(y + 64, ground));
          return top ?? (y + 64 >= ground ? ground : y);
        })
      : null;
    if (this._seesaws) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._seesaws.destroy());
    this._player.findPickup = (x, y) => this._loose.find(x, y, this._player.getBounds());
    this._player.findCrusher = () => {
      if (!this._collapse) return null;
      const b = this._player.body;
      return this._collapse.over(b.left, b.right, b.top, b.bottom);
    };
    // Ladders: the probes his climbing states make of the tile map.
    const blockAt = (x, y) => this._blockAt(x, y);
    const bottom = level.ground ? level.ground.y : levelHeight;
    this._player.ladder = {
      at: (x, feet) => ladderAt(blockAt, x, feet),
      topUnder: (x, feet) => ladderTopUnder(blockAt, x, feet),
      topAt: (x, y) => { const b = blockAt(x, y); return b ? b.top : null; },
      floor: (x, from, to) => (to >= bottom ? bottom : floorUnder(blockAt, x, from, to)),
    };
    this._player.on('pickup', (h) => this._loose.pick(h));
    this._player.on('putdown', ({ handle, x, y }) => this._loose.place(handle, x, y));
    this._player.on('throw', ({ handle, x, y, vx, vy }) => this._loose.throw(handle, x, y, vx, vy));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._loose.destroy());

    // ── Gits: timmies, king timmies, spike gits ──────────────────────────
    // The most common things in the game. Placed timmies sit locked to
    // their block until it dies, then walk; the hoover takes them, and
    // they count. See gits.js.
    this._gits = hasProps(this) && PROP_ANIMS.timmy
      ? new Gits(this, level, {
        blockAt,
        blockIdAt: (x, y) => {
          const id = this._cellOwner.get(Math.floor(y / this._tile) * this._gridW + Math.floor(x / this._tile));
          return id === undefined ? null : id;
        },
        blockAlive: (id) => {
          const e = this._destructibleMap.get(id);
          return !!(e && e.rect.active);
        },
        markerAt: (x, y) => {
          const id = this._cellOwner.get(Math.floor(y / this._tile) * this._gridW + Math.floor(x / this._tile));
          const e = id === undefined ? null : this._destructibleMap.get(id);
          return e && e.rect.active ? e.marker || 0 : 0;
        },
        groundY: bottom,
        width: levelWidth,
        loose: this._loose,
        shake: () => this.cameras.main.shake(120, 0.006),
        jack: () => this._player,
        // The bomb's blast (VA 0x329dc): blocks from 15 px up, its force
        // the level's (rules +0x44 << +0x46), 10 across and 16 up and
        // down, four of them; the shock at its feet.
        bombBlast: (x, y) => {
          this.cameras.main.shake(300, 0.01);
          this._blast(x, y - 15, this.time.now, {
            force: level.bombForce || 0, mask: 0x7ffff, spreadX: 10, spreadY: 16, shockAt: { x, y },
          });
        },
        prize: (kind, count, x, y, left) => { if (this._bonuses) this._bonuses.prize(kind, count, x, y, left); },
      })
      : null;
    if (this._gits) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._gits.destroy());
    // ── Bonuses, dispensers, secret panels ───────────────────────────────
    // .OB classes 33, 8 and 46. See bonuses.js.
    this._superHoover = 0;     // ticks of the super hoover left (0x3f4024)
    this._doublePoints = 0;    // ticks of double points left (0x287c52)
    this._secrets = 0;         // panels taken (level_state +0x18)
    this._bonuses = hasProps(this) && PROP_ANIMS.dis
      ? new Bonuses(this, level, {
        floor: (x, from, to) => floorUnder(blockAt, x, from, to),
        blockIdAt: (x, y) => {
          const id = this._cellOwner.get(Math.floor(y / this._tile) * this._gridW + Math.floor(x / this._tile));
          return id === undefined ? null : id;
        },
        blockAlive: (id) => {
          const e = this._destructibleMap.get(id);
          return !!(e && e.rect.active);
        },
        groundY: bottom,
        jack: () => this._player,
        ball: (x, y, vx, vy) => {
          const key = PROP_ANIMS.ball[0];
          const sprite = this.add.image(x, y, key).setDepth(2);
          applyPropFrame(sprite, key);
          const h = this._loose.add(sprite, 'ball');
          h.big = false;
          this._loose.throw(h, x, y, vx, vy);
        },
        timmy: (x, y, vx, vy) => { if (this._gits) this._gits.spawnFree(x, y, vx, vy); },
        addTime: (seconds) => {
          const sm = SocketManager.getInstance();
          if (sm.socket) sm.emit(EVENTS.TIME_BONUS, { seconds });
          this._flashBonus(`+${seconds} СЕК`);
        },
        superHoover: (ticks) => { this._superHoover = ticks; },
        doublePoints: (ticks) => { this._doublePoints = ticks; },
        secret: () => {
          this._secrets += 1;
          this.cameras.main.shake(120, 0.004);
          this._flashBonus('СЕКРЕТ!');
        },
        shake: () => this.cameras.main.shake(120, 0.006),
      })
      : null;
    if (this._bonuses) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._bonuses.destroy());

    // Hurt, he loses timmies (spill_timmies, VA 0x338d0): each thrown up
    // at -6 px/tick with a random kick, and off his count.
    this._player.on('spill', (count) => {
      if (!this._gits) return;
      const n = Math.min(count, this._gits.collected);
      for (let i = 0; i < n; i += 1) {
        this._gits.spawnFree(this._player.x, this._player.y - 20, (Math.random() * 2 - 1) * 2, -6);
      }
      this._gits.collected -= n;
      this._timmyText.setText(`ТИММИ ${this._gits.collected}`);
    });

    // ── UFOs ──────────────────────────────────────────────────────────────
    // .OB class 31, in 36 levels: they abduct timmies, knock Jack flying,
    // and land — when one can be hit from above. See ufos.js.
    this._ufos = hasProps(this) && PROP_ANIMS.ufo && level.ufo
      ? new Ufos(this, level.ufo, {
        bounds: { left: 0, right: levelWidth, top: 0, bottom },
        blockAt,
        groundY: bottom,
        jacks: () => [this._player],
        timmies: () => (this._gits ? this._gits.timmies() : []),
        loose: this._loose,
        giveTimmy: (x, y, vx, vy) => { if (this._gits) this._gits.spawnFree(x, y, vx, vy); },
        explode: (x, y) => {
          this.cameras.main.shake(300, 0.01);
          this._blast(x, y, this.time.now);
        },
        knock: (pl, speed, spill) => pl.knockedBack(speed, spill),
      })
      : null;
    if (this._ufos) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._ufos.destroy());

    // Colliders
    this.physics.add.collider(this._player, this._platforms);
    this.physics.add.collider(this._player, this._destructibles);

    // ── Input ─────────────────────────────────────────────────────────────────
    // The game's six keys are LEFT RIGHT UP DOWN BUT1 BUT2 (VA 0x912c9), and
    // on the keyboard every action is a combination of them: BUT1 takes the
    // hammer out of the hat and puts it back (with UP held, the hoover), BUT2
    // jumps empty-handed and swings the hammer when it is out. Z and X stand
    // in for the two buttons; Space is BUT2 too. See Player.update.
    this._cursors = this.input.keyboard.createCursorKeys();
    this._but1Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this._but2Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    // ── Camera ────────────────────────────────────────────────────────────────
    // The original's screen is 320x240 "mode X" with the play field clipped
    // to its top 200 lines (the sprite blitter, VA 0x34ed8, stops at x 0x140 and y 200);
    // the rest is the panel. So the world camera shows exactly 320x200 of
    // the level, scaled to the canvas width, and the HUD gets the strip
    // below it, on a camera of its own that does not zoom.
    const zoom = this.scale.width / VIEW_WIDTH;
    this.cameras.main
      .setViewport(0, 0, this.scale.width, VIEW_HEIGHT * zoom)
      .setZoom(zoom)
      .setBounds(streetLeft, 0, streetRight - streetLeft, levelHeight)
      .startFollow(this._player, true, 0.1, 0.1);
    this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
      .setName('hud');
    // World objects, those made so far and every one made later, stay off
    // the HUD camera; _hud() moves an object to it.
    this._uiCam.ignore(this.children.list);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (obj) => {
      this._uiCam.ignore(obj);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE);
    });

    // ── HUD ───────────────────────────────────────────────────────────────────
    const panelTop = VIEW_HEIGHT * zoom;
    const panelH = this.scale.height - panelTop;
    this._hud(this.add.rectangle(this.scale.width / 2, panelTop + panelH / 2,
      this.scale.width, panelH, 0x111122));

    // Timer — centered in the panel
    this.timerText = this._hud(this.add.text(400, panelTop + 10, '3:00', {
      fontSize: '32px',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(10));

    // Mode label — panel right
    const modeLabel = this._mode === 'race' ? 'ГОНКА' : 'КООП';
    this._modeLabelText = this._hud(this.add.text(784, panelTop + 10, modeLabel, {
      fontSize: '20px',
      fill: '#ffff00',
    }).setOrigin(1, 0).setDepth(10));

    // Player list — panel left (colored icon + name per player)
    this._playerListObjects = [];
    const playersData = this._players || [];
    playersData.forEach((p, idx) => {
      const yPos = panelTop + 6 + idx * 22;
      const colorHex = parseInt((p.color || '#ffffff').replace('#', ''), 16);
      const icon = this._hud(this.add.rectangle(16, yPos + 8, 14, 14, colorHex)
        .setDepth(10));
      const nameLabel = this._hud(this.add.text(30, yPos, p.name || p.id, {
        fontSize: '14px',
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      }).setDepth(10));
      this._playerListObjects.push(icon, nameLabel);
    });

    // Small room/mode debug line — panel bottom right
    this._modeText = this._hud(this.add.text(784, this.scale.height - 4,
      `${this._mode === 'race' ? 'ГОНКА' : 'КООП'} | ${this._roomCode}`, {
        fontSize: '11px',
        color: '#555555',
      }).setOrigin(1, 1));

    /** Rubble hoovered up, as the game counts it: area / 16 a piece. */
    this._rubbleTaken = 0;
    this._rubbleText = this._hud(this.add.text(784, panelTop + 40, `МУСОР ${this._rubbleTaken}`, {
      fontSize: '16px',
      fill: '#ffcc33',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(10));
    /** Timmies hoovered up (the player's +0x64, VA 0x1a036). */
    this._timmyText = this._hud(this.add.text(784, panelTop + 60, 'ТИММИ 0', {
      fontSize: '16px',
      fill: '#ffcc33',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(10));

    this._debugText = this._hud(this.add.text(220, this.scale.height - 4, '', {
      fontSize: '11px',
      color: '#556655',
    }).setOrigin(0, 1));

    // ── Throttle timestamp ────────────────────────────────────────────────────
    this._lastUpdateSent = 0;

    /** Structures that lose their support fall (see collapse.js). */
    this._collapse = new Collapse(this, level.heightTiles || Math.ceil(levelHeight / this._tile));

    /** What smashed blocks become: see-through rubble the hoover clears. */
    this._rubble = new Rubble(this, level.ground ? level.ground.y : levelHeight);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._rubble.destroy());

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

    // A tap shorter than a frame still counts: JustDown latches it, where
    // testing isDown would miss a key that was already back up by the time
    // we looked.
    const { JustDown } = Phaser.Input.Keyboard;
    const but2Pressed = JustDown(this._but2Key) || JustDown(this._cursors.space);
    // The speed physics moved him at this frame, before he sets the next
    // one: what a cannon he pushes moves at too, or it runs a frame ahead.
    this._movedVx = this._player.body.velocity.x;
    this._player.update(this._cursors, {
      but1: JustDown(this._but1Key),
      but2: but2Pressed || this._but2Key.isDown || this._cursors.space.isDown,
      but2Pressed,
    }, delta);

    this._collapse.update(delta);
    // The super hoover takes the rubble from a box 2048 x 1024 ahead of
    // him, not 32 x 32 (VA 0x61740), and blinks; double points count each
    // piece twice (VA 0x19fd2).
    const ticks = (delta * 60) / 1000;
    this._superHoover = Math.max(0, this._superHoover - ticks);
    this._doublePoints = Math.max(0, this._doublePoints - ticks);
    let box = this._player.hooverBox;
    if (box && this._superHoover > 0) {
      const ahead = this._player.facingLeft ? this._player.x - 40 - 2048 : this._player.x + 40;
      box = new Phaser.Geom.Rectangle(ahead, this._player.y - 512, 2048, 1024);
    }
    if (this._player.vac) {
      this._player.vac.setAlpha(this._superHoover > 0 && (this.time.now / (1000 / 60)) & 8 ? 0.5 : 1);
    }
    let taken = this._rubble.update(delta, box, this._player.nozzle);
    if (taken && this._doublePoints > 0) taken *= 2;
    if (taken) {
      this._rubbleTaken += taken;
      this._rubbleText.setText(`МУСОР ${this._rubbleTaken}`);
    }

    // ── Hammer interactions ───────────────────────────────────────────────────
    // Blocks take the blow once, on the frame it lands (the player's
    // `hammer_impact`, wired in create). The bell only needs a touch.
    if (STRIKE_STATES.has(this._player.state)) {
      this._checkHammerBell();
    } else {
      this._player.bellHit = false; // reset so bell can be hit again after leaving
    }

    this._tickDynamite(time);
    if (this._cannons) this._tickCannons(delta);
    if (this._tellies) {
      if (this._player.state !== 'caught') this._tellies.meet(this._player);
      this._tellies.update(delta,
        (pl, x, y, sx, sy) => pl.holdAt(x, y, sx, sy),
        (pl) => pl.letGo());
    }
    if (this._suckers) {
      if (this._player.state !== 'caught') this._suckers.catchJack(this._player);
      this._suckers.update(delta,
        (pl, x, y) => pl.holdAt(x, y),
        (pl, x, y, vy) => pl.thrownUp(x, y, vy));
    }

    if (this._ufos) this._ufos.update(delta);
    if (this._bonuses) this._bonuses.update(delta);
    if (this._gits) {
      const got = this._gits.update(delta, this._player.hooverBox, this._player.nozzle);
      if (got) this._timmyText.setText(`ТИММИ ${this._gits.collected}`);
    }
    if (this._seesaws) this._seesaws.update(this._player, this._seesawHooks);

    // A stick that goes off in his hands is gone from them.
    const held = this._player.carried;
    if (held && !held.sprite.active) this._player.dropCarried();
    this._loose.update(delta, this._player.carried ? this._player.carryPoint : null, this._player.aim);

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
   * Put a game object on the HUD camera instead of the world one.
   * @template T
   * @param {T} obj
   * @returns {T}
   */
  /** A word in the middle of the panel for a moment — a bonus taken. */
  _flashBonus(text) {
    const t = this._hud(this.add.text(this.scale.width / 2, this.scale.height - 60, text, {
      fontFamily: 'monospace', fontSize: '22px', fill: '#ffee55', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(1000));
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 20, duration: 1200, onComplete: () => t.destroy() });
  }

  _hud(obj) {
    this.cameras.main.ignore(obj);
    obj.cameraFilter &= ~this._uiCam.id;
    return obj;
  }

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

    // Only the overhead blow reaches sprites, and of the dynamite only the
    // kind a hammer lights listens for it.
    if (!overhead) return;
    if (this._cannons) this._cannons.hit(reach);
    if (this._suckers) this._suckers.hit(reach);
    if (this._ufos) this._ufos.hit(reach);
    if (this._seesaws) this._seesaws.hit(reach, this._seesawHooks);
    if (this._gits) this._gits.hit(reach);
    if (this._bonuses) this._bonuses.hit(reach);
    this._dynamite.forEach((d) => {
      if (d.lit || d.litBy !== 'hammer' || !d.sprite.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(reach, d.sprite.getBounds())) {
        d.lit = this.time.now + FUSE_MS;
      }
    });
  }

  /**
   * Pushing (VA 0x28771 → 0x27f96): in the stance, he takes hold of a
   * cannon on wheels his box overlaps, and while it still does it rolls at
   * his speed. Out of the stance, or apart, it rolls on by itself.
   */
  _tickCannons(delta) {
    const pl = this._player;
    const bounds = pl.getBounds();
    if (pl.pushing && !this._cannons.all.some((c) => c.heldBy === pl)) {
      const c = this._cannons.find(bounds, pl.facingLeft);
      if (c) c.heldBy = pl;
    }
    this._cannons.update(delta, (c) => {
      if (c.heldBy !== pl) return null;
      if (!pl.pushing || !this._cannons.touches(c, pl.getBounds())) {
        c.heldBy = null;
        return null;
      }
      return this._movedVx / 60;
    });
  }

  /** Burns the lit fuses and sets off the ones that run out. */
  _tickDynamite(time) {
    // The other kind lights at Jack's touch.
    const body = this._player.getBounds();
    this._dynamite.forEach((d) => {
      if (d.lit || d.litBy !== 'touch' || !d.sprite.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(body, d.sprite.getBounds())) {
        d.lit = time + FUSE_MS;
      }
    });
    for (let i = this._dynamite.length - 1; i >= 0; i -= 1) {
      const d = this._dynamite[i];
      if (!d.lit || !d.sprite.active) continue;
      // While it burns the stick blinks, which is the fuse animation's job
      // in the game.
      d.sprite.setAlpha(Math.floor(time / 80) % 2 ? 1 : 0.45);
      if (time < d.lit) continue;
      const { x, y } = d.sprite;
      d.sprite.destroy();
      this._dynamite.splice(i, 1);
      this._blast(x, y, time);
    }
  }

  /**
   * The blast (VA 0x1d60b). The force goes through the blow routine the
   * hammer uses, over the cells 0, +8, -8 either way of the stick — a 3x3
   * patch — striking up to four blocks, and travelling both down and up
   * through what they touch. At twenty million it breaks everything it
   * reaches, which is how a stick flattens what a hammer only chips. Then
   * a shock 70 px either way sets off any stick it catches and throws Jack
   * (VA 0x2bc86). A bomb's blast is the same with its own force, mask and
   * spread (`opts`), the shock at its feet.
   */
  _blast(x, y, time, opts = {}) {
    const {
      force = BLAST_FORCE, mask = BLAST_RUBBLE_MASK, spreadX = BLAST_SPREAD, spreadY = BLAST_SPREAD,
      shockAt = { x, y },
    } = opts;
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
    const blocks = [...this._destructibleMap.values()].filter((e) => e.rect.active);
    const stepsX = [0, spreadX, -spreadX];
    const stepsY = [0, spreadY, -spreadY];
    let left = force > 0 ? BLAST_STRIKES : 0;
    stepsY.forEach((sy) => stepsX.forEach((sx) => {
      if (left <= 0) return;
      const cx = Math.floor((Math.round(x) + sx) / 8) * 8 + 4;
      const cy = Math.floor((Math.round(y) + sy) / 8) * 8 + 4;
      const hit = blocks.find((e) => e.rect.active && e.rect.getBounds().contains(cx, cy));
      if (!hit) return;
      this._applyForce(hit, force, 0,
        { tally: new Map(), visits: 0, mask }, { down: true, up: true });
      left -= 1;
    }));

    // The shock (VA 0x1d8d1) reaches Jack too: pushed, and hurt up close.
    const shock = new Phaser.Geom.Rectangle(shockAt.x - BLAST_SHOCK, shockAt.y - BLAST_SHOCK,
      BLAST_SHOCK * 2, BLAST_SHOCK * 2);
    if (Phaser.Geom.Intersects.RectangleToRectangle(shock, this._player.getBounds())) {
      this._player.blasted(shockAt.x, shockAt.y);
    }
    if (this._gits) this._gits.blasted(shockAt.x, shockAt.y, shock);
    this._dynamite.forEach((d) => {
      if (d.lit || !d.sprite.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(shock, d.sprite.getBounds())) d.lit = time + FUSE_MS;
    });
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
   * @param {{down: boolean, up: boolean}} dirs which ways it travels. A
   *   hammer's goes down; the blast's both ways — up is the same rule over
   *   the row above (damage_up, VA 0x68a91).
   */
  _applyForce(entry, force, depth, blow = { tally: new Map(), visits: 0 },
    dirs = { down: true, up: false }) {
    if (!entry || !entry.rect.active) return;
    if (entry.solid) return;          // indestructible: absorbs it, passes nothing
    if (blow.visits >= FORCE_MAX_VISITS) return;
    blow.visits += 1;

    const pass = (ids, way) => {
      if (depth >= FORCE_MAX_DEPTH || ids.length === 0) return;
      const share = Math.floor(force / ids.length);
      if (share <= 2) return;
      ids.forEach((id) => {
        this._applyForce(this._destructibleMap.get(id), share, depth + 1, blow, way);
      });
    };
    if (dirs.down) pass(this._cellsUnder(entry), { down: true, up: false });
    if (dirs.up) pass(this._cellsAbove(entry), { down: false, up: true });

    entry.hp -= force;
    blow.tally.set(entry.id, (blow.tally.get(entry.id) || 0) + force);
    if (this._collapse) this._collapse.touch();   // any hit sets the dirty flag

    if (entry.hp <= 0) {
      this._rubble.add(entry.rect, blow.mask || HAMMER_RUBBLE_MASK);
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

  /**
   * A cannonball striking a block (VA 0x1f36d from above, 0x1f28c from the
   * side): only at 5 px/tick and over coming down, 3 sideways, and with the
   * force of its weight doubled for every px/tick over 2 — halved coming
   * down, where it goes into the block both ways. The big ball weighs
   * 50000 to the small one's 5, and throws its rubble wider.
   */
  _ballImpact(h, { x, y, speed, side, dir }) {
    if (h.kind !== 'ball' && h.kind !== 'lead') return;
    const sp = Math.floor(speed);
    if (sp < (side ? 3 : 5)) return;
    // the weight's mass is its +0x4c, 25 (VA 0x1e6c3)
    const mass = h.kind === 'lead' ? 25 : h.big ? 50000 : 5;
    const force = side ? mass * 2 ** (sp - 2) : (mass * 2 ** (sp - 2)) / 2;
    const id = this._cellOwner.get(Math.floor(y / this._tile) * this._gridW + Math.floor(x / this._tile));
    const entry = id === undefined ? null : this._destructibleMap.get(id);
    if (!entry) return;
    const mask = mass > 40000 ? 0x7ffff : 0x3fff;
    const blow = () => ({ tally: new Map(), visits: 0, mask });
    if (side) {
      this._applyForce(entry, force, 0, blow(), dir > 0 ? { down: true, up: false } : { down: false, up: true });
    } else {
      this._applyForce(entry, force, 0, blow(), { down: false, up: true });
      this._applyForce(entry, force, 0, blow(), { down: true, up: false });
    }
  }

  /**
   * The block whose cell holds a point, as the probes see it (VA 0x60301):
   * its collision kind and its top. Null for an empty cell.
   */
  _blockAt(x, y) {
    if (x < 0 || y < 0 || x >= this._gridW * this._tile) return null;
    const id = this._cellOwner.get(Math.floor(y / this._tile) * this._gridW + Math.floor(x / this._tile));
    const entry = id === undefined ? null : this._destructibleMap.get(id);
    if (!entry || !entry.rect.active) return null;
    return { col: entry.col, top: entry.ty * this._tile };
  }

  /** Clear a block's cells from the collision map (VA 0x68980). */
  _unstampCells(entry) {
    for (let dy = 0; dy < entry.th; dy += 1) {
      for (let dx = 0; dx < entry.tw; dx += 1) {
        const key = (entry.ty + dy) * this._gridW + entry.tx + dx;
        if (this._cellOwner.get(key) === entry.id) this._cellOwner.delete(key);
      }
    }
  }

  /**
   * A falling group has come down on `hit`, `hitter` first: the impact goes
   * down into the one and up into the other (VA 0x68b2d → 0x689e6 / 0x68a91),
   * and shakes the screen by how hard it was.
   */
  _landed(hit, hitter, force) {
    if (force > 0) {
      // `hit` is null when it came down on the floor
      if (hit) this._applyForce(hit, force, 0, undefined, { down: true, up: false });
      if (hitter && hitter.rect.active) {
        this._applyForce(hitter, force, 0, undefined, { down: false, up: true });
      }
    }
    const shake = Math.min(0.012, force / 400000);
    if (shake > 0.0015) this.cameras.main.shake(120, shake);
  }

  /** Take a destroyed block out of the world and out of the map. */
  _forgetBlock(entry) {
    this._unstampCells(entry);
    if (this._collapse) {
      this._collapse.falling.delete(entry.id);
      this._collapse.touch();
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
  /** The row of cells just above a block, as owner ids (VA 0x68a91). */
  _cellsAbove(entry) {
    if (entry.ty === 0) return [];
    const row = (entry.ty - 1) * this._gridW;
    const out = [];
    for (let dx = 0; dx < entry.tw; dx += 1) {
      const id = this._cellOwner.get(row + entry.tx + dx);
      if (id !== undefined) out.push(id);
    }
    return out;
  }

  _cellsUnder(entry) {
    const row = (entry.ty + entry.th) * this._gridW;
    const out = [];
    for (let dx = 0; dx < entry.tw; dx += 1) {
      const id = this._cellOwner.get(row + entry.tx + dx);
      if (id !== undefined) out.push(id);
    }
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
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    // Semi-transparent black background
    this._hud(this.add.rectangle(cx, cy, width, height, 0x000000, 0.75)
      .setDepth(100));

    // Title text
    this._hud(this.add.text(cx, cy - 60, title, {
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(101));

    // Subtitle text
    this._hud(this.add.text(cx, cy, subtitle, {
      fontSize: '24px',
      color: '#cccccc',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(101));

    // Countdown text
    const { nextLevel } = options;
    const label = (n) => (nextLevel
      ? `Следующий уровень через ${n}...`
      : `Возврат в меню через ${n}...`);
    let countdown = 3;
    const countdownText = this._hud(this.add.text(cx, cy + 60, label(countdown), {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(101));

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
      const level = this._level;
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
        this._rubble.add(entry.rect, HAMMER_RUBBLE_MASK);
        this._forgetBlock(entry);
      }
    });
  }
}
