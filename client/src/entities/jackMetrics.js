/**
 * Jack's on-screen geometry, kept in its own module so the sprite loader
 * and the hand-drawn fallback can both use it without importing each other.
 *
 * These match the original game 1:1: Jack stands 41 px tall against its
 * 48 px building blocks, so levels imported from the original (see
 * scripts/export_level.py) are in proportion without any rescaling.
 */
export const PLAYER_WIDTH = 24; // physics body width — his torso, not his arms
export const CANVAS_WIDTH = 40; // hand-drawn fallback texture width
export const FULL_HEIGHT = 41;
export const CROUCH_HEIGHT = 22;
