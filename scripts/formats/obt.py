"""
Trash It (1997 DOS) — .OBT object type table (and notes on .OB).

CONFIDENCE: confirmed. G.EXE loads .OBT into a fixed 2000-byte table
(VA 0x2e8e1 -> 0x40cbf8) and indexes it directly by the `type` field of
a .WAM record (VA 0x2cf7d: `type * 8 + table`). Fields 2 and 4 are
verified: every object's .G2 shape decodes to exactly
width*8 x height*8 pixels.

Record: 8 bytes, 4 x u16 little-endian.

    0   graphic id. 0xffff and 0xfffe are sentinels (the game stores -1
        for both, and 0xfffe additionally sets a flag bit); other values
        seen are round numbers like 60000, 40000, 3000.
    2   width in 8x8 tiles
    4   height in 8x8 tiles
    6   a per-type quantity, forced to 1 when stored as 0. Co-varies
        with field 0 in round pairs (60000/40000, 40000/20000,
        3000/200) — reads like mass/score or health/points, but the
        exact meaning is not pinned down.

Record 0 is all zeros in every sample (the unused "no type" slot).

Field 6 is the one the level loader copies into each object entity at
+0x14 (VA 0x12664 in the decompilation), forcing it to 1 when the table
stores 0. That is consistent with it being the block's strength, but
nothing has yet been found that reads it back, so it is still only
consistent, not confirmed.

About `.OB`: the claim that used to be here — that `G.EXE` never opens a
`.OB` — was wrong, and `scripts/formats/ob.py` now decodes them. The
game builds the name with the extension `".ob"` (VA 0x108fb) and
interprets the file as its startup spawn stream: the player starts and
the bell come from there.
"""
import struct

RECORD_SIZE = 8


def read(path):
    """-> list of dicts(gid, width, height, param), indexed by .WAM type."""
    data = open(path, "rb").read()
    out = []
    for i in range(len(data) // RECORD_SIZE):
        gid, w, h, param = struct.unpack_from("<4H", data, i * RECORD_SIZE)
        out.append(dict(gid=gid, width=w, height=h, param=param))
    return out
