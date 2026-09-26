import Phaser from 'phaser';
import { WORLD_COLORS } from '../palette';

/**
 * Draws a layered background (sky gradient, mountain silhouette, industrial
 * scenery) into the scene, behind gameplay objects. Referenced from the
 * original 1997 game's screenshots: teal/blue sky, snow-capped mountains,
 * gray industrial structures (chimneys, tanks, girder towers).
 *
 * @param {Phaser.Scene} scene
 * @param {number} levelWidth
 * @param {number} levelHeight
 */
export function buildBackground(scene, levelWidth, levelHeight) {
  const gfx = scene.add.graphics();
  gfx.setDepth(-100);

  // ── Sky gradient (banded — Phaser Graphics has no true vertical gradient fill) ──
  const bands = 12;
  const topColor = Phaser.Display.Color.ValueToColor(WORLD_COLORS.skyTop);
  const bottomColor = Phaser.Display.Color.ValueToColor(WORLD_COLORS.sky);
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(topColor, bottomColor, bands - 1, i);
    const color = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    gfx.fillStyle(color, 1);
    gfx.fillRect(0, (levelHeight / bands) * i, levelWidth, levelHeight / bands + 1);
  }

  // ── Distant mountains, confined to a band near the horizon ──────────────────
  const horizonY = levelHeight * 0.28;
  const mountainBandBottom = horizonY + 90;
  const peakCount = Math.max(4, Math.round(levelWidth / 500));
  const points = [];
  for (let i = 0; i <= peakCount; i += 1) {
    const x = (levelWidth / peakCount) * i;
    const peak = horizonY - 20 - (i % 2 === 0 ? 90 : 40) - Math.random() * 40;
    points.push({ x, y: peak });
  }
  gfx.fillStyle(WORLD_COLORS.mountainFar, 1);
  gfx.beginPath();
  gfx.moveTo(0, mountainBandBottom);
  points.forEach((p) => gfx.lineTo(p.x, p.y));
  gfx.lineTo(levelWidth, mountainBandBottom);
  gfx.closePath();
  gfx.fillPath();

  // Snow caps
  gfx.fillStyle(WORLD_COLORS.snow, 1);
  points.forEach((p) => {
    gfx.fillTriangle(p.x - 22, p.y + 26, p.x + 22, p.y + 26, p.x, p.y);
  });

  // ── Back wall behind the demolition site (below the mountain band) ──────────
  gfx.fillStyle(WORLD_COLORS.backWall, 1);
  gfx.fillRect(0, mountainBandBottom, levelWidth, levelHeight - mountainBandBottom);

  // ── Industrial silhouettes scattered along the level ─────────────────────────
  const structureSpacing = 420;
  for (let x = 150; x < levelWidth; x += structureSpacing) {
    const kind = Math.floor((x / structureSpacing)) % 3;
    const groundY = levelHeight - 32;
    if (kind === 0) {
      // Chimney
      gfx.fillStyle(WORLD_COLORS.metal, 1);
      gfx.fillRect(x, groundY - 140, 22, 140);
      gfx.fillStyle(WORLD_COLORS.metalLight, 1);
      gfx.fillRect(x, groundY - 140, 6, 140);
      gfx.fillStyle(WORLD_COLORS.rubbleDark, 1);
      gfx.fillRect(x - 4, groundY - 148, 30, 10);
    } else if (kind === 1) {
      // Storage tank
      gfx.fillStyle(WORLD_COLORS.metalLight, 1);
      gfx.fillRoundedRect(x, groundY - 80, 60, 80, 6);
      gfx.fillStyle(WORLD_COLORS.metal, 1);
      gfx.fillRect(x, groundY - 80, 60, 8);
    } else {
      // Girder tower
      gfx.fillStyle(WORLD_COLORS.metal, 1);
      gfx.fillRect(x, groundY - 160, 8, 160);
      gfx.fillRect(x + 40, groundY - 160, 8, 160);
      for (let ty = groundY - 150; ty < groundY; ty += 30) {
        gfx.fillRect(x, ty, 48, 5);
      }
    }
  }
}
