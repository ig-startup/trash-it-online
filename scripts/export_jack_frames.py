"""
Export the web client's Jack frames straight from the original JACKS.SPR.

Replaces the four frames that used to be cropped out of archive.org
screenshots: these come from the game's own sprite sheet, so they are
pixel-exact, have clean alpha, and carry the sheet's per-frame origin.

The frame->pose mapping below was read off a numbered contact sheet of
all 329 frames (scripts/formats/spr.py decodes them). The sheet is
organised in contiguous animation runs; Jack always faces right, so the
client mirrors him for the other direction, exactly as the game does.

    python3 scripts/export_jack_frames.py

Writes PNGs to client/public/sprites/jack/ and the manifest to
client/src/entities/jackFrames.json.
"""
import colorsys
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import pal
import spr
import _png

SHEET = os.path.join(REPO, "Trash-it-original", "SPR", "JACKS.SPR")
PALETTE = os.path.join(REPO, "Trash-it-original", "SPR", "JACKS.PAL")
OUT_PNG = os.path.join(REPO, "client", "public", "sprites", "jack")
OUT_JSON = os.path.join(REPO, "client", "src", "entities", "jackFrames.json")
PUBLIC_PREFIX = "sprites/jack"

# pose -> frame indices in JACKS.SPR, in play order.
#
# These are no longer guessed. They come from the game's own animation
# table, which `scripts/formats/anims.py` reads out of G.EXE: an array of
# pointers at VA 0xa11ca, one per animation, each to a list of frame
# numbers. The slot each pose comes from is noted below.
#
# The previous mapping was read off a contact sheet by eye and several
# poses were wrong in ways only play-testing caught — "fall" was a frame
# from the middle of a get-up sequence and read as climbing down a
# ladder, and "cower" was a frame from the middle of the transition into
# hard-hat mode.
ANIMS = {
    "idle": [0],                         # slots 3/61/64/77
    "run": list(range(1, 17)),           # slot 2
    "skid": list(range(17, 21)),         # slot 4 — stopping after a run
    # With the hammer out the game walks a cycle of its own (slot 3) and
    # stands on its frame 34 (slot 4, whose hammer frame is 13).
    "walkHammer": list(range(21, 37)),   # slot 3
    "standHammer": [34],                 # slot 4
    "hammerSide": list(range(37, 55)),   # slot 8 — the sideways strike.
                                         # Held-button version is the same
                                         # run from index 10 (frame 47),
                                         # i.e. the windup cut off (slot 17).
    "hammerOver": list(range(55, 71)),   # slot 9 — the overhead strike
    "fall": [140],                       # slot 33
    "land": list(range(141, 145)),       # slot 34 — hitting the ground
    "getUp": list(range(161, 175)),      # slot 38 — jump back onto your feet
    "helmetIn": list(range(91, 101)),    # slot 14 — duck into the hard hat
    "helmetMove": list(range(101, 113)), # slot 16 — travelling as the hat
    "airRoll": list(range(252, 265)),    # slot 57 — roll for extra distance
    # The hoover. Jack reaches into his hard hat (slot 12), pulls it out
    # (slot 11), then carries it: slot 30 is a single standing frame and
    # slot 31 the walk. Those are two of the game's states — 0x256e9 and
    # 0x25813 — and the second hub of its whole graph, so carrying the
    # hoover is a mode Jack is in, not an action he performs.
    "hatReach": list(range(71, 91)),     # slot 12
    "hooverOut": list(range(113, 123)),  # slot 11, second half
    "hooverIdle": [139],                 # slot 30
    "hooverWalk": list(range(123, 139)), # slot 31
    # Carrying (slot numbers as play_anim has them, after the 2026-10-06
    # fix): bend down for it (44 / 50 show 223-224, 45 the whole 223-230),
    # stand holding it overhead (40), walk with it (37), take aim (47) and
    # let fly (41).
    "pickUp": list(range(223, 231)),     # slots 39 / 45 / 51
    "carryIdle": [231],                  # slot 40
    "carryWalk": list(range(191, 207)),  # slots 37 / 48
    "throwAim": list(range(232, 236)),   # slot 47
    "throwRelease": list(range(236, 240)),  # slot 41
    # Under a falling block (see "A falling block on Jack"): squashed flat
    # (slot 65) and the tumble back onto his feet (slot 64).
    "flat": [323, 324, 325],             # slot 65
    "tumble": list(range(277, 289)),     # slot 64
    # Ladders: climbing (slot 33, the frame picked by his height, not a
    # clock) and topping out onto the platform (60) — or, the same list
    # backwards, stepping off the top onto the ladder (61).
    "climb": list(range(175, 191)),      # slot 33
    "topOut": list(range(289, 301)),     # slots 60 / 61
}

#: Where the held-button strike starts inside `hammerSide` (frame 47).
HAMMER_HELD_FROM = 10

# The pose whose height defines Jack's on-screen size; every other frame
# is drawn at the same scale so he doesn't grow and shrink between poses.
STAND_POSE = "idle"

# Jack's dungarees occupy these palette entries (verified by painting them
# magenta and looking: they cover the overalls and nothing else). Players
# are told apart by overalls colour, exactly as in the original, so each
# player colour gets its own recoloured copy of every frame — hue replaced,
# the original shading kept.
OVERALLS_INDICES = list(range(194, 197)) + list(range(225, 232))

