"""
Trash It (1997 DOS) — level assembly: .WAM + .I + .OBT + .G2 / .G2R + .COL.

CONFIDENCE: confirmed. Decoded from the level loader in G.EXE
(VA 0x2cce9) and verified against LEVELS/0A.*: the .WAM size is exactly
8 + 8*object_count, every .I index lands inside the .G2 shape list, and
every shape's decoded size equals its OBT width/height * 8. Rendering
the result produces the level's buildings and platforms.

How a level is put together
---------------------------
A level is a fixed grid of 8x8 px tiles with a flat list of objects
placed on it. Five files, all sharing the level's 2-character name:

  .WAM   the placement list — the level's skeleton
  .I     one entry per object: which .G2 shape it is drawn with
  .OBT   the object type table: size and strength per type
  .G2    the shape library (see g2.py)
  .G2R   one byte per shape: 1 = static, 2 = destructible
  .COL   one record per object: how Jack collides with it (below)
  .PAL   the palette (see pal.py)
  .SCN   the background screens (see scn.py)
  .SDE   a small block of per-level settings (see notes in README)

.WAM (all u16, little-endian):

    0   width in tiles          (level pixel width  = width  * 8)
    2   height in tiles         (level pixel height = height * 8)
    4   object_count (N)
    6   unused (0 in every sample)
    8   N records of 8 bytes: type, x, y, unused
                              x/y are in pixels, top-left of the object

.I: 4 bytes per object, in the same order as the .WAM records. The
first u16 is the .G2 shape index; the second u16 is 0 or 1 (a flag
whose meaning isn't pinned down yet).

.OBT: 8 bytes per record, indexed directly by the .WAM `type` field:

    0   u16  hit points; 0xffff and 0xfffe are sentinels the game
             turns into -1, i.e. indestructible (0xfffe additionally
             sets a flag bit)
    2   u16  width in tiles
    4   u16  height in tiles
    6   u16  mass, forced to 1 when stored as 0 — what a collapsing
             structure weighs (see ccs.py). Fields 0 and 6 are kept raw
             below as `gid` and `param`.

The .OB next to them is read too — it is the level's startup spawn
stream, where the player starts, the bell and the timmies come from (see
ob.py).

.COL: 6 bytes per object, three i16, indexed by the object's number — so
record 0 is the "no object" slot and the file holds N + 1 records (true
of all 147 levels). The game loads it whole into VA 0x3f20c4 (VA 0x6028f,
4800 bytes) and every probe of the tile map reads word 0 of the record
for the object it finds: its **collision kind**.

    0   no collision at all — scenery Jack walks in front of
    1   solid: floor, wall and ceiling
    2   a platform: floor only, and only from above (feet above its top)
    4   a ladder: no collision; UP climbs it
    5   the top of a ladder: a platform, and a ladder
    (3 is a ceiling and 6 a platform in the code; no level uses either)

Word 1 (0..9) is read by the hammer's code and is not traced. Word 2 is
a marker for the gits walking over the block (VA 0x2fbfd): 1 turns them
left, 2 right, 28-30 are conditional actions — see "The gits" in
README.md.
"""
import os
import struct

import g2


def load(levels_dir, name):
    """-> dict with the level's geometry and its placed objects.

    Each object: dict(type, x, y, shape, routine, w, h, gid, param, col, marker,
    bitmap)
    where bitmap is (width, height, [[palette index]]), None for
    transparent pixels.
    """
    def read(ext):
        with open(os.path.join(levels_dir, name + ext), "rb") as f:
            return f.read()

    wam, idx, obt = read(".WAM"), read(".I"), read(".OBT")
    col = read(".COL")
    shapes = g2.split_records(read(".G2"))
    routines = list(read(".G2R"))

    tw, th, count, _ = struct.unpack_from("<4H", wam, 0)
    objects = []
    for i in range(1, count + 1):
        otype, x, y, _f = struct.unpack_from("<4H", wam, i * 8)
        shape = struct.unpack_from("<H", idx, (i - 1) * 4)[0]
        gid, ow, oh, param = struct.unpack_from("<4H", obt, otype * 8)
        rows = g2.decode_shape(shapes[shape], height=oh * 8)
        objects.append(dict(
            type=otype, x=x, y=y, shape=shape,
            routine=routines[shape] if shape < len(routines) else None,
            w=ow * 8, h=oh * 8, gid=gid, param=param,
            col=struct.unpack_from("<h", col, i * 6)[0],
            marker=struct.unpack_from("<h", col, i * 6 + 4)[0],
            bitmap=g2.rows_to_bitmap(rows, transparent=None),
        ))
    return dict(tiles_w=tw, tiles_h=th, width=tw * 8, height=th * 8,
                objects=objects, shapes=len(shapes))


def compose(level, background=0):
    """Paint every object onto one full-level indexed bitmap."""
    w, h = level["width"], level["height"]
    canvas = [background] * (w * h)
    for o in level["objects"]:
        sw, sh, img = o["bitmap"]
        for yy in range(sh):
            ty = o["y"] + yy
            if not 0 <= ty < h:
                continue
            base = ty * w
            row = img[yy]
            for xx in range(sw):
                v = row[xx]
                if v is None:
                    continue
                tx = o["x"] + xx
                if 0 <= tx < w:
                    canvas[base + tx] = v
    return canvas
