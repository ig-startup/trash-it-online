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
| 6 | u16 **mass** | forced to 1 when stored as 0; the level loader copies it to the entity's `+0x14`, and the collapse pass sums it up a pile to get the force of an impact (VA 0x69850) — **confirmed by its reader** |

## `.SCN` — background — **Partly wrong in these notes**

The layout below is right as far as it goes, and the layers do decode to
recognisable images. What is wrong is the assumption that a layer *is*
the backdrop.

| offset | size | field |
|---|---|---|
| 0 | 3072 | lead-in |
| 3072 | 64000 | layer 0 |
| 67072 | 64000 | layer 1 |
| 131072 | 64000 | layer 2 (only in 195072-byte files) |

The renderer (VA 0x18e64 and around) does not blit a layer. It walks the
buffer as **256-byte units**, addressing them `0x257634 + (index << 8)`
where the index is derived from a coordinate by a shift, and the shift
amounts come out of the `.SDE` header — `0x984c4`, which is `.SDE` +4.
The loop runs ~200 times, once per screen row. So the background is
composed per scanline, at a scale the level's own settings control, and
not from a layer taken whole.

Two things support that. Drawing layer 0 as a picture and tiling it
across a level gives a smear rather than a backdrop — which is what it
looks like in the clone today. And level 0C's layer 2 is a developer's
hand-drawn scribble (the words "I'm a" and some doodled shapes), which
no level would ever display.

Reconstructing the background properly means reading that renderer
through. Until then anything the clone draws from a `.SCN` is a
placeholder.

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

## `.OB` — the level's startup code — **Confirmed**

The earlier conclusion here was that `.OB` is editor data the game never
reads. The premise was right — no call to the file loader at VA 0x2df37
opens a literal `.OB` — but the conclusion was wrong. `G.EXE` interprets a
**spawn bytecode stream** (`FUN_0001e5c8`, VA 0x1e5c8), and `.OB` is that
stream:

    count = *(u16*)file          # the first word is a record count
    stream = file + 2
    repeat count times:
        id = *(u16*)stream; stream += 2
        find id in the class registry at VA 0x992c4
        call its constructor, which reads its parameters off `stream`

The registry holds **47 classes** (8-byte records: `u16 id`, pad,
`u32 constructor`; terminated by id -1). An unknown id logs
`could not find object id %d in startup code.`

Each class's payload length is its constructor's net advance of the
stream pointer (global 0x28b924). `scripts/formats/ob.py` carries the
table; it came out of Ghidra's decompilation, because the pointer is
walked in several steps and reading only the last one gives wrong
lengths.

**All 147 files parse to exactly their length**, consuming exactly the
number of records their header declares.

That leading count is what defeated two earlier attempts: parsing from
offset 0 reads it as a class id and everything after is off by one
record. With lengths alone and no count, 51 of 147 files happened to
resync and looked like partial success — which is the trap. The fix came
from reading the interpreter in decompiled form, where the count is one
line.

**Identified classes:**

| id | what |
|---|---|
| 9, 10, 11, 12 | start position for player 1..4 — `i16 x, i16 y`, and the game spawns at **y + 20** (VA 0x1f54f) |
| 13 | sprite entity; the word at payload +14 selects the behaviour (1, 2, 4, 8, 16 — 16 is the bell) |
| 14 | **timmy**, the collectible; locks to the block at its position exactly as the bell does |

Class 9 appears in all 147 levels; 32 levels carry all four starts. Class
14 is the most common record in the archive at 1142 — about eight timmies
a level.

### Object templates name the classes — **Confirmed**

A constructor does not describe its object inline. It passes the spawner
(VA 0x2ed96 / 0x2edbc) a 28-byte **template**, and the template's first
u16 is an index into the sprite table at VA 0x9984c, which carries the
`.SPR` filename inline. So a class's identity is just the name of the
sprite its template points at, and 64 templates cover the whole cast:

| class | spawns |
|---|---|
| 0 | `BCSAW.SPR` |
| 1 | `LEAD.SPR` |
| 6 | `CFIR` / `CWHL` / `CFIX.SPR` |
| **13** | **`BELL.SPR`** |
| 14 | `TIMMY.SPR` and `KTIMMY.SPR` — the king timmy |
| 15 | `DYNA.SPR` — dynamite |
| 17, 32 | `TIMMY.SPR` |
| 22 | `SUCKER.SPR` |
| 23 | `FORK.SPR` |
| 44 | `CRAWL.SPR` |
| 46 | `PANEL.SPR` |

`VAC.SPR` — the hoover — has a template too (VA 0xa3444), which confirms
it as an object rather than only an animation.

### The bell — **Confirmed**

Class 13 is the bell, and it is in `.OB` after all. **135 of the 147
levels carry exactly one**, at `(payload x + 11, payload y + 16)`, and
118 of those land inside the level bounds. The 12 without one are the
`T*`/`U*` files, which look like test levels.

The earlier dead end was a wrong assumption, not a wrong decode: the
subtype word at payload +14 selects which *behaviour* the bell gets
(VA 0x33e79 dispatches 1, 2, 4, 8, 16), and 16 is only the variant that
locks itself to the block underneath and waits for it to be smashed. No
shipped level uses 16 — they use 1 (90x), 8 (39x) and 2 (6x). Reading
"subtype 16 is the bell" as "the bell is subtype 16" cost an afternoon
of looking for a bell that was in front of us the whole time.

Which means the locking behaviour described above is real but not what
most levels do.

**What subtype 1 does — the behaviour 90 of the 135 levels use — is
simply "touch it and the level is over".** Its per-frame routine
(VA 0x34114) runs the usual collision helper, and when the bell comes up
touched it sets `+0x162` on the player who did it and hands off to the
code that puts the level state at 2. No percentage, no block, no gate.

So a clone that ends the level when a player reaches the bell is right
for almost every shipped level, and the elaborate locking variant is the
exception that no level actually ships. Subtypes 2 and 8 are still
unread.

### Off the map: the street, the posts and the flags — **Confirmed**

Of 255 player starts, 75 fall outside the `.WAM` bounds (-19, -98, -130, …,
and in 4M and 5M past the right edge), and 17 of 135 bells do too. They
are not mistakes: **the level stands in a street.** The floor is the
level's bottom edge at any x — when an entity's y reaches the level height
(`[0x41044c]`, rows × 8) it lands there (VA 0x609bc), whatever the tile
map says — and every off-map start sits 3 to 33 px above it. At load
(VA 0x2cf19) the street's ends are set to `(-256) & ~7` and
`(width + 0x107) & ~7`, i.e. 256 px past each side, and a PANEL.SPR post
is stood on each at the bottom edge (VA 0x2f623; frame 16, the right one
mirrored). So players walk in from the street, and some bells are out on
it.

Class 2 (FLAG.SPR, in every level) is not decoration either: it is the
player's **flag**, where he comes back to. Its constructor (VA 0x1f499;
0x1f4fe… for players 2-4) stores `x, y - 10` per player at VA 0x28b928 and
a bobbing flag entity per player at 0x28b948 (templates 0xa34ec…, one
colour each). When Jack is knocked out (state 0x2a199, slot 69: thrown up
with a random sideways kick), after 150 ticks he goes to state 0x2a2fe
(slot 64) and flies to his flag on a damped spring — `v += (flag - pos) >>
6`, then `v -= v >> 3`, capped at 16 px/tick — and once he is within
1/64 px of it and slower than 1/16 px/tick he is set down on it (VA 0x2a4a8) and stands again. The
flags are usually just off the map too, next to the starts.

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
array of pointers at VA 0xa11d2, **79 slots**, each pointing at a list of
u16 frame numbers into `SPR/JACKS.SPR`. The slot number is the argument a
state passes to `play_anim` (VA 0x21c26, `[slot*4 + 0xa11d2]`).

**Until 2026-10-06 these notes put the array at 0xa11ca**, eight bytes
early. The frame lists were right, but every slot number was two too high,
and since `states.py` names a state by looking its `play_anim` argument up
in that table, **every state was named after the animation two slots
along.** The frame-number table below was never affected; the state names
in the section after it were, and are corrected there.

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

Not every slot is a clean frame list — slot 4 (state 0x23499) points at
0xa10d0, two words before the movement-profile index (below), and runs on
into it.

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

### The timmy bin — **Confirmed, and barely used**

