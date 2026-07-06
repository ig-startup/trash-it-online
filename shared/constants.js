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

module.exports = { EVENTS, GAME_CONFIG, PLAYER_COLORS };
