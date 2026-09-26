/**
 * Props lifted from the original game's sprite files — the bell Jack has to
 * reach and the sledgehammer he swings (see scripts/export_props.py).
 *
 * Like Jack's own frames these carry the sheet's anchor point. For the
 * hammer that anchor is the grip, so placing it on Jack's hands is just a
 * matter of putting the anchor there.
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
