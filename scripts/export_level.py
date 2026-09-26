"""
Convert original Trash It levels into the web client's level format.

Reads the game's own level files (see scripts/formats/README.md) and writes,
per level:

  client/public/sprites/levels/<name>/shapes.png    all block artwork, packed
  client/public/sprites/levels/<name>/shapes.json   Phaser atlas for it
  client/public/sprites/levels/<name>/background.png the .SCN wall texture
  client/src/levels/level_<name>.json                geometry for GameScene

and a generated `client/src/levels/generated.js` listing everything exported
so far, which the level registry imports.

    python3 scripts/export_level.py            # the default batch
    python3 scripts/export_level.py 0A 0D 2H   # specific levels
    python3 scripts/export_level.py --all      # every level in the game

Faithful parts: every object's position, size and artwork, and the wall
behind them. Invented parts, because the game stores them somewhere we
haven't decoded: hit points (the
.OBT field that co-varies with an object's "value" is carried through as
`param` so it can be used once its meaning is settled).
"""
import json
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import level as level_fmt
import pal
import ob
import scn
import _png

ORIG = os.path.join(REPO, "Trash-it-original")
LEVELS = os.path.join(ORIG, "LEVELS")
SPR = os.path.join(ORIG, "SPR")
OUT_SPRITES = os.path.join(REPO, "client", "public", "sprites", "levels")
OUT_LEVELS = os.path.join(REPO, "client", "src", "levels")
SHARED_ORDER = os.path.join(REPO, "shared", "levels.json")

# Room above the tallest structure so a player can stand on the roof — the
# original's own coordinates start the top band at y=8.
HEADROOM = 64
GROUND_OVERHANG = 240  # how far the floor runs past each side edge
#: Every class whose template spawns a TIMMY.SPR.
TIMMY_CLASSES = (14, 17, 32)
TIME_LIMIT = 240
PAD = 1  # transparent gutter between packed shapes

# A spread of the game's levels: small and sprawling, low and tall.
# Which levels to export, and in what order they are played. The
# original's own order is not known — the front end (F.EXE) picks levels
# by section and password, and that has not been decoded — so this is
# ours, arranged by how well a level opens rather than alphabetically.
#
# 0C leads because its authored start is on solid ground mid-level and
# its bell sits on a real block a decent walk away; 0A used to lead and
# is one of the worst, starting the players clamped against the left
# edge with the bell a thousand pixels off.
DEFAULT_BATCH = ["0C", "0D", "2H", "0B", "0A", "0H", "0J", "0K", "0S",
                 "1A", "3I", "4A"]


def pack(sizes, max_width=1024):
    """Shelf-pack (name, w, h) boxes. -> (positions, atlas_w, atlas_h)"""
    boxes = sorted(sizes, key=lambda b: -b[2])
    pos = {}
    x = y = shelf_h = 0
    width = 0
    for name, w, h in boxes:
        if x + w + PAD > max_width:
            x = 0
            y += shelf_h + PAD
            shelf_h = 0
        pos[name] = (x, y)
        x += w + PAD
        shelf_h = max(shelf_h, h)
        width = max(width, x)
    return pos, width, y + shelf_h


