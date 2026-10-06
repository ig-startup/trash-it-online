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

### Start positions still do not all fit

Of 255 player starts, 75 fall outside the `.WAM` bounds, several with a
small negative x (-19, -29, -130), and 17 of 135 bells are outside too.
It is not an off-screen margin: the bounds the tile lookup checks are the
level size exactly (`DAT_00410484 = width_in_tiles << 3`). Unexplained,
and the reason this is not yet wired into the client's level export.

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

**The tick is the display's vertical retrace.** The main loop (VA 0x2c654
→ 0x2cb6e) waits for retrace (port 0x3da), then runs the logic frame
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
-vx/4` off walls as Jack's skid) and Jack has carrying, pushing and
throwing animations; none of that is in the clone.

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

The clone's bindings are its own and have not been changed to match.

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

### Reading `G.EXE` in Ghidra

Ghidra has no DOS/4GW LE loader, so the image goes in flat
(`export_flat.py`), seeded with the function entry points
(`disasm.py … entries`, plus the 47 class constructors) and dumped as one
C file (`scripts/ghidra/`). That yields 1214 functions, and the
addresses in it are the ones quoted throughout these notes:

    python3 scripts/formats/export_flat.py Trash-it-original/G.EXE flat.bin
    python3 scripts/formats/disasm.py Trash-it-original/G.EXE entries > entries.txt
    analyzeHeadless <proj-dir> trashit -import flat.bin \
        -processor x86:LE:32:default \
        -loader BinaryLoader -loader-baseAddr 0x10000 \
        -scriptPath scripts/ghidra \
        -preScript MarkFunctions.java entries.txt \
        -postScript DumpDecomp.java decomp.c

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
