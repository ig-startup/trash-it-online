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
solid. Words 1 (0..9) and 2 (mostly 0) are read by the hammer's code
(0x1fb66, 0x1fc64, 0x2fc51) and not traced.
