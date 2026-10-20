# The bonus screens: hammering the big object — **Confirmed**

Number 12 (C) and 13 (D) of the first six worlds are one-object screens
(288 x 96, one floor slab): on the story's map C is a side stop and D is
the world's exit (`front/world-map.md`). G.EXE builds a round of its own
on them — `load_level` (VA 0x1074b) calls **bonus_round_setup 0x10c1f**
for numbers 12..28 with the row `number - 12` of the world `section - 9`.
The clone: `scenes/bonusRound.js`, the data from `export_level.py --bonus`
(`bonusRound` in the level's JSON).

**The table** (VA 0x93594, a pointer per world to two 16-byte rows, C then
D): u32 the force a notch takes, s16 notches, s16 the hit sound (an index
into 0x9fefe), s16 how many pieces it bursts into, s16 the sprite file
(G.EXE's list at 0x9984c, 102-byte records — the one `load_spr` 0x6a380
indexes), s16 the draw mode of the round's four templates (their +0x18,
`set_draw_mode` 0x2d50e: without bit 0x8000 a plain draw — 1 in every row).

| level | sheet | per notch | notches | pieces | clock |
|---|---|---|---|---|---|
| CJ | JG | 200 | 10 | 67 | 25 s |
| DJ | JG | 405 | 9 | 67 | 21 s |
| CH | HG | 950 | 10 | 69 | 42 s |
| DH | HG | 1100 | 10 | 69 | 37 s |
| CC | CG | 3000 | 10 | 60 | 48 s |
| DC | CG | 2400 | 16 | 60 | 46 s |
| CS | SG | 8000 | 8 | 63 | 11 s |
| DS | KG | 25000 | 10 | 63 | 12 s |
| CL | LG | 41000 | 10 | 64 | 12 s |
| DL | LG | 35000 | 32 | 64 | 12 s |
| CI | IG | 380000 | 8 | 64 | 12 s |
| DI | IG | 800000 | 32 | 64 | 12 s |

(A, T and M have rows too — REV.SPR, 200 x 10 — but no C or D screens on
their maps.) The clock is the level's own, as for any level.

**The sheet**: frames 0-3 the object wearing down, 4-5 two parts (the
junkyard's horns), 6-7 a meter segment full and spent, 8 on the pieces —
JG has 75 = 8 + 67. Everything stands on (level_half_width, level_bottom).

**Setup**: the object (template 0x933e4, routine 0x10e4a); the two parts
(0x93438, 0x111a0), hidden; a segment per notch (0x9341c, 0x1110f) at x +
0x70, going up 12 px apart, hidden. The level option bit 0x40 (0x98226) is
set — the bonus mode — and the hit box: x within ±0x50 of the object, y
from `bottom - 0x80` to `0xcd500 + 0x80`, which is 0x80, G.EXE starting
afresh for every level.

**A blow** (blow_walk_cells 0x1f905): in bonus mode it walks no cells at
all. bonus_object_hit 0x110b7 takes its point — Jack's, plus the hammer's
reach ahead and down — and, in the box, adds `force * player +0x92` to
what the object owes (0x933e0, 32-bit, `imul`), zeroes the cooldown and
plays the table's sound; then the screen shakes by `force >> 18`, held to
6..63 (6 + rand 3 below 6). Player +0x92 is the hammer record's +0x52: 1
for the sledges, up to 5 for the moola and 8 for the spoon and the guitar.
Only the sideways blow: the overhead strike goes to sprites, not here.

**Each tick** (0x10e4a): every 8th tick, while the meter is filling, one
more segment shows. While anything is owed: with the cooldown at 0,
`left -= owed`; below 0 a notch goes — `left += hp`, `owed -= hp`, cooldown
8 — else `owed = 0`. Note `owed` can go below 0 and then gives the next
notch back; the clone keeps that. At notch `quarter - 1` (quarter starting
at `notches >> 2`, then up by as much) the object steps a frame, to 3 at
most, with a shake. A segment whose index is at or under the notches taken
shows frame 7 — segment 0 at once. At the fourth frame the parts fly
(`vx` ±2, `vy` up to -2, 240 ticks, gravity 0x900). At `notches - 1` it
**bursts**: the pieces from `pieces + 7` down to 8 fly (`vx` ±2, `vy` up
to -4, 240 + rand 32 ticks), the object goes, `level_state +0x26 = 2`
(won, as the bell does) and 0xa2f16 = 300: logic_frame ends the level
300 ticks later.

**The story** (F.EXE VA 0x20e1d): a bonus screen won trashes its node; a
D won also ends the world. Lost, neither costs a life — only a level does.

A type-0 hammer's force is halved here as anywhere unless UP or DOWN is
held as the blow lands (`logic/collapse.md`, 0x1fcd3) — so a special
aimed up or down hits the object at full force, its force wrapping round
in 32 bits as before.