Timmies go into a bin, and there is one per player: classes 18, 19, 20
and 21 are the same constructor differing only in the player index they
load (0, 1, 2, 3), exactly as the four player starts do.

The bin stacks them. Its entity keeps a count at `+0x4a`, and the count
indexes a table at VA 0xa3622 that gives the pile's stage — 0 for the
first four timmies, 1 for the next four, and so on through **nine
stages**, which is exactly how many frames `TIMBIN.SPR` has. The table
turns to -1 at **52**: at that point the bin resets its count, swaps its
routine and credits the player whose index sits in its `+0x54`.

Worth knowing before building it: across all 147 levels there is
**exactly one bin**, in level 8K. Whatever the design intended, the
shipped game hardly uses it.

### What the levels are actually made of — **Confirmed**

Counting every `.OB` record across all 147 levels says plainly where the
game's content is, and it is not where the clone has put its effort:

| class | records | levels | what |
|---|---|---|---|
| 14, 32, 17 | 1142, 551, 307 | 64, 76, 61 | **timmies** — about 2000 records, far the most of anything |
| 2 | 147 | **147** | in every level, positions a player-linked entity |
| 9 | 147 | **147** | player 1's start |
| 16 | 146 | 146 | **the level's rules record** — see below |
| 13 | 135 | 135 | the bell |
| 15 | 202 | 42 | dynamite |
| 22 | 154 | 72 | the hoover's sucker |
| 27 | 93 | 22 | tellies |
| 0, 6, 1 | 61, 60, 57 | 43, 44, 42 | buzz saw, crane, `LEAD` |

The sprite table has 256 entries and the game ships art for a great deal
more than that: bombs, explosions, sparks, fire, a helicopter, a UFO, a
clock, red buttons, gates, a drain, a vending machine, and the whole
hammer catalogue. Most of it never appears in the shipped levels.

### The level's rules record — **Confirmed**

Class 16 is in 146 of the 147 levels and has the largest payload of any
class, 72 bytes. Its constructor (VA 0x1ae49) does one thing: it is a
bank of switches. Each word either sets a bit in the global option byte
at VA 0x98224 or is copied into a global of its own. This is what makes
one level play differently from another, and `scripts/formats/ob.py`
lists every field with how the 146 levels spread across its values.

Two worth calling out. The word at +0x2a is a four-way selector that
122 levels leave at 1, 14 set to 4 and 10 to 8. And +0x38 is a score:
its value is added in fives through a packed-BCD adder (VA 0x19b9d),
the arcade way of ticking a total up on screen — 40 levels leave it at
zero and the rest sit between 200 and 630.

What the individual option bits *do* is not traced yet. The field list
is the map for doing it.

### There is no percentage check — **Confirmed**

The mission text promises "trash NN% to free the bell", and the game does
compute that percentage: when an object is destroyed it increments a
counter and stores `destroyed * 100 / total_objects` into the word at
VA 0x410464 (destroyed at 0x410490, the level's object total at 0x41045a).

**Nothing reads it back.** It is a display value. The gate is the bell's
locked block and nothing else: demolish the block the bell sits on and the
bell frees, whatever the percentage happens to be. The NN% in the
front-end text is authored per level to describe roughly how much has to
come down to get at that block — not a rule the game enforces.

### How a structure collapses — **Confirmed, and these notes had it wrong**

This is the game's own mechanic, the clone has nothing like it, and the
earlier version of this section concluded the opposite of the truth:
*"a blow stops at the block it lands on; structures do not collapse in any
level the game ships"*. They do. The reasoning that led there was that the
`.WAM` loader never writes the support counts the damage routine divides
by — which is true, and irrelevant: **the engine recomputes them every few
frames.** A field being absent from the level files says nothing about
whether it is filled at run time.

The game's own word for a falling structure is in one of its debug
strings, *"looked for ccs off end of list"* — a `ccs` is a connected group
of blocks that has come loose.

Every object carries **hit points** in its entity at `+0x18`, from `.OBT`
field 0, and a **mass** at `+0x14`, from `.OBT` field 6 (forced to 1 when
the table stores 0, VA 0x2d028 — the reader below is what settles what
that field means). A hit does not remove a block; it applies a **force**,
and the force travels through the structure:

    damage_down(object, force):                 # VA 0x689e6
        if object.hp == -1: return              # indestructible
        supports = object.+0x5e                 # blocks directly beneath
        if supports and force / supports > 2:
            for each occupied cell in the row under it:
                damage_down(that object, force / supports)
        if force < object.hp: object.hp -= force
        else:                 destroy(object)

    damage_up (VA 0x68a91) is the mirror image — the row above, and the
    count at `+0x5c` — so a blow from below pushes up through a structure.

A blow is therefore **divided among the supports at each step** and stops
when a share drops to 2 or less. A pillar passes a hit straight down; a
wide base soaks it up. That division is the whole feel of the demolition,
and it is the single biggest thing the clone is missing.

The two counts are refreshed by a flood up from the bottom row of the
collision map (VA 0x69b88 → 0x69c07): for every object the ground holds
up, transitively, `+0x5c` = how many objects touch it from above and
`+0x5e` = how many from below. Anything the flood does not reach is loose,
and a second flood (VA 0x69660 → 0x698c2) collects the loose ones into
groups through their contacts. Both run at most **every fifth frame**, and
only if a dirty flag (0x410474, set by any hit, destruction or landing)
says something changed (VA 0x69f04).

A group falls as a rigid body (VA 0x690d6): `vy += 10000`, i.e. 0.15
px/frame² — *not* Jack's 0.28125 — capped at 4 px/frame, with the members
riding at fixed offsets. It is stamped into a second copy of the collision
map each frame (VA 0x69386) and unstamped at the start of the next (VA
0x694ad), which is how group-versus-group contact is tested (VA 0x691e9).

When it lands (VA 0x68b2d) the numbers are:

    speed  = (vy >> 16) + 1                     # 1..5 whole pixels
    weight = the mass of the object hit plus everything stacked on top of
             it, flooded upward                 # VA 0x69850
    force  = weight * speed / 4

applied **both ways** — down into what was hit and up into the block that
hit it — so a collapse damages itself on impact. The group's y is snapped
to the 8px grid and its vy *halved* rather than zeroed, which is the
bounce. Two engine limits are worth knowing before building on this: at
most **50 groups** at once and **40 members** before a group chains a
continuation record.

The other way force arises is any moving sprite striking a block (VA
0x1f28c, and VA 0x1f36d for the other axis):

    force = sprite.mass << (|speed| - 2)        # mass is +0x4c here

needing a speed of at least 3 (5 on the other axis, where the force is
also halved). Jack's own mass is 25 (VA 0x21610); a class-15 dynamite is 5,
or 50000 once lit (VA 0x20bc4 / 0x20bf4) — which is how a stick of
dynamite flattens a building that a hammer chips at.

Destroying a block (`remove_object_data`, VA 0x68724) does not simply
remove it: it clears the block's tiles from the collision map (VA
0x68980), turns the block itself into flying rubble with a randomised
velocity, and spawns a dust puff that cycles through eight variants (VA
0x1f784). How far the rubble is thrown comes from two bit masks, and both
the hammer catalogue (fields +0x34 / +0x38) and the landing impact (a
table of eight masks at VA 0xa4970, indexed by bits of `weight * speed`)
feed them — always values of the form 2^n - 1.

