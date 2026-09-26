import Phaser from 'phaser';
import { JACK_COLORS } from '../palette';
import {
  PLAYER_WIDTH, CANVAS_WIDTH, FULL_HEIGHT, CROUCH_HEIGHT,
} from './jackMetrics';
import {
  JACK_FRAME_INFO, JACK_SCALE, hasRealJackFrames, jackAnims, variantForColor,
} from './jackSprites';

export { PLAYER_WIDTH, CANVAS_WIDTH, FULL_HEIGHT, CROUCH_HEIGHT };

/**
 * Draws one animation frame of "Jack" into a Phaser Graphics object.
 * Pose parameters let the same drawing routine produce idle / run / jump /
 * hammer / crouch frames by shifting legs, arms and the hammer.
 *
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} overallsColor
 * @param {object} pose
 * @param {number} [pose.legSpread=0]   px each leg moves apart (run cycle)
 * @param {number} [pose.frontLegLift=0] px the front leg lifts (run cycle)
 * @param {number} [pose.armRaise=0]    0..1 how high the hammer arm is raised
 * @param {number} [pose.hammerSwing=0] 0..1 swing progress (0=up, 1=struck down)
 * @param {number} [pose.crouch=false]
 * @param {number} [pose.bob=0]         vertical body bob in px (idle breathing)
 */
export function drawJack(gfx, overallsColor, pose = {}) {
  const {
    legSpread = 0,
    frontLegLift = 0,
    armRaise = 0,
    hammerSwing = null,
    crouch = false,
    bob = 0,
  } = pose;

  const w = PLAYER_WIDTH;
  const h = crouch ? CROUCH_HEIGHT + 20 : FULL_HEIGHT;
  const yOff = bob;

  // ── Back leg ────────────────────────────────────────────────────────────
  gfx.fillStyle(JACK_COLORS.boots, 1);
  gfx.fillRect(4 - legSpread, h - 8 - yOff, 9, 8);
  gfx.fillStyle(JACK_COLORS.bootsShadow, 1);
  gfx.fillRect(4 - legSpread, h - 3 - yOff, 9, 3);

  gfx.fillStyle(overallsColor, 1);
  gfx.fillRect(5 - legSpread, h - 22 - yOff - frontLegLift, 8, 15);

  // ── Body ────────────────────────────────────────────────────────────────
  if (!crouch) {
    gfx.fillStyle(overallsColor, 1);
    gfx.fillRect(4, h - 30 - yOff, w - 8, 14);
    gfx.fillStyle(JACK_COLORS.overallsShadow, 1);
    gfx.fillRect(4, h - 30 - yOff, w - 8, 4);
  } else {
    gfx.fillStyle(overallsColor, 1);
    gfx.fillRect(4, h - 26 - yOff, w - 8, 12);
  }

  // ── Front leg (drawn after body so it overlaps) ────────────────────────────
  gfx.fillStyle(JACK_COLORS.boots, 1);
  gfx.fillRect(w - 13 + legSpread, h - 8 - yOff + frontLegLift, 9, 8 - frontLegLift);
  gfx.fillStyle(JACK_COLORS.bootsShadow, 1);
  gfx.fillRect(w - 13 + legSpread, h - 3 - yOff, 9, 3);

  gfx.fillStyle(overallsColor, 1);
  gfx.fillRect(w - 13 + legSpread, h - 22 - yOff, 8, 15 - frontLegLift);

  // ── Back arm ────────────────────────────────────────────────────────────
  gfx.fillStyle(JACK_COLORS.skin, 1);
  gfx.fillRect(1, h - 28 - yOff, 5, 12);

  // ── Hammer + front arm ──────────────────────────────────────────────────
  if (hammerSwing !== null) {
    // hammerSwing: 0 = raised overhead, 1 = struck down at ground level
    const armY = h - 30 - yOff - (1 - hammerSwing) * 14;
    const headY = h - 8 - yOff - (1 - hammerSwing) * 30;
    gfx.fillStyle(JACK_COLORS.skin, 1);
    gfx.fillRect(w - 6, armY, 5, 14);
    gfx.fillStyle(JACK_COLORS.hammerHandle, 1);
    gfx.fillRect(w - 4, headY, 3, h - 8 - yOff - headY);
    gfx.fillStyle(JACK_COLORS.hammerHeadDark, 1);
    gfx.fillRect(w - 10, headY - 8, 16, 9);
    gfx.fillStyle(JACK_COLORS.hammerHead, 1);
    gfx.fillRect(w - 10, headY - 8, 16, 6);
  } else {
    const armLift = armRaise * 6;
    gfx.fillStyle(JACK_COLORS.skin, 1);
    gfx.fillRect(w - 6, h - 28 - yOff - armLift, 5, 12);
  }

  // ── Head ────────────────────────────────────────────────────────────────
  const headTop = crouch ? h - 36 - yOff : h - 42 - yOff;
  gfx.fillStyle(JACK_COLORS.skin, 1);
  gfx.fillRect(8, headTop, w - 16, 12);
  gfx.fillStyle(JACK_COLORS.skinShadow, 1);
  gfx.fillRect(8, headTop + 9, w - 16, 3);

  // ── Hard hat ────────────────────────────────────────────────────────────
  gfx.fillStyle(JACK_COLORS.hardHat, 1);
  gfx.fillRect(6, headTop - 6, w - 12, 8);
  gfx.fillRect(4, headTop + 1, w - 8, 3);
  gfx.fillStyle(JACK_COLORS.hardHatShadow, 1);
  gfx.fillRect(6, headTop + 1, w - 12, 2);
}