# shared/constants.js PLAYER_COLORS, in order. Blue is Jack's own colour,
# so that variant ships as the untouched original.
VARIANTS = {
    "red": "#ff4444",
    "blue": "#4444ff",
    "green": "#44bb44",
    "orange": "#ffaa00",
}
ORIGINAL_VARIANT = "blue"


def recolour(palette, target_hex):
    """Replace the overalls hue, keeping each entry's saturation/value."""
    if target_hex is None:
        return palette
    t = target_hex.lstrip("#")
    tr, tg, tb = (int(t[i:i + 2], 16) / 255 for i in (0, 2, 4))
    th, ts, _tv = colorsys.rgb_to_hsv(tr, tg, tb)
    out = list(palette)
    for i in OVERALLS_INDICES:
        r, g, b = palette[i]
        _h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        nr, ng, nb = colorsys.hsv_to_rgb(th, min(1.0, s * (ts + 0.4)), v)
        out[i] = (round(nr * 255), round(ng * 255), round(nb * 255))
    return out


def pack(boxes, max_width=1024):
    """Shelf-pack (name, w, h) into an atlas. -> (positions, width, height)."""
    pos, x, y, shelf_h, width = {}, 0, 0, 0, 0
    for name, w, h in sorted(boxes, key=lambda b: -b[2]):
        if x + w > max_width:
            x, y, shelf_h = 0, y + shelf_h, 0
        pos[name] = (x, y)
        x += w
        shelf_h = max(shelf_h, h)
        width = max(width, x)
    return pos, width, y + shelf_h


def main():
    palette = pal.decode(PALETTE)
    frames = spr.load(SHEET)
    palettes = {v: palette if v == ORIGINAL_VARIANT else recolour(palette, c)
                for v, c in VARIANTS.items()}
    os.makedirs(OUT_PNG, exist_ok=True)

    manifest = {
        "source": "JACKS.SPR",
        "variants": dict(VARIANTS),
        "original": ORIGINAL_VARIANT,
        "atlases": {},
        "frames": {},
        "anims": {},
    }

    # Collect every frame once, then pack. One atlas per colour beats one
    # PNG per frame by a wide margin: 109 poses x 4 colours is 436 files,
    # and loading them separately meant 436 requests and 436 GPU textures
    # at the start of a level, which is enough to lock the tab up.
    bitmaps = {}
    for pose, indices in ANIMS.items():
        names = []
        for i, idx in enumerate(indices):
            f = frames[idx]
            w, h, img = spr.frame_bitmap(f, transparent=None)
            name = pose if len(indices) == 1 else "%s_%02d" % (pose, i)
            bitmaps[name] = img
            manifest["frames"][name] = {
                "w": w, "h": h,
                # anchor inside the frame: the game draws the sprite at the
                # entity position plus this (negative) origin, so -ox/-oy is
                # where Jack's feet-centre sits within the image
                "ax": -f["ox"], "ay": -f["oy"],
                "src": idx,
            }
            names.append(name)
        manifest["anims"][pose] = names

    placed, aw, ah = pack([(n, manifest["frames"][n]["w"],
                            manifest["frames"][n]["h"]) for n in bitmaps])
    for name, (px, py) in placed.items():
        manifest["frames"][name]["atlas"] = {"x": px, "y": py}

    for variant, vpal in palettes.items():
        canvas = [(0, 0, 0, 0)] * (aw * ah)
        for name, img in bitmaps.items():
            px, py = placed[name]
            for row_i, row in enumerate(img):
                base = (py + row_i) * aw + px
                for col_i, v in enumerate(row):
                    if v is not None:
                        canvas[base + col_i] = vpal[v] + (255,)
        _png.write_rgba(os.path.join(OUT_PNG, variant + ".png"), aw, ah, canvas)
        # Phaser's hash-format texture atlas
        atlas = {"frames": {n: {"frame": {"x": placed[n][0], "y": placed[n][1],
                                          "w": manifest["frames"][n]["w"],
                                          "h": manifest["frames"][n]["h"]}}
                            for n in bitmaps},
                 "meta": {"image": variant + ".png", "size": {"w": aw, "h": ah},
                          "scale": "1"}}
        with open(os.path.join(OUT_PNG, variant + ".json"), "w") as fh:
            json.dump(atlas, fh, separators=(",", ":"))
        manifest["atlases"][variant] = {
            "image": "%s/%s.png" % (PUBLIC_PREFIX, variant),
            "data": "%s/%s.json" % (PUBLIC_PREFIX, variant),
        }

    manifest["standHeight"] = manifest["frames"][
        manifest["anims"][STAND_POSE][0]]["h"]
    manifest["hammerHeldFrom"] = HAMMER_HELD_FROM
    with open(OUT_JSON, "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print("packed %d frames x %d colours into %dx%d atlases -> %s"
          % (len(manifest["frames"]), len(VARIANTS), aw, ah, OUT_PNG))
    print("manifest -> %s (standHeight=%d)" % (OUT_JSON, manifest["standHeight"]))


if __name__ == "__main__":
    main()
