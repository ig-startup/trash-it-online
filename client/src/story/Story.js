/**
 * The story, played together at one keyboard: F.EXE's world maps — nine
 * worlds, levels as stops on the paths, passwords, lives. See
 * docs/re/front/world-map.md; the maps themselves are
 * scripts/export_worldmap.py's `worldmap/worlds.json`.
 *
 * What the front end keeps in TRASHIT.DAT's record, this keeps: the world
 * (+0x26), the lives (+0x28), a trashed flag per node (+0x188), the node
 * Jack stands on (+0x1b8), the stage of the last node won (+0x1bc), player
 * 1's hammer (+6) and the timmy points each node paid (+0x20a).
 */
import { FIRST_HAMMER } from '../entities/hammers';

/** A new game and a password both give five lives (F.EXE VA 0x15d55). */
export const START_LIVES = 5;

/** A world starts Jack on its node 1 (map_enter_world, VA 0x200e8). */
export const START_NODE = 1;

/**
 * What the clone does not build yet, refused: the side levels T and U
 * (numbers 29, 30) and the gates (kind 4). T and U are shows — G.EXE plays
 * the level back from its .J recording, fire stops it, and it is never
 * won or trashed (docs/re/front/side-levels.md). The bonus screens, C (12)
 * and the exits' D (13), are played (scenes/bonusRound.js).
 */
const SIDE_NUMBERS = new Set([29, 30]);

/** The thirty shop hammers come first; a special one cannot be traded (0x1f424). */
export const SHOP_HAMMERS = 30;

export default class Story {
  /**
   * @param {object} maps worldmap/worlds.json
   * @param {{world?: number, hammer?: number}} [start]
   */
  constructor(maps, start = {}) {
    this.maps = maps;
    this.lives = START_LIVES;
    /**
     * The score (+0x14) and the timmy points the shop spends (+0x1be): a
     * won level adds its rubble and player 1's timmies to them
     * (map_node_trashed 0x20072, docs/re/front/level-record.md).
     */
    this.score = 0;
    this.timmies = 0;
    this.hammer = Number.isInteger(start.hammer) ? start.hammer : FIRST_HAMMER;
    /** The timmy points a node paid when last won, by node (+0x20a). */
    this.paid = {};
    this.enterWorld(start.world || 0);
  }

  /** The world a password names, or -1 (check_password, VA 0x15d55). */
  static worldOf(maps, word) {
    const w = String(word || '').trim().toLowerCase();
    return maps.worlds.findIndex((m) => m.password === w);
  }

  /** A game started from a password: that world, its hammer (VA 0x8da1a). */
  static fromPassword(maps, word) {
    const world = Story.worldOf(maps, word);
    if (world < 0) return null;
    return new Story(maps, { world, hammer: maps.worlds[world].hammer });
  }

  /** Node 1, stage 0, the path nodes open (map_enter_world, VA 0x200e8). */
  enterWorld(world) {
    this.world = world;
    this.map = this.maps.worlds[world];
    this.node = START_NODE;
    this.stage = 0;
    this.trashed = new Set(Object.entries(this.map.nodes)
      .filter(([, n]) => n.open).map(([id]) => Number(id)));
  }

  /** Whether Jack may walk on past this point (+0x188). */
  isTrashed(id) {
    return this.trashed.has(Number(id));
  }

  nodeAt(id) {
    return this.map.nodes[id] || null;
  }

  /**
   * Fire pressed with Jack stopped on `id` (map_fire_pressed, VA 0x1de35,
   * then map_process_node, 0x1ffe9).
   * @returns {{act: 'play', level: string}
   *   | {act: 'next'} | {act: 'refuse', why: string} | {act: 'none'}}
   */
  fire(id) {
    const n = this.nodeAt(id);
    if (n && n.kind === 'gate' && !this.isTrashed(id)) return { act: 'refuse', why: 'ВОРОТА ЕЩЁ НЕ СДЕЛАНЫ' };
    if (!n || n.number < 0) return { act: 'none' };
    const trashed = this.isTrashed(id);
    if (n.kind === 'exit') {
      // trashed, the world is done; else its D screen first
      if (trashed || !n.level) return { act: 'next' };
      return { act: 'play', level: n.level };
    }
    if (n.number > 11) {
      // the bonus screens and the side levels: once each
      if (trashed) return { act: 'refuse', why: 'УЖЕ ПРОЙДЕНО' };
      if (SIDE_NUMBERS.has(n.number)) return { act: 'refuse', why: 'ДЕМО-ПОКАЗ ОРИГИНАЛА — В КЛОНЕ ЕЩЁ НЕТ' };
      return { act: 'play', level: n.level };
    }
    // A level of a stage below the last one won is shut (VA 0x1df8c). A
    // won one may be played again only while the timmy points it paid are
    // still in hand — not spent in the shop (0x1e037).
    if (n.stage < this.stage) return { act: 'refuse', why: 'СЮДА УЖЕ НЕ ВЕРНУТЬСЯ' };
    if (trashed && this.timmies < (this.paid[id] || 0)) {
      return { act: 'refuse', why: 'ТИММИ ЭТОГО УРОВНЯ ПОТРАЧЕНЫ' };
    }
    return { act: 'play', level: n.level };
  }

