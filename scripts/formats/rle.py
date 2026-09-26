"""
Trash It (1997 DOS) — the shared scanline codec.

CONFIDENCE: confirmed. Decoded from the blitter in G.EXE at
VA 0x38be8 (and its variants 0x34ed8/0x35c9c/0x3680c/0x3737c/0x37f94,
which differ only in how they write pixels, not in how they read them)
and verified by rendering: every .G2 shape and every .SPR frame in the
archive decodes with zero leftover bytes and a row count that matches
the declared height.

Both .G2 shapes and .SPR frames store their pixels as a list of
scanlines, one after another, top to bottom:

    u8  type      0..8, selects a drawing routine (see below)
    u8  size      total record size in bytes, INCLUDING these 2
    u8  skip      only present when (type & 1): transparent pixels
                  to the left of the run
    ...           the run: one palette index per pixel, to the end of
                  the record

The 8 routines are the same loop specialised on three independent
flags, so one uniform decoder covers all of them:

    bit 0 (1)  leading `skip` byte is present
    bit 1 (2)  the run stops before the right edge (the rest of the
               row is transparent). Purely an optimisation hint: the
               run length is already implied by `size`.
    bit 2 (4)  palette index 0 inside the run means transparent
               (colour-key), instead of being drawn as colour 0.

    type 8     an entirely empty (transparent) row; size is 2.

Note the two different kinds of transparency: a row is transparent
outside its run always, and *inside* the run only when bit 2 is set.
"""

EMPTY_ROW = 8


def decode_rows(data, max_rows=None):
    """data: the scanline area of a shape/frame.

    Returns a list of rows `(skip, pixels, color_key)`, or None if an
    unknown row type is met (i.e. this isn't scanline data).
    """
    rows = []
    p = 0
    while p + 2 <= len(data) and (max_rows is None or len(rows) < max_rows):
        t = data[p]
        size = data[p + 1]
        if size < 2:
            break
        if t == EMPTY_ROW:
            rows.append((0, b"", False))
        elif t <= 7:
            off = p + 2
            skip = 0
            if t & 1:
                skip = data[off]
                off += 1
            rows.append((skip, data[off:p + size], bool(t & 4)))
        else:
            return None
        p += size
    return rows


def rows_to_bitmap(rows, transparent=255):
    """Rasterise decoded rows into (width, height, [[index]]).

    Width is the widest row, which equals the real width whenever the
    right-hand columns aren't entirely transparent. The true width for
    a .G2 shape is OBT.width * 8; for a .SPR frame it is in the frame
    header.
    """
    w = max((skip + len(px) for skip, px, _ in rows), default=0)
    h = len(rows)
    img = [[transparent] * w for _ in range(h)]
    for y, (skip, px, key) in enumerate(rows):
        for i, v in enumerate(px):
            if key and v == 0:
                continue
            if skip + i < w:
                img[y][skip + i] = v
    return w, h, img
