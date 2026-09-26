# Trash It (1997 DOS) binary format notes

Reverse-engineered from the original game (used under the user's
written permission from Atari for personal, non-commercial use).

Method: the first pass cross-referenced byte patterns across the level
and sprite directories and got the container framing but not the pixel
encoding. The second pass disassembled `G.EXE` itself, which settled
everything: `G.EXE` is a DOS/4GW **LE executable**, so it needs an LE
loader (parse the object table, map the pages, apply the fixups) before
any disassembler sees real code. `scripts/formats/le_loader.py` does
that; the addresses quoted below are virtual addresses in that image.

Every format below is now decoded and rendered. Archive-wide check:
**all 243 `.SPR` files (5362 frames) and all 147 levels decode with
zero errors** — every frame yields exactly its declared height, every
`.WAM` is exactly `8 + 8*object_count` bytes, and every `.G2` shape
matches its object type's declared size. Run `demo_render.py`
to reproduce the proofs (background screens, the shape library, Jack's
sprite sheet, and a whole level assembled from its files).

## Confidence key

- **Confirmed**: decoded from the game's own code and verified by
  rendering / byte-exact reconstruction.
- **Inferred**: fits every sample checked, but not traced through the
  code.
- **Unsolved**: investigated, no working decode.

## The scanline codec (`rle.py`) — **Confirmed**

The single most important finding: **`.G2` shapes and `.SPR` frames
share one pixel encoding**, and one blitter in `G.EXE` draws both
(VA 0x38be8, plus variants at 0x34ed8 / 0x35c9c / 0x3680c / 0x3737c /
0x37f94 that differ only in how they write pixels).

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

## `.PAL` — palette — **Confirmed**

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

## `.SPR` — sprite sheet — **Confirmed**

| offset | size | field |
|---|---|---|
| 0 | u32 | total file size (self-referential) |
| 4 | u16 | frame count N |
| 6 | u16 | offset of the frame table (always 8) |
| 8 | N x u32 | frame offsets — **relative to byte 8**, not to the file start |
| … | | the frames |

Frame:

| offset | size | field |
|---|---|---|
| 0 | i16 | width |
| 2 | i16 | height |
| 4 | i16 | origin x (draw offset from the entity position; usually negative) |
| 6 | i16 | origin y |
| 8 | var | scanlines (see the codec above), exactly `height` of them |

The "offsets are relative to byte 8" detail is what the first pass
missed: `G.EXE` keeps a pointer to `file + 8` and indexes off that
(VA 0x2e371, 0x2e3bb), then adds 8 more to reach a frame's scanlines
(VA 0x6a596).

Verified: `SPR/JACKS.SPR` = **329 frames, all 329 decoding to exactly
their declared height**, and rendering to recognisable frames of Jack;
across the whole archive, 243/243 `.SPR` files and 5362/5362 frames.

`TRASHIT/CHAR.SPR` uses the same header but its frames are raw
uncompressed 8x8 pixels (72 bytes each) — it is the text font, not a
sprite sheet. `spr.is_font()` / `spr.font_glyphs()` handle it.

## `.G2` / `.G2R` — level shape library — **Confirmed**

A level's library of building blocks — the scenery Jack smashes.

| field | |
|---|---|
| u16 size | record size, excluding this word |
| u8 data[size] | scanlines (see the codec above) |
| … | repeated |
| u16 0 | terminator |

Shapes carry no dimensions: the game takes width/height from the
`.OBT` record of the object's type, in 8x8 tiles. Verified on
`LEVELS/0A.G2`: 62 shapes consuming the file byte-exactly, each one
decoding to exactly `OBT.width*8 x OBT.height*8`.

`.G2R` is one byte per shape, the routine that runs the object built
from it: `1` = static, `2` = destructible. Anything else is rejected by
`G.EXE` with "Invalid routine value in 'g2r'".

## `.WAM` — level geometry and object placement — **Confirmed**

| offset | size | field |
|---|---|---|
| 0 | u16 | level width in 8x8 tiles |
| 2 | u16 | level height in tiles |
| 4 | u16 | object count N |
| 6 | u16 | unused (0 in every sample) |
| 8 | N x 8 bytes | object records |

Object record: `u16 type` (index into `.OBT`), `u16 x`, `u16 y` (pixels,
top-left), `u16` unused.

Verified: `0A.WAM` is exactly `8 + 8*371` bytes, the level is 231x121
tiles (1848x968 px), and object x positions step by exactly the shape
widths.

## `.I` — per-object shape index — **Confirmed**

