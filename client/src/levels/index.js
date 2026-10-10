/**
 * Level registry.
 *
 * `level_01` is the hand-built MVP level, bundled. Everything else is
 * converted straight from the original game's own files by
 * scripts/export_level.py — real geometry, real artwork — and served from
 * `levels/<id>.json`, so a game loads only the level it plays: all of them
 * bundled would be megabytes before the menu.
 */
import level01 from './level01.json';
import levelOrder from '../../../shared/levels.json';

/** Levels that ship inside the bundle. */
export const BUNDLED = { level_01: level01 };

/** The order levels are played in — shared with the server. */
export const LEVEL_ORDER = levelOrder.order || [];

export const DEFAULT_LEVEL_ID = LEVEL_ORDER[0] || 'level_01';

/** A known level id, or the default one. */
export function levelIdOr(id) {
  return BUNDLED[id] || LEVEL_ORDER.includes(id) ? id : DEFAULT_LEVEL_ID;
}

/** @returns {string} where a served level's data is */
export function levelUrl(id) {
  return `levels/${id}.json`;
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
