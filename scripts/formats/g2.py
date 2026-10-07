"""
Trash It (1997 DOS) — .G2 level shape library decoder.

CONFIDENCE: confirmed. Framing decoded from the level loader in G.EXE
(VA 0x2cce9, record walker at 0x2df1b) and verified by rendering:
LEVELS/0A.G2 splits into 62 shapes consuming the file byte-exactly,
and each shape's size matches its object type's OBT width/height.

A .G2 file is one level's library of building blocks — the chunks of
scenery Jack smashes. Layout:

    u16 size                record size in bytes, EXCLUDING this word
    u8  data[size]          scanlines, see rle.py
    ...                     repeated
    u16 0                   terminator

Shapes are referenced by index (0-based, in file order) through the
level's .I file. A shape carries no dimensions of its own: the game
takes width/height from the OBT record of the object's type (in tiles
of 8x8 px). The shape's own scanline count equals that height.

The companion `.G2R` file holds one byte per shape, the "routine"
that animates the object built from it: 1 = static, 2 = destructible
(the value G.EXE rejects anything else with "Invalid routine value in
'g2r'"). Both files are indexed by the same shape index.
"""
import struct

from rle import decode_rows, rows_to_bitmap


def split_records(buf):
    """-> list of the raw scanline areas, one per shape, in file order."""
    recs = []
    p = 0
    while p + 2 <= len(buf):
        size = struct.unpack_from("<H", buf, p)[0]
        if size == 0:
            break
        recs.append(buf[p + 2:p + 2 + size])
        p += 2 + size
    return recs


def decode_shape(rec, height=None):
    """-> rows (see rle.decode_rows), or None if `rec` isn't scanlines."""
    return decode_rows(rec, max_rows=height)


def load(path):
    """-> list of (width, height, [[palette index]]) for every shape."""
    recs = split_records(open(path, "rb").read())
    return [rows_to_bitmap(decode_shape(r)) for r in recs]


def load_routines(path):
    """.G2R -> list of per-shape routine bytes (1 static, 2 destructible)."""
    return list(open(path, "rb").read())
