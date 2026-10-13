# `.PAL` — palette — **Confirmed**

768 bytes = 256 x (R, G, B). No header. Each byte is a VGA 6-bit DAC
value (0-63); scale by `255/63` for 8-bit RGB.

**The game assembles one palette out of several files.** `G.EXE`'s
`load_pal_range` (VA 0x6a4d5) reads a `.PAL` into scratch and copies
only indices `first..last` into the live palette. The range lives in
the sprite table (102-byte records at VA 0x9984c): byte +100 = first
index, +101 = last; a first index of 0 means "brings no palette".
Exactly one of the 252 shipped entries has a range — `JACKS.SPR`,
which owns 151..255. So the live palette is:

| indices | from |
|---|---|
| 0..150 | the level's `LEVELS/<name>.PAL` |
| 151..255 | `SPR/JACKS.PAL` |

Which asset uses which half: `.G2` shapes stay in 1..106, sprite frames
in 151..255 (index 0 being their colour-key), and **`.SCN` backgrounds
use both**. Decoding a background with the level palette alone leaves
its upper-range pixels black, which looks like a corrupt, speckled
image — it is a palette mistake, not a decode error. `pal.merge()`
builds the correct palette.
