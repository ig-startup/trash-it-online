'use strict';

const { EVENTS } = require('../../shared/constants');
const BATTLES = require('../../shared/battles.json');

/** When one player is left to ring in a battle, his clock is cut to this (VA 0x1a7bd). */
const LAST_ONE_SECONDS = 60;

/**
 * GameRoom — full state machine: lobby → playing → ended.
 *
 * @param {{ code: string, mode: string, hostId: string, io: object }} opts
 *   io — Socket.io Server instance; used for io.to(code).emit(event, data)
 */
class GameRoom {
  constructor({ code, mode, hostId, io }) {
    this.code = code;
    this.mode = mode;
    this.hostId = hostId;
    this.io = io;

    /** @type {'lobby'|'playing'|'ended'} */
    this.state = 'lobby';

    /** @type {Map<string, object>} socketId → player */
    this.players = new Map();

    /** @type {Map<string, { hp: number }>} objectId → { hp } */
    this.objects = new Map();

    /** @type {NodeJS.Timeout|null} */
    this.timer = null;

    this.timeLeft = 0;

    /** Socket ids in the order they rang the bell this level. */
    this.rung = [];

    /** Who plays this level; null is everyone. A tie-break narrows it. */
    this.active = null;

    /**
     * A battle under way (mode 'battle', F.EXE VA 0x212d2): the set, how
     * far through it, and everyone's battle points.
     * @type {null|{set: number, levels: object[], index: number, points: Object<string, number>, tieBreak: boolean}}
     */
    this.battle = null;

    /** Called when the level ends by itself — the clock in a battle. */
    this.onLevelEnd = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Broadcast an event to every socket in this room. */
  _emit(event, data) {
    this.io.to(this.code).emit(event, data);
  }

  /** Stop the interval timer if it's running. */
  _clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the game.
   * @param {object} levelData — level descriptor from tech-spec (or level id string for compat)
   * @param {string[]|null} [active] — who plays it; everyone when left out
   */
  startGame(levelData, active = null) {
    // 'ended' is allowed too: that is how the room moves on to the next level.
    if (this.state !== 'lobby' && this.state !== 'ended') return;
    this._clearTimer();

    // Support passing either a full levelData object or just an id
    if (typeof levelData === 'string') {
      // Minimal fallback: no destructibles, 180s timer
      levelData = { id: levelData, timeLimit: 180, destructibles: [] };
    }

    // Initialise object map: objectId → { hp }
    this.objects.clear();
    const destructibles = levelData.destructibles || [];
    for (const obj of destructibles) {
      // Blocks the original marks unbreakable are scenery and structure;
      // they are never destroyed, so the room does not track them.
      if (obj.solid) continue;
      const id = obj.id || `${obj.x}_${obj.y}`;
      this.objects.set(id, { hp: obj.hp });
    }

    this.levelId = levelData.id || null;
    this.timeLeft = levelData.timeLimit || 180;
    this.rung = [];
    this.active = active ? new Set(active) : null;
    this.state = 'playing';

    // Tick every second
    this.timer = setInterval(() => {
      this.timeLeft--;
      this._emit(EVENTS.TIMER_TICK, { timeLeft: this.timeLeft });

      if (this.timeLeft <= 0) {
        this._clearTimer();
        if (this.battle) {
          // Out of time in a battle: those who rang are placed, the rest
          // score nothing, and the set goes on (F.EXE awards whatever the
          // level's state, VA 0x212d2).
          this._endLevel(true);
          if (this.onLevelEnd) this.onLevelEnd();
          return;
        }
        this.state = 'ended';
        this._emit(EVENTS.LEVEL_FAILED, { reason: 'timeout' });
      }
    }, 1000);
  }

  /**
   * A player rang the bell. In the original the bell takes one ring per
   * player (G.EXE sets its count to player_count, VA 0x212d4): whoever
   * rings is out of the level, and the level is won when everyone has
   * (bell_touch_tick, VA 0x34114). The order of the rings is kept — it
   * is the battle's placing.
   * @param {string} socketId — the player who rang
   * @returns {boolean} true when this ring finished the level
   */
  handleBellHit(socketId) {
    if (this.state !== 'playing' || this.rung.includes(socketId)) return false;
    if (!this.players.has(socketId)) return false;
    if (this.active && !this.active.has(socketId)) return false;

    this.rung.push(socketId);
    this._emit(EVENTS.PLAYER_RANG, { playerId: socketId, place: this.rung.length });
    // In a battle the last one left to ring has a minute at most.
    if (this.battle && this._waiting().length === 1 && this.timeLeft > LAST_ONE_SECONDS) {
      this.timeLeft = LAST_ONE_SECONDS;
      this._emit(EVENTS.TIMER_TICK, { timeLeft: this.timeLeft });
    }
    return this.finishIfAllRang();
  }

  /** Players still here who are playing this level and have not rung. */
  _waiting() {
    return [...this.players.keys()]
      .filter((id) => (!this.active || this.active.has(id)) && !this.rung.includes(id));
  }

  /**
   * Ends the level once every player still here has rung — also after
   * someone leaves, who may have been the last one it waited for.
   * @returns {boolean} true when it ended the level
   */
  finishIfAllRang() {
    if (this.state !== 'playing' || this.rung.length === 0) return false;
    if (this._waiting().length > 0) return false;
    this._endLevel(false);
    return true;
  }

  /** The level is over: in a battle, the places score (F.EXE VA 0x13fa1). */
  _endLevel(timeout) {
    this._clearTimer();
    this.state = 'ended';
    const places = [...this.rung];
    if (!this.battle) {
      this._emit(EVENTS.LEVEL_COMPLETE, { winnerId: null, places });
      return;
    }
    const b = this.battle;
    const table = BATTLES.points[String(Math.min(4, Math.max(2, b.roster)))];
    const award = {};
    places.forEach((id, i) => {
      award[id] = table[i] || 0;
      b.points[id] = (b.points[id] || 0) + award[id];
    });
    this._emit(EVENTS.LEVEL_COMPLETE, {
      winnerId: null, places, award, points: { ...b.points }, timeout,
      battle: { level: b.index + 1, of: b.levels.length, tieBreak: b.tieBreak },
    });
  }

  /**
   * Begin a battle on one of the original's sets.
   * @param {number} setIndex 0..4
   * @returns {{levelId: string, hammer: number}} its first level
   */
  startBattle(setIndex) {
    const set = Math.max(0, Math.min(BATTLES.sets.length - 1, Number(setIndex) || 0));
    const points = {};
    for (const id of this.players.keys()) points[id] = 0;
    this.battle = {
      set, levels: BATTLES.sets[set], index: 0, points, tieBreak: false,
      roster: this.players.size,
    };
    return { ...this.battle.levels[0], active: null };
  }

  /**
   * What follows a battle level (F.EXE VA 0x13e80): the next of the set;
   * after the last, the winner — or, if the top is shared, a tie-break on
   * the level just played for those sharing it, everyone with hammer 36,
   * the guitar.
   * @returns {{levelId: string, hammer: number, active: string[]|null}|{over: true, winners: string[], points: object}}
   */
  nextBattleStep() {
    const b = this.battle;
    b.index += 1;
    if (b.index < b.levels.length) {
      const next = b.levels[b.index];
      return { level: next.level, hammer: next.hammer, active: b.tieBreak ? [...this.active] : null };
    }
    const here = Object.keys(b.points).filter((id) => this.players.has(id));
    const top = Math.max(...here.map((id) => b.points[id]));
    const winners = here.filter((id) => b.points[id] === top);
    if (winners.length > 1) {
      const last = b.levels[b.levels.length - 1];
      b.levels = [{ level: last.level, hammer: BATTLES.tieBreakHammer }];
      b.index = 0;
      b.tieBreak = true;
      return { level: last.level, hammer: BATTLES.tieBreakHammer, active: winners };
    }
    this.battle = null;
    return { over: true, winners, points: { ...b.points } };
  }

  /**
   * Time onto the level's clock — a bonus clock taken (the original adds
   * 25 seconds, VA 0x12096). Everyone sees the new time at once.
   * @param {number} seconds
   */
  addTime(seconds) {
    if (this.state !== 'playing') return;
    const add = Math.max(0, Math.min(600, Math.floor(Number(seconds) || 0)));
    if (!add) return;
    this.timeLeft += add;
    this._emit(EVENTS.TIMER_TICK, { timeLeft: this.timeLeft });
  }

  /**
   * Handle a destructible object being hit.
   * @param {string} socketId
   * @param {string} objectId
   */
  handleObjectHit(socketId, objectId, force = 1) {
    if (this.state !== 'playing') return;

    const obj = this.objects.get(objectId);
    if (!obj) return;

    // A blow is worth its force against the block's hit points, which
    // come from the original's own table. The client works out which
    // blocks a swing reaches and how the force carries down through
    // their supports, and reports each one it hit with the force it
    // applied; the arithmetic here is the same, from the same hit
    // points, so both sides destroy the same blocks.
    obj.hp -= force;

    if (obj.hp <= 0) {
      this.objects.delete(objectId);
      this._emit(EVENTS.OBJECT_DESTROYED, { objectId });
    }
  }

  /**
   * Add a player to the room.
   * @param {object} player
   */
  addPlayer(player) {
    this.players.set(player.id, player);
  }

  /**
   * Remove a player from the room.
   * @param {string} socketId
   */
  removePlayer(socketId) {
    this.players.delete(socketId);
  }
}

module.exports = GameRoom;
