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
      const id = obj.id || `${obj.x}_${obj.y}`;
      this.objects.set(id, { hp: obj.hp });
    }

    this.levelId = levelData.id || null;
    this.timeLeft = levelData.timeLimit || 180;
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
   * Handle a bell hit — ends the game immediately.
   * @param {string} socketId — the player who hit the bell
   */
  handleBellHit(socketId) {
    if (this.state !== 'playing') return;

    this._clearTimer();
    this.state = 'ended';

    const winnerId = this.mode === 'race' ? socketId : null;
    this._emit(EVENTS.LEVEL_COMPLETE, { winnerId });
  }

  /**
   * Handle a destructible object being hit.
   * @param {string} socketId
   * @param {string} objectId
   */
  handleObjectHit(socketId, objectId) {
    if (this.state !== 'playing') return;

    const obj = this.objects.get(objectId);
    if (!obj) return;

    obj.hp--;

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