/**
 * Resolves the animation frames for one player.
 *
 * Prefers the real sheet frames decoded from the original game (recoloured
 * per player, see jackSprites.js). Falls back to the hand-drawn frames below
 * if they haven't loaded — so the game still runs without the PNGs.
 *
 * @param {Phaser.Scene} scene
 * @param {string} playerId
 * @param {string} colorHex per-player overalls colour, e.g. '#ff4444'
 * @returns {Record<string, string[]>} pose name → ordered texture keys
 */
export function ensureJackTextures(scene, playerId, colorHex) {
  if (hasRealJackFrames(scene)) {
    return jackAnims(variantForColor(colorHex));
  }
  return drawnJackTextures(scene, playerId, colorHex);
}

/**
 * Hand-drawn fallback frame set, in the same pose→keys shape as the real one.
 * @returns {Record<string, string[]>}
 */
function drawnJackTextures(scene, playerId, colorHex) {
  const overallsColor = Phaser.Display.Color.HexStringToColor(colorHex).color;
  const prefix = `jack_drawn_${playerId}_`;

  const poses = {
    idle: { bob: 0 },
    idle2: { bob: 1 },
    run0: { legSpread: 5, frontLegLift: 4 },
    run1: { legSpread: 0, frontLegLift: 0 },
    run2: { legSpread: -5, frontLegLift: 4 },
    jump: { legSpread: 2, frontLegLift: 6 },
    crouch: { crouch: true },
    hammerUp: { hammerSwing: 0 },
    hammerMid: { hammerSwing: 0.5 },
    hammerDown: { hammerSwing: 1 },
  };

  const keys = {};
  Object.entries(poses).forEach(([name, pose]) => {
    const key = prefix + name;
    keys[name] = key;
    if (scene.textures.exists(key)) return;
    const gfx = scene.make.graphics({ x: 0, y: 0, add: false });
    drawJack(gfx, overallsColor, pose);
    gfx.generateTexture(key, CANVAS_WIDTH, FULL_HEIGHT);
    gfx.destroy();
  });

  // Pose names match the real sheet's (see scripts/export_jack_frames.py),
  // so the game reads the same either way; these stand-ins just have far
  // fewer frames.
  return {
    idle: [keys.idle, keys.idle2],
    run: [keys.run0, keys.run1, keys.run2],
    skid: [keys.crouch],
    jump: [keys.jump],
    fall: [keys.jump],
    land: [keys.crouch],
    getUp: [keys.crouch, keys.idle],
    hammerSide: [keys.hammerUp, keys.hammerMid, keys.hammerDown],
    hammerOver: [keys.hammerUp, keys.hammerMid, keys.hammerDown],
    helmetIn: [keys.crouch],
    helmetMove: [keys.crouch],
    airRoll: [keys.jump],
  };
}

/**
 * Shows one frame on a game object.
 *
 * Real sheet frames vary in size and carry their own anchor, so they are
 * placed by that anchor and all drawn at one scale — that keeps Jack the
 * same size across poses and keeps his feet on the ground. Hand-drawn
 * frames are already game-sized with the feet at the bottom edge.
 *
 * @param {Phaser.GameObjects.Image} obj
 * @param {string} key
 * @param {boolean} [force] apply even if the texture is already set — needed
 *   right after construction, where the texture is set but not yet sized
 */
export function applyJackFrame(obj, key, force = false) {
  if (!key || (!force && obj.texture?.key === key)) return;
  obj.setTexture(key);

  const info = JACK_FRAME_INFO[key];
  if (info) {
    obj.setOrigin(info.ax / info.w, info.ay / info.h);
    obj.setDisplaySize(info.w * JACK_SCALE, info.h * JACK_SCALE);
    return;
  }

  obj.setOrigin(0.5, 1);
  const src = obj.texture.getSourceImage();
  obj.setDisplaySize(src.width * (FULL_HEIGHT / src.height), FULL_HEIGHT);
}
