"""
The front end's tables in `F.EXE`: the world map, passwords, arcade
missions, the hammer shop. **Confirmed** unless a field says otherwise.

`F.EXE` is the menu program; it runs `G.EXE` for every level and the two
talk through the record in `TRASHIT.DAT` (pointer at VA 0xd6d1c here).
Of that record, the front end's side:

| offset | field |
|---|---|
| +0x06 | hammer of each player, u16 x 4 (an index into the shop below) |
| +0x24 | level number to run |
| +0x26 | world (0..8) — the same index as the level-name section |
| +0x28 | lives; a new game and a password both give 5 |
| +0x2a | what the front end does next (1 run G.EXE, 5 world done, 0xb map) |
| +0x1be | timmy points to spend — the shop's money |
| +0x188 | one byte per map node: 1 = trashed, so Jack may walk past it |
| +0x1b8 | the node Jack stands on |
| +0x1bc | the stage of the last trashed node (see `stage` below) |
| +0x20a | timmy points earned on each node, u16 x 48 |

**The world map.** Nine worlds, one per level-select screen
`FSPR/LVSPAT1..9.PAK`, in the order J H C S L I A T M — the same order as
the section letters, so world N plays section N. The table at VA 0x8d534
has a 16-byte row per world whose first word points at its nodes: 40-byte
records ending at id -1. A node's id is the number of its point in the
LVSPAT picture (LVSPAT1 holds points 1..19 = the nineteen path nodes of
world J); Jack walks pixel by pixel along the 255-coloured paths
(VA 0x1e1c1) and **may step over a point only once it is trashed**. Path
corners and junctions are nodes too, with level -1, and they start
trashed (`open`), so the levels are the only stops. A new world puts
Jack on node 1.

What a node does when Jack presses fire on it (VA 0x1de35, 0x1ffe9):

- kind 1 — a level: run it. Won, the node is trashed.
- kind 2 — a level off the main line: numbers 29/30 (T/U files, the only
  levels with a demo `.J`), 12 (C, a one-object bonus screen) and two
  late levels (5A, 4M). A trashed bonus screen cannot be replayed.
- kind 3 — the world's exit. Not trashed: play it (the D file — a
  one-object screen — or, with no icon, nothing); trashed: next world.
- kind 4 — a gate on the path (T and M only), `price` 600..1400.
  **Not traced:** what it charges.

A trashed level can be replayed only while the timmy points it paid out
are still in hand; a level of a stage below the last one trashed cannot
be entered (both VA 0x1de35).

When a node is won its `movie` plays — `D\\SMK\\<name>.SMK` from the
table at VA 0x89180. Worlds end with the six "inter" films and the game
with `end`; five secret films hand player 1 a special hammer
(VA 0x12bbb): dra → dragon, bfh, qua → quality, gal → galactic,
moo → moola.

**Passwords** (VA 0x8da23, checked at 0x15d55): one per world, shown on
arriving there (VA 0x168d5 prints "password is"). Typing one starts that
world with 5 lives, no points, and players 1 and 2 holding the hammer
from VA 0x8da1a. The nine words after them are the worlds' names.

**Arcade** (VA 0x8d6f0, 8-byte rows `section, number, hammer, picture`,
each list ending at -1): fifteen K levels, then the battle sets on B.
Each K level has a mission line (VA 0x8d5c4, five languages, picked by
the row, VA 0x1a163) — and the line is not decoration: it matches the
level's bell (`.OB` class 13, payload +14) exactly. "trash NN% to free
the bell" is subtype 8 with NN at payload +18; G.EXE keeps that bell
hidden until `destroyed_percent` reaches it (VA 0x340af).

    python3 scripts/formats/front.py            # everything
    python3 scripts/formats/front.py worlds     # the nine maps, node by node
    python3 scripts/formats/front.py graph      # which nodes the paths join
"""
import os
import re
import struct
import sys

from disasm import Code
import pak

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ORIGINAL = os.path.join(REPO, "Trash-it-original")
EXE = os.path.join(ORIGINAL, "F.EXE")

NUMBERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SECTIONS = "JHCSLIATMJHCSLIATMBKDX"
LANGUAGES = ("english", "german", "french", "italian", "spanish")

