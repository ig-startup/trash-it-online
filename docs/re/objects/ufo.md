# The UFO — **Confirmed**

`.OB` class 31 (`BON/UFO.SPR`), in 36 of the 147 levels — 0C and 0I
among the first. The clone has none. Names in `scripts/ghidra/symbols.d/ufo.txt`.

**Set-up.** `"set ufo control params"`: a preset (a row of the 16-byte
table at VA 0x93b58) and then every non-zero `.OB` field overrides one
value through its own small table. A row is: how many start at once,
a value copied to a countdown (? the respawn interval), how many may fly
at once, the bomb/spike mix, and the periods of the four actions below,
in ticks:

| preset | land | drop | abduct | zap Jack |
|---|---|---|---|---|
| 0 | 50 | never (32766) | 2500 | 7500 |
| 1 | 100 | 2000 | 2000 | 6500 |
| 2 | 250 | 1500 | 1500 | 5500 |
| 3 | 500 | 1000 | 1000 | 4500 |
| 4 | 1000 | 500 | 500 | 3500 |
| 5 | 1500 | 250 | 250 | 2500 |

**Flying.** It roams toward a random point near the level's centre (kept
80 px above the bottom), steering like a damped spring: `v += (target -
pos) / 64`, then `v -= v / 8`, clamped to 5 px/tick. Four countdowns run
all the time; the first to expire picks the action, and the timer reloads
from its period (the start values are jittered).

1. **Land** — flies over a random player's Jack (about 100 px up, nudged
   until clear), drops at 2.5 px/tick braking by 1/32 until it meets
   floor, sits (frames 0x12-0x16), then takes off. **Landed, it can be
   hit**: the overhead blow sends it to `ufo_hit`.
2. **Drop** — hovers 150 px above a Jack and at tick 50 lets go a bomb
   (`BOM`) or spikes (`SPK`): the mix field 0 is half and half, 1 and 2
   about a third / two thirds bombs, 3 spikes only, 4 bombs only.
3. **Abduct** — picks the first `TIMMY.SPR` nobody holds, hovers 120 px
   over it with a beam (a piece every 8 ticks), and after 30 ticks lifts
   it a pixel a tick, squashing it thinner. Within 10 px of the UFO the
   timmy is gone and the UFO's stolen count (`+0x78`) goes up. If Jack
   picks the timmy up, the beam lets go.
4. **Zap Jack** — 120 px over a random Jack that is not busy, beam every 4
   ticks; at tick 15, if he is within 10 px across, his sprite `+0x43`
   gets bit 0x10 and his player `+0x15e` = 8 (what those do: not read).

**Shot down.** `ufo_hit` halves the stolen count (rounding up) and drops
one timmy back every 32 ticks, sparking. With none left it shakes for 120
ticks, then explodes: screen shake, two blasts, the blocks around it, a
flash, two wreck pieces — and the flying count goes down.
