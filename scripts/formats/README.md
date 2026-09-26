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

## `.SDE` — background settings + scene sprites — **Confirmed**

Not a flat settings block: a 0x40-byte header followed by an array.

| offset | size | field |
|---|---|---|
| 0x00 | 7 x u32 | background/parallax parameters, unpacked into globals at VA 0x18255; the last two are also split into four bytes each |
| 0x3c | u16 | scene sprite count N (max 40) |
| 0x40 | N x 44 | scene sprite records |

**Verified: all 147 `.SDE` files are exactly `0x40 + 44*N` bytes**, with N
read from offset 0x3c (0 to 36 across the archive).

The array is the level's decorative sprites — `G.EXE` calls them scene
sprites (`num_scene_sprites: %d`), caps them at 40
(`Warning. Reached MAX_SCENE_SPRITES!`, VA 0x17f8b) and sorts them by the
dword at record +0x0c before drawing, so that field is a depth key. A
record is filled from a live entity at VA 0x17fa2: `+0x00` = the entity's
type word, `+0x04..+0x0f` = its `+0x24..+0x2f` (which puts x at record
+0x06 and y at +0x0a).

One header field is identified: the u32 at 0x00 feeds the horizon
calculation at VA 0x1c7ad, which scales by 20.0 in 16.16 fixed point and
clamps the result to rows 0..199. It is a background scroll reference,
not gameplay.

**`.SDE` holds no gameplay placement** — no spawns, no bell. Those are in
`.OB`.

## `.STP` — **Inferred, not decoded to meaning**

Always 65536 bytes = 256x256. A debug flag in `G.EXE` — `"/STP [1-3 |
4] : Write out .STP file, with transparency 1-3 (default is 4)"` —
shows it is *written* by the game as a debug dump, and it is read back
into a 64 KB buffer (VA 0x10be9). Rendering it as a bitmap gives a
structured grid, not a picture. Not needed to reconstruct a level.

## `.OB` — the level's startup code — **Partially decoded**

The earlier conclusion here was that `.OB` is editor data the game never
reads. The premise was right — no call to the file loader at VA 0x2df37
opens a `.OB` — but the conclusion was wrong. `G.EXE` interprets a
**spawn bytecode stream** (VA 0x1e60c), and `.OB` is that stream:

    id = *(u16*)stream; stream += 2
    find id in the class registry at VA 0x992c4
    call its constructor, which reads its own parameters off `stream`

The registry holds **47 classes** (8-byte records: `u16 id`, pad,
`u32 constructor`; terminated by id -1). An id with no entry logs
`could not find object id %d in startup code.`

Each class's payload length is its constructor's net advance of the
stream pointer (global 0x28b924). `scripts/formats/ob.py` carries the
table; `disasm.py` recovers it by tracking that pointer symbolically,
summing every `lea`/`add` from the load to the store — reading only the
last step gives wrong lengths.

**Identified classes:**

| id | what |
|---|---|
| 9, 10, 11, 12 | start position for player 1..4 |
| 13 | sprite entity; a subtype word selects the behaviour, subtype 16 is the bell |

Each player constructor (VA 0x1f513/0x1f517/0x1f51e/0x1f525 — identical
but for the player index) reads `u16 x, u16 y` and stores the spawn as
**y + 20** (VA 0x1f54f), then seeds the player entity's fixed-point
position `+0x24 = x<<16`, `+0x28 = y<<16`.

**Status: 51 of 147 files parse to exactly their length.** The other 96
desynchronise, so at least one class has a content-dependent payload
(id 13 is the suspect — its constructor branches on the subtype), and
four classes (17, 25, 29, 30) tail-call shared code and never store the
pointer themselves, so their length is still unknown. Where a file does
parse, the result corroborates itself: the four player spawns come out
clustered within a few pixels, as a four-Jack start line should be.

Open: several parsed spawns have a small negative x (e.g. -55, -130),
which either means levels carry an off-screen margin or x is relative to
something not yet found.

`.COL` is still untouched and still looks like editor data.

## Game logic

### The tile → object map — **Confirmed**

Collision is not rectangle-vs-rectangle. The level keeps one u16 per 8x8
tile naming the object that occupies it, and the lookup (VA 0x69e6a) is:

    if x < 0 or x >= [0x410484] or y < 0 or y >= [0x410482]: return 0
    return tilemap[ row_offset[y >> 3] + (x >> 3) ]

with `row_offset` a dword-per-row table at VA 0x3f5928 and the map itself
at `[0x40f330]`. 0 means empty. Entities are 112-byte records based at
VA 0x3f6178, so the returned index `i` is entity `0x3f6178 + i*112`.

Entity fields seen so far: `+0x08`/`+0x0c` 16.16 position used by the
blitter, `+0x10` behaviour function, `+0x24`/`+0x28` fixed-point x/y,
`+0x26`/`+0x2a` integer x/y, `+0x40` flag byte, `+0x4e`/`+0x50` width and
height, `+0x54`/`+0x56` draw offsets, `+0x58` linked entity, `+0x64`
shape pointer, `+0x68` draw routine.

### The bell is locked to a block — **Confirmed**

