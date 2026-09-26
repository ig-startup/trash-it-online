"""
Trash It (1997 DOS) — .SCN background screen decoder.

CONFIDENCE: confirmed (visual render). The layer images are unmistakably
recognizable (a brick wall texture, a row of buildings with lit windows,
a foreground line-art rubble layer) once decoded this way — see
demo_render.py output.

Layout
------
All SCN files observed (147 files, 2 distinct sizes: 131072 and 195072
bytes) decompose as:

    [ 3072-byte unknown header/lead-in block ]
    [ layer 0 : 320 x 200 raw indexed-color bytes = 64000 bytes ]
    [ layer 1 : 320 x 200 raw indexed-color bytes = 64000 bytes ]
    [ layer 2 : 320 x 200 raw indexed-color bytes = 64000 bytes ]   (only in the larger files)

i.e. total size = 3072 + n_layers * 64000, with n_layers = 2 (131072
bytes) or 3 (195072 bytes). This was verified across the whole archive:
every .SCN file's size matches 3072 + 64000*n for n in {2,3}, no
exceptions.

Each layer is a raw VGA mode-13h-style chunky bitmap: 320x200 pixels,
1 byte per pixel = index into the level's .PAL (row-major, no padding,
no compression). Rendered directly against LEVELS/<code>.PAL these
layers show:
  - layer 0: the main background (wall/building texture)
  - layer 1 (when present as layer 1 of 2, or as a distinct plane):
    an alternate/parallax background (e.g. lit windows at night) —
    likely composited for a lighting or day/night variant, or a
    mid-ground parallax layer
  - the last layer (in 3-layer files): a mostly-black foreground
    overlay with sparse line-art detail (rubble/debris silhouettes) —
    almost certainly meant to be drawn using color index 0 (or another
    reserved index) as transparent, layered on top of the game view.

UNKNOWN: the leading 3072-byte block. It reuses the same narrow set of
palette indices as layer 0 (mostly the same 2-3 dominant colors as the
brick texture), which suggests it's derived from/related to layer 0
(maybe a downscaled thumbnail, a compressed prefix, or leftover editor
data) rather than being unrelated header metadata — but no concrete
struct fields, dimensions, or purpose were confirmed for it. Treat it
as an opaque blob to preserve on round-trip; it is not needed to
recover the visible background images.
"""

LAYER_W = 320
LAYER_H = 200
LAYER_BYTES = LAYER_W * LAYER_H  # 64000
HEADER_BYTES = 3072


def decode(path):
    """Return (header_bytes, [layer0_indices, layer1_indices, ...]).

    Each layer is a flat list/bytes of length 320*200 palette indices,
    row-major.
    """
    with open(path, "rb") as f:
        data = f.read()

    remaining = len(data) - HEADER_BYTES
    if remaining < 0 or remaining % LAYER_BYTES != 0:
        raise ValueError(
            f"{path}: size {len(data)} doesn't match header(3072) + n*64000"
        )
    n_layers = remaining // LAYER_BYTES

    header = data[:HEADER_BYTES]
    layers = []
    off = HEADER_BYTES
    for _ in range(n_layers):
        layers.append(data[off:off + LAYER_BYTES])
        off += LAYER_BYTES
    return header, layers