**What a hammer blow carries** — **Confirmed** (found in Ghidra, from the
`damage_down` caller side rather than the hammer record's side). The
strike state at VA 0x23cef reaches the blow at its impact frame:

    t     = 6 - hammer_entity.+0x5a          # frames from swing start to impact
    force = lo + ((hi - lo) >> t)            # VA 0x23d54..0x23d66
    lo    = wielder.+0x74                    # hammer record +0x3c
    hi    = wielder.+0x78                    # hammer record +0x40
    VA 0x23d93 -> 0x1f83d -> 0x1fcd3 -> 0x1f905 (walks the blow's box cell
    by cell, calling damage_up 0x68a91 / damage_down 0x689e6 on each block)

**The ramp is a charge, and the hammer key is held to build it.** Pressing
the key from a standing or walking state enters the windup, VA 0x23a27,
which plays slot 6 — the first frames of the sideways strike (37-43) —
but does not let it run: while the key stays down (VA 0x2110d), the
animation frame index (player `+0x10`) steps only when the entity's frame
timer `+0x4a` reaches `+0x58`, and every step raises `+0x58` by one. It
starts at 1, so the frames come 1, 2, 3, 4, 5, 6 ticks apart and the
index caps at **6 after 21 ticks** (VA 0x23a66-0x23a98). Jack can creep
meanwhile, `vx ± 0x8000` per tick.

Letting go (VA 0x23b61) copies the index into Jack's `+0x5a`, switches to
the strike state VA 0x23cef, and that plays slot **15 + charge** — slots
15-21, the follow-through 47→54→47 in two lengths. At its impact frame
the formula above runs with `t = 6 - charge`. A full charge carries `hi`;
a tap carries `lo + (hi-lo)/64`. For a sledge v1 that is **10 against
150**. (A full charge also picks a different sound, 0xe rather than 0xc,
VA 0x23b88.) Two things this overturns:

- **Record `+0x40` is the hammer's maximum force, not (only) a price.** It
  is the top of the ramp. The joke hammers at 4294967295 are not "unbuyable",
  they flatten anything — which fits them being the silly ones. Whether the
  shop also reads it as a price is not settled; the *blow* certainly does.
- **`+0x3c` is the minimum**, the floor of the ramp (8 for a sledge v1,
  100 for most late hammers).

**Where the blow lands** (VA 0x1f83d → 0x1f905): from Jack's own position
— his feet, the entity point every sprite is drawn from — the hammer
record's `+0x4a` ahead and `+0x4c` down (53 and -12 for a sledge v1), then
outward in 8 px steps (0, +8, -8, +16, …) for as far as `+0x4e` across and
`+0x50` down allow, each step one cell of the collision map
(`0x69e6a` is a plain `>> 3`). A sledge's extents are 4 and 7, under one
step, so **its blow is a single 8x8 cell**, and the "up to 3 blocks" its
type allows never comes into play. That cell is where the head is drawn
(next paragraph), 24 px past the end of Jack's own frame.

**The hammer is its own sprite.** Jack's frames do not include it. The
hammer entity (template 0xa3038, routine VA 0x20890) copies Jack's
position every frame and shows a frame of `SPR/SPA.SPR` taken from a list
that runs alongside each animation: `play_anim` puts `[slot*4 + 0x9ff88]`
in the player's `+0x58`, and the hammer shows entry [Jack's frame index].
Standing, running and skidding all use 0xa10b0, the hammer on the
shoulder (SPA frames 0-15); the strike runs 26 → 33, and frame 33 —
54x16, anchored 14 px ahead of Jack — puts the head exactly over the
blow's cell. The hoover's slots have no list. `anims.hammer_lists()`
reads them.

The top two bits of a list word are sticky switches (VA 0x20905):
`0x4000` hides the hammer from that frame on, `0x8000` shows it again —
slot 70, drawing the hoover, hides it at the frame the hammer has gone
into the hat, and slot 71, putting the hoover back, shows it as it comes
out. Ducking into the hard hat (slot 12) hides it too (VA 0x20940), and
nothing in the hat states brings it back: the one other place that does
is the way into a swing, state 0x23499 (VA 0x234c3). So after the hat,
Jack's hammer is away until he next swings.

The hoover itself is one strip each way, not the two halves the clone
used: `UP` held with `BUT1` pressed starts 0x2a88c (slot 70, sheet frames
71-81 then 122-113), which ends in 0x24e55, the hoover held (slot 28);
a direction walks it, 0x250d9 (slot 29); and the same keys again run
0x2ab7a (slot 71, the strip backwards) back to standing.

The hammer type (record `+0x48` low u16, wielder `+0x88`) then shapes it
at VA 0x1fcd3: types 1 and 4 halve the force, and every type also sets
how many blocks one blow may strike (1..3; type 4 picks 2 or 3 at random).
Type 0 depends on two flag bits passed in, not read further. The
upper u16 of that same u32 (53 for a sledge v1, 51 for a warhammer) lands
in the wielder's `+0x8a`, which VA 0x1f83d uses as the blow's horizontal
reach in front of Jack — so reach is per-hammer too. Block hit points run
25..5000 in the shipped levels (24464 is the heavy stuff), so a sledge v1
at full ramp (150) clears the weak half and has to be swung repeatedly at
the rest — which is the design.

The `shr 0x12` at VA 0x1fba6 is something else: it reads `force >> 18`
(clamped to 63 and 500) to pick the dust and the camera shake, and it is
zero for any ordinary hammer. Only dynamite and the joke hammers reach it.

**The overhead strike hits sprites, not blocks.** Its force (above) goes
to VA 0x1fd94, which builds a box from the hammer entity's `+0x58`,
`+0x5c`, `+0x5a` (record `+0x5e`, `+0x62`, `+0x60`; for a sledge v1, 40
ahead, 13 up, 27 wide, 14 tall — mirrored when facing left, VA 0x2f1d7)
and hands it to the sprite search at VA 0x2f156. That walks the sprite
list, keeps those whose class mask meets 4, and for up to 32 of them sets
the attacker (`+8`), the force (`+0x4e`) and the hit flag (`+0x40 |=
0x80`). Three things read that flag: a clock, `CLOK.SPR` (VA 0x11edd —
it bursts into twelve pieces and is gone), a hanging sign, `DIS.SPR`
(VA 0x5f3c0 — it swings, amplitude `force >> 5` clamped to 3..32), and a
creature whose state goes to VA 0x14935 with sound 0x84 (not yet named).
The hammer-lit kind of dynamite reads it too (see Dynamite).

Not yet read: how the wielder's +0x74/+0x78 ever differ from the record
once a hammer is upgraded, and what the strike state's other exits do
(VA 0x23dbc goes straight back into the windup if the key is still down).

`scripts/formats/ccs.py` reproduces all three floods over the real level
files, which is how the above was checked rather than argued: across
**all 147 levels and 51727 objects, not one cell is claimed by two
objects** — the game's own `"overwritten block"` complaint never fires —
and only **3 objects in 2 levels are loose at load** (8B has two, 9I one),
each hovering exactly one tile above what should hold it up. A wrong
reading of the map layout or the contact test would have thousands of
blocks falling the moment a level opened.


### Jack's state machine — **Confirmed**

Jack is not a handful of flags. He is **46 states and 174 transitions**,
each state a function, and the clone's player logic — written from the
outside in, by guessing at what the animations implied — is where every
animation complaint from play-testing came from.

An entity's current state lives at `+0x10`, and switching is always the
same pair:

    mov edx, <state function>
    call 0x21d30          # set_state(entity in eax, routine in edx)

A state announces its animation the same way, `mov eax, <slot>` then
`call 0x21c26`, and the slot indexes the table `anims.py` already reads
and that play-testing already named. So each state can be named by what
Jack looks like while he is in it.

Two states are hubs: **0x22892**, which 19 transitions lead to and which
sets animation slot 1 — the single standing frame, so it is simply
*standing* — and **0x256e9** with 29. Everything comes back to one of them.

With the slot numbering corrected (see the animation table) the graph
reads as one coherent machine rather than a scatter of names:

| state | slot | what |
|---|---|---|
| 0x22892 | 1 | standing — the hub |
| 0x22275 | 0 | running (cycle A) — `xor eax, eax` before `play_anim`, which is why `states.py` sees no slot |
| 0x236b9 | 3 | walking (cycle B), at profile 0's 1.53 px/tick; the hammer key from here enters the windup |
| 0x2266d | 2 | skidding to a halt |
| 0x23a27 | 6 | **hammer windup** — charges while the key is held (not found by `states.py`: its slot is a constant, but it is entered by `mov edx, 0x23a27` from three places) |
| 0x23cef | 15+charge | **hammer strike** — computed slot, which is why `states.py` cannot name it |
| 0x25813 | 31 | in the air — horizontal air control lives here (VA 0x2582d-0x25909) |
| 0x25a3e | 32 | hitting the ground |
| 0x24346 → 0x24727 → 0x2498a | 12, 22, 23 | duck into the hard hat → hat, still → hat, moving |
| 0x244c0 | 13 | come back up out of the hat → standing |
| 0x25bda → 0x299b6 | 33, 60 | climbing a ladder → topping out onto the platform |
| 0x25dfc → 0x26167 | 34, 35 | a long fall, two parts |
| 0x29828 | 58 | hard landing and get up |
| 0x2820b | 38 | pushing something along |
| 0x29072 | 55 | air roll |

