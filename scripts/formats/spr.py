"""
Trash It (1997 DOS) — .SPR sprite sheet decoder.

CONFIDENCE: confirmed. Header framing and the frame-pointer arithmetic
come from G.EXE (sprite loader at VA 0x6a380, frame setup at 0x6a596,
which hands the frame's scanlines to the same blitter the .G2 shapes
use). Verified by rendering: SPR/JACKS.SPR yields 329 frames and every
single one decodes to exactly `height` scanlines.

Layout, all little-endian:

    0   u32  total file size (self-referential; == len(file))
    4   u16  frame_count (N)
    6   u16  offset of the frame offset table (always 8)
    8   u32  offsets[N]   -- each RELATIVE TO BYTE 8, not to the file
                             start. This is the detail that makes or
                             breaks the format: G.EXE keeps a pointer
                             to `file + 8` and indexes off that.
    ...      the frames

Each frame:

    i16  width, i16 height        pixel size of the frame
    i16  origin_x, i16 origin_y   draw offset relative to the entity
                                  position (usually negative, i.e. the
                                  entity's anchor sits inside the frame)
    ...                           scanlines, see rle.py

Each .SPR has a matching .PAL loaded alongside it (e.g. JACKS.PAL for
JACKS.SPR), so sprites are NOT drawn in the level's palette.

Exception: TRASHIT/CHAR.SPR uses the same header but its frames are
8x8 raw uncompressed pixels (72 bytes each = 8 header + 64 pixels) —
it is the text font, not a sprite sheet.
"""
import struct

from rle import decode_rows, rows_to_bitmap


def parse(buf):
    """-> list of frames: dict(w, h, ox, oy, rows, off)."""
    size, n, table = struct.unpack_from("<IHH", buf, 0)
    if size != len(buf):
        raise ValueError("not a .SPR: size field %d != file size %d"
                         % (size, len(buf)))
    offs = struct.unpack_from("<%dI" % n, buf, table)
    frames = []
    for i, o in enumerate(offs):
        p = table + o
        w, h, ox, oy = struct.unpack_from("<4h", buf, p)
        end = table + offs[i + 1] if i + 1 < n else len(buf)
        frames.append(dict(w=w, h=h, ox=ox, oy=oy, off=p,
                           rows=decode_rows(buf[p + 8:end], max_rows=h)))
    return frames


def load(path):
    return parse(open(path, "rb").read())


def frame_bitmap(frame, transparent=255):
    """-> (width, height, [[palette index]]) padded to the frame's own
    declared width (rows_to_bitmap only sees the widest scanline)."""
    w, h, img = rows_to_bitmap(frame["rows"], transparent=transparent)
    if w < frame["w"]:
        for row in img:
            row.extend([transparent] * (frame["w"] - w))
        w = frame["w"]
    return w, h, img


def is_font(buf):
    """CHAR.SPR: fixed 8x8 raw frames instead of scanlines."""
    n = struct.unpack_from("<H", buf, 4)[0]
    offs = struct.unpack_from("<%dI" % n, buf, 8)
    return n > 1 and (offs[1] - offs[0]) == 72


def font_glyphs(buf):
    """-> list of (8, 8, [[palette index]]) for CHAR.SPR."""
    n = struct.unpack_from("<H", buf, 4)[0]
    offs = struct.unpack_from("<%dI" % n, buf, 8)
    out = []
    for o in offs:
        p = 8 + o
        w, h = struct.unpack_from("<2h", buf, p)
        px = buf[p + 8:p + 8 + w * h]
        out.append((w, h, [list(px[y * w:(y + 1) * w]) for y in range(h)]))
    return out
