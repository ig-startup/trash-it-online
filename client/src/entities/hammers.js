/**
 * The original's 37 hammers (scripts/export_hammers.py): what a blow of
 * each carries, and its own sprite sheet — 61 frames in the same order for
 * every one, so the hammer lists of Jack's animations fit them all.
 */
import HAMMERS from '../../../shared/hammers.json';

export { HAMMERS };

/** The sledge hammer v1: the one the story starts Jack on. */
export const FIRST_HAMMER = 0;

/** @param {number} index into the catalogue (G.EXE VA 0xa1e04) */
export function hammerAt(index) {
  return HAMMERS[index] || HAMMERS[FIRST_HAMMER];
}

/** The texture key of a hammer's atlas. */
export function hammerKey(hammer) {
  return `hammer_${hammer.sprite}`;
}

/** Queues a hammer's sheet, once. */
export function preloadHammer(scene, hammer) {
  const key = hammerKey(hammer);
  if (!scene.textures.exists(key)) scene.load.atlas(key, hammer.atlas.image, hammer.atlas.data);
}

/**
 * A frame's size and anchor — where Jack's feet are in it.
 * @returns {{w: number, h: number, ax: number, ay: number}|null}
 */
export function hammerFrameInfo(scene, hammer, frame) {
  const f = scene.textures.getFrame(hammerKey(hammer), String(frame));
  if (!f || !f.customData) return null;
  return { w: f.width, h: f.height, ax: f.customData.ax, ay: f.customData.ay };
}

/**
 * How many blocks one blow may strike (VA 0x1fcd3): type 4 picks 2 or 3;
 * an aimed one (type 0) strikes 1 with UP held, 2 with DOWN, else 3.
 * @param {object} hammer
 * @param {number} [held] the input word as the blow lands: 4 UP, 8 DOWN
 */
export function hammerStrikes(hammer, held = 0) {
  if (hammer.aimed) return held & 4 ? 1 : held & 8 ? 2 : 3;
  const s = hammer.strikes;
  return Array.isArray(s) ? s[Math.floor(Math.random() * s.length)] : s;
}
