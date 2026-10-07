"""
Demo/proof script for the Trash It format decoders.

Decodes sample files from the original game and writes PNG previews so
the results can be visually checked. Does NOT copy original game assets
into the repo — it only reads the game files and writes previews to a
temporary output directory.

Defaults to the repo's own `Trash-it-original/` (which is gitignored);
override with the TRASHIT_DIR env var, e.g. a full archive extraction.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import pal
import scn
import g2
import spr
import level
import _png

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRASHIT_DIR = os.environ.get("TRASHIT_DIR", os.path.join(_REPO, "Trash-it-original"))
OUT_DIR = os.environ.get("TRASHIT_OUT", "/tmp/trashit_previews")

LEVELS = os.path.join(TRASHIT_DIR, "LEVELS")
SPR = os.path.join(TRASHIT_DIR, "SPR")


def _write_indexed(path, w, h, flat, palette, transparent=None):
    if transparent is None:
        _png.write_rgb(path, w, h, [palette[v] for v in flat])
    else:
        _png.write_rgba(path, w, h,
                        [(0, 0, 0, 0) if v is None or v == transparent
                         else palette[v] + (255,) for v in flat])
    print("  ->", os.path.basename(path))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # The live palette is assembled from two files: the level owns
    # indices 0..150, JACKS.PAL owns 151..255 (see pal.py).
    level_pal = pal.decode(os.path.join(LEVELS, "0A.PAL"))
    jack_pal = pal.decode(os.path.join(SPR, "JACKS.PAL"))
    palette = pal.merge(level_pal, jack_pal)
    print(f"[PAL] 0A.PAL + JACKS.PAL merged: {len(palette)} colors")

    # SCN: full background layers
    header, layers = scn.decode(os.path.join(SPR, "0A.SCN"))
    print(f"[SCN] 0A.SCN: {len(layers)} layers of {scn.LAYER_W}x{scn.LAYER_H}")
    for i, layer in enumerate(layers):
        _write_indexed(os.path.join(OUT_DIR, f"0A_scn_layer{i}.png"),
                       scn.LAYER_W, scn.LAYER_H, layer, palette)

    # G2: every shape in the level's library, as a contact sheet
    shapes = g2.load(os.path.join(LEVELS, "0A.G2"))
    routines = g2.load_routines(os.path.join(LEVELS, "0A.G2R"))
    print(f"[G2] 0A.G2: {len(shapes)} shapes, routines={sorted(set(routines))}")
    cols = 10
    cw = max(s[0] for s in shapes) + 2
    ch = max(s[1] for s in shapes) + 2
    rows_n = (len(shapes) + cols - 1) // cols
    sheet = [None] * (cols * cw * rows_n * ch)
    for i, (w, h, img) in enumerate(shapes):
        ox, oy = (i % cols) * cw, (i // cols) * ch
        for y in range(h):
            for x in range(w):
                sheet[(oy + y) * cols * cw + ox + x] = img[y][x]
    _write_indexed(os.path.join(OUT_DIR, "0A_g2_shapes.png"),
                   cols * cw, rows_n * ch, sheet, palette, transparent=255)

    # SPR: Jack's sprite sheet, in his own half of the palette
    frames = spr.load(os.path.join(SPR, "JACKS.SPR"))
    good = sum(1 for f in frames if f["rows"] and len(f["rows"]) == f["h"])
    print(f"[SPR] JACKS.SPR: {len(frames)} frames, {good} decode to their "
          f"declared height")
    for i in (0, 1, 2, 40, 120):
        if i >= len(frames):
            continue
        w, h, img = spr.frame_bitmap(frames[i], transparent=None)
        _write_indexed(os.path.join(OUT_DIR, f"jack_frame{i:03d}.png"),
                       w, h, [v for row in img for v in row], jack_pal,
                       transparent=255)

    # Whole level assembled from WAM + I + OBT + G2
    lv = level.load(LEVELS, "0A")
    print(f"[LEVEL] 0A: {lv['tiles_w']}x{lv['tiles_h']} tiles "
          f"({lv['width']}x{lv['height']} px), {len(lv['objects'])} objects")
    _write_indexed(os.path.join(OUT_DIR, "0A_level.png"),
                   lv["width"], lv["height"], level.compose(lv), palette)

    print(f"\nAll previews written to {OUT_DIR}")


if __name__ == "__main__":
    main()
