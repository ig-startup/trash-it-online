# The scanline codec (`rle.py`) — **Confirmed**

The single most important finding: **`.G2` shapes and `.SPR` frames
share one pixel encoding**, and one blitter in `G.EXE` draws both
(VA 0x38be8, plus variants at 0x34ed8 / 0x35c9c / 0x3680c / 0x3737c /
0x37f94 that differ only in how they write pixels).

The variants, read 20.10.2026 against the machine code: `blit_rle_blend`
0x34ed8 (dst = blend[src * 256 + dst]), `blit_rle_mirror` 0x3680c (right
to left — `dec edi` — so the frame faces the other way: mode 0 with
entity `+0x40` bit 4), `blit_rle_remap` 0x37f94 and
`blit_rle_remap_mirror` 0x3737c (each pixel through the entity's remap
table, its mode `+0x20`), and `blit_rle_heat` 0x35c9c — draw mode −1:
it reads no pixel of the frame at all, each pixel the shape covers takes
the **screen's** pixel two to its right, a shimmer (`HEAT`, dead in the
game — `scn.md`). There is no vertical flip; the old names `_flip_x/_y/_xy`
and `_v2.._v5` were guesses. F.EXE has the same set (`blit_scaled`
0x29e10 its `blit_rle`; the heat one reached only from an unreferenced
`obj_draw_heat` 0x26235).

Pixels are stored as scanlines, top to bottom:

| offset | size | field |
|---|---|---|
| 0 | u8 | row type, 0-8 (index into a jump table of 9 draw routines) |
| 1 | u8 | record size in bytes, **including** these 2 |
| 2 | u8 | leading transparent pixel count — only when `type & 1` |
| … | var | the run: one palette index per pixel, to the end of the record |

The 8 drawing routines are the same loop specialised on three
independent flags, so one uniform decoder covers all of them:

- `type & 1` — a leading `skip` byte is present
- `type & 2` — the run stops before the right edge (rest of the row is
  transparent). An optimisation hint only: the run length is already
  implied by the size byte.
- `type & 4` — palette index 0 inside the run is transparent
  (colour-key), rather than being drawn as colour 0
- `type == 8` — an entirely empty row

Note the two kinds of transparency: outside the run a row is always
transparent; *inside* the run only when bit 2 is set.

There is no run-length compression at all — which is why every RLE
scheme tried in the first pass failed. The format instead scales at
draw time: the blitter walks the rows with a 16.16 fixed-point step, so
one shape is drawn at any size.

**Wide rows.** A frame wider than a byte can measure keeps the same
records with the size, and the skip, as **u16**: type, size lo, size hi,
[skip lo, skip hi], run — `FSPR/HAMSHP_E.SPR` frames 89 and 90 (320
wide), `ILSBAT.SPR` 75. The front end's other wide frames are raw `w * h`
(`formats/spr.md`), `HSHAMS.SPR`'s padded to 256 a row. `rle.decode_rows(
wide=True)`, tried first by `spr.parse` for frames over 253 wide.

