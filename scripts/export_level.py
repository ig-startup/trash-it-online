"""
Convert original Trash It levels into the web client's level format.

Reads the game's own level files (see scripts/formats/README.md) and writes,
per level:

  client/public/sprites/levels/<name>/shapes.png    all block artwork, packed
  client/public/sprites/levels/<name>/shapes.json   Phaser atlas for it
  client/public/sprites/levels/<name>/background.png the .SCN wall texture
  client/public/levels/level_<name>.json             geometry for GameScene

and the play order in `shared/levels.json`, which both the client and the
server read. The level files are served, not bundled: a game loads only
the level it plays.

    python3 scripts/export_level.py            # the default batch
    python3 scripts/export_level.py 0A 0D 2H   # specific levels
    python3 scripts/export_level.py --all      # every shipped level

Faithful parts: every object's position, size and artwork, the wall behind
them, and each block's hit points and mass — `.OBT` fields 0 and 6, both
now decoded (see scripts/formats/ccs.py for what the game does with
them).
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
OUT_LEVELS = os.path.join(REPO, "client", "public", "levels")
SHARED_ORDER = os.path.join(REPO, "shared", "levels.json")

# Room above the tallest structure so a player can stand on the roof — the
# original's own coordinates start the top band at y=8.
HEADROOM = 64
#: How far the street runs past each side edge of the map. G.EXE sets its
#: ends at load, (-256) & ~7 and (width + 0x107) & ~7 (VA 0x2cf19), and
#: stands a PANEL.SPR post on each (VA 0x2f623).
STREET = 256
#: Every class whose template spawns a TIMMY.SPR.
TIMMY_CLASS = 14
KING_TIMMY_CLASS = 17
SPIKE_CLASS = 32
RULES_CLASS = 16
#: Class 15 places a stick of dynamite.
DYNAMITE_CLASS = 15
#: Class 6 places a cannon (VA 0x5f69a), class 7 a cannonball (VA 0x20b58).
CANNON_CLASS = 6
BALL_CLASS = 7
#: Class 22 places a sucker — the spring that throws what lands on it.
SUCKER_CLASS = 22
#: Class 27 places a teleporter pad (TELLY.SPR).
TELLY_CLASS = 27
UFO_CLASS = 31
SEESAW_CLASS = 0
WEIGHT_CLASS = 1
TIME_LIMIT = 240
MIN_OBJECTS = 10
PAD = 1  # transparent gutter between packed shapes

# The batch exported when no level is named: a spread of the game's
# levels, small and sprawling, low and tall. It is not the play order —
# play_order() is.
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


# ── UFO control (.OB class 31, VA 0x13079 → 0x1315c) ───────────────────────
# A preset row, then each field of the record that is set overrides one
# value through its own table — all read from G.EXE. See "The UFO" in
# scripts/formats/README.md.
_UFO_TABLES = None


def _ufo_tables():
    global _UFO_TABLES
    if _UFO_TABLES is None:
        from le_loader import LE
        le = LE(os.path.join(ORIG, "G.EXE"))

        def words(va, n):
            return list(struct.unpack("<%dh" % n, le.va_read(va, 2 * n)))
        _UFO_TABLES = {
            "presets": [words(0x93b58 + 16 * i, 8) for i in range(8)],
            "max": words(0x93ae0, 16), "land": words(0x93b08, 8),
            "respawn": words(0x93b18, 8), "drop": words(0x93b28, 8),
            "abduct": words(0x93b38, 8), "zap": words(0x93b48, 8),
        }
    return _UFO_TABLES


def _lowest_bit(v):
    """VA 0x1cff9: the index of the lowest set bit — the editor's radio
    buttons store a one-bit mask; 0 (no choice) reads as index 0."""
    v &= 0xffff
    return (v & -v).bit_length() - 1 if v else 0


def ufo_params(payload):
    """The values the game leaves in 0xcd518-0xcd528 and 0x287c5a, in ticks."""
    t = _ufo_tables()
    w = struct.unpack_from("<23h", payload, 0)
    start, respawn, most, mix, land, drop, abduct, zap = \
        t["presets"][_lowest_bit(w[7])]                     # +0x0e
    i = _lowest_bit(w[9])                                   # +0x12
    if i:
        respawn = t["respawn"][i]
    if t["max"][_lowest_bit(w[11])]:                        # +0x16
        most = t["max"][_lowest_bit(w[11])]
    if _lowest_bit(w[13]):                                  # +0x1a
        mix = _lowest_bit(w[13])
    def pick(table, word, default):                        # +0x1e … +0x2a
        i = _lowest_bit(word)
        return t[table][i] if i else default
    land = pick("land", w[15], land)
    drop = pick("drop", w[17], drop)
    abduct = pick("abduct", w[19], abduct)
    zap = pick("zap", w[21], zap)
    if w[22]:                                               # +0x2c
        start = w[22]
    return {"start": start, "respawn": respawn, "max": most, "mix": mix,
            "land": land, "drop": drop, "abduct": abduct, "zap": zap}


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
        # `.OBT` field 6: what the block weighs. A collapsing structure's
        # impact force is the mass of the whole pile times its speed.
        "mass": o["param"] or 1,
        # `.COL` word 0: how Jack collides with it — 0 not at all, 1 solid,
        # 2 a platform from above, 4 a ladder, 5 a ladder's top (level.py).
        "col": o["col"],
        # `.COL` word 2: a marker for the gits walking over it — 1 turns
        # them left, 2 right (VA 0x2fbfd; README "The gits").
        **({"marker": o["marker"]} if o["marker"] else {}),
    } for i, o in enumerate(lv["objects"])]

    # Start positions and the bell come from the level's own `.OB` — the
    # spawn stream the game interprets at startup (scripts/formats/ob.py).
    # They used to be invented here, which put the bell on whichever roof
    # happened to be highest and stood the players in a neat row.
    placed = ob.parse(open(os.path.join(LEVELS, name + ".OB"), "rb").read())

    # Many authored positions are off the map — 75 of 255 starts and 17
    # of 135 bells, always in x. They are on the street: the floor is the
    # level's bottom edge at any x (VA 0x609bc), and it runs STREET past
    # either side. Players walk in from it, and some bells stand on it.
    def clamp_x(x, width=8):
        return max(-STREET, min(x, lv["width"] + STREET - width))

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

    # Timmies. Class 14 a timmy, 17 a king timmy (VA 0x2fd06, 0x2fd42):
    # x, y, the word at +0xe its mode — 1 locked to the block under it
    # until that dies, 2 free from the start — and at +0x14 its flags
    # (bit 1: it heeds the conditional markers). About 1450 records, the
    # most common thing in the game. See "The gits" in the README.
    timmies = [{"x": x, "y": y + HEADROOM, "king": cid == KING_TIMMY_CLASS,
                "locked": w[7] == 1, "flags": w[10]}
               for cid, _off, payload in placed
               if cid in (TIMMY_CLASS, KING_TIMMY_CLASS)
               for w in [struct.unpack_from("<11h", payload, 0)]
               for x, y in [(w[0], w[1])]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Spike gits. Class 32 (VA 0x1327e) — not a timmy: x, y, and the word
    # at +0x12 bit 0 a free walker, bit 1 locked to a block. The rules
    # record caps how many there may be (+0x3e).
    spikes = [{"x": w[0], "y": w[1] + HEADROOM, "locked": not w[9] & 1}
              for cid, _off, payload in placed if cid == SPIKE_CLASS
              for w in [struct.unpack_from("<10h", payload, 0)]
              if 0 <= w[0] <= lv["width"] and 0 <= w[1] <= lv["height"]]
    rules = next((payload for cid, _off, payload in placed
                  if cid == RULES_CLASS and len(payload) >= 0x40), None)
    spike_max = struct.unpack_from("<h", rules, 0x3e)[0] if rules else 0
    spikes = spikes[:max(0, spike_max)]

    # Dynamite. Class 15, drawn at the record's position plus the offset
    # its constructor applies (VA 0x1d2d5). The word at +14 picks which of
    # two sticks it is: 1 is lit by a hammer blow (template 0x98c84), 2 by
    # Jack touching it (template 0x98ca0, outcome 5 of his event list).
    dynamite = [{"x": x + 10, "y": y + 20 + HEADROOM,
                 "lit_by": ("touch" if struct.unpack_from("<h", payload, 14)[0] == 2
                            else "hammer")}
                for cid, _off, payload in placed if cid == DYNAMITE_CLASS
                for x, y in [struct.unpack_from("<hh", payload, 0)]
                if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Cannons. Class 6: the record's x, y is the wheel's (VA 0x5f6c1), the
    # word at +14 which way it faces (1 left, 2 right — VA 0x5f802) and the
    # word at +18 what it stands on: 2 wheels, which roll when pushed, or
    # 1 a fixed carriage (VA 0x5f82b). They are dropped in mid-air and
    # settle on whatever is under them.
    cannons = [{"x": x, "y": y + HEADROOM,
                "facing": "left" if struct.unpack_from("<h", payload, 14)[0] == 1 else "right",
                "wheels": bool(struct.unpack_from("<h", payload, 18)[0] & 2)}
               for cid, _off, payload in placed if cid == CANNON_CLASS
               for x, y in [struct.unpack_from("<hh", payload, 0)]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Cannonballs. Class 7: x, y as given, and the word at +14 picks the
    # ball — 2 the big one, which weighs 50000 to the small one's 5.
    balls = [{"x": x, "y": y + HEADROOM,
              "big": struct.unpack_from("<h", payload, 14)[0] == 2}
             for cid, _off, payload in placed if cid == BALL_CLASS
             for x, y in [struct.unpack_from("<hh", payload, 0)]
             if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Suckers. Class 22: x, y as given (VA 0x18fdd).
    suckers = [{"x": x, "y": y + HEADROOM}
               for cid, _off, payload in placed if cid == SUCKER_CLASS
               for x, y in [struct.unpack_from("<hh", payload, 0)]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Teleporters. Class 27: x, y; at +14 bit 0 keeps it on for good, at
    # +16 its own number (under 8) and at +18 the number of the pad it
    # sends to (VA 0x347c1).
    tellies = [{"x": x, "y": y + HEADROOM, "id": w[8], "target": w[9],
                "alwaysOn": bool(w[7] & 1)}
               for cid, _off, payload in placed if cid == TELLY_CLASS
               for w in [struct.unpack_from("<10h", payload, 0)]
               for x, y in [(w[0], w[1])]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # Seesaws. Class 0, 20 bytes: x, y — the seesaw stands 26 below it —
    # the word at +0xe 1 for the left end down (frame 0), and at +0x12 1
    # for the CSAW look, else BCSAW (VA 0x1eb0d).
    seesaws = [{"x": w[0], "y": w[1] + 0x1a + HEADROOM,
                "tilt": 0 if w[7] == 1 else 1, "big": w[9] != 1}
               for cid, _off, payload in placed if cid == SEESAW_CLASS
               for w in [struct.unpack_from("<10h", payload, 0)]
               if 0 <= w[0] <= lv["width"] and 0 <= w[1] <= lv["height"]]

    # The 20-ton weights. Class 1: x, y as given (VA 0x1e6c3).
    weights = [{"x": x, "y": y + HEADROOM}
               for cid, _off, payload in placed if cid == WEIGHT_CLASS
               for x, y in [struct.unpack_from("<hh", payload, 0)]
               if 0 <= x <= lv["width"] and 0 <= y <= lv["height"]]

    # The UFO. The record's x, y go unused: each starts 100 px above a
    # random Jack (VA 0x13634). One record per level sets them all up.
    ufo = next((ufo_params(payload) for cid, _off, payload in placed
                if cid == UFO_CLASS), None)

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
        "spikes": spikes,
        "dynamite": dynamite,
        "cannons": cannons,
        "balls": balls,
        "suckers": suckers,
        "tellies": tellies,
        "ufo": ufo,
        "seesaws": seesaws,
        "weights": weights,
        # The bottom edge of a level is solid ground in the original. It is
        # not made of objects — in 0B all 179 are destructible and nothing
        # sits under the start at all — but every level's authored start is
        # a few pixels above the bottom edge (3 to 33 across the archive),
        # which only works if Jack is standing on it. Without this the
        # players simply fall out of the level.
        #
        # It reaches past both side edges, as far as the street goes.
        "ground": {"x": -STREET,
                   "y": (lv["tiles_h"] + HEADROOM // 8) * 8,
                   "width": lv["width"] + STREET * 2,
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


#: Level name -> number and section, as G.EXE builds it (VA 0x10a46):
#: name = NUMBERS[number] + SECTIONS[section]. Sections 9-17 repeat 0-8.
NUMBERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SECTIONS = "JHCSLIATMJHCSLIATMBKDX"


def play_order(ids):
    """Sort level ids the way the original plays them: section by section
    in the order the game numbers them (J, H, C, S, L, I, A, T, M, B, K, D),
    and within a section by number — so the first level is 0J, the one a
    new game's TRASHIT.DAT starts from. Ids that are not original levels
    go last, as they came."""
    def key(i, lid):
        name = lid[len("level_"):] if lid.startswith("level_") else lid
        if len(name) == 2 and name[0] in NUMBERS and name[1] in SECTIONS:
            return (0, SECTIONS.index(name[1]), NUMBERS.index(name[0]), i)
        return (1, 0, 0, i)
    return [lid for _, lid in sorted((key(i, lid), lid)
                                     for i, lid in enumerate(ids))]


def write_index(ids):
    """Write the play order.

    The order lives in shared/ because both sides need it: the client to
    know what comes next, the server to decide what to start.
    """
    with open(SHARED_ORDER, "w") as fh:
        json.dump({"order": ids}, fh, indent=1)
        fh.write("\n")


def main(argv):
    if argv and argv[0] == "--all":
        # The T* and U* files are test levels: the only twelve without a
        # bell.
        every = sorted({os.path.splitext(f)[0] for f in os.listdir(LEVELS)
                        if f.upper().endswith(".WAM")})
        # Twelve more (CC, CH, … DS) hold a single object on a 288x160
        # screen: not levels to play.
        def playable(n):
            wam = open(os.path.join(LEVELS, n + ".WAM"), "rb").read()
            return struct.unpack_from("<H", wam, 4)[0] >= MIN_OBJECTS
        names = [n for n in every if n[0] not in "TU" and playable(n)]
    else:
        names = argv or DEFAULT_BATCH

    os.makedirs(OUT_SPRITES, exist_ok=True)
    os.makedirs(OUT_LEVELS, exist_ok=True)
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
            if lid not in ids:
                ids.append(lid)
    seen = play_order(list(dict.fromkeys(ids)))
    write_index(seen)
    print("%d levels in the play order -> %s" % (len(seen), SHARED_ORDER))


if __name__ == "__main__":
    main(sys.argv[1:])
