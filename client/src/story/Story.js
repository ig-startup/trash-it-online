/**
 * The story, played together at one keyboard: F.EXE's world maps — nine
 * worlds, levels as stops on the paths, passwords, lives. See
 * docs/re/front/world-map.md; the maps themselves are
 * scripts/export_worldmap.py's `worldmap/worlds.json`.
 *
 * What the front end keeps in TRASHIT.DAT's record, this keeps: the world
 * (+0x26), the lives (+0x28), a trashed flag per node (+0x188), the node
 * Jack stands on (+0x1b8), the stage of the last node won (+0x1bc).
 */
import { FIRST_HAMMER } from '../entities/hammers';

/** A new game and a password both give five lives (F.EXE VA 0x15d55). */
export const START_LIVES = 5;

/** A world starts Jack on its node 1 (map_enter_world, VA 0x200e8). */
export const START_NODE = 1;

/**
 * Rounds of G.EXE the clone does not build yet: the one-object bonus
 * screens (C, number 12; the world exits' D, number 13 — VA 0x10c1f) are
 * counted as won, so the story can go on past them; the side levels T and
 * U (numbers 29, 30) and the gates (kind 4) are refused.
 */
const BONUS_NUMBERS = new Set([12, 13]);

export default class Story {
  /**
   * @param {object} maps worldmap/worlds.json
   * @param {{world?: number, hammer?: number}} [start]
   */
  constructor(maps, start = {}) {
    this.maps = maps;
    this.lives = START_LIVES;
    this.hammer = Number.isInteger(start.hammer) ? start.hammer : FIRST_HAMMER;
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
   *   | {act: 'next'} | {act: 'bonus'} | {act: 'refuse', why: string}
   *   | {act: 'none'}}
   */
  fire(id) {
    const n = this.nodeAt(id);
    if (!n || n.number < 0) return { act: 'none' };
    const trashed = this.isTrashed(id);
    if (n.kind === 'gate') return { act: 'refuse', why: 'ВОРОТА ЕЩЁ НЕ СДЕЛАНЫ' };
    if (n.kind === 'exit') {
      // trashed, the world is done; else its bonus screen first
      if (trashed) return { act: 'next' };
      return { act: 'bonus' };
    }
    if (n.number > 11) {
      // the bonus screens and the side levels: once each
      if (trashed) return { act: 'refuse', why: 'УЖЕ ПРОЙДЕНО' };
      if (BONUS_NUMBERS.has(n.number)) return { act: 'bonus' };
      return { act: 'refuse', why: 'ЭТОТ УРОВЕНЬ ЕЩЁ НЕ СДЕЛАН' };
    }
    // A level of a stage below the last one won is shut (VA 0x1df8c). A
    // won one may be played again while its timmy points are in hand —
    // the clone has no shop yet, so they always are.
    if (n.stage < this.stage) return { act: 'refuse', why: 'СЮДА УЖЕ НЕ ВЕРНУТЬСЯ' };
    return { act: 'play', level: n.level };
  }

  /** The level or round on `id` was won (map_node_trashed, VA 0x20072). */
  won(id) {
    const n = this.nodeAt(id);
    this.node = Number(id);
    this.trashed.add(Number(id));
    if (n) this.stage = n.stage;
  }

  /** The level was lost: a life gone. @returns {boolean} lives left */
  lost() {
    this.lives = Math.max(0, this.lives - 1);
    return this.lives > 0;
  }

  /** On to the next world, or null after the last. */
  nextWorld() {
    if (this.world + 1 >= this.maps.worlds.length) return false;
    this.enterWorld(this.world + 1);
    return true;
  }
}
