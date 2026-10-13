# Ladders — **Confirmed**

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
