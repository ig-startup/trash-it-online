"""
Trash It (1997 DOS) — .OBT object type table (and notes on .OB).

CONFIDENCE: confirmed. G.EXE loads .OBT into a fixed 2000-byte table
(VA 0x2e8e1 -> 0x40cbf8) and indexes it directly by the `type` field of
a .WAM record (VA 0x2cf7d: `type * 8 + table`). Fields 2 and 4 are
verified: every object's .G2 shape decodes to exactly
width*8 x height*8 pixels.

Record: 8 bytes, 4 x u16 little-endian.

    0   **hit points.** Not a graphic id — the shape comes from `.I`.
        The level loader copies this into the object entity at +0x18,
        and the damage routine subtracts the force of a hit from it and
        destroys the object when it runs out (see "How a structure
        collapses" in README.md). 0xffff and 0xfffe both mean
        indestructible (stored as -1; 0xfffe also sets a flag bit).
        Across the archive: 2216 of 6560 types are indestructible, and
        the rest run from 50 to 60000.
    2   width in 8x8 tiles
    4   height in 8x8 tiles
    6   a per-type quantity, forced to 1 when stored as 0. Co-varies
        with field 0 in round pairs (60000/40000, 40000/20000,
        3000/200). **Not hit points**: across the exported levels it
        takes 26 distinct values including 54411, 50000 and 40000, which
        no block survives. Score is the likely reading.

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
