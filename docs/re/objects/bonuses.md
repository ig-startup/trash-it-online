# Bonuses, the dispenser and the panel — **Confirmed**

Classes 33, 8 and 46. Names in `scripts/ghidra/symbols.d/bonus.txt`.

**The bonus git** (class 33, 48 in 20 levels). The record's word +0xe is
its mode: 1 a bonus git (`BON.SPR`) walking from the start (17), 2 a
shell — the `BELL.SPR` template — locked in a block (31), which when the
block dies is thrown up at -6 and becomes the walker. It walks like any
git and touching it does nothing. **The overhead blow** (0x3333c) sends it
up at -4, sparkling; when it lands it **swells** (`1 << t/2`) and past 50
**bursts** into its prize (0x123c0) — the lowest set bit of word +0x12:

| bit | prize | in the levels | Jack touching it |
|---|---|---|---|
| 0 | a **clock** (`CLOK`) | 29 | **+25 seconds** on the level's timer (outcome 14) |
| 1 | **timmies** — word +0x14 of them (5, 10, 30), flung up | 8 | (they are timmies) |
| 2 | a **super hoover** (`BVAC`) | 5 | for **60 s** the hoover blinks and takes every bit of rubble in a 2048x1024 box, not 32x32 (outcome 13) |
| 3 | a **bubble** (`BUBBLE`) | 6 | **double points** for rubble, 32 s (outcome 8) |

The clock spins, a frame every 3 ticks, and after ten turns hops about for
240 ticks; the hammer bursts it into twelve pieces and the time is lost.
The bubble bounces about at random; the super hoover drops to the floor.

**The dispenser** (class 8, `DIS.SPR`, 20 in 18 levels — first read as a
sign). It stands on what is under it with ordinary physics (word +0x1a =
2, all of them). **The overhead blow** wobbles it for 40 ticks — the lid
opens at 36 — and then it lets out word +0x1c small **cannonballs**, one a
tick (+0x20 between them, 0 in all), from 17 px left of it and 16 up:
straight up at the blow's force `>> 5`, held to 3..32 px/tick, across by
turns at ±0.92, ±1.37, ±1.83, ±2.29 (0xa43f8). Word +0x1e is how many
times it does so (1, 2, 4; 0 for ever); spent, it rises off the screen.

**The panel** (class 46, `PANEL.SPR` frame 17, one in each of 21 levels).
A secret — standing free (18), or locked in a block (3, word +0xe = 2)
until the block dies — drawn with six layers that shift with the
camera for a 3-D look and a twinkle at random spots. Freed, it sits; Jack
touching it (outcome 16) takes it — `level_state +0x18` goes up by one,
a count the game hands back to the front end (F.EXE) — with 32 sparks.
