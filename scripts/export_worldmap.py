"""
Export the story's world maps (F.EXE's level-select screens) for the
client — see docs/re/front/world-map.md.

For each of the nine worlds: its 640 x 480 picture (the raw frame of the
screen's sheet, JUNKMP.SPR and the rest, named first in
`PROJ/LVSL<n>_E.DAT`), its nodes (front.py), and where Jack goes from each
point of its LVSPAT path picture for each of the four key groups — walked
here exactly as F.EXE walks it (map_walk_step 0x1e1c1, the step 0x1e09f),
pixel by pixel, so the client only has to replay the pixels. Plus Jack's
map sprite, LSJACK.SPR, as one atlas: eight walks of 17 frames.

    python3 scripts/export_worldmap.py

Plus the sheets of the "continue?" screen a lost level asks, and the
hammer shop's: its screen, its tables and words (export_shop).

Writes client/public/worldmap/*.png and client/public/worldmap/worlds.json.
"""
import json
import os
import re
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import _png
import front
import pak
import pal
import spr

ORIG = os.path.join(REPO, "Trash-it-original")
OUT = os.path.join(REPO, "client", "public", "worldmap")
W, H = 640, 480

#: The eight neighbours as F.EXE numbers them (0x1e539): row by row from
#: the top left, 4 being the pixel itself.
STEP = {0: (-1, -1), 1: (0, -1), 2: (1, -1), 3: (-1, 0), 5: (1, 0),
        6: (-1, 1), 7: (0, 1), 8: (1, 1)}

#: The key groups of map_walk_step: which two neighbours a key may start
#: Jack towards, in the order it tries them, and the `came` (the neighbour
#: he arrived from, d981c) under which it may turn him back on a pixel
#: that is not a trashed point. The isometric map makes each arrow a pair.
GROUPS = {
    "up": ((1, 2), (1, 2)),
    "down": ((6, 7), (6, 7)),
    "left": ((0, 3), (0, 3)),
    "right": ((5, 8), (5, 8)),
}
#: The came-from a move into each neighbour leaves behind (0x1e5c9).
CAME = {0: 8, 1: 7, 2: 6, 3: 5, 5: 3, 6: 2, 7: 1, 8: 0}

#: LSJACK.SPR's 136 frames (map_jack_tick 0x1f941, docs/re/front/map-objects.md):
#: direction d of map_pick_jack_facing (0x1e788, table 0x1dbc1 — 1 right,
#: 2 down-right, 3 down, 4 down-left, 5 left, 6 up-left, 7 up, 8 up-right)
#: stands on frame d-1 (table 0x1e9d1) and walks 16 frames from 8 + 16 (d-1)
#: (table 0x1e9c8), one every two ticks.
JACK_STAND = list(range(8))
JACK_WALK = [8 + 16 * d for d in range(8)]
JACK_WALK_FRAMES = 16

#: The map's object templates (0x89f7a + 0x20 k) a node may carry: what
#: the clone does with it, the sheet it draws from (None: the world's own)
#: and, for one that loops, its frames and the ticks each is shown.
ICONS = {
    0x89f7a: ("loop", "LVSL8FLM", list(range(8)), 5),       # 0x1f6c9, on A
    0x89f9a: ("loop", "LVSL8FLM", list(range(8, 16)), 5),   # 0x1f6f1
    0x89fba: ("loop", "LVSL8SPR", [8, 4], 30),              # 0x1f713
    0x8a03a: ("bin", "LEVSLBIN", None, 0),                  # 0x1f5f7
    0x8a05a: ("loop", None, list(range(8)), 3),             # 0x1f689, T's node 15
    0x8a07a: ("hat", "LS_HAT", None, 0),                    # 0x1f73f
    0x8a09a: ("landmark", None, None, 0),                   # 0x1c9ba
    0x8a0ba: ("untilTrashed", None, None, 0),               # 0x1f7ad
    0x8a0da: ("untilTrashed", None, None, 0),               # 0x1f7cd
    0x8a0fa: ("onceTrashed", None, None, 0),                # 0x1f7ed
    0x8a15a: ("onceTrashed", None, None, 0),                # 0x1f80a
}


def neighbours(mask, x, y):
    out = [0] * 9
    for i in range(9):
        dx, dy = i % 3 - 1, i // 3 - 1
        if 0 <= x + dx < W and 0 <= y + dy < H:
            out[i] = mask[(y + dy) * W + x + dx]
    return out