  /**
   * A level played to its end, won or lost (F.EXE VA 0x20e1d): the panels
   * it took are lives (record +0x1c, G.EXE jack_touch_panel 0x1bacb).
   * @param {{lives?: number}} tally
   */
  played(tally = {}) {
    this.lives += tally.lives || 0;
  }

  /**
   * The level or round on `id` was won (map_node_trashed, VA 0x20072): its
   * rubble is added to the score, its timmies to the timmy points.
   * @param {{score?: number, timmies?: number}} [tally]
   */
  won(id, tally = {}) {
    const n = this.nodeAt(id);
    this.node = Number(id);
    this.trashed.add(Number(id));
    if (n) this.stage = n.stage;
    this.score += tally.score || 0;
    this.timmies += tally.timmies || 0;
    this.paid[Number(id)] = tally.timmies || 0;
  }

  /**
   * The level on `id` was lost (F.EXE VA 0x20e1d). A bonus screen, a side
   * level or an exit's D costs nothing and asks nothing. A level asks
   * "continue?" (continue_screen 0x1590e, docs/re/front/continue.md) —
   * unless no lives are left: then the game is over unasked.
   * @returns {'free'|'ask'|'over'}
   */
  lost(id) {
    const n = this.nodeAt(id);
    if (n && (n.kind === 'exit' || n.number > 11)) return 'free';
    // a level lost pays nothing: replaying it is open again (0x21106)
    this.paid[Number(id)] = 0;
    return this.lives === 0 ? 'over' : 'ask';
  }

  /** "Continue?" answered yes: it costs a life (VA 0x15988). */
  carryOn() {
    this.lives -= 1;
  }

  /** Whether `id` is a world's exit: won, the world is done (VA 0x2117c). */
  isExit(id) {
    const n = this.nodeAt(id);
    return !!n && n.kind === 'exit';
  }

  /** On to the next world, or null after the last. */
  nextWorld() {
    if (this.world + 1 >= this.maps.worlds.length) return false;
    this.enterWorld(this.world + 1);
    // the timmy points do not come along to a new world (0x2125f)
    this.timmies = 0;
    this.paid = {};
    return true;
  }

  /**
   * Whether the shop will come (0x1f3a1): not for a special hammer —
   * the bfh, quality and the rest are never traded in.
   */
  canShop() {
    return this.hammer < SHOP_HAMMERS;
  }

  /**
   * Into the shop (0x1b632): the hammer in hand is traded in, its worth
   * added to the timmy points; leaving without buying takes it back
   * (hammer_shop 0x1b92a). docs/re/front/hammer-shop.md
   * @param {number[]} worth the shop's worth of each hammer index
   */
  enterShop(worth) {
    this._worth = worth;
    this._bought = false;
    this.timmies += worth[this.hammer] || 0;
  }

  /**
   * Buy (0x1bf01): refused when it is the hammer in hand ('owned') or
   * costs more than the points ('poor'); else it is player 1's.
   * @param {{hammer: number, price: number}} item
   * @returns {'owned'|'poor'|'bought'}
   */
  buy(item) {
    if (item.hammer === this.hammer) return 'owned';
    if (this.timmies < item.price) return 'poor';
    this.hammer = item.hammer;
    this.timmies -= item.price;
    this._bought = true;
    return 'bought';
  }

  leaveShop() {
    if (!this._bought) this.timmies -= this._worth[this.hammer] || 0;
  }
}
