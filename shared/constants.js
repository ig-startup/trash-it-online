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
  TIME_BONUS: 'time_bonus',      // a clock taken: seconds onto the level's timer

  // Server → Client
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  JOIN_ERROR: 'join_error',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_READY_CHANGED: 'player_ready_changed',
  GAME_STARTED: 'game_started',
  OBJECT_DESTROYED: 'object_destroyed',
  PLAYER_RANG: 'player_rang',    // one player has rung the bell and is out of the level
  LEVEL_COMPLETE: 'level_complete',
  LEVEL_FAILED: 'level_failed',
  BATTLE_OVER: 'battle_over',      // the set is played: everyone's points, and who won
  TIMER_TICK: 'timer_tick',
};

const PLAYER_COLORS = ['#ff4444', '#4444ff', '#44bb44', '#ffaa00'];

const GAME_CONFIG = {
  PORT: 3000,
  PLAYER_COLORS,
};

/**
 * The hammer Jack swings: the first record of the original's hammer
 * catalogue (VA 0xa1e04, `scripts/formats/hammers.py`), "the sledge
 * hammer v1" — the one the game starts you on. The clone has no shop, so
 * it is the only one; the levels' hit points are pitched at the whole
 * catalogue, which is why some buildings barely notice it and want
 * dynamite or a collapse instead.
 *
 *   lo, hi  record +0x3c / +0x40 — the two ends of the force ramp
 *   halves  hammer type (record +0x48) 1 and 4 halve the blow (VA 0x1fcd3)
 *   strikes how many blocks one blow may hit; type 1 gives 3
 *   overLo, overHi  record +0x44 / +0x46 — the overhead strike's own ramp
 *   reach   record +0x4a..+0x50: where the blow lands from Jack's feet
 *           (dx ahead, dy down) and how far it spreads (w, h) — VA 0x1f83d
 *   overBox record +0x5e / +0x62 / +0x60: the overhead strike's box, from
 *           Jack's feet (VA 0x1fd5a). That strike hits sprites, not blocks.
 *
 * See "What a hammer blow carries" in scripts/formats/README.md.
 */
const HAMMER = {
  name: 'the sledge hammer v1', lo: 8, hi: 150, halves: true, strikes: 3, overLo: 1, overHi: 8,
  reach: { dx: 53, dy: -12, w: 4, h: 7 },
  overBox: { dx: 40, dy: -13, w: 27, h: 14 },
};

/** Holding the key charges the swing up to this (VA 0x23a93). */
const MAX_CHARGE = 6;

/**
 * What a blow carries at a given charge: `lo + ((hi - lo) >> (6 - charge))`
 * (VA 0x23d54), halved for this hammer's type. A tap is worth 5, a full
 * charge 75.
 * @param {number} charge 0..MAX_CHARGE
 */
function hammerForce(charge, hammer = HAMMER) {
  const c = Math.max(0, Math.min(MAX_CHARGE, charge | 0));
  const f = hammer.lo + ((hammer.hi - hammer.lo) >>> (MAX_CHARGE - c));
  return hammer.halves ? f >>> 1 : f;
}

/** The overhead windup charges to 3, not 6 (VA 0x23f7e). */
const MAX_OVER_CHARGE = 3;

/**
 * The overhead strike: the same ramp over its own two numbers,
 * `overLo + ((overHi - overLo) >> (3 - charge))` (VA 0x241db). It does not
 * touch blocks at all: VA 0x1fd94 hands it to every *sprite* in the
 * strike's box (VA 0x2f156), which is how a clock gets smashed or a
 * hanging sign set swinging. For this hammer it is 1..8.
 * @param {number} charge 0..MAX_OVER_CHARGE
 */
function overheadForce(charge, hammer = HAMMER) {
  const c = Math.max(0, Math.min(MAX_OVER_CHARGE, charge | 0));
  return hammer.overLo + ((hammer.overHi - hammer.overLo) >>> (MAX_OVER_CHARGE - c));
}

/** A fully charged blow — what the server tests swing. */
const HAMMER_FORCE = hammerForce(MAX_CHARGE);

module.exports = {
  EVENTS, GAME_CONFIG, PLAYER_COLORS, HAMMER, MAX_CHARGE, hammerForce, MAX_OVER_CHARGE, overheadForce,
  HAMMER_FORCE,
};
