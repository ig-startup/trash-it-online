/**
 * The story's world map — F.EXE's level-select screen (see
 * docs/re/front/world-map.md). Jack walks the paths of the world's LVSPAT
 * picture pixel by pixel, stops on every point, may only turn back on a
 * level not yet trashed, and fire on a level plays it with everyone at
 * this keyboard. The second button calls the hammer shop: it flies down
 * for Jack and away with him (0x1f3a1, docs/re/front/hammer-shop.md).
 *
 * The walking itself was worked out once, by scripts/export_worldmap.py,
 * which follows F.EXE's own steps (map_walk_step 0x1e1c1, 0x1e09f): for
 * every point and arrow it gives the pixels to the next point. Here they
 * are replayed a pixel a tick.
 */
import Phaser from 'phaser';
import Story from '../story/Story';
import { loadKeySets, LocalKeys, SOLO_EXTRA } from '../input/keySets';

const MAP_W = 640;
const MAP_H = 480;
/**
 * F.EXE draws a 320 x 200 screen and shows the 640 x 480 map through it,
 * the camera after Jack (docs/re/front/map-panel.md): each tick it closes
 * 1/16 of the way (0x1348a, 16.16), its centre held to x 160..480 and
 * y 128..408 (0x1fa7d) — the screen spans 128 above it and 72 below.
 */
const VIEW_W = 320;
const VIEW_H = 200;
const VIEW_ABOVE = 128;
const CAM_MIN_X = 160;
const CAM_MAX_X = MAP_W - 160;
const CAM_MIN_Y = 128;
const CAM_MAX_Y = MAP_H - 72;
/**
 * The panel (map_screen_init 0x1fcc2, 0x201a4), in screen pixels: LSPANEL
 * icons, and the numbers in its digits (frame = character - 0x2e, each
 * set its width + 2 on, 0x2025a) — timmy points (+0x1be), score (+0x14),
 * lives (+0x28).
 */
const PANEL_ICONS = [[1, 20, 20], [0, 134, 20], [12, 264, 20]];
const PANEL_NUMBERS = { timmies: [40, 30], score: [155, 30], lives: [287, 30] };
/** The panel's own camera looks at a spot of the world nothing else uses. */
const PANEL_AT = -10000;
const TICK_MS = 1000 / 60;
/** Arrows tried in map_walk_step's order. */
const GROUPS = ['up', 'down', 'left', 'right'];
/** Keys are not read for 35 ticks after a warp (d980e, VA 0x1e708). */
const WARP_LOCK = 35;
/** map_pick_jack_facing (VA 0x1e788): 32 steps ahead, each weighted 32 - k. */
const LOOK_AHEAD = 32;
/** Its slope bounds, |dy| * 10000 / |dx|, and table 0x1dbc1 of directions. */
const FLAT = 0x102c;
const STEEP = 0x3cf0;
const FACING = [1, 8, 7, 5, 6, 7, 1, 2, 3, 5, 4, 3];
/** Jack's draw depth (template 0x8a01a): a smaller depth is drawn nearer. */
const JACK_DEPTH = 0x1cb;
/** A held frame. */
const HOLD = Infinity;

/**
 * The shop's flight (0x1f3a1, LSSHOP frame 0): it starts at Jack's x - 90,
 * y -240, drops to Jack's y - 225 and on, slowed by 0x15f90 a tick, until
 * it stops; 90 ticks later it rises — 10 before, Jack is gone into it —
 * after 100 more ticks it climbs at 0x9c40 a tick per tick, and past
 * y -440 the screen fades out (4 of 128 a tick) for the shop. The speed
 * it falls at is not read: the clone's 8 px a tick.
 */
const SHOP = {
  dx: -90, startY: -240, landDy: -225, fall: 8, brake: 0x15f90 / 0x10000,
  sit: 90, jackIn: 10, wait: 100, climb: 0x9c40 / 0x10000, gone: -440, fade: 32,
};
/** Drawn in front of every other thing on the map. */
const SHOP_DEPTH = 5000;

