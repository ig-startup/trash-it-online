/**
 * The story's world map — F.EXE's level-select screen (see
 * docs/re/front/world-map.md). Jack walks the paths of the world's LVSPAT
 * picture pixel by pixel, stops on every point, may only turn back on a
 * level not yet trashed, and fire on a level plays it with everyone at
 * this keyboard.
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
/** The clone's choice: a walk frame every two pixels (the anim rate is not traced). */
const PX_PER_FRAME = 2;

export default class WorldMapScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldMapScene' });
  }

  /**
   * @param {{players: object[], story?: Story, password?: string,
   *   result?: 'won'|'lost', arrived?: boolean}} data
   */
  init(data) {
    this._players = data.players || [];
    this._story = data.story || null;
    this._password = data.password || null;
    this._result = data.result || null;
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
    if (this._result === 'won') {
      story.won(story.node);
    } else if (this._result === 'lost' && !story.lost()) {
      this._bigText('ИГРА ОКОНЧЕНА');
      return;
    } else if (this._result === 'lost') {
      note = `ОСТАЛОСЬ ЖИЗНЕЙ: ${story.lives}`;
    }
    const map = story.map;
    const bgKey = `worldmap_${map.screen}`;
    const start = () => this._build(maps, bgKey, note);
    const need = [];
    if (!this.textures.exists(bgKey)) need.push(() => this.load.image(bgKey, map.background));
    if (!this.textures.exists('lsjack')) need.push(() => this.load.image('lsjack', maps.jack.image));
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
    const zoom = this.scale.width / MAP_W;
    this.cameras.main.setZoom(zoom).centerOn(MAP_W / 2, MAP_H / 2);
    this.add.image(0, 0, bgKey).setOrigin(0, 0);

    // Jack's sheet: eight walks of 17 frames, cut out of the atlas once.
    const tex = this.textures.get('lsjack');
    if (!tex.has('0')) {
      maps.jack.frames.forEach(([x, y, w, h], i) => tex.add(String(i), 0, x, y, w, h));
    }
    this._frames = maps.jack.frames;
    this._perAnim = maps.jack.framesPerAnim;
    this._groups = maps.groups;

    // The levels: a mark on each, green once trashed (the clone's own —
    // the original draws its bins and landmarks, not traced yet).
    this._marks = this.add.graphics();
    this._drawMarks();

    this._jack = this.add.image(0, 0, 'lsjack', '0').setOrigin(0, 0);
    // map_screen_init / 0x1dbd9: stopped on the record's node, from nowhere
    const p = map.points[story.node];
    this._w = {
      x: p[0], y: p[1], moving: false, came: 4, at: story.node, prev: story.node,
      edge: null, i: 0, lock: 0, auto: false, dir: 3, want: 3, wantTicks: 0, step: 0,
    };

    // The panel: what the original's LSPANEL shows, in text for now.
    const ui = { fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };
    this._title = this.add.text(8, 6, '', { ...ui, fontSize: '16px', color: '#ffff66' });
    this._info = this.add.text(8, 28, '', ui);
    this._msg = this.add.text(MAP_W / 2, MAP_H - 24, note, { ...ui, fontSize: '14px' }).setOrigin(0.5);
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
      if (this._tick()) return;
    }
    this._show();
  }

  /** Whether any player holds `group`'s arrow. */
  _held(group) {
    return this._pads.some((p) => p[group].isDown);
  }

  /** Whether any player pressed fire (F.EXE: any button, input & 0xf0). */
  _fire() {
    let fired = Phaser.Input.Keyboard.JustDown(this._enter);
    this._pads.forEach((p) => {
      if (Phaser.Input.Keyboard.JustDown(p.but1)) fired = true;
      if (Phaser.Input.Keyboard.JustDown(p.but2)) fired = true;
    });
    return fired;
  }

  /** One tick of map_fire_pressed (VA 0x1de35). @returns {boolean} left the scene */
  _tick() {
    const w = this._w;
    const story = this._story;
    const moves = story.map.moves;
    const fire = this._fire();
    if (w.lock > 0) w.lock -= 1;

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

  /** A pixel along the edge; at its end he stops on the point. */
  _step() {
    const w = this._w;
    const path = w.edge.path;
    const nx = path[w.i];
    const ny = path[w.i + 1];
    if (nx !== w.x || ny !== w.y) {
      w.came = cameFrom(nx - w.x, ny - w.y);
      w.step += 1;
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
    if (r.act === 'bonus') {
      story.won(id);
      this._drawMarks();
      this._say('БОНУС-РАУНД ЕЩЁ НЕ СДЕЛАН — ЗАСЧИТАН');
    } else if (r.act === 'next') {
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

  _drawMarks() {
    const story = this._story;
    const g = this._marks;
    g.clear();
    Object.entries(story.map.nodes).forEach(([id, n]) => {
      const p = story.map.points[id];
      if (!p || n.number < 0) return;
      g.fillStyle(story.isTrashed(id) ? 0x33dd55 : 0xdd3333, 0.9);
      g.fillCircle(p[0], p[1], 3);
    });
  }

  _show() {
    const w = this._w;
    const story = this._story;
    const anim = w.dir - 1;
    const k = w.moving ? Math.floor(w.step / PX_PER_FRAME) % this._perAnim : 0;
    const i = anim * this._perAnim + k;
    const [, , , , ox, oy] = this._frames[i];
    this._jack.setFrame(String(i)).setPosition(w.x + ox, w.y + oy);
    this._title.setText(`${story.map.name.toUpperCase()}  (мир ${story.world + 1} из ${story.maps.worlds.length})`);
    this._info.setText(`Жизни: ${story.lives}`);
  }

  /** A line across the screen, then back to the menu. */
  _bigText(text) {
    this.add.text(this.scale.width / 2, this.scale.height / 2, text, {
      fontSize: '40px', color: '#ff4444', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);
    this.time.delayedCall(3000, () => this.scene.start('MenuScene'));
  }
}

/** The neighbour index (0x1e539's numbering) a step of (dx, dy) came from. */
function cameFrom(dx, dy) {
  return (1 - Math.sign(dy)) * 3 + (1 - Math.sign(dx));
}
