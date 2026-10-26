# The coloured buttons and the big demolition — **Confirmed**

`.OB` classes 28, 29 and 30 are the **red, green and blue buttons**
(`REDBUT.SPR`; the constructors log `"startup red button"` etc.). Four
levels have them: 1D (one red), and 2T, 4T and BA (one of each colour).
They are why 2T, 4T and BA ask for more trashing than their blocks hold:
the last button **demolishes the whole level**.

## A button

One constructor tail (VA 0x1722b) behind three heads (0x17100, 0x17178,
0x171d4). Payload 20 bytes: x, y, …, word 7 = what it sets, word 9 = 1
for a hidden button. Template 0x96b04/0x96b20/0x96b3c, routine 0x172a9.

| colour | class | frame (up / pressed) | revealed by | word 7: 1 / 2 / 4 sets |
|---|---|---|---|---|
| red | 28 | 0 / 1 | option 0x100 | 0x400 / 0x1000 / 0x800 |
| green | 29 | 2 / 3 | option 0x400 | 0x200 / 0x1000 / 0x800 |
| blue | 30 | 4 / 5 | option 0x200 | 0x800 / 0x1000 / — |

So red reveals green, green reveals blue, and 0x800 is what the subtype-2
bell waits for.

**Pressed by a blow from above.** The tick (0x172a9) looks for entity
`+0x40` bit 0x80 — set by the overhead hammer blow (0x1fd94), a blast
(0x1d8d1), a lead weight landing (`lead_lands_on` 0x1ea81: the three
templates' sprite id is 0x45, REDBUT, one of the five it presses). Then it ORs its bit into the
level options (0x98224), shows the pressed frame, hops (vy −3) and
counts down `+0x50` (40 by 4) and `+0x4a` (6, every fourth tick), which
nothing that draws it reads. It can be pressed again; the bit is already
set — but its frame goes up by one on every press, so a second blow shows
the next colour's up frame. No sound of its own.

**Hidden** (word 9 = 1): routine 0x17350, invisible and untouchable until
its colour's bit is in the options, then it appears, the camera taking
it in for 120 ticks (`camera_track`, see [camera](../logic/camera.md)) and kick −1.53 px/tick.

## Option 0x1000: the level's one big event

The rules record (class 16, see [rules record](../levels/rules-record.md))
picks, by its word at stream +0x26, a handler for option 0x1000: 1 none
(142 levels), **2 → 0x204be** (1D), **4 → 0x1b0f6** (2T 4T BA). A watcher
(0x1b089, added to the 32-slot list) calls it once, the first tick 0x1000
is set without 0x2000, and sets 0x2000.

- **0x1b0f6, the demolition.** Starts an 80-tick count (0x28b964) and draws
  the camera back to a point 1900 px over the bottom of the level, for
  800 ticks (x `level_half_width`, y `level_bottom` − 0x76c). `logic_frame`
  runs 0x2043c: at 8 the screen shakes (`request_shake` 0x10); at 0 it
  sets option 0x40, the rubble mask 0x7ffff, calls `demolish_all`
  (0x206c0) and plays sound 0x2b. `demolish_all` runs `remove_object_data`
  on every level object whose flags have bit 1 — the still ones, as
  `objects_tick` reads them, unbreakable or not: so the share destroyed
  reaches 100 % and the subtype-8 bell comes out (Inferred — that the
  unbreakable ones carry bit 1 is read from `objects_tick`, not the loader).
- **0x204be (1D).** Plays CD track 10 and starts the scripted
  sequence at 0x9ff42 — the [dragon show](../levels/dragon-show.md): a
  demon face, lightning, a camera sweep, then a blow from below that
  brings the level down.
  The mystical dragon hammer's trick starts the same sequence, and the
  ULTIMATE MOOLA's trick the same demolition ([combos](../jack/combos.md)).

In 2T, 4T and BA: red (visible, sets 0x400) → green appears (sets 0x200)
→ blue appears (sets 0x1000) → 80 ticks later the level is rubble and the
percentage bell (subtype 8) is free. In 1D the single red button sets
0x1000 directly, next to the bell.

**Clone:** `client/src/scenes/buttons.js` (the buttons), and in
`GameScene.js` `_optionsTick`, `_startDemolition`, `_demolishAll` and the
camera's `_camTargets`. 1D's dragon show is not in the clone yet: there
the button brings the level down the 2T way.

The rules record's stream +0x22 bit 1 does the demolition at load (option
0x40 + `demolish_all`); all 146 records leave it 0.
