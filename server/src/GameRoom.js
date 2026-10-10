'use strict';

const { EVENTS } = require('../../shared/constants');

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
   */
  startGame(levelData) {
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
    this.state = 'playing';

    // Tick every second
    this.timer = setInterval(() => {
      this.timeLeft--;
      this._emit(EVENTS.TIMER_TICK, { timeLeft: this.timeLeft });

      if (this.timeLeft <= 0) {
        this._clearTimer();
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

    this.rung.push(socketId);
    this._emit(EVENTS.PLAYER_RANG, { playerId: socketId, place: this.rung.length });
    return this.finishIfAllRang();
  }

  /**
   * Ends the level once every player still here has rung — also after
   * someone leaves, who may have been the last one it waited for.
   * @returns {boolean} true when it ended the level
   */
  finishIfAllRang() {
    if (this.state !== 'playing' || this.rung.length === 0) return false;
    const waiting = [...this.players.keys()].filter((id) => !this.rung.includes(id));
    if (waiting.length > 0) return false;

    this._clearTimer();
    this.state = 'ended';

    const winnerId = this.mode === 'race' ? this.rung[0] : null;
    this._emit(EVENTS.LEVEL_COMPLETE, { winnerId, places: [...this.rung] });
    return true;
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
