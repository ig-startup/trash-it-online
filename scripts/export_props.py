"""
Export the props the client needs — the bell and Jack's sledgehammer —
from the original game's sprite files.

The bell is BELL.SPR frame 0, the timmies are TIMMY.SPR. The hammer is
SPA.SPR, which holds a
61-frame rotation of the sledgehammer: the game draws the tool as its own
entity spinning through that arc, so we pick three frames that read as an
overhead-to-ground swing and hang them off Jack's hands.

Sprites without their own .PAL are drawn in the shared palette, which the
level supplies below index 151 and JACKS.PAL above it (see pal.merge).

    python3 scripts/export_props.py

Writes client/public/sprites/props/*.png and
client/src/entities/propFrames.json.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import pal
import spr
import _png

ORIG = os.path.join(REPO, "Trash-it-original")
OUT_PNG = os.path.join(REPO, "client", "public", "sprites", "props")
OUT_JSON = os.path.join(REPO, "client", "src", "entities", "propFrames.json")
PREFIX = "sprites/props"

PROPS = {
    "bell": ("BELL.SPR", [0]),
    "hammer": ("SPA.SPR", [45, 2, 60]),   # raised, mid-swing, struck down
    # Timmies are the most common object in the game by a wide margin —
    # about 2000 records across three quarters of the levels. TIMMY.SPR
    # holds 35 frames; these six read as a walk cycle.
    "timmy": ("TIMMY.SPR", [0, 1, 2, 3, 4, 5]),
}


def main(level_name="0A"):
    palette = pal.merge(
        pal.decode(os.path.join(ORIG, "LEVELS", level_name + ".PAL")),
        pal.decode(os.path.join(ORIG, "SPR", "JACKS.PAL")))
    os.makedirs(OUT_PNG, exist_ok=True)

    manifest = {"frames": {}, "anims": {}}
    for prop, (sheet, indices) in PROPS.items():
        frames = spr.load(os.path.join(ORIG, "SPR", sheet))
        names = []
        for i, idx in enumerate(indices):
            f = frames[idx]
            w, h, img = spr.frame_bitmap(f, transparent=None)
            rgba = [(0, 0, 0, 0) if v is None else palette[v] + (255,)
                    for row in img for v in row]
            name = prop if len(indices) == 1 else "%s_%02d" % (prop, i)
            _png.write_rgba(os.path.join(OUT_PNG, name + ".png"), w, h, rgba)
            manifest["frames"][name] = {
                "file": "%s/%s.png" % (PREFIX, name),
                "w": w, "h": h, "ax": -f["ox"], "ay": -f["oy"],
                "src": "%s:%d" % (sheet, idx),
            }
            names.append(name)
        manifest["anims"][prop] = names

    with open(OUT_JSON, "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print("exported %d prop frames -> %s" % (len(manifest["frames"]), OUT_PNG))
    print("manifest -> %s" % OUT_JSON)


if __name__ == "__main__":
    main()
