# What Jack collides with: `.COL` — **Confirmed**

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
solid. **Word 1 is the block's material — what it sounds like** (0..9; over
the 147 levels 0: 9406, 1: 8392, 2: 1341, 3: 3369, 4: 5047, 5: 6115,
6: 14189, 7: 1672, 8: 1945, 9: 251). Two tables of ten sound ids turn it
into a sound: 0x9fefe when a blow lands — the hammer's (`blow_walk_cells`
0x1fb66, each cell its own, offset by the cell's order) and a git's
(`git_strikes_cell` 0x20874) — sounds 1-10; and 0x9ff14 when something
strikes or lands on the block (`play_sound_staggered` 0x1fca1, from
`sprite_strikes_block_x/_y` and `group_landed`) — sounds 36 38 3 4 37 34
35 8 9 33, the same for materials 2, 3, 7, 8, a duller one for the rest.
The samples carry no names (`sound.py`), so which material is glass or
wood is for the ear.

**Word 2 is the gits' marker** (`git_marker_at` 0x2fc51): `objects/gits.md`.
