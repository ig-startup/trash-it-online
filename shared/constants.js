// Shared constants for client and server

const EVENTS = {
  // Client → Server
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  PLAYER_READY: 'player_ready',
  START_GAME: 'start_game',
  PLAYER_UPDATE: 'player_update',
  BELL_HIT: 'bell_hit',
  OBJECT_HIT: 'object_hit',

  // Server → Client
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  JOIN_ERROR: 'join_error',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_READY_CHANGED: 'player_ready_changed',
  GAME_STARTED: 'game_started',
  OBJECT_DESTROYED: 'object_destroyed',
  LEVEL_COMPLETE: 'level_complete',
  LEVEL_FAILED: 'level_failed',
  TIMER_TICK: 'timer_tick',
};

const PLAYER_COLORS = ['#ff4444', '#4444ff', '#44bb44', '#ffaa00'];

const GAME_CONFIG = {
  PORT: 3000,
  PLAYER_COLORS,
};

/**
 * What one hammer blow is worth against a block's hit points, which come
 * from the original's own `.OBT` table and run from 50 to 60000.
 *
 * The game's own figure has not been recovered — it reaches the damage
 * routine through several registers — so this is ours. 0x9000 is
 * the value, which does appear in the code around this machinery, and
 * against the real hit points it splits the archive cleanly: 57% of
 * blocks go in one blow and the remaining 43% in two, with nothing
 * needing three. See "How a structure collapses" in
 * scripts/formats/README.md.
 */
const HAMMER_FORCE = 36864;

module.exports = { EVENTS, GAME_CONFIG, PLAYER_COLORS, HAMMER_FORCE };
