/**
 * Real frames of "Jack", decoded straight out of the original 1997 game's
 * own sprite sheet (SPR/JACKS.SPR) — see scripts/export_jack_frames.py and
 * scripts/formats/spr.py. Pixel-exact, with the sheet's own per-frame
 * anchor point, so poses stay planted instead of jittering.
 *
 * Replaces the four frames that used to be cropped out of archive.org
 * screenshots with a flood fill.
 *
 * Players are told apart by overalls colour as in the original, so every
 * frame ships in four recoloured variants (see PLAYER_COLORS).
 *
 * To change which poses ship, edit ANIMS in scripts/export_jack_frames.py
 * and re-run it — it rewrites the PNGs and jackFrames.json together.
 */
import manifest from './jackFrames.json';
import { FULL_HEIGHT } from './jackMetrics';

/** Uniform scale so Jack's standing height matches the game's body height. */
export const JACK_SCALE = FULL_HEIGHT / manifest.standHeight;

/** All pose names the sheet provides, e.g. 'run', 'jump', 'hammerUp'. */
export const JACK_POSES = Object.keys(manifest.anims);

/**
 * Frames live in one packed atlas per colour, so a "key" here names both:
 * `<atlas>|<frame>`. applyJackFrame splits it. Loading the 109 poses as
 * separate images in four colours meant 436 requests and 436 GPU textures
 * when a level started, which was enough to lock the tab up.
 */
const atlasKey = (variant) => `jack_${variant}`;
const textureKey = (variant, frameName) => `${atlasKey(variant)}|${frameName}`;

/**
 * Picks the colour variant whose overalls match a player's colour, falling
 * back to the untouched original for any colour we don't ship.
 * @param {string} colorHex e.g. '#ff4444'
 */
export function variantForColor(colorHex) {
  const wanted = String(colorHex || '').toLowerCase();
  const hit = Object.entries(manifest.variants)
    .find(([, hex]) => hex.toLowerCase() === wanted);
  return hit ? hit[0] : manifest.original;
}

/**
 * pose name → ordered texture keys, for one colour variant.
 * @param {string} variant
 * @returns {Record<string, string[]>}
 */
export function jackAnims(variant) {
  return Object.fromEntries(
    Object.entries(manifest.anims).map(([pose, names]) => [
      pose,
      names.map((n) => textureKey(variant, n)),
    ]),
  );
}

/**
 * Frame metadata by texture key: { w, h, ax, ay } straight from the sheet,
 * where (ax, ay) is Jack's feet-centre inside the image.
 */
export const JACK_FRAME_INFO = {};
Object.keys(manifest.variants).forEach((variant) => {
  Object.entries(manifest.frames).forEach(([name, info]) => {
    JACK_FRAME_INFO[textureKey(variant, name)] = info;
  });
});

/** True once the frames are loaded and usable. */
export function hasRealJackFrames(scene) {
  return scene.textures.exists(atlasKey(manifest.original));
}

/**
 * Queues one packed atlas per colour for loading.
 * Call from a Scene's preload().
 * @param {Phaser.Scene} scene
 */
export function preloadRealJackFrames(scene) {
  Object.entries(manifest.atlases).forEach(([variant, files]) => {
    const key = atlasKey(variant);
    if (!scene.textures.exists(key)) scene.load.atlas(key, files.image, files.data);
  });
}
