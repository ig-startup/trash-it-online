'use strict';

const GameRoom = require('./GameRoom');
const { PLAYER_COLORS } = require('../../shared/constants');

const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 4;

class RoomManager {
  constructor() {
    /** @type {Map<string, GameRoom>} code → room */
    this._rooms = new Map();

    /** @type {Map<string, string>} socketId → room code */
    this._playerRoomMap = new Map();
  }

  /**
   * Generate a random 4-char A-Z code.
   * @returns {string}
   */
  generateCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  /**
   * Generate a code that is not already in use.
   * @returns {string}
   */
  _uniqueCode() {
    let code;
    do {
      code = this.generateCode();
    } while (this._rooms.has(code));
    return code;
  }

  /**
   * Create a new room. The host is automatically added as the first player.
   * @param {string} mode - 'coop' | 'battle'
   * @param {string} hostSocketId
   * @param {string} playerName
   * @param {object} [io] - Socket.io Server instance passed to GameRoom
   * @returns {GameRoom}
   */
  createRoom(mode, hostSocketId, playerName, io) {
    const code = this._uniqueCode();
    const room = new GameRoom({ code, mode, hostId: hostSocketId, io });
    this._rooms.set(code, room);

    // Add host as the first player
    const player = this._makePlayer(hostSocketId, playerName, room.players.size);
    room.players.set(hostSocketId, player);
    this._playerRoomMap.set(hostSocketId, code);

    return room;
  }

  /**
   * Find a room by code.
   * @param {string} code
   * @returns {GameRoom|null}
   */
  findRoom(code) {
    return this._rooms.get(code) || null;
  }

  /**
   * Add a player to a room.
   * @param {string} code
   * @param {string} socketId
   * @param {string} playerName
   * @returns {Object|false} Player object, or false if room is full / not found
   */
  addPlayer(code, socketId, playerName) {
    const room = this.findRoom(code);
    if (!room) return false;
    if (room.players.size >= MAX_PLAYERS) return false;

    const player = this._makePlayer(socketId, playerName, room.players.size);
    room.players.set(socketId, player);
    this._playerRoomMap.set(socketId, code);
    return player;
  }

  /**
   * Remove a player from their room. Deletes the room if it becomes empty.
   * @param {string} socketId
   */
  removePlayer(socketId) {
    const code = this._playerRoomMap.get(socketId);
    if (!code) return;

    const room = this._rooms.get(code);
    if (room) {
      room.players.delete(socketId);
      if (room.players.size === 0) {
        this._rooms.delete(code);
      }
    }

    this._playerRoomMap.delete(socketId);
  }

  /**
   * Get the room a socket is currently in.
   * @param {string} socketId
   * @returns {GameRoom|null}
   */
  getPlayerRoom(socketId) {
    const code = this._playerRoomMap.get(socketId);
    return code ? (this._rooms.get(code) || null) : null;
  }

  /**
   * Build a Player object.
   * @param {string} socketId
   * @param {string} name
   * @param {number} index - current player count (used for color assignment)
   * @returns {Object}
   */
  _makePlayer(socketId, name, index) {
    return {
      id: socketId,
      name,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      x: 0,
      y: 0,
      ready: false,
    };
  }
}

module.exports = RoomManager;
