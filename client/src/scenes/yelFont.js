/**
 * F.EXE's writer (write_text 0x1d45e, write_line 0x1d4e0, font_frame
 * 0x1d20c) in YELMEDFT, the yellow letters of the shop and the map's
 * dialog: a glyph object each, the line centred on x (flag 0x8000).
 *
 * The font template (0x89b2c, `shop.font` of worlds.json): letters of
 * either case from frame `upper`/`lower`, digits from `digits`, the signs
 * from `signs`; a space is `space` wide, a letter its own width and `gap`
 * on; '@' starts a new line `line` lower. '~' draws nothing: it is where
 * the yes/no pointer stands (docs/re/front/hammer-shop.md).
 */

/**
 * @param {Phaser.Scene} scene
 * @param {{key: string, frames: number[][], font: object}} sheet the
 *   YELMEDFT texture, its frames [x, y, w, h, ox, oy], the font template
 * @param {string} text
 * @param {number} x the centre of each line
 * @param {number} y the first line's point
 * @returns {{images: Phaser.GameObjects.Image[], tilde: {x: number, y: number}|null}}
 */
export function writeYel(scene, sheet, text, x, y) {
  const { key, frames, font } = sheet;
  const images = [];
  let tilde = null;
  text.split('@').forEach((line, n) => {
    const glyphs = [];
    let at = 0;
    let tildeAt = null;
    for (const ch of line) {
      let f = -1;
      if (ch >= 'a' && ch <= 'z') f = font.lower + ch.charCodeAt(0) - 97;
      else if (ch >= 'A' && ch <= 'Z') f = font.upper + ch.charCodeAt(0) - 65;
      else if (ch >= '0' && ch <= '9') f = font.digits + ch.charCodeAt(0) - 48;
      else if (font.signs[ch] !== undefined) f = font.signs[ch];
      if (ch === '~') tildeAt = at;
      if (f < 0) {
        at += font.space;
        continue;
      }
      glyphs.push([f, at]);
      at += frames[f][2] + font.gap;
    }
    const left = x - Math.floor(at / 2);
    const ly = y + n * font.line;
    glyphs.forEach(([f, gx]) => {
      const [, , , , ox, oy] = frames[f];
      images.push(scene.add.image(left + gx + ox, ly + oy, key, String(f)).setOrigin(0, 0));
    });
    if (tildeAt !== null) tilde = { x: left + tildeAt, y: ly };
  });
  return { images, tilde };
}