WORLDS = 0x8d534
WORLD_COUNT = 9
NODE_SIZE = 40
MOVIES = 0x89180
MOVIE_COUNT = 48
PASSWORDS = 0x8da23
PASSWORD_HAMMERS = 0x8da1a
WORLD_NAMES = PASSWORDS + 4 * WORLD_COUNT
ARCADE = 0x8d6f0
MISSIONS = 0x8d5c4
SHOP = 0x89860
SHOP_COUNT = 36
#: The shop leaves the specials' names blank; these are the films that
#: hand them out (and `hammers.py` names them the same way).
SPECIALS = {30: "bfh", 31: "quality", 32: "galactic", 33: "dragon",
            34: "moola"}
#: Secret films that hand player 1 a hammer: movie index -> shop index
#: (VA 0x12bbb, the five bytes at 0x1263c).
MOVIE_HAMMERS = {36: 33, 37: 30, 38: 31, 39: 32, 40: 34}

KINDS = {1: "level", 2: "side", 3: "exit", 4: "gate"}


def level_name(world, number):
    """A node's level file, or None for a path node."""
    if number < 0:
        return None
    return NUMBERS[number] + SECTIONS[world]


class Front:
    def __init__(self, path=EXE):
        self.c = Code(path)

    def u32(self, va):
        return self.c.u32(va)

    def text(self, va):
        return self.c.cstring(va)

    def movies(self):
        return [self.text(self.u32(MOVIES + 4 * i)) for i in range(MOVIE_COUNT)]

    def nodes(self, world):
        """The nodes of one world, in table order."""
        out = []
        va = self.u32(WORLDS + 16 * world)
        while True:
            w = struct.unpack("<20h", self.c.read(va, NODE_SIZE))
            if w[0] == -1:
                return out
            icon = struct.unpack_from("<I", self.c.read(va + 12, 4))[0]
            out.append({
                "id": w[0],
                # the exits of A, T and M have no screen of their own:
                # number 0, open — they are just the way out
                "level": "exit" if w[2] == 3 and w[4] else level_name(world, w[1]),
                "number": w[1],
                "kind": KINDS.get(w[2], w[2]),
                # standing here sends Jack to that node (VA 0x1e708)
                "warp": w[3],
                # trashed from the start: a path corner, passable
                "open": bool(w[4]),
                # the map-screen object drawn for it, and where
                "icon": icon,
                "x": w[8], "y": w[9],
                "movie": w[13],
                # copied to the record's +0x1bc when won (VA 0x20072)
                "stage": w[14],
                "price": w[16],
                # +0x22 and +0x24: no reader found in F.EXE
                "unknown": (w[17], w[18]),
            })
            va += NODE_SIZE

    def screen(self, world):
        """
        The LVSPAT picture a world is drawn on. Not the world's own index:
        the row's second word names the screen's text file, `lvslN_e.dat`,
        and N is the picture — S and L are swapped, so are A and T.
        """
        name = self.text(self.u32(WORLDS + 16 * world + 4))
        return int(re.match(r"lvsl(\d)_", name).group(1))

    def passwords(self):
        """[(word, world, world name, hammer index)] for the nine worlds."""
        hammers = self.c.read(PASSWORD_HAMMERS, WORLD_COUNT)
        return [(self.text(self.u32(PASSWORDS + 4 * i)), i,
                 self.text(self.u32(WORLD_NAMES + 4 * i)), hammers[i])
                for i in range(WORLD_COUNT)]

    def shop(self):
        """[(name, price in timmy points)] in hammer-index order."""
        out = []
        for i in range(SHOP_COUNT):
            rec = self.u32(SHOP + 4 * i)
            name = self.text(self.u32(rec)).strip() or SPECIALS.get(i, "?")
            price = struct.unpack("<h", self.c.read(rec + 4, 2))[0]
            out.append((name, price))
        return out

    def arcade(self):
        """
        The arcade lists: [[(level, hammer, picture), ...], ...], each
        ended by -1 — the K levels first, then sets of battle levels.
        """
        lists, cur, va = [], [], ARCADE
        while True:
            s, n, ham, pic = struct.unpack("<4h", self.c.read(va, 8))
            va += 8
            if s == -1:
                lists.append(cur)
                cur = []
            elif s in (18, 19) and 0 <= n < 15:
                cur.append((NUMBERS[n] + SECTIONS[s], ham, pic))
            else:
                return lists

    def missions(self, language=0):
        out, va = [], MISSIONS
        while True:
            p = self.u32(va + 4 * language)
            if not 0x80000 <= p < 0x90000:
                return out
            out.append(self.text(p))
            va += 4 * len(LANGUAGES)


