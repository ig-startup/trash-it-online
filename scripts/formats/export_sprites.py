"""
Export a Trash It .SPR sheet to individual PNG frames (with alpha).

    python3 export_sprites.py SPR/JACKS.SPR out_dir [--pal SPR/JACKS.PAL]

Sprite frames only use their own half of the palette (151..255 for
Jack, with index 0 as the colour key), so the sprite's own .PAL is all
this needs — unlike .SCN backgrounds, which span both halves and need
pal.merge().

Frame files are named `<n>_<w>x<h>_<ox>_<oy>.png` so the sprite's own
origin (the draw offset the game applies relative to the entity's
position) survives the export and can be fed back into the web client.

Original game assets stay out of the repo — write the output somewhere
gitignored.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pal
import spr
import _png


def export(spr_path, out_dir, pal_path=None):
    if pal_path is None:
        pal_path = os.path.splitext(spr_path)[0] + ".PAL"
    palette = pal.decode(pal_path)
    frames = spr.load(spr_path)
    os.makedirs(out_dir, exist_ok=True)
    for i, f in enumerate(frames):
        w, h, img = spr.frame_bitmap(f, transparent=None)
        rgba = [(0, 0, 0, 0) if v is None else palette[v] + (255,)
                for row in img for v in row]
        name = "%03d_%dx%d_%d_%d.png" % (i, w, h, f["ox"], f["oy"])
        _png.write_rgba(os.path.join(out_dir, name), w, h, rgba)
    return len(frames)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(2)
    p = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "--pal" else None
    if "--pal" in sys.argv:
        p = sys.argv[sys.argv.index("--pal") + 1]
    n = export(sys.argv[1], sys.argv[2], p)
    print("exported %d frames to %s" % (n, sys.argv[2]))
