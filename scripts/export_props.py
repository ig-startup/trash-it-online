"""
Export the props the client needs — the bell and Jack's sledgehammer —
from the original game's sprite files.

The bell is BELL.SPR frame 0, the timmies are TIMMY.SPR. The hammer is
SPA.SPR, all 61 frames: the game draws the tool as its own entity, standing
on Jack's own position and picking its frame from a list that runs
alongside each of Jack's animations (anims.hammer_lists). Those lists are
written into the manifest as `hammerBySlot`, so the client draws exactly
the frame the game would. The words keep the game's two flag bits
(0x4000 hide from here on, 0x8000 show again).

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
from anims import hammer_lists, hoover_lists

ORIG = os.path.join(REPO, "Trash-it-original")
OUT_PNG = os.path.join(REPO, "client", "public", "sprites", "props")
OUT_JSON = os.path.join(REPO, "client", "src", "entities", "propFrames.json")
PREFIX = "sprites/props"

PROPS = {
    "bell": ("BELL.SPR", [0]),
    "hammer": ("SPA.SPR", list(range(61))),   # index = SPA frame number
    # The gits (README "The gits"): every frame of each sheet, index =
    # frame number, since their frame lists (VA 0xa40be) index the sheet
    # directly — the walk is 1-16, the fall 6-9, the skid 17-25.
    "timmy": ("TIMMY.SPR", list(range(35))),
    "ktimmy": ("KTIMMY.SPR", None),
    "spk": ("SPK.SPR", None),          # 26-34 bristling, 35-42 its needles
    "bom": ("BOM.SPR", list(range(34))),  # the walking bomb; 34 is empty
    # Dynamite: 202 placements across 42 levels, the third most common
    # thing in the game. Its own sheet carries the stick and the blast.
    "dyna": ("DYNA.SPR", [0]),          # the stick; the sheet has only four
    "blast": ("BLAM.SPR", [0, 2, 4, 6, 8, 10, 12, 14]),  # it expands
    # The hoover is its own sprite too, drawn from a list per slot like the
    # hammer (`hooverBySlot`): 9 → 0 unfolds it, 10-26 are it held.
    "vac": ("VAC.SPR", list(range(27))),       # index = VAC frame number
    # The cannon (.OB class 6, VA 0x5f69a) is four sprites on one spot: the
    # wheel it rolls on (CWHL, four turns) or a fixed carriage (CFIX), and
    # three parts of CFIR — the barrel with its fuse (frame 0) and the two
    # halves of its breech (10, and 9 shown while 10 is).
    "cwhl": ("CWHL.SPR", [0, 1, 2, 3]),
    "cfix": ("CFIX.SPR", [0]),
    # 11 is the breech's own frame once a ball is in (VA 0x20d5e).
    "cfir": ("CFIR.SPR", [0, 10, 9, 11]),
    # Firing, the barrel swells (1-6, the shot leaves on 6) and kicks
    # (7-8); the spark runs down the fuse on BLAM.SPR 9-14 (VA 0x5feef).
    "barrel": ("CFIR.SPR", list(range(9))),
    "spark": ("BLAM.SPR", list(range(9, 15))),
    # The cannonballs (.OB class 7): small, and the big one (VA 0x20b84).
    "ball": ("CFIR.SPR", [12, 13]),
    # The sucker (.OB class 22, VA 0x18fba): a base, and the red cup on it
    # that rides up and down with what it is doing.
    "sucker": ("SUCKER.SPR", [0, 1]),
    # The teleporter (.OB class 27, VA 0x347c1): the pad opening and
    # closing (0-9) and the beam that rises over it while it is on (10).
    "telly": ("TELLY.SPR", list(range(11))),
    # The seesaw (.OB class 0, VA 0x1eb0d) in its two looks, BCSAW and
    # CSAW: frame 0 the left end down, 1 the right. And the 20-ton weight
    # (.OB class 1, VA 0x1e6c3): 0 on its own, 1 and 2 riding the right
    # and the left end.
    "bcsaw": ("BCSAW.SPR", [0, 1]),
    "csaw": ("CSAW.SPR", [0, 1]),
    "lead": ("LEAD.SPR", [0, 1, 2]),
    # The UFO (.OB class 31, VA 0x13079): 0-8 leaning with its speed (4
    # level), 9-17 legs coming out, 18-22 rocking on them, 23 a ring of the
    # tractor beam, 24 the wreck, 25-30 chips, 31 the bolt it zaps Jack with.
    "ufo": ("UFO.SPR", list(range(32))),
    # The post at each end of the street (VA 0x2f623): PANEL.SPR, a sheet
    # of odds and ends, frame 16 (+0x44 = 0x10); the right one mirrored.
    "post": ("PANEL.SPR", [16]),
    # Bonuses (README "Bonuses, the dispenser and the panel"): the bonus
    # git walks on BON 1-16 like a timmy, 17 struck, 21-23 its sparks; it
    # waits in a block as a BELL; its prizes are the clock (CLOK 0-23
    # spinning), the super hoover (BVAC 5) and the bubble.
    "bon": ("BON.SPR", list(range(24))),
    "clok": ("CLOK.SPR", list(range(24))),
    "bvac": ("BVAC.SPR", [5]),
    "bubble": ("BUBBLE.SPR", [0]),
    # The dispenser: its body (6) and the lid (0 shut, 1 open).
    "dis": ("DIS.SPR", [6, 0, 1]),
    # The secret panel (17) and its twinkle (0x15-0x24).
    "panel": ("PANEL.SPR", [17] + list(range(21, 37))),
}


def main(level_name="0A"):
    palette = pal.merge(
        pal.decode(os.path.join(ORIG, "LEVELS", level_name + ".PAL")),
        pal.decode(os.path.join(ORIG, "SPR", "JACKS.PAL")))
    os.makedirs(OUT_PNG, exist_ok=True)

    manifest = {"frames": {}, "anims": {}}
    for prop, (sheet, indices) in PROPS.items():
        frames = spr.load(os.path.join(ORIG, "SPR", sheet))
        if indices is None:
            indices = list(range(len(frames)))
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

    lists = hammer_lists(os.path.join(ORIG, "G.EXE"), raw=True)
    manifest["hammerBySlot"] = {str(k): v for k, v in sorted(lists.items())}
    vac = hoover_lists(os.path.join(ORIG, "G.EXE"))
    manifest["hooverBySlot"] = {str(k): v for k, v in sorted(vac.items())}

    with open(OUT_JSON, "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print("exported %d prop frames -> %s" % (len(manifest["frames"]), OUT_PNG))
    print("manifest -> %s" % OUT_JSON)


if __name__ == "__main__":
    main()
