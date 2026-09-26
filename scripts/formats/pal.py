"""
Trash It (1997 DOS) — .PAL palette decoder.

CONFIDENCE: confirmed (visual render + cross-checked against
client/src/palette.js, which has real colors hand-extracted from
FWJACK.PAL / 0A.PAL previously).

Layout
------
Fixed size: 768 bytes = 256 colors x 3 bytes (R, G, B).
No header, no magic number, no footer.

Each byte is a VGA DAC value in the 0-63 range (6-bit-per-channel,
"VGA scale"), NOT 0-255. To get standard 8-bit RGB, scale by 255/63
(equivalently, ~4.048x, clamp to 255).

Confirmed by: decoding LEVELS/0A.PAL this way and rendering a 256-color
swatch grid PNG (see demo_render.py) — the resulting colors visually
match a plausible outdoor-demolition-site palette (sky blues, browns,
concrete greys), and specific values match colors already hand-picked
into client/src/palette.js (e.g. the "hard hat yellow" and "overalls
blue" families land in the same swatches).

Applies to: LEVELS/*.PAL, SPR/*.PAL (if present), FSPR/*.PAL — all
768-byte files in the archive use this same layout.
"""

def decode(path):
    """Decode a .PAL file into a list of 256 (r, g, b) tuples, 0-255 scale."""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) != 768:
        raise ValueError(f"{path}: expected 768 bytes, got {len(data)}")
    pal = []
    for i in range(256):
        r6, g6, b6 = data[i * 3], data[i * 3 + 1], data[i * 3 + 2]
        r = min(255, round(r6 * 255 / 63))
        g = min(255, round(g6 * 255 / 63))
        b = min(255, round(b6 * 255 / 63))
        pal.append((r, g, b))
    return pal


# --- palette ranges -------------------------------------------------
#
# CONFIDENCE: confirmed. The game does not use one .PAL at a time: it
# assembles the 256-colour palette from several files, each owning a
# range of indices. G.EXE's `load_pal_range` (VA 0x6a4d5) reads a 768-
# byte .PAL into scratch and copies only entries `first..last` into the
# live palette. The range comes from the sprite table (102-byte
# records at VA 0x9984c): byte +100 = first index, +101 = last. A
# first index of 0 means "this sprite brings no palette".
#
# In the shipped table exactly one of the 252 entries has a range:
# JACKS.SPR owns 151..255. So:
#
#     indices   0..150   the level's LEVELS/<name>.PAL
#     indices 151..255   SPR/JACKS.PAL
#
# This matters for backgrounds: .SCN screens use indices from BOTH
# ranges, so decoding one with the level palette alone leaves the
# upper-range pixels black — a speckled, seemingly corrupt image.
# .G2 shapes stay in 1..106 and sprites in 151..255 (index 0 is the
# colour-key), so only .SCN actually needs the merge.

JACK_PAL_FIRST = 151


def merge(level_palette, jack_palette, first=JACK_PAL_FIRST):
    """Build the live 256-colour palette the game actually displays."""
    return list(level_palette[:first]) + list(jack_palette[first:])
