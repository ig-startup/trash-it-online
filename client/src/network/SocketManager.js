import { io } from 'socket.io-client';
import { EVENTS } from '../../../shared/constants.mjs';

const THROTTLE_MS = 50; // max 20 updates/s

/** Events that fire many times a second and must never be logged. */
const CHATTY_EVENTS = new Set([EVENTS.PLAYER_UPDATE]);

/**
 * Singleton wrapper around socket.io-client.
 * Stores session state: playerId, roomCode, isHost, mode, playerName.
 */
class SocketManager {
  constructor() {
    this.socket = null;

    // Session state
    this.playerId = null;
    this.roomCode = null;
    this.isHost = false;
    this.mode = 'coop';
    this.playerName = 'Player';

    // Throttle timestamp for sendPlayerUpdate
    this._lastSendTime = 0;
  }

  /**
   * Returns the singleton instance.
   * @returns {SocketManager}
   */
  static getInstance() {
    if (!SocketManager._instance) {
      SocketManager._instance = new SocketManager();
    }
    return SocketManager._instance;
  }

  /**
   * Connect to socket.io server.
   * In dev (via Vite proxy) pass window.location.origin so the proxy handles it.
   * @param {string} [serverUrl]
   */
  connect(serverUrl) {
    if (this.socket && this.socket.connected) {
      console.log('[SocketManager] already connected');
      return;
    }

    const url = serverUrl || window.location.origin;
    console.log(`[SocketManager] connecting to ${url}`);

    this.socket = io(url, {
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log(`[SocketManager] connected, id=${this.socket.id}`);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn(`[SocketManager] disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (err) => {
      console.error(`[SocketManager] connection error: ${err.message}`);
    });
  }

  /**
   * Emit an event to the server.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    if (!this.socket) {
      console.error('[SocketManager] emit called before connect()');
      return;
    }
    // Position updates go out 20 times a second. Logging each one, with
    // its object, floods the console: with devtools open the tab slows to
    // a crawl and then stops responding. Only the rare events are logged.
    if (!CHATTY_EVENTS.has(event)) {
      console.log(`[SocketManager] emit "${event}"`, data);
    }
    this.socket.emit(event, data);
  }

  /**
   * Subscribe to a server event.
   * @param {string} event
   * @param {Function} cb
   */
  on(event, cb) {
    if (!this.socket) {
      console.error('[SocketManager] on() called before connect()');
      return;
    }
    this.socket.on(event, cb);
  }

  /**
   * Send player position/state to server with 50ms throttle.
   * @param {number} x
   * @param {number} y
   * @param {string} state  'idle'|'run'|'jump'|'crouch'|'hammer'
   * @param {string} dir    'left'|'right'
   */
  sendPlayerUpdate(x, y, state, dir) {
    const now = Date.now();
    if (now - this._lastSendTime < THROTTLE_MS) return;
    this._lastSendTime = now;
    this.emit(EVENTS.PLAYER_UPDATE, { x, y, state, dir });
  }

  /**
   * Unsubscribe from a server event.
   * @param {string} event
   * @param {Function} [cb]
   */
  off(event, cb) {
    if (!this.socket) return;
    if (cb) {
      this.socket.off(event, cb);
    } else {
      this.socket.off(event);
    }
  }
}

SocketManager._instance = null;

export default SocketManager;
