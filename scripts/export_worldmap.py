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

Writes client/public/worldmap/*.png and client/public/worldmap/worlds.json.
"""
import json
import os
import re
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

#: LSJACK.SPR: 8 animations of 17 frames (the screen file's "OW" header,
#: 8 and 0x88); animation d-1 walks direction d of map_pick_jack_facing
#: (0x1e788, table 0x1dbc1): 1 right, 2 down-right, 3 down, 4 down-left,
#: 5 left, 6 up-left, 7 up, 8 up-right.
JACK_ANIMS, JACK_FRAMES = 8, 17


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
        for f in spr.load(sheet + ".SPR"):
            if f["w"] == W and f["h"] == H:
                return sheet, f
    raise ValueError("screen %d has no picture" % screen)


def export_background(screen, out_path):
    sheet, frame = screen_picture(screen)
    palette = pal.decode(sheet + ".PAL")
    _, _, img = spr.frame_bitmap(frame)
    _png.write_rgb(out_path, W, H, [tuple(palette[v]) for row in img for v in row])


def export_jack():
    """LSJACK.SPR as one atlas, a row per animation."""
    palette = pal.decode(os.path.join(ORIG, "FSPR", "LSJACK.PAL"))
    frames = spr.load(os.path.join(ORIG, "FSPR", "LSJACK.SPR"))
    assert len(frames) == JACK_ANIMS * JACK_FRAMES
    cw = max(f["w"] for f in frames)
    ch = max(f["h"] for f in frames)
    aw, ah = cw * JACK_FRAMES, ch * JACK_ANIMS
    rgba = [(0, 0, 0, 0)] * (aw * ah)
    rects = []
    for i, f in enumerate(frames):
        bx, by = (i % JACK_FRAMES) * cw, (i // JACK_FRAMES) * ch
        w, h, img = spr.frame_bitmap(f, transparent=0)
        for y in range(h):
            for x in range(w):
                v = img[y][x]
                if v:
                    r, g, b = palette[v]
                    rgba[(by + y) * aw + bx + x] = (r, g, b, 255)
        # the origin is where the frame's top left sits from Jack's point
        rects.append([bx, by, f["w"], f["h"], f["ox"], f["oy"]])
    _png.write_rgba(os.path.join(OUT, "lsjack.png"), aw, ah, rgba)
    return {"image": "worldmap/lsjack.png", "anims": JACK_ANIMS,
            "framesPerAnim": JACK_FRAMES, "frames": rects}


def main():
    os.makedirs(OUT, exist_ok=True)
    f = front.Front()
    names = {world: (word, name, hammer) for word, world, name, hammer in f.passwords()}
    worlds = []
    for world in range(front.WORLD_COUNT):
        screen = f.screen(world)
        mask = pak.load(os.path.join(ORIG, "FSPR", "LVSPAT%d.PAK" % screen))
        points = {v: (i % W, i // W) for i, v in enumerate(mask) if 0 < v < 255}
        background = "map_%d.png" % screen
        export_background(screen, os.path.join(OUT, background))
        nodes = {}
        for n in f.nodes(world):
            level = n["level"]
            nodes[n["id"]] = {
                "level": None if level in (None, "exit") else "level_" + level,
                "number": n["number"], "kind": n["kind"], "warp": n["warp"],
                "open": n["open"], "stage": n["stage"],
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
            "nodes": nodes, "moves": moves,
        })
        print("world %d %s: %d points, %d nodes" % (world, front.SECTIONS[world],
                                                    len(points), len(nodes)))
    data = {
        "groups": {g: list(came) for g, (_, came) in GROUPS.items()},
        "jack": export_jack(),
        "worlds": worlds,
    }
    with open(os.path.join(OUT, "worlds.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print("-> %s" % OUT)


if __name__ == "__main__":
    main()