def path_graph(screen):
    """
    Which points one LVSPAT picture's paths join: {(a, b), ...}, a < b.

    Flood the 255 pixels out of every point; whatever other point the
    flood touches is a neighbour. Points are single pixels on the path.
    """
    img = pak.load(os.path.join(ORIGINAL, "FSPR", "LVSPAT%d.PAK" % screen))
    w, h = 640, 480
    points = {i: v for i, v in enumerate(img) if 0 < v < 255}
    edges = set()
    for start, a in points.items():
        seen, todo = {start}, [start]
        while todo:
            p = todo.pop()
            x, y = p % w, p // w
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (y + dy) * w + x + dx
                    if (dx or dy) and 0 <= x + dx < w and 0 <= y + dy < h \
                            and q not in seen:
                        seen.add(q)
                        if img[q] == 255:
                            todo.append(q)
                        elif q in points and points[q] != a:
                            edges.add(tuple(sorted((a, points[q]))))
    return edges


def level_graph(front, world):
    """
    The paths as Jack walks them: which levels neighbour each other once
    the open path nodes between them are walked through. {(a, b), ...}
    of level names, a < b.
    """
    nodes = {n["id"]: n for n in front.nodes(world)}
    edges = path_graph(front.screen(world))
    near = {}
    for a, b in edges:
        near.setdefault(a, set()).add(b)
        near.setdefault(b, set()).add(a)
    for n in nodes.values():          # warps join two path nodes
        if n["warp"]:
            near.setdefault(n["id"], set()).add(n["warp"])
    out = set()
    for start, n in nodes.items():
        if n["level"] is None:
            continue
        seen, todo = {start}, list(near.get(start, ()))
        while todo:
            p = todo.pop()
            if p in seen:
                continue
            seen.add(p)
            m = nodes.get(p)
            if m and m["level"] is not None and (not m["open"]
                                                 or m["kind"] == "exit"):
                if m["level"] != n["level"]:
                    out.add(tuple(sorted((n["level"], m["level"]))))
                continue
            todo.extend(near.get(p, ()))
    return out


def _main(argv):
    what = argv[0] if argv else "all"
    f = Front()
    movies = f.movies()
    shop = f.shop()
    if what in ("all", "worlds"):
        names = {i: n for _, i, n, _ in f.passwords()}
        for world in range(WORLD_COUNT):
            print("world %d %s — %s" % (world, SECTIONS[world], names[world]))
            for n in f.nodes(world):
                if n["level"] is None and not n["warp"] and n["kind"] != "gate":
                    continue
                bits = [n["kind"]]
                if n["warp"]:
                    bits.append("warp -> %d" % n["warp"])
                if n["movie"] >= 0:
                    film = movies[n["movie"]]
                    if n["movie"] in MOVIE_HAMMERS:
                        film += " (gives %s)" % shop[MOVIE_HAMMERS[n["movie"]]][0]
                    bits.append("film " + film)
                if n["price"]:
                    bits.append("price %d" % n["price"])
                print("  %2d %-4s stage %d  %s" % (n["id"], n["level"] or "--",
                                                  n["stage"], ", ".join(bits)))
    if what in ("all", "graph"):
        for world in range(WORLD_COUNT):
            print("world %d %s (LVSPAT%d):" % (world, SECTIONS[world],
                                               f.screen(world)),
                  " ".join("%s-%s" % e for e in sorted(level_graph(f, world))))
    if what in ("all", "passwords"):
        print("passwords:")
        for word, world, name, ham in f.passwords():
            print("  %-8s world %d %s (%s), hammer %s"
                  % (word, world, SECTIONS[world], name, shop[ham][0]))
    if what in ("all", "arcade"):
        k, *battles = f.arcade()
        missions = f.missions()
        for i, (lvl, ham, pic) in enumerate(k):
            line = missions[i] if i < len(missions) else "(no mission line)"
            ham = shop[ham][0] if ham < len(shop) else "#%d" % ham
            print("  arcade %s  %-28s hammer %s" % (lvl, line, ham))
        for b in battles:
            print("  battle set:", " ".join(l for l, _, _ in b))
    if what in ("all", "shop"):
        print("shop:", ", ".join("%s %d" % s for s in shop if s[0]))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
