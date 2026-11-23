"""
Export the props the client needs — the bell, the gits, the cannons and
the rest — from the original game's sprite files.

The bell is BELL.SPR frames 0-3, the timmies are TIMMY.SPR. The hammers
are scripts/export_hammers.py's: each its own sheet of 61 frames, which
the game draws as an entity of its own, standing on Jack's own position
and picking its frame from a list that runs alongside each of Jack's
animations (anims.hammer_lists). Those lists are written here, into the
manifest as `hammerBySlot`, so the client draws exactly the frame the game
would. The words keep the game's two flag bits (0x4000 hide from here on,
0x8000 show again). (The clone used to draw SPA.SPR — the splitter hammer
v1 — as the sledge; the sledge v1 is SLA.SPR.)

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
from export_jack_frames import VARIANTS, ORIGINAL_VARIANT, recolour

ORIG = os.path.join(REPO, "Trash-it-original")
OUT_PNG = os.path.join(REPO, "client", "public", "sprites", "props")
OUT_JSON = os.path.join(REPO, "client", "src", "entities", "propFrames.json")
PREFIX = "sprites/props"

PROPS = {
    # The bell is three sprites (VA 0x33d1d): the plinth (0), the tower
    # with its striker (1, and 2 while it rings) and the ball on top (3).
    "bell": ("BELL.SPR", [0, 1, 2, 3]),
    # The gits (docs/re/objects/gits.md "The gits"): every frame of each sheet, index =
    # frame number, since their frame lists (VA 0xa40be) index the sheet
    # directly — the walk is 1-16, the fall 6-9, the skid 17-25.
    "timmy": ("TIMMY.SPR", list(range(35))),
    # Tommy: a timmy whose .OB flags are 2, drawn from TOMMY.SPR (spawn_timmy
    # 0x3053f, sprite 0x5b); frames 26-34 are its swing at a block.
    "tommy": ("TOMMY.SPR", list(range(35))),
    "ktimmy": ("KTIMMY.SPR", None),
    # The timmy bin (.OB classes 18-21): frame = how far into swallowing
    # one it is, by the table at 0xa3622 (docs/re/objects/timmy-bin.md).
    "timbin": ("TIMBIN.SPR", list(range(9))),
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
    # Bonuses (docs/re/objects/bonuses.md "Bonuses, the dispenser and the panel"): the bonus
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
    # What a timmy taken says (spawn_got_popup 0x11a92): three frames each
    # for +1, +2 and +20; and the puff it — or a prize taken — goes in
    # (puff_tick 0x11d4b, seven frames).
    "got": ("GOT.SPR", list(range(9))),
    # The pause panel (pause_hud 0x1aaa8, list 0x973c4): PAUSE (55), the
    # menu plates — 52 resume / quit level / quit game, 53 are you sure?
    # yeah / naah, 54 resume / quit game — Jack's face (12) and the arrow
    # (56-58).
    "pause": ("PANEL.SPR", [55, 52, 53, 54, 12, 56, 57, 58]),
    # The countdown that opens a level (list 0x97374, docs/re/front/hud.md):
    # PANEL 47 (its script turns it into 49), 48 and 50 "GO".
    "countdown": ("PANEL.SPR", [47, 48, 49, 50]),
    "bloi": ("BLOI.SPR", list(range(7))),
    # The buttons (.OB classes 28-30, VA 0x1722b): red 0/1, green 2/3,
    # blue 4/5 — up and pressed.
    "button": ("REDBUT.SPR", list(range(6))),
    # The crawler (.OB class 44, VA 0x111fb): 0-7 its tracks turning, 8 the
    # lift, 9/10 the crane arm, 11/12 its hand open and shut, 13 the pad,
    # 14-16 the tower's foot, a segment of it and the light on top.
    "crawl": ("CRAWL.SPR", list(range(17))),
    # The rocket's nine pieces, bottom up (.OB classes 43 → 35).
    "apollo": ("APOLLO.SPR", list(range(9))),
    # The forklift (.OB class 23, VA 0x1bbc3): 0-3 the rear wheel, 4-7 the
    # front, 8 the body (9 jolted), 10 the mast, 11 the forks, 18-22 the
    # gear lever.
    "fork": ("FORK.SPR", list(range(23))),
    # The dragon show (docs/re/levels/dragon-show.md): VM.SPR's demon face
    # (0) and lightning bolts (1-4), and the DUST.SPR column of its blast.
    "vm": ("VM.SPR", list(range(5))),
    "dust": ("DUST.SPR", None),
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

    # The flags (FLAG.SPR 0-7, waving): one per player, in his colour. The
    # game recolours them with Jack's own remap (template +0x18 = 0x8000 |
    # player, VA 0xa34ec…); the clone recolours Jack by overalls hue, so the
    # flag gets the same treatment to match him.
    flag_frames = spr.load(os.path.join(ORIG, "SPR", "FLAG.SPR"))
    for variant, colour in VARIANTS.items():
        vpal = palette if variant == ORIGINAL_VARIANT else recolour(palette, colour)
        names = []
        for idx in range(8):
            f = flag_frames[idx]
            w, h, img = spr.frame_bitmap(f, transparent=None)
            rgba = [(0, 0, 0, 0) if v is None else vpal[v] + (255,)
                    for row in img for v in row]
            name = "flag_%s_%02d" % (variant, idx)
            _png.write_rgba(os.path.join(OUT_PNG, name + ".png"), w, h, rgba)
            manifest["frames"][name] = {
                "file": "%s/%s.png" % (PREFIX, name),
                "w": w, "h": h, "ax": -f["ox"], "ay": -f["oy"],
                "src": "FLAG.SPR:%d" % idx,
            }
            names.append(name)
        manifest["anims"]["flag_" + variant] = names

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
