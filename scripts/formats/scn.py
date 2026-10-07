"""
Trash It (1997 DOS) — `.SCN` background textures.

CONFIDENCE: confirmed, from the renderer and by rendering.

**These notes used to say a `.SCN` was a 3072-byte lead-in followed by
320x200 screens.** Every file's size fits that arithmetic, which is why
it stood for so long, and the images it produces are recognisable — but
sheared. Slicing a 256-wide texture into 320-wide rows walks each row 64
pixels along, and a wall drawn that way is a diagonal smear, which is
exactly what it looked like in the clone.

The renderer settles it. `FUN_00018acc` (VA 0x18acc) is an affine
scanline texture mapper: 80 iterations writing four pixels each, 320 to
a row, sampling `base + (v << 8) + u` with **both indices masked to 8
bits**. The source is 256 wide and addressed 256 to a row; the caller
(VA 0x18e64) computes `base + (v << 8)` and takes its shift amounts from
the `.SDE` header, so the level's own settings drive the scale.

Layout
------

A `.SCN` is simply **256 pixels wide, `filesize / 256` rows tall**, one
byte per pixel, indexed into the merged palette (the level's `.PAL` for
the low range, `SPR/JACKS.PAL` above it — see `pal.merge`). No header,
no compression.

Across the archive there are two sizes, and both divide by 256 exactly:

| size | rows | what it holds |
|---|---|---|
| 131072 | 512 | two 256x256 textures |
| 195072 | 762 | two 256x256 textures and one 256x250 |

What the textures are varies by level. In 0C the first is a brick wall
and the second is a scene — cloudy sky, a chimney, a pylon, a fence
above a brick base. In 0D both are stone walls at different light
levels. A 256x256 texture tiles seamlessly in both directions, which the
old reading's "layers" never did: the grey band that used to repeat down
the clone's levels every 200 pixels was the shear, not a floor strip.
"""

WIDTH = 256


def decode(path):
    """
    Read a `.SCN`.

    -> (width, rows, pixels) where `pixels` is a flat bytes of palette
    indices, row-major, `width` wide.
    """
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) % WIDTH:
        raise ValueError(
            f"{path}: {len(data)} bytes is not a whole number of "
            f"{WIDTH}-pixel rows")
    return WIDTH, len(data) // WIDTH, data


def textures(path, height=WIDTH):
    """
    Split a `.SCN` into its textures, `height` rows each.

    The last one is short in the larger files (250 rows rather than 256);
    it is returned as it is rather than padded.

    -> list of (width, height, pixels)
    """
    width, rows, data = decode(path)
    out = []
    for top in range(0, rows, height):
        take = min(height, rows - top)
        out.append((width, take, data[top * width:(top + take) * width]))
    return out
