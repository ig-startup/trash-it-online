/**
 * Level registry.
 *
 * `level_01` is the hand-built MVP level. Everything else is converted
 * straight from the original game's own files by scripts/export_level.py —
 * real geometry, real artwork. Re-running that script regenerates
 * `generated.js`, so new levels appear here without touching this file.
 */
import level01 from './level01.json';
import { GENERATED_LEVELS } from './generated';
import levelOrder from '../../../shared/levels.json';

export const LEVELS = {
  level_01: level01,
  ...GENERATED_LEVELS,
};

/** The order levels are played in — shared with the server. */
export const LEVEL_ORDER = (levelOrder.order || [])
  .filter((id) => LEVELS[id]);

export const DEFAULT_LEVEL_ID = LEVEL_ORDER[0] || 'level_01';

/**
 * @param {string} id
 * @returns {object} the level, falling back to the default one
 */
export function getLevel(id) {
  return LEVELS[id] || LEVELS[DEFAULT_LEVEL_ID];
}

/**
 * The level after `id`, wrapping around at the end.
 * @param {string} id
 * @returns {string}
 */
export function nextLevelId(id) {
  const i = LEVEL_ORDER.indexOf(id);
  return LEVEL_ORDER[(i + 1) % LEVEL_ORDER.length] || DEFAULT_LEVEL_ID;
}