def choose(n):
    """0x1e09f's pick: the first neighbour that is a point, else the first path."""
    pick = next((i for i in range(9) if n[i] not in (0, 255)), None)
    return pick if pick is not None else next((i for i in range(9) if n[i]), None)


def walk(mask, x, y, group):
    """
    Jack leaving the point at (x, y) with `group` held: the pixels he
    steps on, up to and including the point he stops at, and that
    point's id — or None when the group has no way out of here.
    """
    pair, _ = GROUPS[group]
    n = neighbours(mask, x, y)
    path, came = [], 4
    # map_walk_step: each of the pair that is path moves him, the second
    # on the flags read before the first move (as the game does).
    for i in pair:
        if n[i]:
            dx, dy = STEP[i]
            x, y = x + dx, y + dy
            came = CAME[i]
            path.append((x, y))
    if not path:
        return None
    first = True
    for _ in range(4000):
        # 0x1e09f: never back where he came from; the first step only
        # along the pair; a point before plain path; the first in order.
        # Only a point it steps onto stops him (d981e), so one the key's
        # own move landed on is walked through.
        n = neighbours(mask, x, y)
        n[4] = 0
        if came != 4:
            n[came] = 0
        if first:
            # d981b holds for one tick and is cleared even when nothing
            # along the pair is path: then he stands a tick, and goes on.
            first = False
            pick = choose([v if i in pair else 0 for i, v in enumerate(n)])
            if pick is None:
                path.append((x, y))
                pick = choose(n)
        else:
            pick = choose(n)
        if pick is None:
            return None
        dx, dy = STEP[pick]
        x, y = x + dx, y + dy
        came = CAME[pick]
        path.append((x, y))
        if 0 < n[pick] < 255:
            return path, n[pick], came
    raise RuntimeError("walk from (%d, %d) %s never ends" % (x, y, group))


def screen_picture(screen):
    """
    The screen's picture: the 640 x 480 frame of the first sheet its PROJ
    file names that has one (A's names its film sheet, LVSL8FLM, first).
    """
    dat = open(os.path.join(ORIG, "PROJ", "LVSL%d_E.DAT" % screen), "rb").read()
    for m in re.finditer(rb"([A-Za-z0-9_]+)\.spr", dat, re.I):
        sheet = os.path.join(ORIG, "FSPR", m.group(1).decode().upper())
        for i, f in enumerate(spr.load(sheet + ".SPR")):
            if f["w"] == W and f["h"] == H:
                return sheet, f, i
    raise ValueError("screen %d has no picture" % screen)


def export_background(screen, out_path):
    sheet, frame, _ = screen_picture(screen)
    palette = pal.decode(sheet + ".PAL")
    _, _, img = spr.frame_bitmap(frame)
    _png.write_rgb(out_path, W, H, [tuple(palette[v]) for row in img for v in row])


