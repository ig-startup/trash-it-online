/**
 * Props lifted from the original game's sprite files — the bell Jack has to
 * reach and the sledgehammer he swings (see scripts/export_props.py).
 *
 * Like Jack's own frames these carry the sheet's anchor point. The hammer's
 * is Jack's own feet — the game stands the hammer on his position — so its
 * frames reach out from there to wherever the head is.
 */
import manifest from './propFrames.json';

const key = (name) => `prop_${name}`;

/** pose name → ordered texture keys */
export const PROP_ANIMS = Object.fromEntries(
  Object.entries(manifest.anims).map(([n, names]) => [n, names.map(key)]),
);

/** texture key → { w, h, ax, ay } */
export const PROP_FRAME_INFO = Object.fromEntries(
  Object.entries(manifest.frames).map(([n, info]) => [key(n), info]),
);

/**
 * For each of Jack's animation slots, the hammer frame (an index into
 * PROP_ANIMS.hammer, which is SPA.SPR's own numbering) to show at each of
 * his frames — the game's list at VA 0x9ff88, with its top two bits
 * (0x4000 hide, 0x8000 show) left on. Missing slots carry none.
 */
export const HAMMER_BY_SLOT = manifest.hammerBySlot || {};

/**
 * The same for the hoover, VAC.SPR (the game's list at VA 0xa47c4): slots
 * 70 and 71 bring it out of the hat and put it back, 28 and 29 hold it.
 */
export const HOOVER_BY_SLOT = manifest.hooverBySlot || {};

/** @param {Phaser.Scene} scene */
export function preloadProps(scene) {
  Object.entries(manifest.frames).forEach(([name, info]) => {
    if (!scene.textures.exists(key(name))) scene.load.image(key(name), info.file);
  });
}

/** @param {Phaser.Scene} scene */
export function hasProps(scene) {
  return scene.textures.exists(PROP_ANIMS.bell[0]);
}

/**
 * Places a prop frame so its own anchor lands on (x, y).
 * @param {Phaser.GameObjects.Image} obj
 * @param {string} textureKey
 */
export function applyPropFrame(obj, textureKey) {
  obj.setTexture(textureKey);
  const info = PROP_FRAME_INFO[textureKey];
  if (info) obj.setOrigin(info.ax / info.w, info.ay / info.h);
}
