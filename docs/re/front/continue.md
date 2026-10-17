# The "continue?" screen — **Confirmed**

What a lost story level asks before the map comes back. Every address is
F.EXE's; where it is called from — `world-map.md` ("Lost", VA 0x20e1d).

**The rule** (0x1590e): with no lives left (record `+0x28` = 0) nothing is
shown — the answer is no, and the game is over (0x12654, state 0xf). Else
the screen is shown; the answer starts on **yes**, and a yes costs a life
on leaving (`+0x28` - 1) and puts Jack back on the map, on the level he
lost (`world-map.md`). Only a level asks: a bonus screen, a side level or
an exit's D lost costs nothing and asks nothing.

**The screen** (0x154cb) is `PROJ/CONTIN_E.DAT`, one palette for all:

| slot | sheet | what |
|---|---|---|
| 12 | CONTINBG | frame 0 the 320 x 200 picture — five glass tubes with a Jack in each; frames 2-6 the same tubes empty |
| 13 | CNTGRB_E | 0 YES (bottom left), 1 NO (bottom right), 2 CONTINUE? (hanging from the top) |
| 14 | CONMIST | three strips of green mist |
| 126 | CONTPANL | digits 0-9, 10 "+", 11 a small Jack |

Its coordinates put the picture's top left at (-160, -128) (0x1c8bf, slot
12 frame 0); below, (x, y) means the picture's (x + 160, y + 128), and an
object is drawn at its point plus its frame's origin, as everywhere.

- **The lives** — the tubes. With L lives, L ≤ 5, the first 5 - L tubes
  from the left are covered by their empty frames (template 0x87018, frame
  2 + i, at the picture's corner). With 6 or more, the Jack icon (0x86fb8,
  frame 11 at (15, 30)) and " + %d" of L - 5 in CONTPANL's digits at
  (40, 36) (0x1d45e).
- **The mist** (template 0x86ff8, behaviour 0x154b0): three strips, x a
  16.16 number moving right each tick by 0x3000, 0x5000, 0x7000 (3/16,
  5/16, 7/16 px), from (110, 28), (-20, 78), (-20, 88); past x 315 one
  goes back to -170. Each is drawn with `+0x1c` = -2.
- **The words** (template 0x87038, behaviour 0x15415): each waits its
  ticks (`+0x9c`), then moves — position += velocity, then velocity +=
  acceleration (0x1c947, 0x1c991; 16.16 numbers). YES waits 20, NO 30;
  both start at y 150 + 128 going up at 8 px a tick, slowed by 1/4 a tick,
  and stop where the speed reaches 0 — 132 px higher. CONTINUE? starts at
  -160 + 128 going down at 8, slowed by 1/4, and stops 132 px lower. At a
  speed of -6 or +5 each plays sound 0x23 (the thud as it lands).

**The choice** (0x15818, every tick): the input word of the controller
in 0xc611e (bit 1 left, bit 2 right, 0xf0 fire — the bits as
`map_walk_step` 0x1e1c1 reads them): left picks yes (sound 0x33 when it
changes), right picks no (0x32). The word picked flashes: 6 ticks in 16
(the tick counter & 15 < 6) it is drawn through the remap table at
0x943dc, every entry 0xfe — a silhouette in colour 254, black in this
palette (`obj_draw` 0x234bf, bit 0 of `+0x93`: 0x26eda sets it, 0x26ee2
clears it). Fire plays sounds 2 and 0x23 and sends the words off: YES
falls at 1/8 a tick per tick, NO at 3/8, CONTINUE? rises at 1/4; the
choice can no longer change (0x15415 stops looking).

**Timing:** the screen fades in, 4 of 128 a tick (0x1aaff, step 0x1ab8d —
32 ticks); after fire it runs 60 more ticks (0x12bf2 with 0x3c), then fades
out at 16 a tick (8 ticks) before the answer is taken.

**Unsolved:** what `+0x1c` = -2 does to the mist (a mode of the blitter,
not the remap path); **Inferred:** that 0x12bf2's argument is a count of
ticks.

Clone: `client/src/scenes/ContinueScene.js`, sheets from
`scripts/export_worldmap.py` (`continue` in `worlds.json`), `Story.js`.