def export_sheet(name, out_name, skip=(), palette_of=None):
    """
    A whole FSPR sheet as one atlas in its own palette, a frame per cell;
    -> {"image", "frames": [[x, y, w, h, ox, oy]]}, the origin being where
    the frame's top left sits from the object's point. Frames in `skip`
    (a world's 640 x 480 picture) are left empty.
    """
    path = os.path.join(ORIG, "FSPR", name)
    # a screen shows every sheet in its own one palette
    palette = pal.decode(os.path.join(ORIG, "FSPR", (palette_of or name) + ".PAL"))
    frames = spr.load(path + ".SPR")
    keep = [f for i, f in enumerate(frames) if i not in skip]
    cw = max(f["w"] for f in keep)
    ch = max(f["h"] for f in keep)
    cols = max(1, min(len(frames), 2048 // cw))
    rows = (len(frames) + cols - 1) // cols
    aw, ah = cw * cols, ch * rows
    rgba = [(0, 0, 0, 0)] * (aw * ah)
    rects = []
    for i, f in enumerate(frames):
        bx, by = (i % cols) * cw, (i // cols) * ch
        if i in skip:
            rects.append([bx, by, 1, 1, 0, 0])
            continue
        w, h, img = spr.frame_bitmap(f, transparent=0)
        for y in range(h):
            for x in range(w):
                v = img[y][x]
                if v:
                    r, g, b = palette[v]
                    rgba[(by + y) * aw + bx + x] = (r, g, b, 255)
        rects.append([bx, by, f["w"], f["h"], f["ox"], f["oy"]])
    _png.write_rgba(os.path.join(OUT, out_name), aw, ah, rgba)
    return {"image": "worldmap/" + out_name, "frames": rects}


def export_jack():
    """LSJACK.SPR: eight standing poses, then eight walks of sixteen."""
    jack = export_sheet("LSJACK", "lsjack.png")
    assert len(jack["frames"]) == len(JACK_STAND) + 8 * JACK_WALK_FRAMES
    jack.update(stand=JACK_STAND, walk=JACK_WALK, walkFrames=JACK_WALK_FRAMES)
    return jack


def export_continue():
    """
    The "continue?" screen's sheets, PROJ/CONTIN_E.DAT (continue_screen_init
    0x154cb, docs/re/front/continue.md), and colour 254 of their shared
    palette — the silhouette the answer picked flashes in.
    """
    out = {}
    for name in ("CONTINBG", "CNTGRB_E", "CONMIST", "CONTPANL"):
        out[name.lower()] = export_sheet(name, "continue_%s.png" % name.lower())
    r, g, b = pal.decode(os.path.join(ORIG, "FSPR", "CONTINBG.PAL"))[254]
    return {"sheets": out, "flash": (r << 16) | (g << 8) | b}


#: The shop's tables in F.EXE (docs/re/front/hammer-shop.md).
SHOP_ITEMS = 0x897e8      # 30 records in cursor order: column * 6 + row
SHOP_OPEN = 0x8d90c       # per world, 30 flags by row * 5 + column
SHOP_CELL = 0x89ad0       # hammer index -> its cell, row * 5 + column
SHOP_WORDS = {"bought": 0x89784, "buyThe": 0x89798, "yesNo": 0x897ac,
              "poor": 0x897c0, "owned": 0x897d4}
#: The map's dialog (0x1eaf4): its words, English (record +0x204 = 0).
DIALOG_WORDS = {"available": 0x89db2, "buyYourWay": 0x89c72, "inFor": 0x89c86,
                "timmy": 0x89d62, "timmies": 0x89c5e, "oneContinue": 0x89c9a,
                "noContinues": 0x89d8a, "yesNo": 0x89cae, "tollGate": 0x89cd6,
                "youNeed": 0x89cfe, "youHave": 0x89d12, "tryAgain": 0x89d26,
                "openGate": 0x89d3a, "playLevel": 0x89cc2, "quit": 0x89d9e}
#: The font template the shop writes with (0x89b2c): the YELMEDFT frame of
#: 'a'/'A' and '0', of each sign, and the widths (space, gap, line).
FONT = 0x89b2c
FONT_SIGNS = {"!": 4, "?": 5, '"': 6, ",": 7, ".": 8, "+": 9, "-": 10,
              "'": 11, "%": 12, ":": 15, "*": 16}


def export_shop():
    """
    The hammer shop (hammer_shop 0x1b92a): HAMSHP_E's screen parts and
    words, HSHAMS's twenty frames of the hammer grid, STATSPR's two rings,
    YELMEDFT's letters — all in HAMSHP_E's palette, as the screen shows
    them — and LSSHOP, the shop that flies to Jack on the map.
    """
    f = front.Front()
    c = f.c
    items = []
    for i in range(30):
        rec = f.u32(SHOP_ITEMS + 4 * i)
        w = struct.unpack("<14h", c.read(rec + 4, 28))
        items.append({
            "name": f.text(f.u32(rec)), "price": w[0], "hammer": w[1],
            # the name plate: HAMSHP_E frame 23 + this
            "plate": w[2],
            "girth": [w[3], w[4]], "splat": [w[5], w[6]],
            # words: HAMSHP_E frame 54 + this
            "control": w[7], "range": w[8], "restrike": w[9],
            "area": [w[10], w[11]], "spread": [w[12], w[13]],
        })
    flags = c.read(SHOP_OPEN, 30 * front.WORLD_COUNT)
    font = c.read(FONT, 0x19)
    sheets = {}
    for name, own in (("HAMSHP_E", False), ("HSHAMS", False), ("STATSPR", False),
                      ("YELMEDFT", False), ("LSSHOP", True)):
        sheets[name.lower()] = export_sheet(name, "shop_%s.png" % name.lower(),
                                            palette_of=None if own else "HAMSHP_E")
    palette = pal.decode(os.path.join(ORIG, "FSPR", "HAMSHP_E.PAL"))
    rgb = lambda i: (palette[i][0] << 16) | (palette[i][1] << 8) | palette[i][2]
    return {
        "sheets": sheets,
        "items": items,
        "open": [list(flags[30 * w:30 * w + 30]) for w in range(front.WORLD_COUNT)],
        "cell": list(struct.unpack("<30h", c.read(SHOP_CELL, 60))),
        # what a hammer is worth traded in, by hammer index (0x89860 + 4)
        "worth": [p for _, p in f.shop()],
        "words": {k: c.cstring(c.u32(va)) for k, va in SHOP_WORDS.items()},
        "font": {"upper": font[1], "lower": font[2], "digits": font[3],
                 "signs": {ch: font[i] for ch, i in FONT_SIGNS.items()},
                 "space": font[0x16], "gap": font[0x17], "line": font[0x18]},
        # the bars (0x26efb): rows of colours 0xf2 0xf3 0xf3 0xf2, or for
        # the second part 0x28 0x27 0x27 0x28
        "bar": [[rgb(0xf2), rgb(0xf3)], [rgb(0x28), rgb(0x27)]],
        "silhouette": rgb(254),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    f = front.Front()
    names = {world: (word, name, hammer) for word, world, name, hammer in f.passwords()}
    worlds = []
    sheets = {}
    for world in range(front.WORLD_COUNT):
        screen = f.screen(world)
        mask = pak.load(os.path.join(ORIG, "FSPR", "LVSPAT%d.PAK" % screen))
        points = {v: (i % W, i // W) for i, v in enumerate(mask) if 0 < v < 255}
        background = "map_%d.png" % screen
        export_background(screen, os.path.join(OUT, background))
        # The world's objects (map_place_jack 0x1dbd9): what each node
        # carries — its bin, hat, landmark — from the world's own sheet
        # (its picture left out) or a shared one.
        sheet, _, picture = screen_picture(screen)
        own = os.path.basename(sheet)
        if own not in sheets:
            sheets[own] = export_sheet(own, "sheet_%s.png" % own.lower(), skip=(picture,))
        icons = []
        for n in f.nodes(world):
            if not n["icon"]:
                continue
            kind, name, loop, ticks = ICONS[n["icon"]]
            name = name or own
            if name not in sheets:
                sheets[name] = export_sheet(name, "sheet_%s.png" % name.lower())
            icons.append({"node": n["id"], "kind": kind, "sheet": name,
                          "frame": n["frame"], "x": n["x"], "y": n["y"],
                          "depth": None if n["depth"] == -1 else n["depth"],
                          **({"loop": loop, "ticks": ticks} if loop else {}),
                          # 0x1f689 puts T's node 15 behind Jack once he is
                          # at y 152 or lower, in front of him above
                          **({"behindJackBelow": 152} if n["icon"] == 0x8a05a else {})})
        nodes = {}
        for n in f.nodes(world):
            level = n["level"]
            nodes[n["id"]] = {
                "level": None if level in (None, "exit") else "level_" + level,
                "number": n["number"], "kind": n["kind"], "warp": n["warp"],
                "open": n["open"], "stage": n["stage"],
                # the map's dialog (0x1eaf4): the level's timmies and kings,
                # a gate's toll
                "timmies": n["timmies"], "kings": n["kings"], "price": n["price"],
            }
        moves = {}
        for pid, (x, y) in sorted(points.items()):
            out = {}
            for group in GROUPS:
                w = walk(mask, x, y, group)
                if w:
                    path, to, came = w
                    out[group] = {"to": to, "came": came,
                                  "path": [c for p in path for c in p]}
            moves[pid] = out
        word, name, hammer = names[world]
        worlds.append({
            "letter": front.SECTIONS[world], "name": name, "password": word,
            # the hammer a password hands players 1 and 2 (VA 0x8da1a)
            "hammer": hammer,
            "screen": screen, "background": "worldmap/" + background,
            "points": {k: list(v) for k, v in sorted(points.items())},
            "nodes": nodes, "moves": moves, "icons": icons,
        })
        print("world %d %s: %d points, %d nodes" % (world, front.SECTIONS[world],
                                                    len(points), len(nodes)))
    data = {
        "groups": {g: list(came) for g, (_, came) in GROUPS.items()},
        "jack": export_jack(),
        "continue": export_continue(),
        "shop": export_shop(),
        "dialog": {k: f.c.cstring(f.c.u32(va)) for k, va in DIALOG_WORDS.items()},
        # the panel over the map (map_screen_init 0x1fcc2): its icons and
        # the digits its numbers are written in
        "panel": export_sheet("LSPANEL", "sheet_lspanel.png"),
        "sheets": sheets,
        "worlds": worlds,
    }
    with open(os.path.join(OUT, "worlds.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print("-> %s" % OUT)


if __name__ == "__main__":
    main()