`scripts/formats/states.py` extracts the whole graph, and will draw it
with `--dot`.

The note that used to stand here — *"the hard-hat animations belong to no
state"* — was an artefact of the slot offset. They belong to three states
(0x24346, 0x24727, 0x2498a, plus 0x244c0 to leave), and the hat is a
mode in the sense that those states loop among themselves until Jack
comes back out.

### Movement and gravity — **Confirmed**

Velocities are 16.16 fixed point, in pixels per frame, and every moving
entity goes through one shared step (VA 0x22d31):

    x += vx                                    # entity +0x24 += +0x30
    if not on the ground: vy += 0x4800         # entity +0x34, 0.28125 px/frame²
    if y - fall_start > 0x1660000: …           # +0x68 records where the fall began

**A fall longer than 358 pixels is special-cased** — the entity's `+0x68`
holds the y it started falling from, and crossing that distance branches
away before the normal landing code.

Horizontal movement is **not** a velocity set from the key, which is what
the clone does. It accelerates (VA 0x257c0):

    if vx > -maxspeed:  vx -= accel            # still speeding up
    else:               vx -= (maxspeed + vx) >> 5   # ease onto the cap

so Jack builds up speed and eases into his top speed rather than starting
and stopping dead. `maxspeed` is the player struct's `+0x14` and `accel`
its `+0x1c`; the struct is 360 bytes, four of them from VA 0x28b97c, and
the current one is cached at VA 0x28bf2c.

**Top speed and acceleration belong to the animation, not to Jack.**
`play_anim` (VA 0x21c26), whenever the slot changes, looks the slot up in a
u16 index at VA 0xa10d4 and copies a 12-byte record from VA 0xa1172 into
the player: `+0x14` top speed, `+0x1c` acceleration, `+0x20` the rate used
when pushing against the current direction. There are eight records:

| profile | top speed | accel | turn | used by (slots) |
|---|---|---|---|---|
| 0 | 100000 (1.53 px/tick) | 4000 | 8000 | most of them: walk cycle B (3), the windup and strikes (6, 15-21), the hat (22, 23), the hoover (28, 29), in the air (31), carrying |
| 1 | 350000 (5.34) | 12000 | 12000 | the run (0, state 0x22275), standing (1), skid (2), slot 5, into and out of the hat (12, 13), air roll part 1 (55) |
| 2 | 200000 (3.05) | 10000 | 10000 | 30, hitting the ground (32), 49, 74 |
| 3 | 45056 (0.69) | 4000 | 8000 | 43, 63 |
| 4 | 200000 | 8000 | 10000 | pushing (38) |
| 5 | 362000 | 12000 | 12000 | air roll part 2 (56) |
| 6 | 700000 | 12000 | 12000 | 64 |
| 7 | 1400000 (21.4) | 12000 | 12000 | air roll part 3 (57) |

So the run's top speed is set from *standing* (slot 1 already carries
profile 1), and a strike, the hat or the hoover drops the cap to 1.53
px/tick — the `>> 5` ease above is what bleeds
the excess off when that happens. `initialise_a_player` (VA 0x21337) only
seeds `+0x1c`/`+0x20` with 12000 before the first `play_anim` replaces
them. The pointer it puts in `+0x14` is overwritten the same way.

Friction is in the shared step, every tick, keys or no keys: `|vx| > 399`
→ `vx ∓ 2000`, else `vx = 0`.

Letting go of a run drops into the skid, VA 0x2266d, which moves Jack
itself rather than through the shared step and brakes harder: `vx ∓ 5000`
a tick, and once `|vx| < 10000` it zeroes `vx` and hands over to standing.
Pushing the other way brakes by the profile's turn rate instead and, once
`vx` crosses zero, goes straight back into the run. The skid's four frames
step every fourth tick and hold on the last. Running into a wall during
it bounces him: `vx = -vx / 4` (VA 0x227ea).

**The tick is the display's vertical retrace.** `game_main` (VA 0x2c52c) loops
on 0x2cb6e, which waits for retrace (port 0x3da), then runs the logic frame
(VA 0x2cbb9) once — or, if the machine has fallen behind, `elapsed_ms /
13` times, clamped to 1..4 and only changed when two measurements agree
(VA 0x10ad0; the millisecond clock is the PIT read at VA 0x76f26). Both
video set-ups in the binary are 480-line modes — VESA through `0x4f02`,
and mode 13h reprogrammed with misc-output `0xe3` (VA 0x61fd1), the 320x240
"mode X" timing — and those retrace at **60 Hz**. A 30 Hz PIT handler also
exists (divisor 0x9b5c at VA 0x60ccd, handler 0x685e3) but nothing calls
its installer directly. So: 60 ticks a second on a machine that keeps up,
with a catch-up step of 13 ms (≈77 Hz) when it does not.

### Dynamite — **Confirmed**

Class 15's constructor (VA 0x1d2d5) reads the word at payload +14 and
makes one of two sticks — the clone's exporter used to read it as "a
linked pair", which it is not:

| +14 | template | state | lit by | count |
|---|---|---|---|---|
| 1 | 0x98c84 | 0x1d405 | a hammer: it reads the sprite hit flag (`+0x40 & 0x80`) the **overhead** strike sets (sound 0x58) | 63 |
| 2 | 0x98ca0 | 0x1d7bb + a sparking child (0x98cd8) | **Jack touching it**: its event type (template `+0xa`) is 5, and outcome 5 of Jack's event list (0xa2f48, an array by type) is VA 0x1d7e1 | 139 |

Once lit: 35 ticks of the stick hopping (offset tables 0x98d3c/0x98d6a),
a flame (0x98cbc, state 0x1d584) for 25 more (0x98db2), then a countdown
of ten steps of eleven ticks (VA 0x1d60b) — about 170 ticks, 2.8 s. The
blast then:

- calls the hammer's blow routine (VA 0x1f8c5 → 0x1f905) at the stick
  with force **20,000,000**, extents 8 and 8 — the 3x3 cells around it —
  up to 4 blocks, flags 3 so it travels **down and up** (damage_down and
  damage_up), and rubble masks 0x3ffff;
- runs a sprite search 70 px either way (VA 0x1d8d1) that sets the hit
  flag, force 0x4001, on what it catches — which lights the next stick;
- shakes the screen by 30 and plays sound 0x59.