The bell does not sit at a free-floating coordinate and it is not won by
touching it. Its constructor (VA 0x33ef2) looks up the object at
`(bell.x, bell.y - 2)` through the tile map and stores it in `+0x58`;
failing that it logs `*** Bell has no block to lock to?? ***`.

Its per-frame routine (VA 0x33f58) then does nothing at all while bit 0
of the locked block's first word is set. When that block dies the bit
clears and the bell frees: it takes a new behaviour, and moves to the
block's centre and underside —
`x = block.x + block.width/2`, `y = block.y + block.height`.

So the bell is released by demolition, not reached by walking. The
timmies work the same way (`*** timmy has no block to lock to?? ***`).

### Jack's animation table — **Confirmed**

The client's poses were picked off a numbered contact sheet by eye, and
several are wrong — a frame lifted out of the middle of a sequence reads
as a different action entirely. The game keeps the real thing: a flat
array of pointers at VA 0xa11ca, **79 slots**, each pointing at a list of
u16 frame numbers into `SPR/JACKS.SPR`.

A list's length needs both bounds: the lists are packed back to back, so
one runs until the next list the array references, *and* a list shorter
than that gap ends on an `0xffff` sentinel — take whichever comes first.
The long walk cycles carry no sentinel; the short lists do.

The top two bits of a frame entry (`0x4000`, `0x8000`) are event markers,
not part of the frame number. They fall on the frames where a swing
connects.

The table is named in `scripts/formats/anims.py`. Naming it needed
someone who played the original — guessing from rendered strips got two
wrong (frames 71-90 look like a swing but are Jack reaching into his hard
hat; 140-174 look like riding something but are a fall and the jump back
up), so none of it is named from the pixels alone.

| frames | what |
|---|---|
| 1-16, 21-36 | the two walk/run cycles |
| 17-20 | skid to a halt after running |
| **37-54** | **hammer strike, sideways** |
| 47-54 | the same strike with the windup cut off — the held-button version |
| **55-70** | **hammer strike, overhead** |
| 59-70 | the overhead swing alone, in five paddings — one per hammer speed, with an event flag on the connect |
| 71-90 | reach into the hard hat |
| 113-122 | …and pull the hoover out (the two are always chained) |
| 123-138 | walking with the hoover |
| 91-100 / 100-91 | duck down into the hard hat, and come back up |
| 101-112 | hard-hat mode, moving |
| 317-322 | peering out from under the hat where the gap is too low to stand |
| 175-190 | climbing a ladder |
| 289-300 | topping out off the ladder onto the platform |
| 140-174 | a fall, and the jump back up onto your feet |
| 252-288 | air roll — carries you further sideways |
| 301-316 | hard landing and get up |
| 191-206 | carrying something above your head |
| 207-222 | pushing something along |
| 223-230 / 232-235 / 236-239 | pick an object up, throw it, put it down |
| 323-325 | a hammer lying on the ground |
| 326-328 | loading-screen animation, not used in play |

Worth reading that list for what the clone has no mechanic for at all:
ladders, the hoover, carrying, pushing, throwing, hard-hat mode, and two
distinct hammer strikes where the clone has one.

Not every slot is a frame list — slot 6 points at 0xa10d0, whose values
are too small and too repetitive to be frames.

### Objectives — **Confirmed** (from `F.EXE`)

`F.EXE` is the front end, not the editor, and it carries the mission
text for the level-select screen in five languages:

- `trash NN% to free the bell` — seen with 28, 34, 48, 58, 61, 85, 90
- `get to the bell`
- `ring the bell`
- `hit the bell`
- `collect the timmies`

So "run to the bell and win" is not the game for most levels. Which
objective a level carries, and where the percentage is enforced, is not
yet traced.

### Counters — **Confirmed**

A level-state record (pointer at VA 0x317ca8) holds the three counters
the debug print names (`timmies %d rubble %d timer %d`, VA 0x10abd):
`+0x14` timmies, `+0x0c` rubble, `+0x1c` timer. `+0x26` is a state enum
taking 2, 3, 0x10 and 0x11. Separately, the level loader counts objects
by their `.G2R` routine into 0x3f166a (static) and 0x3f166c
(destructible) — and reads neither back, so they are diagnostics.

`.G2R` really is validated to 1 or 2 only (VA 0x2d0d3): the 1/2/4/8/16
values dispatched at VA 0x33e79 are the `.OB` sprite subtypes, a
different thing.

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
| `disasm.py` | disassembly workbench over the LE image: functions, xrefs, strings, constant search, stream-advance tracing |
| `ob.py` | `.OB` startup-code decoder (partial — see above) |
| `anims.py` | Jack's animation table from `G.EXE` |
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
- `.OB`: the content-dependent record length that desynchronises 96 of
  147 files, and the four classes (17, 25, 29, 30) whose length is
  unknown. Everything else about level placement depends on this.
- Where the "trash NN%" threshold lives and what counts toward it.
- What the remaining 45 `.OB` classes are. Timmies and the king timmy
  are in there; so, probably, are the enemies and pickups.
- Physics of a collapsing structure, scoring, block strength.
