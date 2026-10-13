/**
 * Jack's on-screen geometry, kept in its own module so the sprite loader
 * and the hand-drawn fallback can both use it without importing each other.
 *
 * These match the original game 1:1: Jack stands 41 px tall against its
 * 48 px building blocks, so levels imported from the original (see
 * scripts/export_level.py) are in proportion without any rescaling.
 */
export const PLAYER_WIDTH = 24; // what he can be touched by — his torso, not his arms
/**
 * The box his walls and floors are probed with: x ± 4 (VA 0xa0260, used by
 * probe_wall_right / probe_wall_left and probe_floor) — far narrower than
 * he looks, so he slips past corners and stands on a ledge by his middle.
 */
export const BODY_WIDTH = 8;
export const CANVAS_WIDTH = 40; // hand-drawn fallback texture width
export const FULL_HEIGHT = 41;
export const CROUCH_HEIGHT = 22;