4 bytes per object, in the same order as the `.WAM` records. First u16
is the `.G2` shape index; second u16 is 0 or 1 (flag, meaning not
pinned down). This is the indirection that lets several objects of the
same *type* (same size/strength) wear different graphics.

## `.OBT` — object type table — **Confirmed**

8 bytes per record, indexed directly by the `.WAM` `type` field.

| offset | field | note |
|---|---|---|
| 0 | u16 graphic id | 0xffff / 0xfffe are sentinels (stored as -1; 0xfffe also sets a flag bit) |
| 2 | u16 width | in 8x8 tiles — **verified** against every shape |
| 4 | u16 height | in tiles — **verified** |
| 6 | u16 | forced to 1 when stored as 0; co-varies with field 0 in round pairs (60000/40000, 3000/200) — reads like mass/score or health/points, meaning not pinned down |

## `.SCN` — background screens — **Confirmed**

| offset | size | field |
|---|---|---|
| 0 | 3072 | lead-in block (still unidentified; not needed to recover the image) |
| 3072 | 64000 | layer 0: 320x200, 1 byte/pixel, indexed into the **merged** palette (see `.PAL` above) |
| 67072 | 64000 | layer 1 |
| 131072 | 64000 | layer 2 (only in 195072-byte files) |

## `.SDE` — per-level settings — **Inferred**

A small fixed block (max 1824 bytes) of u32 fields copied into globals
one by one at VA 0x18255; several are unpacked as four bytes each
(`>>24, >>16, >>8, &0xff`). So it is a settings record, not an array.
Individual field meanings not determined.

## `.STP` — **Inferred, not decoded to meaning**

Always 65536 bytes = 256x256. A debug flag in `G.EXE` — `"/STP [1-3 |
4] : Write out .STP file, with transparency 1-3 (default is 4)"` —
shows it is *written* by the game as a debug dump, and it is read back
into a 64 KB buffer (VA 0x10be9). Rendering it as a bitmap gives a
structured grid, not a picture. Not needed to reconstruct a level.

## `.OB`, `.COL` — editor data, not used by the game

`G.EXE` never opens a `.OB` or `.COL` file. Enumerating every call to
the file loader (VA 0x2df37) gives the complete list of what the game
reads: `PMAP.MAP`, `PMAP.PAL`, `TRASHIT.DAT`, `%s.WVL`, `%s.XMI`
(XMIDI music), `%s.STP`, and per level `%s.WAM`, `%s.I`, `%s.G2`,
`%s.G2R`, `%s.PAL`, `%s.SCN`, `%s.SDE`, plus `%s.OBT`. `.OB`/`.COL`
therefore belong to the level editor (`F.EXE`) — which is why the first
pass could not find one fixed record size for `.OB`. They are not
needed to reconstruct a level.

## How a level is put together

```
.WAM  ──► object i: type, x, y
           │
           ├─ .OBT[type] ──► width, height (in 8x8 tiles)
           └─ .I[i]      ──► shape index
                             │
                             ├─ .G2[shape]  ──► scanlines, drawn at width x height
                             └─ .G2R[shape] ──► 1 static / 2 destructible
.SCN ──► 320x200 background layers      .PAL ──► palette for all of the above
```

Sprites are separate: `SPR/<name>.SPR` + `SPR/<name>.PAL`, drawn by the
same blitter, positioned by the frame's own origin.

## Files here

| file | what |
|---|---|
| `le_loader.py` | DOS/4GW LE executable loader (objects, pages, fixups) — how `G.EXE` was read |
| `rle.py` | the shared scanline codec |
| `pal.py` `scn.py` `g2.py` `spr.py` `obt.py` | per-format decoders |
| `level.py` | assembles a whole level from `.WAM` + `.I` + `.OBT` + `.G2` |
| `export_sprites.py` | dumps a `.SPR` to PNG frames with alpha, origin in the filename |
| `demo_render.py` | runs all of the above and writes PNG proofs |

## Still open

- `.SDE` field meanings; the `.SCN` 3072-byte lead-in (it holds image
  indices, not a palette — it reuses the layers' own colours); the `.I`
  second u16; `.OBT` fields 0 and 6.
- `.WVL` / `.XMI` audio (XMIDI is a documented format; `.WVL` is not
  examined at all).
- Game logic proper: physics of a collapsing structure, scoring, the
  level-complete condition. The entity struct is 112 bytes (base
  VA 0x3f6178) with `+0x0a`/`+0x0e` = y/x, `+0x4e`/`+0x50` = size,
  `+0x64` = shape pointer, `+0x68` = routine pointer — a starting point
  if that is ever worth chasing.