def build_atlas(shapes, palette, out_dir, image_name="shapes.png"):
    """shapes: {name: (width, height, bitmap)} -> writes png + Phaser atlas."""
    pos, aw, ah = pack([(n, s[0], s[1]) for n, s in shapes.items()])
    pixels = [(0, 0, 0, 0)] * (aw * ah)
    frames = {}
    for name, (w, h, bitmap) in shapes.items():
        ox, oy = pos[name]
        bw, bh, img = bitmap
        for y in range(h):
            for x in range(w):
                v = img[y][x] if y < bh and x < bw else None
                if v is None:
                    continue
                pixels[(oy + y) * aw + ox + x] = palette[v] + (255,)
        frames[name] = {
            "frame": {"x": ox, "y": oy, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
        }
    _png.write_rgba(os.path.join(out_dir, image_name), aw, ah, pixels)
    atlas = {"frames": frames,
             "meta": {"image": image_name, "size": {"w": aw, "h": ah},
                      "scale": "1"}}
    with open(os.path.join(out_dir, "shapes.json"), "w") as fh:
        json.dump(atlas, fh)
    return aw, ah


def export(name):
    palette = pal.merge(pal.decode(os.path.join(LEVELS, name + ".PAL")),
                        pal.decode(os.path.join(SPR, "JACKS.PAL")))
    lv = level_fmt.load(LEVELS, name)

    out_dir = os.path.join(OUT_SPRITES, name)
    os.makedirs(out_dir, exist_ok=True)
    prefix = "sprites/levels/%s" % name

    # the wall behind everything; layer 0 is the plain one
    background = None
    scn_path = os.path.join(SPR, name + ".SCN")
    if os.path.exists(scn_path):
        # A `.SCN` is 256-wide textures, not 320-wide screens; reading
        # them 320 across sheared every row by 64 pixels, which is the
        # smear the backdrop used to be. The first texture is the wall.
        wall_w, wall_h, pixels = scn.textures(scn_path)[0]
        _png.write_rgb(os.path.join(out_dir, "background.png"),
                       wall_w, wall_h, [palette[v] for v in pixels])
        background = "%s/background.png" % prefix

    # one atlas frame per (shape, size) actually used
    shapes, sizes = {}, {}
    for o in lv["objects"]:
        key = "%d_%dx%d" % (o["shape"], o["w"], o["h"])
        if key not in shapes:
            shapes[key] = (o["w"], o["h"], o["bitmap"])
            sizes[key] = {"width": o["w"], "height": o["h"]}
    aw, ah = build_atlas(shapes, palette, out_dir)

    # Hit points are the original's own, from `.OBT` field 0 — which the
    # notes used to call a graphic id. 0xffff and 0xfffe mean the block
    # cannot be broken at all; those are the scenery and the structure.
    def hit_points(o):
        if o["gid"] in (0xffff, 0xfffe):
            return None
        return o["gid"] or 1

    destructibles = [{
        "id": "o%d" % i,
        "x": o["x"], "y": o["y"] + HEADROOM,
        "width": o["w"], "height": o["h"],
        "hp": hit_points(o) or 0,
        "solid": hit_points(o) is None,
        "shape": "%d_%dx%d" % (o["shape"], o["w"], o["h"]),
        "type": o["type"],
        "param": o["param"],
    } for i, o in enumerate(lv["objects"])]

    # Start positions and the bell come from the level's own `.OB` — the
    # spawn stream the game interprets at startup (scripts/formats/ob.py).
    # They used to be invented here, which put the bell on whichever roof
    # happened to be highest and stood the players in a neat row.
    placed = ob.parse(open(os.path.join(LEVELS, name + ".OB"), "rb").read())

    # Some authored coordinates sit off the left edge — 75 of 255 starts
    # and 17 of 135 bells across the archive, always in x, never in y.
    # Why is not understood (see scripts/formats/README.md), so clamp
    # rather than pretend: a start off the map has no floor under it.
    def clamp_x(x, width=8):
        return max(0, min(x, lv["width"] - width))

    found = ob.spawns(placed)
    if found:
        spawn_pts = [{"x": clamp_x(x), "y": y + HEADROOM}
                     for _i, (x, y) in sorted(found.items())]
        # Most levels name only player 1's start. The original leaves the
        # others wherever they were; here they would land on top of each
        # other, so fan them out along the ground instead.
        while len(spawn_pts) < 4:
            last = spawn_pts[-1]
            spawn_pts.append({"x": clamp_x(last["x"] + 24), "y": last["y"]})
    else:
        ground = min(o["y"] for o in lv["objects"]
                     if o["y"] > lv["height"] * 0.7) + HEADROOM
        left = min(o["x"] for o in lv["objects"])
        spawn_pts = [{"x": left + 40 + i * 60, "y": ground} for i in range(4)]

    # Timmies. Classes 14, 17 and 32 all spawn one (their templates point
    # at TIMMY.SPR), and between them they are about 2000 records across
    # the archive — the most common thing in the game. Position is the
    # first two words of the record.
    timmies = [{"x": x, "y": y + HEADROOM}
               for cid, _off, payload in placed if cid in TIMMY_CLASSES
               for x, y in [struct.unpack_from("<hh", payload, 0)]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    rung = ob.bells(placed)
    if rung:
        bx, by, _subtype = rung[0]
        bell = {"x": clamp_x(bx), "y": by + HEADROOM}
    else:
        top = min(o["y"] for o in lv["objects"]) + HEADROOM
        tower = [o for o in lv["objects"] if o["y"] + HEADROOM == top]
        bell = {"x": (min(o["x"] for o in tower)
                      + max(o["x"] + o["w"] for o in tower)) // 2, "y": top}

    data = {
        "id": "level_%s" % name,
        "source": "LEVELS/%s" % name,
        "widthTiles": lv["tiles_w"], "heightTiles": lv["tiles_h"] + HEADROOM // 8,
        "tileSize": 8,
        "timeLimit": TIME_LIMIT,
        "background": background,
        "shapeAtlas": {"image": "%s/shapes.png" % prefix,
                       "data": "%s/shapes.json" % prefix},
        "shapes": sizes,
        "spawnPoints": spawn_pts,
        "timmies": timmies,
        # The bottom edge of a level is solid ground in the original. It is
        # not made of objects — in 0B all 179 are destructible and nothing
        # sits under the start at all — but every level's authored start is
        # a few pixels above the bottom edge (3 to 33 across the archive),
        # which only works if Jack is standing on it. Without this the
        # players simply fall out of the level.
        #
        # It reaches past both side edges because some authored positions
        # are off the left edge (see the clamp above): whatever the reason
        # for that, they still need a floor.
        "ground": {"x": -GROUND_OVERHANG,
                   "y": (lv["tiles_h"] + HEADROOM // 8) * 8,
                   "width": lv["width"] + GROUND_OVERHANG * 2,
                   "height": 32},
        "platforms": [],
        "destructibles": destructibles,
        "bell": bell,
    }
    with open(os.path.join(OUT_LEVELS, "level_%s.json" % name), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
        fh.write("\n")

    atlas_kb = os.path.getsize(os.path.join(out_dir, "shapes.png")) // 1024
    print("  %-4s %5dx%-5d %4d objects, %3d shapes, atlas %dx%d (%d KB)"
          % (name, lv["width"], lv["height"] + HEADROOM, len(destructibles),
             len(shapes), aw, ah, atlas_kb))
    return "level_%s" % name


def write_index(ids):
    """Regenerate the module the level registry imports, and the play order.

    The order lives in shared/ because both sides need it: the client to
    know what comes next, the server to decide what to start.
    """
    with open(SHARED_ORDER, "w") as fh:
        json.dump({"order": ids}, fh, indent=1)
        fh.write("\n")

    lines = ["/**",
             " * Generated by scripts/export_level.py — do not edit by hand.",
             " * Levels converted straight from the original game's files.",
             " */"]
    for lid in ids:
        lines.append("import %s from './%s.json';" % (lid, lid))
    lines.append("")
    lines.append("export const GENERATED_LEVELS = {")
    for lid in ids:
        lines.append("  %s," % lid)
    lines.append("};")
    lines.append("")
    with open(os.path.join(OUT_LEVELS, "generated.js"), "w") as fh:
        fh.write("\n".join(lines))


def main(argv):
    if argv and argv[0] == "--all":
        names = sorted({os.path.splitext(f)[0] for f in os.listdir(LEVELS)
                        if f.upper().endswith(".WAM")})
    else:
        names = argv or DEFAULT_BATCH

    os.makedirs(OUT_SPRITES, exist_ok=True)
    print("exporting %d level(s):" % len(names))
    ids = []
    for n in names:
        try:
            ids.append(export(n))
        except Exception as exc:                      # noqa: BLE001
            print("  %-4s SKIPPED: %s" % (n, exc))

    # keep any level exported in an earlier run
    for f in sorted(os.listdir(OUT_LEVELS)):
        if f.startswith("level_") and f.endswith(".json"):
            lid = f[:-5]
            if lid not in ids and lid != "level01":
                ids.append(lid)
    # Keep the batch order: it is the play order, not an alphabet.
    seen = []
    for lid in ids:
        if lid not in seen:
            seen.append(lid)
    write_index(seen)
    print("index -> %s" % os.path.join(OUT_LEVELS, "generated.js"))


if __name__ == "__main__":
    main(sys.argv[1:])