The 3x3 reach is small: a stick has to be against what it is meant to
bring down. Sticks are physical sprites (VA 0x1f098, with the same `vx =
-vx/4` off walls as Jack's skid), and the way to get one there is to
carry it — see "Carrying and throwing" below. A lit stick can still be
picked up: lighting clears bit 2 of its category, not bit 0.

The other dynamite (template 0xa011c, VA 0x20b84 — spawned by the
`DIS.SPR` sign and by one more object) is a different thing: when "lit"
it has mass 50000 and smashes through what it lands on, and nothing
lights it after it is made.

### Controls and the jump — **Confirmed**

The game asks for six keys per player, in this order (VA 0x912c9):
LEFT, RIGHT, UP, DOWN, BUT1, BUT2 — and the input word the states test
(`0x28bf36` held, `0x28bf34` just pressed, copied from the player's
`+0x24` / `+0x28` each tick, VA 0x218a0) carries them as bits 1, 2, 4, 8,
0x10, 0x20. Bits 0x40 and 0x80 are two more buttons used when the
player's control mode (`+0x166`) is 4 or more.

| action | test | input |
|---|---|---|
| jump | VA 0x20e9f, from standing, running, skidding | BUT2 (0x20) pressed |
| duck into the hard hat | VA 0x22a66 | DOWN alone, pressed |
| the hoover | VA 0x2371f | BUT1 (0x10) pressed with UP held — unless the level's option bits 2 / 4 at 0x98224 forbid it |
| sideways windup | VA 0x2110d | button 0x80 (mode ≥ 4), or BUT2 (mode 2) |
| overhead windup | VA 0x21185 | button 0x40 (mode ≥ 4), or BUT2 with a direction (mode 2) |

**Where the input comes from.** 0x6b79b gives each player a device
(`+0x2a`) and a control mode (`+0x166`): the keyboard is device 1, mode
2, read by 0x6bbef as exactly those six bits (LEFT excludes RIGHT, UP
excludes DOWN); device 2 is the analogue joystick on port 0x201 (two
axes, two buttons), also mode 2; the GrIP pads are mode 6, with four
buttons 0x10-0x80 that 0x6bcec can remap. Demo playback is mode 6 too
(0x17956). Nothing ever sets 0x40 or 0x80 from a keyboard — so on the
keyboard every action is a combination of the six, and the raw `& 0x40`
tests (picking up from standing, VA 0x22ad1, and from the air, 0x22e89)
are pad-only.

### The keyboard layout, state by state — **Confirmed**

Read off every input test in the state code (`held` is `0x28bf36`,
`pressed` is `0x28bf34`). The hammer is **a mode**, not a button: Jack
starts empty-handed, BUT1 takes the hammer out of his hard hat and puts
it back, and BUT2 is the jump without it and the swing with it.

Empty-handed, standing (0x22892) or running (0x22275):

| input | goes to |
|---|---|
| LEFT / RIGHT | run (cycle A, profile 1) |
| BUT2 pressed | jump (0x22b91) |
| BUT1 pressed | hammer out of the hat (0x22fa5, slot 11) → standing with it (0x23499) — or 0x263a7 (slot 42) when `+0x9a` is set; level option bit 1 forbids it |
| UP held + BUT1 pressed | the hoover (0x24bb6 → 0x24e55); level option bit 4 forbids it |
| DOWN pressed alone, standing | into the hard hat (0x24346); at the top of a ladder, down it (0x29b15) |
| UP held, at a ladder | climb (0x25bda) |
| DOWN held alone, **running** (arrow let go, still moving) | **pick up** (0x267e3, via 0x20ee0) |
| UP held, running | push (0x2820b) |
| UP held, standing | 0x28691: the pushing stance, still — holds on to a cannon rolling at him (see Pushing) |

With the hammer out (0x23499 standing, 0x236b9 walking — cycle B,
profile 0, so slower):

| input | goes to |
|---|---|
| BUT2 held | sideways windup (0x23a27) |
| BUT2 held + LEFT/RIGHT | overhead windup (0x23f0f) — so walking with it, BUT2 always gives the overhead one |
| BUT1 pressed | hammer back into the hat (0x2320a, slot 10) |
| UP held + BUT1 pressed | the hoover (0x2a88c) |
| DOWN alone | 0x27ff7: clears `+0x9a`, hides the hammer entity — lays it down? (not traced further); option bit 2 forbids it |

In the hard hat (0x24727): UP pressed comes out (0x244c0); BUT2 pressed
goes to 0x26539 (slot 43) or 0x2a199 (slot 69) depending on 0x60c25.

With the hoover (0x24e55): LEFT/RIGHT walk with it (0x250d9); UP + BUT1
puts it away (0x2ab7a); BUT1 alone goes to 0x25468 (slot 9); DOWN alone
calls 0x28035, which spawns a sprite thrown upward at -2 px/tick —
emptying the bag? (not traced). Option bit 8 forbids both.

Carrying: see "Carrying and throwing" — DOWN puts down, UP aims, BUT1 or
BUT2 throws. In the air: DOWN held + BUT2 pressed goes to 0x2b3ac (not
traced).

The level's option byte (0x98224) switches actions off: bit 1 the
hammer, 2 the hammer's DOWN action, 4 the hoover, 8 the hoover's.

The clone plays this layout with Z as BUT1 and X (or Space) as BUT2.
Not yet in it: the hammer's and the
hoover's DOWN actions, and the hat's BUT2. Two choices are its own:
putting a carried thing down takes a fresh press of Down (the game tests
Down held, so keeping it held after the lift would drop it at once), and
the level's option byte is not applied.

### Carrying and throwing — **Confirmed** (except where noted)

**What can be picked up** is the template's business: Jack's search
(0x26971 → 0x2f0ab) walks the sprite list with his own template's search
mask (`+0x10`) set to 1 for the call, so it takes what has bit 0 in its
category word (template `+0xc`). In the cast: the hammer-lit dynamite
(0x98c84), `LEAD.SPR`, `CSAW`/`BCSAW`, the fire-extinguisher dynamite
(`CFIR`, 0xa011c), `TIMMY`, `TOMMY` and `KTIMMY` — and *not* the dynamite
that lights at a touch (0x98ca0, category 0x100).

**Taking hold** (0x21d51): Jack's frame and the object's must overlap
(0x2ef85), and his grab point — 11 px ahead of his feet, 5 up (VA
0xa0288) — must fall inside the object's frame (0x2dcb3). Then the two
are linked both ways (`jack[0] = obj`, `jack+0x41 |= 2`; `obj[0] = jack`,
`obj+0x41 |= 4`), and Jack's velocity becomes the average of his and the
object's.

**The states**, slot numbers as `play_anim` has them:

| state | slot | frames | what |
|---|---|---|---|
| 0x267e3 → 0x26971 | 44, 50 | 223-224 | bend for it; searches every tick while the button is held |
| 0x26c6a / 0x26e2c | 39, 51 | 223-230 | lift it |
| 0x26fe0 | 40 | 231 | standing, holding it overhead |
| 0x270e1 | 37 | 191-206 | walking with it |
| 0x27a94 | 48 | 191-206 | in the air with it |
| 0x27356 | 45 | 223-230 | put it down |
| 0x2767d | 47 | 232-235 | take aim |
| 0x27954 | 41 | 236-239 | let fly |

From standing with it, 0x20f1d decides: on the keyboard layout (mode 2)
DOWN puts it down and UP takes aim; on a four-button pad (mode ≥ 4)
button 0x40 aims, 0x40 with DOWN puts down. **Picking up** itself is
raw button 0x40 from standing and skidding (VA 0x22ad1, 0x227af) —
pad only — and, on the keyboard, DOWN held alone while running (0x225e1
via 0x20ee0), which is also what keeps the bend going. See "The
keyboard layout" below.

**The throw.** While he aims, the frame index (`+0x10`) steps 3, 8, 13
ticks in (`+0x58` growing by 5); at the last one the arc is drawn
(0x15bcb). Each tick a direction ahead or back moves the reach index
`+0x74` (0..31, from 16) and Up or Down the lift index `+0x76` (0..7,
from 4). The aim ends when the button test 0x20fe1 fails — in mode 2 a
press of BUT1 or BUT2. The object leaves at

    vx = ±reach[+0x74]   0.5 … 3.0 px/tick in 32 even steps (VA 0x93eb0)
    vy = -lift[+0x76]    0.5, 1.0 … 4.0 px/tick (VA 0x93f30)

from 10 px ahead of him and 41 up; the arc steps it with `vx` losing
2000 a tick and `vy` gaining 0x4800, for at most 68 ticks. Release
(0x27954 → 0x221b9) first checks the object can move a pixel ahead —
against a wall it is not thrown. In flight it is the sprites' shared
step 0x1f098: off a wall `vx = -vx/4`; landing slower than 1.5 px/tick
it settles, faster and it calls the object's own routine (a bounce in
the clone — **ours**). Where a carried object sits over his head is not
traced; the clone puts it on his head, 41 px up.

The jump (state 0x22b91, slot 5 — frames 6-12) starts at `vy = -4.5`
px/tick. From its eighth tick, while the key is held and Jack is still
rising, it adds lift: `vy -= boost`, the boost starting at 0x5400 and
falling by 0x6f0 a tick until spent (VA 0x22bf8-0x22c2d). A tap clears
36 px; a held jump about half as much again.

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

### A block's entity, and the frame it lives in — **Confirmed**

The level's objects live in one array of 112-byte entities at VA 0x3f6178,
indexed from 1 (index 0 means "no object", which is what an empty cell in
the collision map holds). The level loader (VA 0x2cce9) fills them, and
these are the fields the mechanics above use:

| offset | field |
|---|---|
| 0x00 | flags; bit 0 alive, bit 2 reached by the ground flood, bit 4 free to be grouped, bit 5 group head, bit 6 already in a group, bit 7 counted by the weight sum |
| 0x02 | `.WAM` type — the `.OBT` index |
| 0x04 | vy, 16.16 (on a group head: the whole group's) |
| 0x08 / 0x0c | y / x, 16.16 |
| 0x10 | height in pixels, 16.16 |
| 0x14 | **mass**, from `.OBT` field 6 |
| 0x18 | **hit points**, from `.OBT` field 0; -1 is indestructible |
| 0x1c / 0x20 | while falling: this member's fixed offset from its group |
| 0x44 | the object's own id, as stamped into the collision map |
| 0x46 / 0x48 | tile x / tile y |
| 0x4a / 0x4c | width / height in tiles |
| 0x4e / 0x50 | width / height in pixels |
| 0x5c / 0x5e | objects touching it from above / below |
| 0x64 / 0x68 | its `.G2` shape, and the routine its `.G2R` byte selects |

A group head is one of these same entities with bit 5 set, borrowing
`+0x30`/`+0x34` for its member array, `+0x38`/`+0x3c` for the list of
members with nothing beneath them, `+0x52` for the group's total mass,
`+0x56` for the member count and `+0x40` for the continuation record once
it passes 40 members.

The collision map is one u16 per 8x8 cell with a row stride of the level's
tile width, and the row table at VA 0x3f5928 is simply `row[i] = i *
stride` (VA 0x69eb3). There are two of them: the live map at 0x40f330 and
a provisional copy at 0x40f334 that a falling group is stamped into.

The frame is one function, VA 0x2cbb9, and it calls in this order:

    0x135fc  0x162c7  0x2bfda  0x1c821
    0x68b2d   <- the structural pass: falling groups, landings, rebuild
    0x20409  0x2043c  0x2eadb  0x6b90f  0x6b400  0x2d1b5  0x1e1ca
    0x1e16e  0x60e82  0x6b533  0x15ccd  ...  0x2c911  0x2f9ce

so the structures settle *before* the sprites move, and 0x2d1b5 (which
builds the draw list by testing every object against the camera) runs
after both.

### What a destroyed block becomes — **Confirmed**

`remove_object_data` (VA 0x68724) keeps the block's entity and turns it
into **rubble**: it swaps the draw routine from 0x2d285 (opaque, through
0x38be8) to 0x2d381, which draws through 0x34ed8 — a blit that writes
`dst = table[src * 256 + dst]` with the 256x256 blend table at 0xbd4e4,
so the rubble is **see-through**. Its state becomes 0x60f60:

- it flies with a random push (`vy = -((rand & mask) + 0x4e29)`, `vx = ±(rand
  & mask)`, the masks those of "What a hammer blow carries") and falls at
  **5000 a tick** (0.076 px/tick²) — *through* everything, to the bottom of
  the level (`0x41044c`), not onto the blocks below;
- on the bottom it bounces, `vy = -(vy / 4)`, puffs dust (0x6125c,
  `DUST.SPR`) and comes to rest;
- resting, it counts down `+0x60` from **2000 ticks** (about 33 s) and every
  tick puts itself on the rubble list (0x3f3390, count 0x3f4022) — the list
  the hoover reads;
- when the count runs out (0x61205) it sinks into the floor a pixel a tick
  until it is gone.

A second mode (`0x41044e`, state 0x6109e) sends rubble flying sideways
towards a point instead; not traced.

### The hoover — **Confirmed**

The hoover is a sprite of its own, `VAC.SPR` (template 0xa3444, made for
each player at VA 0x21616 and kept at the player's `+0x4c`), and like the
hammer it follows Jack and shows a frame from a list per animation slot
(table 0xa47c4, indexed by the frame index): slot 70, drawing it, shows
nothing until entry 12 (`0x8009` — show, frame 9) and then frames 9 → 0;
slot 28, held, frame 26; slot 29, walking, frames 10-26; slot 71, putting
it away, frames 0-9 then `0x4000` (hide). Showing plays sound 0x16, hiding
0x17.

From frame 10 on it **sucks** (VA 0x617xx → 0x61472): a box 32 px wide
starting **40 px ahead** of Jack (72 px when facing left: `x - 0x48`), at
`y - 8`, tested against **the rubble list only**. A caught piece (state
0x61518) moves an eighth of the way to the nozzle across and a quarter
down each tick while its height shrinks by a quarter a tick, then its
width; at 4 px it is gone and counted (0x61327: area / 16). Timmies are
not on that list — the hoover does not take them.

### A falling block on Jack — **Confirmed**

Every tick (VA 0x21aef, from Jack's routine) 0x60a00 looks along Jack's
width in the **falling** map (0x69fdf reads the provisional map 0x40f334,
where moving groups are stamped) for a solid block over him:

- in the air: rising, his `vy` flips downward; falling, he gets half the
  block's `vy` on top of his own;
- on the ground without the hat: the block goes in the player's `+0xac`
  and Jack enters **0x29c92** — pinned; each tick the block's descent since
  contact is his squash, `+0x52` (height) down by it and `+0x50` (width) up
  by half of it. When the block stops pressing, or has pressed him more
  than **32 px**, he shoots out at `vy = -6` into **0x29f7a**: flattened
  (slot 65, sheet frames 323-325, Jack as a pancake), thrown with a random
  `vx` (`rand >> 15`, either way), then flapping across the floor (±0x3000
  a tick, friction 0x1500) for **150 ticks** before he gets up;
- on the ground in the hard hat: **0x29e16**, the same pin, but he pops out
  at `vy = -4` into **0x2a199** (slot 69): no sideways push, half gravity
  (0x2400), and a springy wobble of width and height (`+0x50` kicked by
  0x28000, `+0x52` by -0x20000, each damped by `-value * 0x8000`) until he
  lands, back in the hat.
- holding something (`+0x40 & 0x20`), he drops it (0x1e7d5) and goes to
  0x256e9, or 0x26539 in the hat.

The same squash handler (0x21a70: hat → 0x2a199 at -4, else 0x29f7a at
-6) is outcome 2 of a "generic thing" (`.OB` class 26, event 9), which no
shipped level places.

### What Jack collides with: `.COL` — **Confirmed**

Not every block is solid, and the clone treated every one as if it were.
The game keeps a **collision kind per object** in `.COL` — the one level
file these notes used to say `G.EXE` never opens. It does (VA 0x108db
builds the name, VA 0x6028f reads it whole into 0x3f20c4, 4800 bytes):
6 bytes per object, three i16, indexed by the object's number, so record
0 is the "no object" slot and the file holds `N + 1` records — true of
all 147 levels. Every probe of the tile map reads word 0 of the record
for the object it finds:

| kind | objects | what the probes do with it |
|---|---|---|
| 0 | 24553 | nothing — scenery Jack walks in front of: the buildings he smashes |
| 1 | 21555 | solid: the only kind that stops him sideways (VA 0x6040a, 0x60513) |
| 2 | 3220 | a floor only from above — feet over its top (VA 0x607c1); the girders |
| 4 | 2139 | a ladder: no collision; the ladder probe looks for it |
| 5 | 407 | a ladder's top: a floor from above, and still a ladder |

Kinds 3 (overhead only, VA 0x60666) and 6 (floor from above) are in the
code and in no level. In 0A, 328 of 371 objects are kind 0 and only 7 are
solid. Words 1 (0..9) and 2 (mostly 0) are read by the hammer's code
(0x1fb66, 0x1fc64, 0x2fc51) and not traced.

### Ladders — **Confirmed**

**The ladder probe** (VA 0x60920, box 0xa0264 = 4, 30) reads the row of
cells 31 px over his feet, across x ± 4. *Every* cell there must be kind 4
or 5 — anything else, empty included, answers 0 — and the answer is 5 if
a top is among them, else 4. So he must stand squarely at the ladder.

**Catching hold**: UP held and the probe non-zero, from standing
(0x22a99), running (0x22598) or in the air (0x22e16); from the last two
only while `|vx| < 5 px/tick` (faster goes to the hard landing, 0x29828),
and in the air only once `+0x15c` has counted down — 15 ticks, set when he
leaves a ladder any way but the top. Only empty-handed: no state with the
hammer out leads to it.

**Climbing** (0x25bda, slot 33): UP sets `vy = -2`, DOWN `+2` px/tick,
nothing steers sideways (the state's tail is a bare return), and the
frame shown is his height, `(y >> 1) & 15`. BUT2 pressed jumps off
(0x22b91). Going down, the floor probe 0x606eb with `& 6` — a solid block
or a platform he is above; a ladder's top he passes through — stands him
on it, as does the bottom of the level. Going up, if the probe at the new
height answers 0 but answered 5 where he was, he tops out; any other
empty answer drops him (0x256e9).

**Topping out** (0x299b6, slot 60): twelve frames two ticks apart; at
frame `f` he moves `table[f] / 2` px a tick, the table at VA 0xa130e being
`0, -2, -3, 0, 0, -1, -3, -3, -3, -3, -2, -5` — 25 px up — and then his
feet are set on the top of the block 30 px over where he started
(`+0xa6`). **Stepping down** from a top (DOWN pressed, standing on kind 5,
0x22a05 → 0x29b15, slot 61 — the same frame list backwards): 9 px down at
once, the table backwards from frame 11, and then 31 px under the top,
climbing.

### Pushing — **Confirmed**

UP held on the run goes into **0x2820b** (slot 38, sheet 207-222: arms
out, leaning in), standing into **0x28691** (slot 52, frame 245, the same
stance still). Neither pushes anything by itself — 0x2820b is a walk with
movement profile 4 (top 3.05 px/tick, accel 8000, turn 10000) whose frame
is his x, `(x >> 3) & 15`, run backwards facing left. Pushing back the
other way faster than 0x2bf20 (2.75 px/tick) skids him; with no direction
he brakes 5000 a tick and below 10000 stands in 0x28691, and a direction
from there walks again. BUT2 jumps, BUT1 does what it does from standing.

What makes it pushing is a search both states run while UP is held
(0x284e5 / 0x28771): sprites whose category has **bit 1** (template
`+0x10` set to 2 for the call, VA 0x2f0ab), up to the list at 0x3f1670,
that his box overlaps (0x2ddd6) and that are coming at him — `vx <= 0`
facing right, `vx > 0` facing left. The first is linked both ways (`jack[4]
= obj`, `jack+0x41 |= 0x20`; `obj[4] = jack`, `obj+0x41 |= 0x40`); one
another player holds is taken from him, and he gets a 3-tick wait
(`+0xa4`). The link lasts while they overlap. A linked sprite copies its
holder's `vx` every tick (VA 0x27f96) — and then runs its own physics and
friction on top, so it lags him slightly and he stays against it.

Of the whole cast **only one template has category bit 1: CWHL.SPR**, the
cannon's wheel. Pushing is for cannons.

### The cannon — **Confirmed**

`.OB` class 6 (constructor VA 0x5f69a, 20-byte payload): `i16 x, y` — the
wheel's position — then at +14 which way it faces (1 left, 2 right) and at
+18 what it stands on: **2 a wheel** (CWHL, template 0xa4470, category 6 —
pushable, and hit by the overhead blow) or **1 a fixed carriage** (CFIX,
0xa448c, category 0, `+0x64 |= 4`). On it the constructor stacks three
parts of CFIR.SPR that follow it each tick: the barrel with its fuse
(frame 0, template 0xa441c), and two halves of the breech (frames 10 and
9, 0xa4438 and 0xa4454 — the second shown only while the first is on 10).
All four share the one anchor. 46 levels carry 60 of them; in 0H, 0S, 2H
and 3I among the exported ones.

The wheel (state 0x5f8b0): its frame is `(x >> 1) & 3`, backwards facing
left; it takes its holder's speed (0x27f96); gravity 0x4800 and friction
2000 a tick, zeroed below 10000 (0x5fd1e). The overhead blow's hit flag,
on the ground and on wheels only, throws it up at `vy = -0x30d40` and
turns it round (`+0x40 ^= 4`, VA 0x5f944).

**It is loaded with a cannonball, from behind.** `.OB` class 7 (VA
0x20b58, 16-byte payload: `x, y`, and at +14 which ball — 2 is the big
one) places balls, CFIR.SPR frame 12 or 13 on template 0xa011c: category
0x841, so Jack can pick one up and throw it. The big ball weighs 50000
(`+0x4c`), the small one 5, and both strike what they hit (`+0x41 |=
0x10`). These are the "other dynamite" the Dynamite section mentions.

1. **Taken in.** Every tick a ball comes down (`vy > 0`) it runs a sprite
   search with mask 0x20 (VA 0x20c26 → 0x2f36b, its event list 0xa0250),
   which only the barrel answers. Its one outcome, 0x20e13, tests the
   ball's point against the barrel's hotspot 0xa4518 — centre (-19, -4),
   half-size 11 x 5, x mirrored facing left (test VA 0x2dfc7): **the bowl
   at the back of the breech**, not the muzzle. A hit links the two,
   clears the barrel's category bit 0x20 (no second ball) and plays sound
   0x2d or 0x2f.
2. **Rocking.** For 62 ticks the ball sits at `(cannon.x + dx ∓ 19,
   cannon.y - dy)` from table 0xa0154 (to 1234) — rocking in the bowl,
   dying away — then is hidden and the breech goes to frame 11 (VA 0x20d4f).
3. **The fuse.** That frame is what 0xa4438 waits for: it spawns a spark
   (BLAM.SPR frames 9-14, cycling a tick each, template 0xa44a8), which
   waits 20 ticks and then steps along the fuse's 29 points (0xa4522, x
   mirrored facing left) one every `+0x62` ticks — 5 on wheels, 10 on a
   carriage.
4. **The shot.** At the end the barrel goes to 0x5f964: a frame every 6
   ticks (it swells, 1-6, then kicks, 7-8). On frame 6 the ball leaves at
   `(x ± 20, y - 32)` through 0x6010e at 45° with the speed of the power in
   `+0x60` — **3 on wheels (9.6 px/tick), 4 on a carriage (12.7)**, table
   0xa44e0 — and the wheels take half its speed back as recoil. On frame 8,
   once it has stopped rolling, everything resets and bit 0x20 is back.

A ball in flight is an ordinary physical sprite (0x1f098). Landing on a
block at 5 px/tick or more it strikes it (VA 0x1f36d) with `mass << (speed
- 2) >> 1`, both up and down the structure; hitting one sideways at 3 or
more (0x1f28c), `mass << (speed - 2)` one way. Rubble flies wider for the
big ball (mask 0x7ffff against 0x3fff).

Sprites land as the probes have it, `& 0x66` (VA 0x1f206): on solid blocks
and on platforms (kinds 1, 2, 5, 6), and walls are only solid ones.

### The sucker — **Confirmed**

`.OB` class 22 (constructor VA 0x18fba, 12-byte payload `x, y`), in 72
levels, 154 of them: SUCKER.SPR, a base (frame 0, template 0x96de0, state
0x19058) and a red cup on it (frame 1, 0x96dfc, state 0x193cb), drawn at
the base's `+0x5e, +0x5c`. Category 0x1805: it can be carried, and the
overhead blow reaches it. It is a spring for throwing things up.

- **Landing** (on the ground and not yet wobbling, VA 0x190a9) sets the
  cup off along table 0x96e18 — a wobble, sound 0x4d.
- **The overhead blow** (its hit flag, VA 0x19065) arms it: `+0x50 = 64`,
  category bits 0 and 2 cleared (not to be picked up or struck again),
  sounds 0x49 and 0x4a, state 0x19105.
- **Armed, empty**, it searches for category 0x800 each tick (list 0x96e44
  → 0x1947e). Something in the air and falling (`vy > 0`) that overlaps it
  is caught: put at its x, 18 above it (`+0x60, +0x62 = 0, -18`), sound
  0x49. Jack and three other types (event types 0, 0x35, 0x3f, 0x5b) are
  frozen in place by `+0x40 |= 0x400020`; anything else has its state set
  aside for 0x1951a while it is held. Category 0x800 is Jack's, the
  dynamite's and the cannonballs', among others.
- **The count** steps `+0x50 -= 2` every `+0x6c` ticks — 12 while empty,
  so a little over six seconds. Holding something it plays the sink (cup
  table 0x96e54) and then sets `+0x6c = 0`, so the rest goes in a tick a
  step.
- **At zero, with a rider** (VA 0x19169): the rider is lifted 10 px and
  thrown straight up at **`vy = -0xe30d0` (-14.2 px/tick, about 360 px)**,
  its state given back; the cup springs (0x96ee4) and it resets (0x19347:
  everything zeroed, category bits 0 and 2 back). **Empty**, it hops
  instead (0x19264): the cup rises along 0x96e90 while 0x96e64 runs, then
  it leaves the ground 42 px up at `vy = -0x61a80` (-6.1 px/tick).

### The teleporter — **Confirmed**

`.OB` class 27 (constructor VA 0x347c1, 20-byte payload), 93 in 22
levels: `x, y`; at +14 bit 0 keeps it on for good (`+0x54 |= 3`); at +16
its own number, under 8 (`"teleport id exceeds limit"`), which puts it in
the table at 0x3f20a4; at +18 the number of the pad it sends to (`+0x58`).
TELLY.SPR, template 0xa4190 (state 0x34890), is a pad — frames 0-9 open
and close it — and while it is open a beam stands over it, frame 10, a
sprite of its own (0xa41ac, state 0x34a26). The pad is a physical sprite
(0x34d3e → 0x1f098, box ± 10): it settles onto what is under it.

- **The cycle** (`+0x54` bits, VA 0x34961-0x34a1c): 2 asks it to open — it
  makes the beam and steps 0 → 9 on the frame counter's `& 3`, then is
  open (0x20) for `+0x4a` = 180 ticks; 4 asks it to close — 9 → 0, the beam
  shrinks away (0x34cda) — and it stays shut (0x40) 180 ticks before
  asking to open again. Bit 1 skips the open countdown: always on. Every
  pad in the exported levels has it.
- **The beam** grows over about 20 ticks (offsets to its width and height,
  tables 0xa41f6 and 0xa41cc) and shrinks by 0xa4262 / 0xa421e. Each tick
  it searches for category 0x10000 — Jack's, whose category is the u32
  0x10804 — and sends on (0x34b5b) what it meets that is **in the air and
  not carrying** (`+0x40 & 0x30` clear), if the pad it names is open, has
  more than 30 ticks of it left and room for one more of its eight
  passengers. Sound 0x37; the passenger is held 8 above the beam.
- **The far pad** (0x34bcb) squeezes each new passenger — width offset
  `+0x50` down a pixel a tick, height `+0x52` up — until it is 6 px wide,
  moves it 12 above itself, and lets it out the same way back.
- **No ping-pong.** A passenger stays on the far pad's list after it is
  let out, and the beam leaves it alone until it has left the beam (VA
  0x34aa4-0x34b15) — it comes out standing in that pad's beam.

### Level names, sections and the order of play — **Partly confirmed**

A level is not chosen by name. The game is started with a **section and a
number**, `load_level(section, number)` (VA 0x1074b, which logs `"section
%d level %d"`), taken from the shared record both programs keep in
`TRASHIT.DAT` (0x2cc bytes: number at +0x20, section at +0x22; `G.EXE`
reads it through the pointer at 0x317ca8, `F.EXE` through 0xd6d1c). The
file name is built from the pair (VA 0x10a46):

    name[0] = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[number]
    name[1] = "JHCSLIATMJHCSLIATMBKDX"[section]

and `parse_level_name()` (VA 0x2c499) does the reverse for a name given on
the command line (`USAGE: TRASHIT LevelName`). So **the letter is the
section** and the first character the number in it — which is why `AA`,
`BK`, `EK` exist: numbers 10-14 of sections A, K and B. Sections 0-8 run
**J, H, C, S, L, I, A, T, M**; 9-17 repeat those letters (the loader adds
9 to the section for numbers 12-28 in one case, VA 0x10890 — not traced);
18-21 are B, K, D and X. Each letter is one look — the wall behind a
section's levels is the same from 0 to 9.

**The first level is 0J** — section 0, number 0 — on two counts: the
table's own first section is J, and the shipped `TRASHIT.DAT` holds 0 and
0 at +0x20/+0x22, the state a new game starts from.

The clone plays them in that order — section by section as numbered,
numbers ascending within one (`play_order()` in `export_level.py`).

Not traced: how `F.EXE` moves on. It keeps a history of played levels in
the record (`+0x158 + 4 * +0x10a`, the pair as one dword) and the furthest
reached at `+0x104`, copied into `+0x20` before a level is run (VA
0x215b2-0x215f8); the step from one pair to the next is somewhere above
that. `F.EXE` also names six movies "end of level 1..6" and "game
complete", so the game is grouped into six parts above the sections. The
twelve one-object screens (`CC` … `DS`) are numbers 12 and 13 of the
sections they name.

### Reading `G.EXE` in Ghidra

Ghidra has no DOS/4GW LE loader, so the image goes in flat
(`export_flat.py`), seeded with the function entry points and named from
the symbol map, and is dumped as one C file. One script does all of it,
in about two minutes:

    scripts/ghidra/run.sh <work dir>        # -> <work dir>/decomp.c

**The symbol map** (`scripts/ghidra/`) is what makes the dump readable:
`jack_fly_to_flag(...)` and `current_player` rather than `FUN_0002a2fe`
and `DAT_0028bf2c`. Three sources, in order of precedence:

- `symbols.txt` — by hand: everything these notes establish, one line a
  symbol with its address, kind (`f` function, `d` data), name and a
  one-line meaning; a guess says so with "?".
- `symbols_lib.txt` — generated from a dump by `symbols.py strings`:
  the Miles Sound System wrappers, each named after the `AIL_…(` call it
  logs, and **module helpers** — a function every caller of which belongs
  to one object or subsystem is `<module>_sub_<addr>`: whose it is is
  certain, what it does is still to be read.
- derived from the binary each time by `symbols.py`: the 47 class
  constructors from the registry (`ob_class_<id>_<sprite>`), every object
  template by the sprite it draws (`tpl_<sprite>_<addr>`) and the state
  it starts in (`<sprite>_tick_<addr>`), and every routine installed with
  `set_state` or stored into an entity's `+0x10` (`state_<addr>`).

`symbols.py coverage decomp.c` counts what has a name and lists the rest,
most called first — the order to read them in. The game's own code is
0x10000-0x6cfff; above that are the linked libraries (Miles, the Watcom
C runtime). Many of the game's error messages name the function they are
in (`"BUG in 'record_pad_entry'"`), and `symbols.py strings` lists those
too.

One gotcha that costs a run: **no path given to `analyzeHeadless` may
contain a directory whose name starts with a dot** — it refuses with
*"Path element starting with '.' is not permitted"*, so a project under
`~/.cache` or `~/.claude` fails before it starts.

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
| `disasm.py` | disassembly workbench over the LE image: functions, xrefs, strings, constant search, stream-advance tracing. `callers` / `entries` find call sites by byte scan rather than from a linear sweep — a sweep drifts past data and hides whole functions, which is what kept the collapse module's callers invisible |
| `ob.py` | `.OB` startup-code decoder (partial — see above) |
| `anims.py` | Jack's animation table from `G.EXE` |
| `hammers.py` | the 37-hammer catalogue (partial — see its docstring) |
| `states.py` | Jack's 46-state machine and its transitions |
| `ccs.py` | the structural simulation: the collision map, the support counts, the falling groups, and what a blow does as it travels — run over the real levels |
| `rle.py` | the shared scanline codec |
| `pal.py` `scn.py` `g2.py` `spr.py` `obt.py` | per-format decoders |
| `level.py` | assembles a whole level from `.WAM` + `.I` + `.OBT` + `.G2` |
| `export_sprites.py` | dumps a `.SPR` to PNG frames with alpha, origin in the filename |
| `demo_render.py` | runs all of the above and writes PNG proofs |

## Still open

- `.SDE` field meanings; the `.SCN` 3072-byte lead-in (it holds image
  indices, not a palette — it reuses the layers' own colours); the `.I`
  second u16.
- `.WVL` / `.XMI` audio (XMIDI is a documented format; `.WVL` is not
  examined at all).
- What sets the swing's starting frame — the operating range of the force
  ramp (see the collapse section; the formula itself is confirmed).
- What the individual bits of the level's option byte (0x98224, and a
  second at 0x98226) do. `ob.py` lists every field of the rules record
  that sets them; nothing yet traces a reader.
- What the remaining 45 `.OB` classes are — the enemies and pickups are
  in there.
- `"event list contains no outcome for object type %d"` (VA 0x90e0c):
  there is an event/outcome table keyed by object type that nothing here
  has looked at.
- Scoring beyond the packed-BCD adder and the rules record's +0x38.

Closed since these notes last listed them: `.OBT` field 6 is mass and
field 0 is hit points; the `.OB` record lengths (all 147 files parse
exactly); the physics of a collapsing structure and block strength.
