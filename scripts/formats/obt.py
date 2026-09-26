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

About `.OB`: replaced by nothing here on purpose. G.EXE never opens a
.OB or .COL file — the only level files it reads are .WAM, .I, .G2,
.G2R, .OBT, .PAL, .SCN and .SDE. .OB/.COL are therefore level *editor*
data (F.EXE), which is why earlier attempts to find one fixed record
size for .OB across the archive kept failing; they are not needed to
reconstruct a level.
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
