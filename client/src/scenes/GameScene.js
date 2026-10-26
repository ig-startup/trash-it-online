import Phaser from 'phaser';
import Player from '../entities/Player.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import SocketManager from '../network/SocketManager.js';
import {
  EVENTS, PLAYER_COLORS, hammerForce,
} from '../../../shared/constants.mjs';
import { preloadHammer, hammerAt, hammerStrikes, FIRST_HAMMER } from '../entities/hammers';
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
import Popups from './popups';
import Bell from './bell';
import Buttons from './buttons';
import Rocket from './rocket';
import { playSfx, SFX, BLOW_BY_MATERIAL, LAND_BY_MATERIAL } from '../audio/sfx';
import BonusRound, { preloadBonusRound } from './bonusRound';
import TimmyBins from './timmyBins';
import Flags from './flags';
import {
  COL, applyCollisionKind, ladderAt, ladderTopUnder, floorUnder,
} from './blockKinds';
import { LocalKeys, loadKeySets, SOLO_EXTRA } from '../input/keySets';
import { QUIT_LEVEL } from './PauseScene';
import { LAST_ONE_SECONDS } from '../battle/LocalBattle';
import { ARCADE_MAX_TENTHS, formatTenths, missionText } from '../battle/LocalArcade';

const PLAYER_UPDATE_INTERVAL = 50; // ms
const FORCE_MAX_DEPTH = 12;  // how far one blow may travel down a stack
const FORCE_MAX_VISITS = 600; // guard: a blow decays fast, but not in one frame
const TILE = 8;              // px — the original's collision-map cell
const VIEW_WIDTH = 320;      // px of the level on screen at once, as in the original
const VIEW_HEIGHT = 200;
// The camera keeps every Jack on screen (VA 0x2c22f): a box round them all,
// 60 px out either side and below, 102 above, widened to the screen's 320:200,
// never narrower than 320 nor wider than 0x27ff (VA 0x2be4e). It eases there
// an eighth of the way a tick, the zoom a quarter (VA 0x2c198).
const CAM_MARGIN = { side: 60, top: 102, bottom: 60 };
const VIEW_MAX = 0x27ff;
const CAM_EASE = 1 / 8;
const CAM_ZOOM_EASE = 1 / 4;
const CAM_LOWEST = 90;       // the centre stays this far over the ground (VA 0x2c198)
const BACKDROP_PAD = 1024;   // px of wall past the level, for a camera drawn back
const DEFAULT_TIME = 20 * 60; // a level with no limit keeps 20:00 (BCD 0x2000)
/** Player states during which a swing connects (see STATES in Player.js). */
// The debris masks a blow throws rubble with: a hammer's own (record +0x34,
// the sledge v1's where none is given), 0x3ffff for the blast (VA 0x1f8c5).
const HAMMER_RUBBLE_MASK = 4095;
const BLAST_RUBBLE_MASK = 0x3ffff;
// Dynamite, all from the original (see "Dynamite" in docs/re/objects/dynamite.md).
// The fuse: 35 ticks of the lit stick hopping, 25 of the flame, then ten
// steps of eleven ticks counting down (VA 0x1d4ec → 0x1d584 → 0x1d60b).
const FUSE_MS = (170 * 1000) / 60;
const BLAST_FORCE = 20000000; // VA 0x1d6aa — through anything that can break
const BLAST_STRIKES = 4;      // blocks the blast may strike (ecx = 4)
const BLAST_SPREAD = 8;       // 3x3 cells around the stick: 0, +8, -8 each way
const BLAST_SHOCK = 70;       // px either way the shock lights other sticks (VA 0x1d8d1)
const BLAST_FRAME_MS = 45;
// The level's option bits the buttons deal in (docs/re/objects/buttons.md):
// 0x1000 sets off the level's one big event, which sets 0x2000 so it runs
// once (watcher 0x1b089); the demolition sets 0x40 when it falls.
const OPT_DEMOLISHED = 0x40;
const OPT_ROCKET = 0x800;     // what the subtype-2 bell waits for (VA 0x33fdd)
const OPT_BIG_EVENT = 0x1000;
const OPT_BIG_EVENT_DONE = 0x2000;
// The demolition (demolition_start 0x1b0f6, demolition_tick 0x2043c): 80
// ticks, the shake at 8; the camera on a point 1900 px over the bottom of
// the level, mid-way across, for 800 ticks.
const DEMOLISH_TICKS = 0x50;
const DEMOLISH_SHAKE_AT = 8;
const DEMOLISH_RUBBLE_MASK = 0x7ffff;
const DEMOLISH_SFX = 0x2b;
const DEMOLISH_CAM = { over: 0x76c, ticks: 0x320 };
/** How long the camera holds what the levels' objects show it (docs/re/logic/camera.md). */
const CAM_TICKS = {
  bellFree: 180,     // the bell coming free, VA 0x340fa
  bellRung: 60,      // a Jack ringing it while others are left, 0x341f2
  bellLast: 900,     // the last ring — priority, 0x3423a
  hoover: 180,       // spawn_super_hoover 0x1b447
  sucker: 120,       // sucker_armed 0x191d8
  launched: 120,     // seesaw_launch 0x1eda0, launch_at_45 0x60170
};


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
    /** Who plays this level (a tie-break narrows it); null is everyone. */
    this._active = data.active || null;
    /** In a battle: set, level k of n, the points so far, the hammer. */
    this._battle = data.battle || null;
    /**
     * Everyone in `players` plays at this keyboard, each Jack on the key set
     * the player's `pad` names (or its place in the list) — the original's
     * way of playing together. Otherwise only `myPlayerId` is played here.
     */
    this._local = !!data.local;
    /** A battle at this keyboard keeps its own score (battle/LocalBattle.js). */
    this._localBattle = data.localBattle || null;
    /** So does the arcade: the teams' turns and times (battle/LocalArcade.js). */
    this._arcade = data.arcade || null;
    /** The story: a level played off the world map, back to it after (story/Story.js). */
    this._story = data.story || null;
    if (this._localBattle && !this._battle) {
      const now = this._localBattle.current();
      this._battle = now.battle;
      this._active = now.active;
    }
    /** Local players in the order they rang the bell. */
    this._rung = [];
  }

  preload() {
    preloadRealJackFrames(this);
    preloadProps(this);
    // Every Jack swings the same hammer: a battle level names its own
    // (the guitar in a tie-break); the story starts on the sledge v1.
    // An arcade level hands its row's hammer.
    if (this._arcade) {
      this._hammerIndex = this._arcade.entry.hammer;
    } else if (this._story) {
      this._hammerIndex = this._story.hammer;
    } else {
      this._hammerIndex = this._battle && Number.isInteger(this._battle.hammer)
        ? this._battle.hammer : FIRST_HAMMER;
    }
    preloadHammer(this, hammerAt(this._hammerIndex));

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
    if (level.bonusRound) preloadBonusRound(this, level.bonusRound);
    if (level.background) {
      this.load.image(this._bgKey(level), level.background);
    }
    if (level.floor) {
      this.load.image(this._floorKey(level), level.floor);
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

  /** @returns {string} texture key for a level's ground texture */
  _floorKey(level) {
    return `lvlfloor_${level.id}`;
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
    // The original's backdrop (docs/re/formats/scn.md): the street is the
    // horizon; above it `.SCN` texture 1 stands upright, bottom row on the
    // street (VA 0x1c895), carried on to the top when `.SDE` word 3 says so
    // and filled with its top-left pixel's colour otherwise (0x6d2ab); below
    // it texture 0 is the ground (VA 0x18f74). The original draws both in
    // perspective from the camera's depth, which the clone does not model,
    // so here they are flat, at their own scale. Everything runs well past
    // the level, for the camera draws back to keep every player in view.
    const groundY = level.ground ? level.ground.y : levelHeight;
    const left = streetLeft - BACKDROP_PAD;
    const width = streetRight - streetLeft + BACKDROP_PAD * 2;
    const top = -BACKDROP_PAD * 2;
    if (level.background && this.textures.exists(this._bgKey(level))) {
      const src = this.textures.get(this._bgKey(level)).getSourceImage();
      const x0 = Math.floor(left / src.width) * src.width;
      const w = left + width - x0;
      const toTop = !level.backdrop || level.backdrop.toTop;
      const y0 = toTop ? groundY - Math.ceil((groundY - top) / src.height) * src.height
        : groundY - src.height;
      if (!toTop) {
        this.add.rectangle(left, top, width, y0 - top, level.backdrop.fill)
          .setOrigin(0, 0).setDepth(-10);
      }
      this.add.tileSprite(x0, y0, w, groundY - y0, this._bgKey(level))
        .setOrigin(0, 0).setDepth(-10);
      if (level.floor && this.textures.exists(this._floorKey(level))) {
        const fsrc = this.textures.get(this._floorKey(level)).getSourceImage();
        const fx0 = Math.floor(left / fsrc.width) * fsrc.width;
        this.add.tileSprite(fx0, groundY, left + width - fx0, levelHeight - groundY + BACKDROP_PAD,
          this._floorKey(level)).setOrigin(0, 0).setDepth(-10);
      }
    } else {
      buildBackground(this, levelWidth, levelHeight);
    }
    this._street = { left: streetLeft, right: streetRight, ground: groundY };

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
        mat: d.mat || 0,
      };
      this._destructibleMap.set(d.id, entry);
      this._stampCells(entry);
    });

    // ── Bell ──────────────────────────────────────────────────────────────
    // Three sprites that fall like any other (see bell.js). A subtype-8
    // bell stays hidden until this share of the level is destroyed
    // (VA 0x340af) — the arcade's "trash NN% to free the bell". The share
    // is of every object in the level, the unbreakable ones included
    // (`destroyed_percent`, VA 0x68724).
    // A bonus screen has no bell: its round is won on the object instead.
    const bell = level.bell || { x: -1000, y: -1000 };
    const bellGround = level.ground ? level.ground.y : levelHeight;
    this._objectTotal = level.destructibles.length;
    this._destroyedCount = 0;
    this._bellTrash = bell.trash || 0;
    // A subtype-2 bell waits for so many timmies in the bins (VA 0x33fdd).
    this._bellBins = bell.bins || 0;
    // A rocket level's subtype-2 bell waits for option 0x800: the last
    // piece on the stack (rocket.js).
    this._bellRocket = !!bell.rocket;
    this._bell = new Bell(this, bell, (x, from, to) => (to >= bellGround ? bellGround
      : floorUnder((bx, by) => this._blockAt(bx, by), x, from, to)),
    { hidden: this._bellTrash > 0 || this._bellBins > 0 || this._bellRocket || !level.bell, fallbackColor: WORLD_COLORS.bell });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._bell.destroy());

    // ── A bonus screen's object (G.EXE VA 0x10c1f; bonusRound.js) ─────────
    this._bonusRound = null;
    if (level.bonusRound) {
      this._bonusRound = new BonusRound(this, level.bonusRound, () => this._bonusWon());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._bonusRound.destroy());
    }

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
          this._camTrack(h.sprite, CAM_TICKS.launched, { moving: () => h.flying });
        })
      : null;

    // ── Teleporters (.OB class 27) ────────────────────────────────────────
    // Made before him too: he stands in their beams, not behind them.
    this._tellies = hasProps(this) && PROP_ANIMS.telly && (level.tellies || []).length
      ? new Tellies(this, level.tellies, (x, y) => this._blockAt(x, y),
        level.ground ? level.ground.y : levelHeight)
      : null;
    if (this._tellies) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._tellies.destroy());

    // ── Buttons (.OB classes 28-30) and the level's option bits ───────────
    // Only 1D, 2T, 4T and BA have them: red, then green, then blue, and the
    // last sets off the level's big event (bigEvent). See buttons.js.
    this._options = 0;
    this._bigEvent = level.bigEvent || null;
    this._demolishIn = 0;
    this._eventAcc = 0;
    /** What the camera takes in besides the Jacks: {x, y, ticks}, or a `follow` sprite. */
    this._camTargets = [];
    this._buttons = hasProps(this) && PROP_ANIMS.button && (level.buttons || []).length
      ? new Buttons(this, level.buttons, (x, from, to) => (to >= bellGround ? bellGround
        : floorUnder((bx, by) => this._blockAt(bx, by), x, from, to)))
      : null;
    if (this._buttons) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._buttons.destroy());

    // ── The rocket levels: the crawler, the pieces, the forklifts ─────────
    // 0L 2D 5L 9L (rocket.js). Jack jumps into a forklift's seat and drives
    // the pieces to the crawler, which stacks them on its pad.
    this._rocket = hasProps(this) && PROP_ANIMS.crawl && level.crawler
      ? new Rocket(this, level.crawler, level.rocketBits || [], level.forklifts || [],
        (x, from, to) => (to >= bellGround ? bellGround
          : floorUnder((bx, by) => this._blockAt(bx, by), x, from, to)),
        (x, y) => this._blockAt(x, y),
        () => this._setOptions(OPT_ROCKET))
      : null;
    if (this._rocket) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._rocket.destroy());

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

    // ── The Jacks played at this keyboard ─────────────────────────────────
    // Each starts on his own start position of the level (the `.OB` record's
    // players 1-4) and reads his own six keys.
    const mine = this._players.find((p) => p.id === this._myPlayerId)
      || this._players[0]
      || { id: 'local', color: '#ff4444' };
    const here = this._local && this._players.length ? this._players : [mine];
    this._levelHeight = levelHeight;
    this._keys = new LocalKeys();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._keys.destroy());
    const keySets = loadKeySets();
    this._jacks = here.map((pd, i) => {
      const spawnIndex = Math.max(0, this._players.findIndex((p) => p.id === pd.id));
      const spawn = level.spawnPoints[spawnIndex] || level.spawnPoints[0];
      const player = new Player(this, spawn.x, spawn.y, pd.color || '#ff4444', pd.id, true,
        { hammer: this._hammerIndex, hand: level.handOptions || 0 });
      player.drawAtStart(this.time.now);
      const set = keySets[pd.pad ?? i] || keySets[0];
      const pad = this._keys.pad(set, here.length === 1 ? SOLO_EXTRA : {});
      // His flag (`.OB` class 2 + his index): where he flies home to once
      // flattened (VA 0x2a2fe).
      player.flag = (level.flags || [])[spawnIndex] || null;
      const j = {
        player, pad, data: pd, spawn, rang: false, movedVx: 0,
      };
      player.on('hammer_impact', (blow) => this._checkHammerDestructibles(blow, player));
      return j;
    });
    /** The Jack this browser sends to the server, when there is one. */
    this._player = this._jacks[0].player;
    this._spawn = this._jacks[0].spawn;

    // ── What can be picked up ─────────────────────────────────────────────
    this._loose = new LooseObjects(this,
      () => [...this._platforms.getChildren(), ...this._destructibles.getChildren()],
      levelHeight + 120, {
        // A ball coming down into a cannon's bowl is taken in (VA 0x20c15).
        falling: (h) => {
          if (h.kind === 'timmy' && this._bins && this._gits
            && this._bins.take(h.sprite.x, h.sprite.y, h.vy)) {
            this._gits.binned(h.sprite);
            return true;
          }
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
        impact: (h, hit) => {
          // a weight landing presses what is under it (lead_lands_on, VA 0x1ea81)
          if (h.kind === 'lead' && !hit.side && this._buttons) {
            this._setOptions(this._buttons.hit(h.sprite.getBounds()));
          }
          this._ballImpact(h, hit);
        },
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
      launchJack: (pl, x, y, vy) => {
        pl.thrownUp(x, y, vy);
        this._camTrack(pl, CAM_TICKS.launched, { moving: () => !pl.body.blocked.down || pl.body.velocity.y < 0 });
      },
      launched: (h) => this._camTrack(h.sprite, CAM_TICKS.launched, { moving: () => h.flying }),
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
    // Ladders: the probes his climbing states make of the tile map.
    const blockAt = (x, y) => this._blockAt(x, y);
    const bottom = level.ground ? level.ground.y : levelHeight;
    this._flags = hasProps(this) && (level.flags || []).length
      ? new Flags(this, this._jacks.map(({ player }) => player.flag || level.flags[0]),
        this._jacks.map(({ data }) => data.color || '#ff4444'))
      : null;
    if (this._flags) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._flags.destroy());
    this._jacks.forEach(({ player }) => {
      // Flattened, he comes down through everything to here (VA 0x2a151).
      player.levelBottom = bottom;
      player.findPickup = (x, y) => this._loose.find(x, y, player.getBounds());
      player.findCrusher = () => {
        if (!this._collapse) return null;
        const b = player.body;
        return this._collapse.over(b.left, b.right, b.top, b.bottom);
      };
      // Room over his head (the rows 0x244c0 probes): no solid cell
      // across x ± 4 from `top` down to `bottom`.
      player.headroom = (x, top, bottom) => {
        for (let cy = Math.floor(top / 8) * 8; cy < bottom; cy += 8) {
          for (let cx = Math.floor((x - 4) / 8) * 8; cx <= x + 4; cx += 8) {
            const b = blockAt(cx, cy);
            if (b && b.col === COL.SOLID) return false;
          }
        }
        return true;
      };
      player.ladder = {
        at: (x, feet) => ladderAt(blockAt, x, feet),
        topUnder: (x, feet) => ladderTopUnder(blockAt, x, feet),
        topAt: (x, y) => { const b = blockAt(x, y); return b ? b.top : null; },
        floor: (x, from, to) => (to >= bottom ? bottom : floorUnder(blockAt, x, from, to)),
      };
      player.on('pickup', (h) => this._loose.pick(h));
      player.on('putdown', ({ handle, x, y }) => this._loose.place(handle, x, y));
      player.on('throw', ({ handle, x, y, vx, vy }) => this._loose.throw(handle, x, y, vx, vy));
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._loose.destroy());

    // ── Gits: timmies, king timmies, spike gits ──────────────────────────
    // The most common things in the game. Placed timmies sit locked to
    // their block until it dies, then walk; the hoover takes them, and
    // they count. See gits.js.
    // GOT and the puff: what a thing taken leaves in the air (popups.js)
    this._popups = hasProps(this) && PROP_ANIMS.got ? new Popups(this) : null;
    if (this._popups) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._popups.destroy());
    const got = (x, y, worth) => this._popups && this._popups.got(x, y, worth);
    const puff = (x, y, w, h) => this._popups && this._popups.puff(x, y, w, h);
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
        jacks: () => this._liveJacks().map((j) => j.player),
        got,
        // a falling block over a timmy (probe_crusher 0x60a00)
        crusher: (left, right, top, feet) => (this._collapse
          ? this._collapse.over(left, right, top, feet) : null),
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
        bin: (x, y, vy) => !!this._bins && this._bins.take(x, y, vy),
      })
      : null;
    if (this._gits) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._gits.destroy());

    // ── Timmy bins (.OB classes 18-21, only in 8K) ───────────────────────
    // A timmy that comes down into one is swallowed and counts; once the
    // level's number is in, the bell lets go. See timmyBins.js.
    this._bins = this._gits && PROP_ANIMS.timbin && (level.bins || []).length
      ? new TimmyBins(this, level.bins, {
        floor: (x, from, to) => (to >= bottom ? bottom : floorUnder(blockAt, x, from, to)),
        credit: () => {
          this._gits.collected += 1;
          this._timmyText.setText(`ТИММИ ${this._gits.collected}`);
          if (this._bellBins > 0) {
            this._bellBins -= 1;
            if (this._bellBins === 0) this._releaseBell(SFX.BELL_FREED_BINS);
            this._showBins();
          }
        },
        hop: () => this.cameras.main.shake(120, 0.006),
      })
      : null;
    if (this._bins) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._bins.destroy());
    // ── Bonuses, dispensers, secret panels ───────────────────────────────
    // .OB classes 33, 8 and 46. See bonuses.js.
    this._superHoover = 0;     // ticks of the super hoover left (0x3f4024)
    this._doublePoints = 0;    // ticks of double points left (0x287c52)
    this._secrets = 0;         // panels taken (level_state +0x18)
    this._bonuses = hasProps(this) && PROP_ANIMS.dis
      ? new Bonuses(this, level, {
        puff,
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
        jacks: () => this._liveJacks().map((j) => j.player),
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
          if (this._online()) sm.emit(EVENTS.TIME_BONUS, { seconds });
          else {
            this._timeLeft += seconds;
            this._showClock(this._timeLeft);
          }
          this._flashBonus(`+${seconds} СЕК`);
        },
        superHoover: (ticks) => { this._superHoover = ticks; },
        shown: (sprite) => this._camTrack(sprite, CAM_TICKS.hoover),
        doublePoints: (ticks) => { this._doublePoints = ticks; },
        secret: (jack) => {
          // jack_touch_panel 0x1bacb: 32 sparks round him, sounds 0x8d, 0x8c
          this._secrets += 1;
          if (this._popups) this._popups.sparks(jack);
          playSfx(SFX.PANEL_A);
          playSfx(SFX.PANEL_B);
          this.cameras.main.shake(120, 0.004);
          this._flashBonus('СЕКРЕТ!');
        },
        shake: () => this.cameras.main.shake(120, 0.006),
      })
      : null;
    if (this._bonuses) this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._bonuses.destroy());

    // Hurt, he loses timmies (spill_timmies, VA 0x338d0): each thrown up
    // at -6 px/tick with a random kick, and off his count.
    this._jacks.forEach(({ player }) => player.on('spill', (count) => {
      if (!this._gits) return;
      const own = this._gits.collectedBy.get(player) || 0;
      const n = Math.min(count, own, this._gits.collected);
      for (let i = 0; i < n; i += 1) {
        this._gits.spawnFree(player.x, player.y - 20, (Math.random() * 2 - 1) * 2, -6);
      }
      this._gits.collected -= n;
      this._gits.collectedBy.set(player, own - n);
      this._timmyText.setText(`ТИММИ ${this._gits.collected}`);
    }));

    // ── UFOs ──────────────────────────────────────────────────────────────
    // .OB class 31, in 36 levels: they abduct timmies, knock Jack flying,
    // and land — when one can be hit from above. See ufos.js.
    this._ufos = hasProps(this) && PROP_ANIMS.ufo && level.ufo
      ? new Ufos(this, level.ufo, {
        bounds: { left: 0, right: levelWidth, top: 0, bottom },
        blockAt,
        groundY: bottom,
        jacks: () => this._liveJacks().map((j) => j.player),
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

    // Colliders. Jacks pass through one another, as in the original.
    this._jacks.forEach(({ player }) => {
      this.physics.add.collider(player, this._platforms);
      this.physics.add.collider(player, this._destructibles);
    });

    // ── Input ─────────────────────────────────────────────────────────────────
    // The game's six keys are LEFT RIGHT UP DOWN BUT1 BUT2 (VA 0x912c9), and
    // on the keyboard every action is a combination of them: BUT1 takes the
    // hammer out of the hat and puts it back (with UP held, the hoover), BUT2
    // jumps empty-handed and swings the hammer when it is out. Each Jack has
    // his own six (see input/keySets.js and Player.update).

    // ── Camera ────────────────────────────────────────────────────────────────
    // The original's screen is 320x240 "mode X" with the play field clipped
    // to its top 200 lines (the sprite blitter, VA 0x34ed8, stops at x 0x140 and y 200);
    // the rest is the panel. So the world camera shows exactly 320x200 of
    // the level, scaled to the canvas width, and the HUD gets the strip
    // below it, on a camera of its own that does not zoom.
    const zoom = this.scale.width / VIEW_WIDTH;
    this.cameras.main
      .setViewport(0, 0, this.scale.width, VIEW_HEIGHT * zoom)
      .setZoom(zoom);
    this._cam = null;
    this._updateCamera(0);
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

    // Timer — centered in the panel. Online the server keeps the clock; at
    // one keyboard this scene does, a second per 60 ticks (VA 0x19dce) from
    // the level's own limit (rules +0x38; 20:00 where it has none).
    this.timerText = this._hud(this.add.text(400, panelTop + 10, '', {
      fontSize: '32px',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(10));
    this._timeLeft = level.timeLimit || DEFAULT_TIME;
    this._clockMs = 0;
    this._over = false;
    this._quitting = false; // quit from the pause menu, the level ending
    // In the arcade the clock starts at 0 and counts up, in tenths.
    this._tenths = 0;
    if (this._arcade) this.timerText.setText(formatTenths(0));
    else this._showClock(this._timeLeft);

    // Mode label — panel right
    const modeLabel = this._modeLabel();
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
      `${this._modeLabel()} | ${this._roomCode}`, {
        fontSize: '11px',
        color: '#555555',
      }).setOrigin(1, 1));

    /** Rubble hoovered up, as the game counts it: area / 16 a piece. */
    this._rubbleTaken = 0;
    /**
     * The panel's rubble number (0x287bec): the same additions, less 10000
     * for each life it has paid (rubble_extra_life_tick, see _lifeTick).
     * G.EXE is run afresh for each level, so it starts at 0.
     */
    this._panelRubble = 0;
    this._lifeFlash = 0;
    this._lifeAcc = 0;
    this._rubbleText = this._hud(this.add.text(784, panelTop + 40, `МУСОР ${this._panelRubble}`, {
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
    /** How much is trashed, while a bell waits for it — under the clock. */
    this._trashText = this._hud(this.add.text(400, panelTop + 52, '', {
      fontSize: '16px',
      fill: '#ffcc33',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(10));
    this._showTrash();
    this._showBins();

    this._debugText =this._hud(this.add.text(220, this.scale.height - 4, '', {
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

    // A tie-break is for those sharing the top; the rest look on.
    if (this._active) {
      this._jacks.forEach((j) => {
        if (!this._active.includes(j.data.id)) this._leaveLevel(j);
      });
      this._flashBonus(`ТАЙ-БРЕЙК: ${this._active.map((id) => this._nameOf(id)).join(' и ')}`);
    }
    if (this._arcade) {
      this._flashBonus(missionText(this._arcade.entry.mission), 3500);
    }

    // Esc pauses a game played at this keyboard (PauseScene.js).
    if (this._local) {
      this.input.keyboard.on('keydown-ESC', () => this._pause());
    }

    console.log('[GameScene] created', {
      levelId: this._levelId,
      mode: this._mode,
      players: this._players.length,
      local: this._jacks.length,
    });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(time, delta) {
    if (!this._jacks) return;
    this._tickClock(delta);
    const live = this._liveJacks();
    if (live.length === 0) {
      this._bell.update(delta);
      return;
    }

    // A tap shorter than a frame still counts: JustDown latches it, where
    // testing isDown would miss a key that was already back up by the time
    // we looked.
    const { JustDown } = Phaser.Input.Keyboard;
    live.forEach((j) => {
      const { pad, player } = j;
      const but2Pressed = JustDown(pad.but2);
      const but1Pressed = JustDown(pad.but1);
      j.keysNow = { but1: but1Pressed, but2Pressed };
      // The speed physics moved him at this frame, before he sets the next
      // one: what a cannon he pushes moves at too, or it runs a frame ahead.
      j.movedVx = player.body.velocity.x;
      player.update(pad, {
        but1: but1Pressed,
        but2: but2Pressed || pad.but2.isDown,
        but2Pressed,
      }, delta);
    });

    this._collapse.update(delta);
    if (this._rocket) this._tickRocket(delta, live);
    // The super hoover takes the rubble from a box 2048 x 1024 ahead of
    // him, not 32 x 32 (VA 0x61740), and blinks; double points count each
    // piece twice (VA 0x19fd2).
    const ticks = (delta * 60) / 1000;
    this._superHoover = Math.max(0, this._superHoover - ticks);
    this._doublePoints = Math.max(0, this._doublePoints - ticks);
    const hoovers = [];
    live.forEach(({ player }) => {
      let box = player.hooverBox;
      if (box && this._superHoover > 0) {
        const ahead = player.facingLeft ? player.x - 40 - 2048 : player.x + 40;
        box = new Phaser.Geom.Rectangle(ahead, player.y - 512, 2048, 1024);
      }
      if (player.vac) {
        player.vac.setAlpha(this._superHoover > 0 && (this.time.now / (1000 / 60)) & 8 ? 0.5 : 1);
      }
      if (box) hoovers.push({ box, nozzle: player.nozzle, who: player });
    });
    let taken = 0;
    this._rubble.update(delta, hoovers).forEach((n) => { taken += n; });
    if (taken && this._doublePoints > 0) taken *= 2;
    if (taken) {
      this._rubbleTaken += taken;
      this._panelRubble += taken;
      this._rubbleText.setText(`МУСОР ${this._panelRubble}`);
    }
    for (this._lifeAcc += ticks; this._lifeAcc >= 1; this._lifeAcc -= 1) this._lifeTick();

    // ── The bell ──────────────────────────────────────────────────────────
    // It is rung by a blow from above, not by a touch: see _ringBell.
    this._bell.update(delta);
    if (this._buttons) {
      this._buttons.update(delta, this._options,
        (b, ticks) => this._camTrack(b, ticks));
    }
    for (this._eventAcc += ticks; this._eventAcc >= 1; this._eventAcc -= 1) this._optionsTick();
    if (this._bonusRound && !this._over) this._bonusRound.update(delta);
    this._tickDynamite(time);
    if (this._cannons) this._tickCannons(delta);
    const stillIn = this._liveJacks();
    if (this._tellies) {
      stillIn.forEach(({ player }) => {
        if (player.state !== 'caught' && player.state !== 'driving') this._tellies.meet(player);
      });
      this._tellies.update(delta,
        (pl, x, y, sx, sy) => pl.holdAt(x, y, sx, sy),
        (pl) => pl.letGo());
    }
    if (this._suckers) {
      stillIn.forEach(({ player }) => {
        if (player.state !== 'caught' && player.state !== 'driving') this._suckers.catchJack(player);
      });
      this._suckers.update(delta,
        (pl, x, y) => pl.holdAt(x, y),
        (pl, x, y, vy) => pl.thrownUp(x, y, vy));
    }

    if (this._ufos) this._ufos.update(delta);
    if (this._bonuses) this._bonuses.update(delta);
    if (this._popups) this._popups.update(delta);
    if (this._bins) this._bins.update(delta);
    if (this._flags) this._flags.update(delta);
    if (this._gits) {
      const got = this._gits.update(delta, hoovers);
      if (got) this._timmyText.setText(`ТИММИ ${this._gits.collected}`);
    }
    if (this._seesaws) this._seesaws.update(stillIn.map((j) => j.player), this._seesawHooks);

    // A stick that goes off in his hands is gone from them.
    const carries = [];
    const aims = [];
    stillIn.forEach(({ player }) => {
      const held = player.carried;
      if (held && !held.sprite.active) player.dropCarried();
      if (player.carried) carries.push({ handle: player.carried, point: player.carryPoint });
      if (player.aim) aims.push(player.aim);
    });
    this._loose.update(delta, carries, aims);

    // ── Throttled player update (for future socket send) ──────────────────────
    if (time - this._lastUpdateSent >= PLAYER_UPDATE_INTERVAL) {
      this._lastUpdateSent = time;
      this._emitPlayerUpdate();
    }

    // ── Fell out of the level ─────────────────────────────────────────────────
    // Levels converted from the original are open at the bottom, so a missed
    // jump drops you into nothing. Put the player back on the start ledge.
    stillIn.forEach(({ player, spawn }) => {
      if (player.y > this._levelHeight + 120) {
        player.setPosition(spawn.x, spawn.y);
        player.body.setVelocity(0, 0);
      }
    });

    this._updateCamera(delta);

    // ── Remote players interpolation ──────────────────────────────────────────
    this.remotePlayers.forEach((rp) => rp.update());

    // ── Debug HUD ─────────────────────────────────────────────────────────────
    const pl = this._jacks[0].player;
    const b = pl.body;
    this._debugText.setText(
      `x:${Math.round(pl.x)} y:${Math.round(pl.y)} state:${pl.state} vx:${Math.round(b.velocity.x)} vy:${Math.round(b.velocity.y)}`,
    );
  }

  /** The clock on the panel; under 0:20 it flashes (VA 0x19e8b). */
  _showClock(timeLeft) {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
    if (timeLeft < 20) {
      this.timerText.setStyle({ fill: timeLeft % 2 ? '#ff4444' : '#ffffff', stroke: '#000000', strokeThickness: 4 });
    }
  }

  /** The clock run here, when no server does: down a second a second. */
  _tickClock(delta) {
    if (this._online() || this._over) return;
    if (this._arcade) {
      // up a tenth every 6 ticks, to 60:00.0 and no further (VA 0x19edb)
      this._clockMs += delta;
      while (this._clockMs >= 100 && this._tenths < ARCADE_MAX_TENTHS) {
        this._clockMs -= 100;
        this._tenths += 1;
      }
      this.timerText.setText(formatTenths(this._tenths));
      return;
    }
    this._clockMs += delta;
    while (this._clockMs >= 1000 && this._timeLeft > 0) {
      this._clockMs -= 1000;
      this._timeLeft -= 1;
      this._showClock(this._timeLeft);
    }
    if (this._timeLeft <= 0) this._timeUp();
  }

  /** Out of time at one keyboard: the level is lost (state 3) — play it again. */
  _timeUp() {
    // the object burst: the round is won, whatever the clock says
    if (this._bonusRound && this._bonusRound.burst) return;
    if (this._localBattle) {
      // those who rang are placed, the rest score nothing, the set goes on
      this._endLocalBattleLevel(true);
      return;
    }
    this._over = true;
    this._jacks.forEach((j) => { if (!j.rang) this._leaveLevel(j); });
    if (this._story) {
      this.showResultOverlay('ВРЕМЯ ВЫШЛО', 'Уровень проигран', { then: () => this._backToMap('lost') });
      return;
    }
    this.showResultOverlay('ВРЕМЯ ВЫШЛО', 'Попробуйте ещё раз', { nextLevel: this._levelId });
  }

  /** A battle level over at one keyboard: the places score, then on. */
  _endLocalBattleLevel(timeout) {
    this._over = true;
    this._jacks.forEach((j) => { if (!j.rang) this._leaveLevel(j); });
    const result = this._localBattle.endLevel(this._rung.map((j) => j.data.id), timeout);
    const { title, text } = this._battleLevelText(result);
    this.showResultOverlay(title, text, { then: () => this._nextLocalBattleStep() });
  }

  /** A team has all rung: its time is kept, and the next team goes. */
  _endArcadeTurn() {
    this._over = true;
    const a = this._arcade;
    const team = a.current + 1;
    const time = this._tenths;
    const more = a.record(time);
    const best = a.best === time ? 'РЕКОРД!' : `Рекорд ${formatTenths(a.best)}`;
    if (more) {
      this.showResultOverlay(`КОМАНДА ${team}: ${formatTenths(time)}`,
        `${best}\nДальше играет команда ${a.current + 1}`,
        { then: () => this._startLevel(this._levelId) });
      return;
    }
    const table = a.standings()
      .map((r) => `${r.place}. КОМАНДА ${r.team + 1} — ${r.time === null ? '—' : formatTenths(r.time)}`)
      .join('\n');
    this.showResultOverlay(a.teams > 1 ? 'ИТОГИ АРКАДЫ' : `ВРЕМЯ ${formatTenths(time)}`,
      a.teams > 1 ? table : missionText(a.entry.mission));
  }

  _nextLocalBattleStep() {
    const step = this._localBattle.next();
    if (step.over) {
      const { title, text } = this._battleOverText(step);
      this.showResultOverlay(title, text);
      return;
    }
    this._startLevel(step.level, { battle: step.battle, active: step.active });
  }

  /** The panel after a battle level: who rang in what order, what it scored. */
  _battleLevelText({
    places = [], award = {}, points = {}, battle, timeout,
  }) {
    const text = Object.keys(points)
      .sort((a, b) => points[b] - points[a])
      .map((id) => {
        const place = places.indexOf(id);
        const at = place >= 0 ? `${place + 1}-й` : 'не дозвонился';
        return `${this._nameOf(id)}: ${at}, +${award[id] || 0} = ${points[id]}`;
      }).join('\n');
    const head = battle.tieBreak ? 'ТАЙ-БРЕЙК' : `УРОВЕНЬ ${battle.level} ИЗ ${battle.of}`;
    return { title: timeout ? `${head}: ВРЕМЯ ВЫШЛО` : head, text };
  }

  /** The set is played (F.EXE VA 0x13e80): the points and the winner. */
  _battleOverText({ winners = [], points = {} }) {
    const text = Object.entries(points).sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => `${this._nameOf(id)} — ${pts}`).join('\n');
    const title = !this._local && winners.includes(this._myPlayerId)
      ? 'ВЫ ПОБЕДИЛИ!' : `ПОБЕДИЛ ${this._nameOf(winners[0])}`;
    return { title, text };
  }

  /** Whether this game goes through the server: not when played at one keyboard. */
  _online() {
    return !this._local && !!SocketManager.getInstance().socket;
  }

  /** The Jacks still in the level: not yet rung, not looking on. */
  _liveJacks() {
    return this._jacks.filter((j) => !j.rang);
  }

  /**
   * The original's camera (VA 0x2c22f): the box round every Jack still in
   * the level, its margins added, as wide as it must be for its height at
   * 320:200 and no narrower than the screen's 320 — so one Jack is seen at
   * 1:1, and the view draws back as the players spread out. Eased toward,
   * except the first time.
   */
  _updateCamera(delta) {
    let jacks = this._liveJacks();
    if (jacks.length === 0) jacks = this._jacks;
    // and whatever has joined the list for a while (camera_targets_bounds,
    // VA 0x1daa7, see docs/re/logic/camera.md): one that has died leaves it;
    // one that waits does not count down until it has stopped once; the
    // priority ones, while there are any, are framed alone — the Jacks too
    // are only list entries in the original, so the rung bell has the
    // screen to itself.
    const ticks = (delta * 60) / 1000;
    this._camTargets = (this._camTargets || []).filter((t) => {
      if (t.follow && t.follow.active === false) return false;
      if (t.wait) {
        if (!t.moving()) t.wait = false;
        return true;
      }
      t.ticks -= ticks;
      return t.ticks > 0;
    });
    const at = (t) => (t.follow ? t.follow : t);
    const first = this._camTargets.filter((t) => t.priority);
    const points = first.length ? first.map(at)
      : jacks.map((j) => j.player).concat(this._camTargets.map(at));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs) - CAM_MARGIN.side;
    const x1 = Math.max(...xs) + CAM_MARGIN.side;
    const y0 = Math.min(...ys) - CAM_MARGIN.top;
    const y1 = Math.max(...ys) + CAM_MARGIN.bottom;
    const w = x1 - x0;
    const h = y1 - y0;
    const want = {
      x: x0 + w / 2,
      y: y0 + h / 2,
      width: Phaser.Math.Clamp(Math.max(w, (h * VIEW_WIDTH) / VIEW_HEIGHT), VIEW_WIDTH, VIEW_MAX),
    };
    if (!this._cam) {
      this._cam = want;
    } else {
      const ease = (k) => 1 - (1 - k) ** ticks;
      this._cam.x += (want.x - this._cam.x) * ease(CAM_EASE);
      this._cam.y += (want.y - this._cam.y) * ease(CAM_EASE);
      this._cam.width += (want.width - this._cam.width) * ease(CAM_ZOOM_EASE);
    }
    this._cam.y = Math.min(this._cam.y, this._street.ground - CAM_LOWEST);
    // Sideways it keeps to the street, as the clone always has.
    const { left, right } = this._street;
    const half = this._cam.width / 2;
    const x = right - left <= this._cam.width
      ? (left + right) / 2
      : Phaser.Math.Clamp(this._cam.x, left + half, right - half);
    const cam = this.cameras.main;
    cam.setZoom(this.scale.width / this._cam.width);
    cam.centerOn(x, this._cam.y);
  }

  /**
   * camera_track (VA 0x1d9d6): something the camera takes in for `ticks`.
   * `moving` given, the count waits until it has stopped (flag 2);
   * `priority`, it is framed alone (flag 8).
   * @param {{x: number, y: number, active?: boolean}} follow
   * @param {number} ticks
   * @param {{moving?: () => boolean, priority?: boolean}} [opts]
   */
  _camTrack(follow, ticks, { moving = null, priority = false } = {}) {
    this._camTargets.push({ follow, ticks, wait: !!moving, moving, priority });
  }

  /** camera_point (VA 0x1da48): a fixed point for `ticks` (flag 4). */
  _camPoint(x, y, ticks) {
    this._camTargets.push({ x, y, ticks });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Put a game object on the HUD camera instead of the world one.
   * @template T
   * @param {T} obj
   * @returns {T}
   */
  /** A word in the middle of the panel for a moment — a bonus taken. */
  _flashBonus(text, ms = 1200) {
    // at the foot of the play field, clear of the clock in the panel
    const y = VIEW_HEIGHT * (this.scale.width / VIEW_WIDTH) - 40;
    const t = this._hud(this.add.text(this.scale.width / 2, y, text, {
      fontFamily: 'monospace', fontSize: '22px', fill: '#ffee55', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(1000));
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 20, duration: ms, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
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
  _hammerCells(pl) {
    const { dx, dy, w, h } = pl.hammerStats.reach;
    const dir = pl.facingLeft ? -1 : 1;
    const ox = Math.round(pl.x) + dir * dx;
    const oy = Math.round(pl.y) + dy;
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
   * The overhead strike's box: from Jack's feet, his hammer's `overBox` ahead
   * and down, mirrored when he faces left (VA 0x2f1d7).
   */
  _overheadBox(pl) {
    const { dx, dy, w, h } = pl.hammerStats.overBox;
    const x = Math.round(pl.x);
    const left = pl.facingLeft ? x - dx - w + 1 : x + dx;
    return new Phaser.Geom.Rectangle(left, Math.round(pl.y) + dy, w, h);
  }

  /**
   * A blow landing. The sideways blow carries the hammer's ramp at the
   * charge it was let go with into the blocks under its cells, until
   * his hammer's `strikes` have been struck. The overhead blow strikes no blocks
   * — in the game it goes to sprites only (VA 0x1fd94) — so here it only
   * reaches what is not a block.
   * @param {{charge: number, overhead: boolean}} blow
   * @param {Player} pl whose hammer it is
   */
  _checkHammerDestructibles({ charge, overhead }, pl) {
    let reach;
    if (overhead) {
      reach = this._overheadBox(pl);
    } else if (this._bonusRound) {
      // On a bonus screen the blow strikes no block, only the object: its
      // force times the hammer's `bonus`, at the blow's own point (VA 0x1f935).
      const stats = pl.hammerStats;
      const dir = pl.facingLeft ? -1 : 1;
      this._bonusRound.hit(Math.round(pl.x) + dir * stats.reach.dx, Math.round(pl.y) + stats.reach.dy,
        Math.imul(hammerForce(charge, stats, pl.heldAim), stats.bonus || 1));
      return;
    } else {
      const stats = pl.hammerStats;
      const force = hammerForce(charge, stats, pl.heldAim);
      const cells = this._hammerCells(pl);
      const blocks = [...this._destructibleMap.values()].filter((e) => e.rect.active);
      let left = hammerStrikes(stats, pl.heldAim);
      for (const c of cells) {
        if (left <= 0) break;
        const hit = blocks.find((e) => e.rect.active && e.rect.getBounds().contains(c.x, c.y));
        if (!hit) continue;
        // each struck cell sounds of its block's material, a tick apart (VA 0x1fb6e)
        playSfx(BLOW_BY_MATERIAL[hit.mat] || BLOW_BY_MATERIAL[0], { delay: left & 7 });
        this._applyForce(hit, force, 0, { tally: new Map(), visits: 0, mask: stats.mask });
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
    this._ringBell(reach, pl);
    if (this._buttons) this._setOptions(this._buttons.hit(reach));
    if (this._cannons) this._cannons.hit(reach);
    if (this._suckers) {
      this._suckers.hit(reach, (s) => this._camTrack(s.base, CAM_TICKS.sucker,
        { moving: () => s.handle.flying || s.handle.carried }));
    }
    if (this._ufos) this._ufos.hit(reach);
    if (this._seesaws) this._seesaws.hit(reach, this._seesawHooks);
    if (this._gits) this._gits.hit(reach);
    if (this._bonuses) this._bonuses.hit(reach);
    this._dynamite.forEach((d) => {
      if (d.lit || d.litBy !== 'hammer' || !d.sprite.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(reach, d.sprite.getBounds())) {
        d.lit = this.time.now + FUSE_MS;
        playSfx(SFX.DYNA_STRUCK);   // dyna_hammer_state
      }
    });
  }

  /**
   * Pushing (VA 0x28771 → 0x27f96): in the stance, he takes hold of a
   * cannon on wheels his box overlaps, and while it still does it rolls at
   * his speed. Out of the stance, or apart, it rolls on by itself.
   */
  _tickCannons(delta) {
    const live = this._liveJacks();
    live.forEach(({ player: pl }) => {
      if (pl.pushing && !this._cannons.all.some((c) => c.heldBy === pl)) {
        const c = this._cannons.find(pl.getBounds(), pl.facingLeft);
        if (c && !c.heldBy) c.heldBy = pl;
      }
    });
    this._cannons.update(delta, (c) => {
      const j = c.heldBy ? live.find((k) => k.player === c.heldBy) : null;
      if (!j || !j.player.pushing || !this._cannons.touches(c, j.player.getBounds())) {
        c.heldBy = null;
        return null;
      }
      return j.movedVx / 60;
    });
  }

  /**
   * The forklifts: a Jack in a seat drives — BUT2 gets him out — and one
   * jumping into a free seat gets in (VA 0x1c19f, 0x2b86b).
   */
  _tickRocket(delta, live) {
    live.forEach((j) => {
      const f = this._rocket.drivenBy(j.player);
      if (f) {
        if (j.keysNow && j.keysNow.but2Pressed) this._rocket.leave(f);
      } else this._rocket.board(j.player);
    });
    this._rocket.update(delta, (f) => {
      const j = live.find((k) => k.player === f.driver);
      if (!j) return null;
      const { pad } = j;
      // a press shifts once, however many ticks this frame runs
      const shift = !!(j.keysNow && j.keysNow.but1);
      if (shift) j.keysNow.but1 = false;
      return {
        left: pad.left.isDown, right: pad.right.isDown, up: pad.up.isDown, down: pad.down.isDown, shift,
      };
    });
  }

  /** Burns the lit fuses and sets off the ones that run out. */
  _tickDynamite(time) {
    // The other kind lights at Jack's touch.
    const bodies = this._liveJacks().map((j) => j.player.getBounds());
    this._dynamite.forEach((d) => {
      if (d.lit || d.litBy !== 'touch' || !d.sprite.active) return;
      const box = d.sprite.getBounds();
      if (bodies.some((b) => Phaser.Geom.Intersects.RectangleToRectangle(b, box))) {
        d.lit = time + FUSE_MS;
        playSfx(SFX.DYNA_LIT);      // dyna_touched_outcome
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
    playSfx(SFX.DYNA_BOOM);       // dyna_explode
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
    this._liveJacks().forEach(({ player }) => {
      if (Phaser.Geom.Intersects.RectangleToRectangle(shock, player.getBounds())) {
        player.blasted(shockAt.x, shockAt.y);
      }
    });
    if (this._gits) this._gits.blasted(shockAt.x, shockAt.y, shock);
    if (this._buttons) this._setOptions(this._buttons.hit(shock));
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
      this._rubble.add(entry.rect, blow.mask || HAMMER_RUBBLE_MASK, entry.mat);
      blow.cells = (blow.cells || 0) + (entry.width >> 3) * (entry.height >> 3);
      this._forgetBlock(entry);
    } else if (entry.rect.setFillStyle) {
      entry.rect.setFillStyle(WORLD_COLORS.rubbleDark); // plain rectangle
    } else {
      entry.rect.setTint(0x996655); // real block: darken the artwork
    }

    if (depth === 0) {
      // a blow that brought down more than 20 cells crashes (VA 0x1fc47)
      if (blow.cells > 20) playSfx(SFX.BLOCKS_DOWN);
      this._reportBlow(blow);
    }
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
    if (!this._online()) return;
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
    // what it came down on sounds of its material (group_landed, table 0x9ff14)
    const on = hit || hitter;
    if (on) playSfx(LAND_BY_MATERIAL[on.mat] || LAND_BY_MATERIAL[0], { delay: Math.floor(Math.random() * 4) });
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
    this._destroyedCount += 1;
    this._showTrash();
  }

  /** Bits into the level's options, as a button sets them (VA 0x172a9). */
  _setOptions(bits) {
    this._options |= bits;
    if (this._bellRocket && (this._options & OPT_ROCKET)) {
      this._bellRocket = false;
      this._releaseBell(SFX.BELL_FREED_BINS);   // bell_wait_option_800
    }
  }

  /**
   * One tick of what watches the options. The first tick 0x1000 is set
   * without 0x2000, the level's big event goes off (watcher 0x1b089, by the
   * rules record's +0x26); then the demolition counts down (0x2043c).
   */
  _optionsTick() {
    if ((this._options & (OPT_BIG_EVENT | OPT_BIG_EVENT_DONE)) === OPT_BIG_EVENT) {
      this._options |= OPT_BIG_EVENT_DONE;
      // 1D's own event is the dragon show (0x204be, docs/re/levels/dragon-show.md),
      // which brings the level down at its end; until the clone has it, 1D
      // is brought down the 2T way.
      if (this._bigEvent) this._startDemolition();
    }
    if (this._demolishIn <= 0) return;
    if (this._demolishIn === DEMOLISH_SHAKE_AT) this.cameras.main.shake(300, 0.01);
    this._demolishIn -= 1;
    if (this._demolishIn === 0) this._demolishAll();
  }

  /** demolition_start (VA 0x1b0f6): the count, and the camera drawn back. */
  _startDemolition() {
    this._demolishIn = DEMOLISH_TICKS;
    const g = this._street.ground;
    this._camPoint((this._street.left + this._street.right) / 2, g - DEMOLISH_CAM.over, DEMOLISH_CAM.ticks);
  }

  /**
   * demolish_all (VA 0x206c0): every object still in the level is turned to
   * rubble at once — the unbreakable ones too, which is what lets 2T, 4T and
   * BA ask for more than their breakable share (docs/re/levels/percentage-check.md).
   */
  _demolishAll() {
    this._options |= OPT_DEMOLISHED;
    [...this._destructibleMap.values()].forEach((entry) => {
      if (!entry.rect.active) return;
      this._rubble.add(entry.rect, DEMOLISH_RUBBLE_MASK, entry.mat);
      this._forgetBlock(entry);
    });
    playSfx(DEMOLISH_SFX);
  }

  /** `destroyed_percent`: what share of the level's objects is gone. */
  _trashPercent() {
    return this._objectTotal ? Math.floor(this._destroyedCount * 100 / this._objectTotal) : 0;
  }

  /** The readout under the clock, and the bell let go once it is earned. */
  _showTrash() {
    if (!this._bellTrash || !this._trashText) return;
    const pct = this._trashPercent();
    if (pct >= this._bellTrash) {
      this._bellTrash = 0;
      this._trashText.setText('');
      this._releaseBell();
      return;
    }
    this._trashText.setText(`РАЗНЕСИ ${this._bellTrash}%: ${pct}%`);
  }

  /** 8K's "collect the timmies": how many the bin still wants. */
  _showBins() {
    if (!this._trashText || this._bellTrash) return;
    this._trashText.setText(this._bellBins > 0 ? `ТИММИ В БАК: ${this._bellBins}` : '');
  }

  /** The bell pops into view: kicked up, and down it comes (VA 0x340af). */
  _releaseBell(sound = SFX.BELL_FREED_PCT) {
    this._bell.release();
    this._camTrack(this._bell, CAM_TICKS.bellFree);
    playSfx(sound);   // bell_wait_percent 0x8f, bell_wait_option_800 0x82
    this._flashBonus('КОЛОКОЛЬЧИК!');
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

  /**
   * An overhead blow's reach against the bell. bell_touch_tick (VA 0x34114)
   * rings only on the sprite's "hit from above" flag (+0x40 bit 0x80), which
   * the overhead strike sets (and the ground pound, not in the clone), and
   * only while the bell stands on something (bit 0x10) — touching it, or a
   * sideways blow, does nothing. The hitter (+8) is traced back to his Jack.
   * Every player rings it, each for himself.
   * @param {Phaser.Geom.Rectangle} reach
   * @param {Player} pl
   */
  _ringBell(reach, pl) {
    if (!this._bell || this._bell.hidden || !this._bell.grounded || this._over) return;
    if (!Phaser.Geom.Intersects.RectangleToRectangle(reach, this._bell.getBounds())) return;
    [this._liveJacks().find((k) => k.player === pl)].forEach((j) => {
      if (!j) return;
      this._bell.ring();
      // every ring, and the last one — the level over — its own (VA 0x34255, 0x342a4)
      playSfx(this._liveJacks().length > 1 ? SFX.BELL_RUNG : SFX.BELL_LAST);
      this._rung.push(j);
      // the camera to the bell: a while, or — the last ring — for itself alone
      const last = this._liveJacks().length === 1;
      this._camTrack(this._bell, last ? CAM_TICKS.bellLast : CAM_TICKS.bellRung, { priority: last });
      // Whoever rings is out of the level (Jack and hammer flagged done,
      // VA 0x34114); the level ends when everyone has rung.
      this._leaveLevel(j);

      const sm = SocketManager.getInstance();
      if (this._online()) {
        sm.emit(EVENTS.BELL_HIT, { playerId: j.data.id });
        return;
      }
      if (this._liveJacks().length > 0) {
        this._flashBonus(`${this._nameOf(j.data.id)} — ${this._rung.length}-Й`);
        // In a battle the last one left to ring has a minute at most.
        if (this._localBattle && this._liveJacks().length === 1 && this._timeLeft > LAST_ONE_SECONDS) {
          this._timeLeft = LAST_ONE_SECONDS;
          this._showClock(this._timeLeft);
        }
        return;
      }
      // Offline, at one keyboard: nobody else is going to advance the level.
      if (this._localBattle) {
        this._endLocalBattleLevel(false);
        return;
      }
      if (this._arcade) {
        this._endArcadeTurn();
        return;
      }
      this._over = true;
      const order = this._rung.length > 1
        ? this._rung.map((k, i) => `${i + 1}. ${this._nameOf(k.data.id)}`).join('\n')
        : 'Колокольчик твой';
      if (this._story) {
        this.showResultOverlay('УРОВЕНЬ ПРОЙДЕН', order, { then: () => this._backToMap('won') });
        return;
      }
      this.showResultOverlay('УРОВЕНЬ ПРОЙДЕН', order, { nextLevel: nextLevelId(this._levelId) });
    });
  }

  /** A bonus screen's object burst: the round is won, by everyone. */
  _bonusWon() {
    if (this._over) return;
    this._over = true;
    this._jacks.forEach((j) => { if (!j.rang) this._leaveLevel(j); });
    if (this._story) {
      this.showResultOverlay('БОНУС ПРОЙДЕН', '', { then: () => this._backToMap('won') });
      return;
    }
    this.showResultOverlay('БОНУС ПРОЙДЕН', '', { nextLevel: nextLevelId(this._levelId) });
  }

  /** Esc: the game stops under the pause menu (pause_game 0x1007c). */
  _pause() {
    if (this._over || this._quitting) return;
    this.scene.pause();
    // the story's and the arcade's menu has quit level, battle's not
    // (pause_hud 0x1aaa8 tests option 0x10000000 only); the coop is the clone's
    this.scene.launch('PauseScene', {
      menu: this._story || this._arcade ? 0 : 2,
      done: (state) => this._unpause(state),
    });
  }

  /**
   * The pause over: resumed, or quit — then, as in G.EXE, the level plays
   * on for 25 more ticks before it ends (0xa2f16 = 25, logic_frame
   * 0x2cbb9). Quitting a story level is state 0x11: back to the map, which
   * takes a life for it (F.EXE 0x20e1d, Story.quit); quitting the game is
   * 0x10, back to the menu — as is an arcade level quit, which keeps no
   * time (F.EXE 0x214c2).
   */
  _unpause(state) {
    this.scene.resume();
    // a button that picked from the menu is not a press in the game
    this._keys.settle();
    if (state === null) return;
    this._quitting = true;
    this.time.delayedCall(25 * 1000 / 60, () => {
      if (this._over) return;
      this._over = true;
      if (state === QUIT_LEVEL && this._story) this._backToMap('quit');
      else this.scene.start('MenuScene');
    });
  }

  /**
   * A life for 10000 of rubble (rubble_extra_life_tick 0x1a9b0, list
   * 0x97284 — the story's panel only, so not in a bonus round; see
   * docs/re/front/level-record.md). Past 10000 the number flashes 64
   * ticks; then 10000 comes off it and off the story's score, the lives
   * go up one, 32 panel sparks fly round Jack 1, sounds 0x8d and 0x8c.
   * The rubble the level hands on at its end is not reduced.
   */
  _lifeTick() {
    if (!this._story || this._bonusRound) return;
    if (this._lifeFlash === 0) {
      if (this._panelRubble > 10000) this._lifeFlash = 64;
      return;
    }
    this._lifeFlash -= 1;
    this._rubbleText.setVisible(this._lifeFlash === 0 || (this._lifeFlash & 4) === 0);
    if (this._lifeFlash !== 1) return;
    this._panelRubble -= 10000;
    this._rubbleText.setText(`МУСОР ${this._panelRubble}`);
    this._story.score -= 10000;
    this._story.lives += 1;
    this._modeLabelText.setText(this._modeLabel());
    this._modeText.setText(`${this._modeLabel()} | ${this._roomCode}`);
    const first = this._jacks[0] && this._jacks[0].player;
    if (this._popups && first) this._popups.sparks(first);
    playSfx(SFX.PANEL_A);
    playSfx(SFX.PANEL_B);
    this._flashBonus('+1 ЖИЗНЬ');
  }

  /** The story goes on on the world map, the level won or lost. */
  _backToMap(result) {
    // What the level leaves in the shared record for F.EXE
    // (print_level_counters 0x10a62, docs/re/front/level-record.md): the
    // rubble as the score, player 1's timmies, a life per panel taken.
    const first = this._jacks[0] && this._jacks[0].player;
    const tally = {
      score: this._rubbleTaken || 0,
      timmies: (this._gits && first && this._gits.collectedBy.get(first)) || 0,
      lives: this._secrets || 0,
    };
    this.scene.start('WorldMapScene', { players: this._players, story: this._story, result, tally });
  }

  /** A player has rung, or looks on: his Jack leaves the level, the others go on. */
  _leaveLevel(j) {
    j.rang = true;
    const pl = j.player;
    pl.setVisible(false);
    pl.body.setVelocity(0, 0);
    pl.body.enable = false;
    if (pl.art) pl.art.setVisible(false);
    if (pl.hammer) pl.hammer.setVisible(false);
    if (pl.vac) pl.vac.setVisible(false);
    if (pl.carried) pl.dropCarried();
    if (this.remotePlayers && this.remotePlayers.size > 0 && !this._active) this._flashBonus('ЖДЁМ ОСТАЛЬНЫХ');
  }

  /**
   * Send local player position to server via SocketManager.
   */
  _emitPlayerUpdate() {
    if (!this._player) return;
    const sm = SocketManager.getInstance();
    if (!this._online()) return; // not connected, or playing at one keyboard
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
  _startLevel(levelId, extra = {}) {
    this.scene.restart({
      roomCode: this._roomCode,
      players: this._players,
      mode: this._mode,
      levelId,
      myPlayerId: this._myPlayerId,
      hostId: this._hostId,
      active: extra.active || null,
      battle: extra.battle || null,
      local: this._local,
      localBattle: this._localBattle,
      arcade: this._arcade,
      story: this._story,
    });
  }

  /** The heading of the panel's mode label: КООП, or the battle's progress. */
  _modeLabel() {
    if (this._arcade) {
      const a = this._arcade;
      const best = a.best === null ? '' : `  РЕКОРД ${formatTenths(a.best)}`;
      return `КОМАНДА ${a.current + 1}/${a.teams}${best}`;
    }
    if (this._story) return `СЮЖЕТ · ЖИЗНИ ${this._story.lives}`;
    if (this._mode !== 'battle') return 'КООП';
    const b = this._battle;
    if (!b) return 'БИТВА';
    return b.tieBreak ? 'ТАЙ-БРЕЙК' : `БИТВА ${b.level}/${b.of}`;
  }

  /** A player's name from the room's list. */
  _nameOf(id) {
    const p = this._players.find((q) => q.id === id);
    return p ? (p.name || p.id) : id;
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

    // One overlay at a time: a new one (the battle's result after its last
    // level's) takes the place of the last, countdown and all.
    (this._overlay || []).forEach((o) => o.destroy());
    if (this._overlayTimer) this._overlayTimer.remove();
    this._overlayTimer = null;
    this._overlay = [];
    const keep = (o) => { this._overlay.push(o); return o; };

    // Semi-transparent black background
    keep(this._hud(this.add.rectangle(cx, cy, width, height, 0x000000, 0.75)
      .setDepth(100)));

    // Title text
    keep(this._hud(this.add.text(cx, cy - 60, title, {
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(101)));

    // Subtitle text
    const lines = String(subtitle).split('\n').length;
    keep(this._hud(this.add.text(cx, cy + (lines > 1 ? 10 * lines : 0), subtitle, {
      fontSize: lines > 1 ? '18px' : '24px',
      align: 'center',
      lineSpacing: 6,
      color: '#cccccc',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(101)));

    // Countdown text. Online the server moves the room on by itself (its
    // game_started restarts this scene), so the overlay only waits for it;
    // leaving for the menu here dropped the player out of the room.
    const {
      nextLevel, waitServer, toLobby, then,
    } = options;
    if (waitServer) {
      keep(this._hud(this.add.text(cx, height - 40, 'Следующий уровень…', {
        fontSize: '18px',
        color: '#aaaaaa',
      }).setOrigin(0.5).setDepth(101)));
      return;
    }
    const label = (n) => (then ? `Дальше через ${n}...` : nextLevel
      ? `Следующий уровень через ${n}...`
      : `Возврат ${toLobby ? 'в лобби' : 'в меню'} через ${n}...`);
    let countdown = 3;
    // below the subtitle, however many lines it runs to
    const countdownText = keep(this._hud(this.add.text(cx, Math.max(cy + 60, cy + 22 * lines + 30), label(countdown), {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(101)));

    const timer = this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        countdown -= 1;
        if (countdown > 0) {
          countdownText.setText(label(countdown));
        } else if (then) {
          this._overlayTimer = null;
          then();
        } else if (nextLevel) {
          this._startLevel(nextLevel);
        } else if (toLobby) {
          timer.remove();
          this.scene.start('LobbyScene', {
            players: this._players, mode: this._mode, hostId: this._hostId, roomCode: this._roomCode,
          });
        } else {
          timer.remove();
          this.scene.start('MenuScene');
        }
      },
    });
    this._overlayTimer = timer;
  }

  /**
   * Wire socket events for multiplayer sync.
   * Called once from create().
   */
  _initSocketHandlers() {
    const sm = SocketManager.getInstance();
    if (!this._online()) return; // offline, or everyone at this keyboard — no-op

    // This scene restarts on every new level, so its handlers have to go
    // with it — otherwise each level would add another copy.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      [EVENTS.PLAYER_UPDATE, EVENTS.PLAYER_JOINED, EVENTS.PLAYER_LEFT,
        EVENTS.OBJECT_DESTROYED, EVENTS.GAME_STARTED, EVENTS.LEVEL_COMPLETE, EVENTS.PLAYER_RANG,
        EVENTS.LEVEL_FAILED, EVENTS.TIMER_TICK, EVENTS.BATTLE_OVER].forEach((e) => sm.off(e));
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
    // Someone else rang: their Jack is out of the level.
    sm.on(EVENTS.PLAYER_RANG, ({ playerId } = {}) => {
      if (playerId === this._myPlayerId) return;
      const rp = this.remotePlayers.get(playerId);
      if (rp) rp.setVisible(false);
      if (this._bell) this._bell.ring();
    });

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
      if (data.levelId) this._startLevel(data.levelId, data);
    });

    // The battle set is played (F.EXE VA 0x13e80): points and the winner.
    sm.on(EVENTS.BATTLE_OVER, (data = {}) => {
      const { title, text } = this._battleOverText(data);
      this.showResultOverlay(title, text, { toLobby: true });
    });

    // Level outcome overlays
    sm.on(EVENTS.LEVEL_COMPLETE, (data = {}) => {
      if (!data.battle) {
        this.showResultOverlay('КОМАНДА ПОБЕДИЛА!', 'Уровень пройден', { waitServer: true });
        return;
      }
      const { title, text } = this._battleLevelText(data);
      this.showResultOverlay(title, text, { waitServer: true });
    });

    sm.on(EVENTS.LEVEL_FAILED, () => {
      this.showResultOverlay('ВРЕМЯ ВЫШЛО', 'Попробуйте ещё раз');
    });

    // Timer tick — update HUD timer display
    sm.on(EVENTS.TIMER_TICK, (data) => this._showClock(data?.timeLeft ?? 0));

    // An object was destroyed on the server side
    sm.on(EVENTS.OBJECT_DESTROYED, ({ objectId } = {}) => {
      const entry = this._destructibleMap.get(objectId);
      if (entry && entry.rect.active) {
        this._rubble.add(entry.rect, HAMMER_RUBBLE_MASK, entry.mat);
        this._forgetBlock(entry);
      }
    });
  }
}