/**
 * The bins' and hats' scripts (docs/re/front/map-objects.md), as
 * [frame, ticks] steps: the loop of a level not yet trashed, from a random
 * step (eaac); the pose of one trashed; and the one just won, played once.
 */
const SCRIPTS = {
  // 0x89dfa, 0x89e36, 0x89efe: the lid rattles; the bin crushed flat
  bin: {
    loop: [0, 1, 2, 3, 2, 1].map((f) => [f, 3]),
    trashed: [[6, HOLD]],
    won: [[0, 45], [4, 5], [5, 5], [6, HOLD]],
  },
  // 0x89e4a, 0x89e9e, 0x89ebe
  hat: {
    loop: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((f) => [f, 4]),
    trashed: [[15, HOLD]],
    won: [[0, 44], [12, 4], [13, 4], [14, 4], [15, HOLD]],
  },
};

export default class WorldMapScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldMapScene' });
  }

  /**
   * @param {{players: object[], story?: Story, password?: string,
   *   result?: 'won'|'lost'|'continued', arrived?: boolean}} data
   */
  init(data) {
    this._players = data.players || [];
    this._story = data.story || null;
    this._password = data.password || null;
    this._result = data.result || null;
    /** What the level left in the record: score, timmies, lives. */
    this._tally = data.tally || {};
    /** Just arrived in this world: its password is shown (VA 0x168d5). */
    this._arrived = !!data.arrived;
    this._ready = false;
  }

  preload() {
    this.load.json('worldmaps', 'worldmap/worlds.json');
  }

  create() {
    const maps = this.cache.json.get('worldmaps');
    if (!this._story) {
      this._story = this._password ? Story.fromPassword(maps, this._password) : new Story(maps);
      if (!this._story) {
        this._bigText('НЕВЕРНЫЙ ПАРОЛЬ');
        return;
      }
    }
    const story = this._story;
    let note = '';
    if (this._result === 'won' || this._result === 'lost') story.played(this._tally);
    if (this._result === 'won') {
      story.won(story.node, this._tally);
      // a world's exit won: straight on to the next world (state 5)
      if (story.isExit(story.node)) {
        if (!story.nextWorld()) {
          this._bigText('ИГРА ПРОЙДЕНА!');
          return;
        }
        this._arrived = true;
      }
    } else if (this._result === 'lost') {
      const r = story.lost(story.node);
      if (r === 'over') {
        this._bigText('ИГРА ОКОНЧЕНА');
        return;
      }
      if (r === 'ask') {
        this.scene.start('ContinueScene', { players: this._players, story });
        return;
      }
    } else if (this._result === 'continued') {
      note = `ОСТАЛОСЬ ЖИЗНЕЙ: ${story.lives}`;
    }
    const map = story.map;
    const bgKey = `worldmap_${map.screen}`;
    const start = () => this._build(maps, bgKey, note);
    const need = [];
    if (!this.textures.exists(bgKey)) need.push(() => this.load.image(bgKey, map.background));
    if (!this.textures.exists('lsjack')) need.push(() => this.load.image('lsjack', maps.jack.image));
    if (!this.textures.exists('lspanel')) need.push(() => this.load.image('lspanel', maps.panel.image));
    if (!this.textures.exists('shop_lsshop')) need.push(() => this.load.image('shop_lsshop', maps.shop.sheets.lsshop.image));
    new Set(map.icons.map((i) => i.sheet)).forEach((name) => {
      const key = sheetKey(name);
      if (!this.textures.exists(key)) need.push(() => this.load.image(key, maps.sheets[name].image));
    });
    if (!need.length) {
      start();
      return;
    }
    need.forEach((f) => f());
    this.load.once('complete', start);
    this.load.start();
  }

  _build(maps, bgKey, note) {
    const story = this._story;
    const map = story.map;
    const zoom = Math.min(this.scale.width / VIEW_W, this.scale.height / VIEW_H);
    const vw = VIEW_W * zoom;
    const vh = VIEW_H * zoom;
    const vx = (this.scale.width - vw) / 2;
    const vy = (this.scale.height - vh) / 2;
    this.cameras.main.setViewport(vx, vy, vw, vh).setZoom(zoom);
    this._panelCam = this.cameras.add(vx, vy, vw, vh).setZoom(zoom)
      .centerOn(PANEL_AT + VIEW_W / 2, VIEW_H / 2);
    this._textCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.add.image(0, 0, bgKey).setOrigin(0, 0);

    // Jack's sheet: eight standing poses, then eight walks of sixteen.
    cutFrames(this.textures.get('lsjack'), maps.jack.frames);
    this._jackSheet = maps.jack;
    this._groups = maps.groups;
    this._ticks = 0;

    // What stands on the picture: a bin on each level, a hat on each side
    // level, the landmarks Jack passes behind (map_place_jack 0x1dbd9).
    const justWon = this._result === 'won' ? story.node : null;
    this._icons = map.icons.map((icon) => {
      const sheet = maps.sheets[icon.sheet];
      cutFrames(this.textures.get(sheetKey(icon.sheet)), sheet.frames);
      const o = {
        icon, frames: sheet.frames, depth: icon.depth, steps: null, step: 0, left: 0,
        img: this.add.image(0, 0, sheetKey(icon.sheet), String(icon.frame)).setOrigin(0, 0),
      };
      const script = SCRIPTS[icon.kind];
      if (script) {
        if (icon.node === justWon) {
          o.steps = script.won;
        } else if (story.isTrashed(icon.node)) {
          o.steps = script.trashed;
        } else {
          o.steps = script.loop;
          o.loops = true;
          o.step = Math.floor(Math.random() * Math.min(o.steps.length, icon.kind === 'bin' ? 6 : 8));
        }
        o.left = o.steps[o.step][1];
      }
      this._placeIcon(o, o.steps ? o.steps[o.step][0] : icon.frame);
      return o;
    });

    this._jack = this.add.image(0, 0, 'lsjack', '0').setOrigin(0, 0);
    this._shopSheet = maps.shop.sheets.lsshop;
    cutFrames(this.textures.get('shop_lsshop'), this._shopSheet.frames);
    this._shopImg = this.add.image(0, 0, 'shop_lsshop', '0').setOrigin(0, 0)
      .setDepth(SHOP_DEPTH).setVisible(false);
    this._flight = null;
    // map_screen_init / 0x1dbd9: stopped on the record's node, from nowhere
    const p = map.points[story.node];
    this._w = {
      x: p[0], y: p[1], moving: false, came: 4, at: story.node, prev: story.node,
      edge: null, i: 0, lock: 0, auto: false, dir: 3, want: 3, wantTicks: 0,
    };

    // the camera starts on Jack (map_screen_init: 0xc613c, 0xc6140)
    this._cam = { x: p[0] * 0x10000, y: p[1] * 0x10000 };
    this._follow();

    // The panel, on its own camera: three icons and three numbers.
    const panel = maps.panel;
    cutFrames(this.textures.get('lspanel'), panel.frames);
    this._panelSheet = panel;
    const panelObjs = PANEL_ICONS.map(([f, x, y]) => this.add.image(PANEL_AT + x, y, 'lspanel', String(f)).setOrigin(0, 0));
    this._digits = {};
    Object.keys(PANEL_NUMBERS).forEach((k) => {
      this._digits[k] = { value: null, imgs: [] };
      for (let i = 0; i < 6; i++) {
        const img = this.add.image(0, 0, 'lspanel', '2').setOrigin(0, 0).setVisible(false);
        this._digits[k].imgs.push(img);
        panelObjs.push(img);
      }
    });

    // The clone's own lines, in the margins around the screen.
    const ui = { fontSize: '14px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };
    this._title = this.add.text(8, Math.max(4, vy / 2 - 9), '', { ...ui, fontSize: '16px', color: '#ffff66' });
    this._msg = this.add.text(this.scale.width / 2, this.scale.height - Math.max(12, vy / 2), note, ui).setOrigin(0.5);
    const texts = [this._title, this._msg];
    texts.forEach((t) => t.setDepth(3000));
    const world = this.children.list.filter((o) => !panelObjs.includes(o) && !texts.includes(o));
    this.cameras.main.ignore([...panelObjs, ...texts]);
    this._panelCam.ignore([...world, ...texts]);
    this._textCam.ignore([...world, ...panelObjs]);
    if (this._arrived) this._say(`МИР: ${map.name.toUpperCase()} — ПАРОЛЬ ${map.password.toUpperCase()}`, 5000);

    // Every player's keys steer the one Jack on the map.
    this._keys = new LocalKeys();
    const sets = loadKeySets();
    const n = Math.max(1, this._players.length);
    this._pads = sets.slice(0, n).map((set, i) => this._keys.pad(set, n === 1 && i === 0 ? SOLO_EXTRA : {}));
    this._enter = this.input.keyboard.addKey('ENTER');
    this._esc = this.input.keyboard.addKey('ESC');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._keys.destroy());

    this._acc = 0;
    this._ready = true;
    this._show();
  }

  update(_t, delta) {
    if (!this._ready) return;
    if (Phaser.Input.Keyboard.JustDown(this._esc)) {
      this.scene.start('MenuScene');
      return;
    }
    this._acc += Math.min(delta, 100);
    while (this._acc >= TICK_MS) {
      this._acc -= TICK_MS;
      this._ticks += 1;
      this._tickIcons();
      if (this._tick()) return;
      this._follow();
    }
    this._show();
  }

  /** Whether any player holds `group`'s arrow. */
  _held(group) {
    return this._pads.some((p) => p[group].isDown);
  }

  /**
   * Whether any player pressed fire. F.EXE takes any button (input &
   * 0xf0) — the second (0x20) also calls the shop; the clone gives that
   * button to the shop alone.
   */
  _fire() {
    let fired = Phaser.Input.Keyboard.JustDown(this._enter);
    this._pads.forEach((p) => {
      if (Phaser.Input.Keyboard.JustDown(p.but1)) fired = true;
    });
    return fired;
  }

  /** Whether any player pressed the second button (input & 0x20). */
  _shopKey() {
    return this._pads.some((p) => Phaser.Input.Keyboard.JustDown(p.but2));
  }

  /** One tick of map_fire_pressed (VA 0x1de35). @returns {boolean} left the scene */
  _tick() {
    const w = this._w;
    const story = this._story;
    const moves = story.map.moves;
    const fire = this._fire();
    const shopKey = this._shopKey();
    if (w.lock > 0) w.lock -= 1;
    if (this._flight) return this._flightTick();

    if (!w.moving) {
      // map_take_warp: a warp node sends him to its pair, walking on
      const node = story.nodeAt(w.at);
      if (node && node.warp && w.prev !== node.warp) {
        const to = story.map.points[node.warp];
        Object.assign(w, {
          x: to[0], y: to[1], prev: w.at, at: node.warp, came: 4, auto: true, lock: WARP_LOCK,
        });
      }
      // map_walk_step: an arrow — or the warp's push — starts him off. On
      // a point not yet trashed only the way he came is open.
      const open = story.isTrashed(w.at);
      const g = GROUPS.find((k) => moves[w.at] && moves[w.at][k]
        && (open || this._groups[k].includes(w.came))
        && ((this._held(k) && w.lock === 0) || w.auto));
      // 0x1f3a1: stopped on a point that is no warp, the second button
      // calls the shop — not with a special hammer in hand
      const here = story.nodeAt(w.at);
      if (shopKey && !g && !(here && here.warp)) {
        if (!story.canShop()) {
          this._say('С ЭТИМ МОЛОТКОМ В МАГАЗИН НЕЛЬЗЯ');
        } else {
          this._flight = {
            x: w.x + SHOP.dx, y: SHOP.startY, vy: SHOP.fall, phase: 'fall', left: 0,
          };
          this._shopImg.setVisible(true);
          this._msg.setText('');
        }
        return false;
      }
      if (g) {
        const m = moves[w.at][g];
        w.edge = { path: m.path, to: m.to, came: m.came, from: w.at };
        w.i = 0;
        w.moving = true;
        w.auto = false;
        this._msg.setText('');
      } else if (fire) {
        return this._fireOn(w.at);
      }
    } else {
      // Mid-path an arrow can only turn him round (map_walk_step, cVar2 0).
      const back = GROUPS.find((k) => this._held(k) && w.lock === 0
        && this._groups[k].includes(w.came));
      if (back && w.i > 0) {
        const path = w.edge.path;
        // back over the pixels he has walked, from the one before this
        // (the edge's pauses — a pixel twice — would leave him facing the
        // same way, and the held arrow would turn him round again)
        const rev = [];
        let lx = w.x;
        let ly = w.y;
        for (let k = w.i - 2; k >= 0; k -= 2) {
          if (path[k] !== lx || path[k + 1] !== ly) rev.push(path[k], path[k + 1]);
          lx = path[k];
          ly = path[k + 1];
        }
        const from = story.map.points[w.edge.from];
        rev.push(from[0], from[1]);
        w.edge = { path: rev, to: w.edge.from, came: null, from: w.edge.to };
        w.i = 0;
      }
    }

    if (w.moving) this._step();
    return false;
  }

  /** One tick of the shop's flight (0x1f3a1). @returns {boolean} left the scene */
  _flightTick() {
    const f = this._flight;
    const w = this._w;
    const land = w.y + SHOP.landDy;
    if (f.phase === 'fall') {
      f.y += f.vy;
      if (f.y >= land) {
        f.y = land;
        f.phase = 'land';
      }
    } else if (f.phase === 'land') {
      // on down past the mark, slowing until it stops
      if (f.vy > 0) {
        f.y += f.vy;
        f.vy -= SHOP.brake;
      } else {
        f.vy = 0;
        f.phase = 'sit';
        f.left = SHOP.sit;
      }
    } else if (f.phase === 'sit') {
      f.left -= 1;
      if (f.left === SHOP.jackIn) this._jack.setVisible(false);
      if (f.left === 0) {
        f.phase = 'wait';
        f.left = SHOP.wait;
      }
    } else if (f.phase === 'wait') {
      if (f.left > 0) f.left -= 1;
      else f.phase = 'climb';
    } else if (f.phase === 'climb') {
      f.vy -= SHOP.climb;
      f.y += f.vy;
      if (f.y < SHOP.gone) {
        f.phase = 'gone';
        // Jack is on this point when he is back (+0x1b8 = d981f)
        this._story.node = w.at;
        this.cameras.main.fadeOut(SHOP.fade * TICK_MS, 0, 0, 0);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          this.scene.start('ShopScene', { players: this._players, story: this._story });
        });
      }
    }
    return false;
  }

  /** A pixel along the edge; at its end he stops on the point. */
  _step() {
    const w = this._w;
    const path = w.edge.path;
    const nx = path[w.i];
    const ny = path[w.i + 1];
    if (nx !== w.x || ny !== w.y) {
      w.came = cameFrom(nx - w.x, ny - w.y);
    }
    w.x = nx;
    w.y = ny;
    w.i += 2;
    this._face();
    if (w.i >= path.length) {
      w.moving = false;
      w.prev = w.at;
      w.at = w.edge.to;
      w.edge = null;
      this._say(this._nodeText(w.at));
    }
  }

  /** map_pick_jack_facing: where the next 32 pixels lead, weighted; held two ticks. */
  _face() {
    const w = this._w;
    if (!w.edge) return;
    let sx = 0;
    let sy = 0;
    const path = w.edge.path;
    for (let k = 0; k < LOOK_AHEAD && w.i + 2 * k < path.length; k += 1) {
      sx += (path[w.i + 2 * k] - w.x) * (LOOK_AHEAD - k);
      sy += (path[w.i + 2 * k + 1] - w.y) * (LOOK_AHEAD - k);
    }
    if (!sx && !sy) return;
    let dir;
    if (sx === 0) {
      dir = sy < 0 ? 7 : 3;
    } else {
      const q = (sx < 0 ? 1 : 0) + (sy >= 0 ? 2 : 0);
      const r = Math.floor((Math.abs(sy) * 10000) / Math.abs(sx));
      const slope = r < FLAT ? 0 : r < STEEP ? 1 : 2;
      dir = FACING[slope + q * 3];
    }
    // 0x1e923: a new direction is taken once it has held for two ticks
    if (dir === w.dir) {
      w.wantTicks = 0;
    } else if (dir !== w.want) {
      w.want = dir;
      w.wantTicks = 0;
    } else if ((w.wantTicks += 1) > 1) {
      w.dir = dir;
      w.wantTicks = 0;
    }
  }

  /** Fire on a point: play it, or say why not (Story.fire). */
  _fireOn(id) {
    const story = this._story;
    const r = story.fire(id);
    if (r.act === 'play') {
      story.node = id;
      this.scene.start('GameScene', {
        players: this._players, mode: 'coop', myPlayerId: this._players[0].id,
        local: true, levelId: r.level, story,
      });
      return true;
    }
    if (r.act === 'next') {
      if (!story.nextWorld()) {
        this._say('ИГРА ПРОЙДЕНА!', 0);
        this.time.delayedCall(4000, () => this.scene.start('MenuScene'));
        this._ready = false;
        return true;
      }
      this.scene.start('WorldMapScene', { players: this._players, story, arrived: true });
      return true;
    } else if (r.act === 'refuse') {
      this._say(r.why);
    }
    return false;
  }

  _nodeText(id) {
    const n = this._story.nodeAt(id);
    if (!n || n.number < 0) return '';
    if (n.kind === 'exit') return this._story.isTrashed(id) ? 'ВЫХОД — ОГОНЬ: ДАЛЬШЕ' : 'ВЫХОД';
    const name = n.level ? n.level.replace('level_', '') : '';
    return `${name}${this._story.isTrashed(id) ? ' — ПРОЙДЕН' : ''}`;
  }

  _say(text, ms = 3000) {
    this._msg.setText(text);
    if (this._sayTimer) this._sayTimer.remove();
    if (ms) this._sayTimer = this.time.delayedCall(ms, () => this._msg.setText(''));
  }

  /** An icon's frame, drawn at its point plus the frame's origin. */
  _placeIcon(o, frame) {
    const [, , , , ox, oy] = o.frames[frame];
    o.img.setFrame(String(frame)).setPosition(o.icon.x + ox, o.icon.y + oy);
    const shown = o.icon.kind === 'untilTrashed' ? !this._story.isTrashed(o.icon.node)
      : o.icon.kind === 'onceTrashed' ? this._story.isTrashed(o.icon.node) : true;
    o.img.setVisible(shown);
    // the bin crushed flat (frame 6) lies at Jack's own depth (0x1f5f7)
    if (o.icon.kind === 'bin' && frame === 6) o.depth = JACK_DEPTH;
  }

  /** One tick of every icon's script, or its loop on the tick count. */
  _tickIcons() {
    this._icons.forEach((o) => {
      const { icon } = o;
      if (icon.loop) {
        this._placeIcon(o, icon.loop[Math.floor(this._ticks / icon.ticks) % icon.loop.length]);
      } else if (o.steps && (o.left -= 1) <= 0) {
        if (o.step + 1 < o.steps.length) o.step += 1;
        else if (o.loops) o.step = 0;
        o.left = o.steps[o.step][1];
        this._placeIcon(o, o.steps[o.step][0]);
      }
      // 0x1f689: T's node 15 goes behind Jack once he is low enough
      if (icon.behindJackBelow) o.depth = this._w.y >= icon.behindJackBelow ? 0x1cd : 1;
    });
  }

  _show() {
    const w = this._w;
    const story = this._story;
    // map_jack_tick 0x1f941: stopped, his pose; walking, a new frame every
    // two ticks
    const sheet = this._jackSheet;
    const i = w.moving
      ? sheet.walk[w.dir - 1] + (Math.floor(this._ticks / 2) % sheet.walkFrames)
      : sheet.stand[w.dir - 1];
    const [, , , , ox, oy] = sheet.frames[i];
    this._jack.setFrame(String(i)).setPosition(w.x + ox, w.y + oy).setDepth(drawDepth(null, w.y));
    this._icons.forEach((o) => o.img.setDepth(drawDepth(o.depth, o.icon.y)));
    if (this._flight) {
      const [, , , , ox, oy] = this._shopSheet.frames[0];
      this._shopImg.setPosition(this._flight.x + ox, Math.floor(this._flight.y) + oy);
    }
    this._title.setText(`${story.map.name.toUpperCase()}  (мир ${story.world + 1} из ${story.maps.worlds.length})`);
    this._writeNumber('timmies', story.timmies);
    this._writeNumber('score', story.score);
    this._writeNumber('lives', story.lives);
  }

  /** 0x1348a: the camera closes 1/16 of the way to Jack, then is held in. */
  _follow() {
    const c = this._cam;
    const clamp = (v, lo, hi) => {
      // only the whole part is held; the fraction stays
      const whole = Math.floor(v / 0x10000);
      const frac = v - whole * 0x10000;
      return Math.min(Math.max(whole, lo), hi) * 0x10000 + frac;
    };
    c.x = clamp(c.x + Math.trunc((this._w.x * 0x10000 - c.x) / 16), CAM_MIN_X, CAM_MAX_X);
    c.y = clamp(c.y + Math.trunc((this._w.y * 0x10000 - c.y) / 16), CAM_MIN_Y, CAM_MAX_Y);
    const left = Math.floor(c.x / 0x10000) - VIEW_W / 2;
    const top = Math.floor(c.y / 0x10000) - VIEW_ABOVE;
    this.cameras.main.centerOn(left + VIEW_W / 2, top + VIEW_H / 2);
  }

  /** 0x2025a: a number in LSPANEL's digits, each its width + 2 on. */
  _writeNumber(key, value) {
    const d = this._digits[key];
    if (d.value === value) return;
    d.value = value;
    const text = String(value).slice(0, d.imgs.length);
    let [x] = PANEL_NUMBERS[key];
    const [, y] = PANEL_NUMBERS[key];
    d.imgs.forEach((img, i) => {
      if (i >= text.length) {
        img.setVisible(false);
        return;
      }
      const frame = text.charCodeAt(i) - 0x2e;
      const [, , w, , ox, oy] = this._panelSheet.frames[frame];
      img.setFrame(String(frame)).setPosition(PANEL_AT + x + ox, y + oy).setVisible(true);
      x += w + 2;
    });
  }

  /** A line across the screen, then back to the menu. */
  _bigText(text) {
    this.add.text(this.scale.width / 2, this.scale.height / 2, text, {
      fontSize: '40px', color: '#ff4444', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);
    this.time.delayedCall(3000, () => this.scene.start('MenuScene'));
  }
}

/** @returns {string} the texture key of an FSPR sheet */
function sheetKey(name) {
  return `wmsheet_${name}`;
}

/** Cut an atlas's [x, y, w, h, ...] frames into a texture once. */
function cutFrames(tex, frames) {
  if (tex.has('0')) return;
  frames.forEach(([x, y, w, h], i) => tex.add(String(i), 0, x, y, w, h));
}

/**
 * Phaser's depth for one of F.EXE's: a smaller depth is nearer, and none
 * (bit 0x40 of +0x91, -1 in the node) is the object's y — Jack's own way.
 * Jack's depth or more is behind him, less in front of him.
 */
function drawDepth(depth, y) {
  if (depth === null || depth === undefined) return y;
  return depth < JACK_DEPTH ? 1000 + (JACK_DEPTH - depth) : -1 - (depth - JACK_DEPTH);
}

/** The neighbour index (0x1e539's numbering) a step of (dx, dy) came from. */
function cameFrom(dx, dy) {
  return (1 - Math.sign(dy)) * 3 + (1 - Math.sign(dx));
}
