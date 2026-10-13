# The hoover — **Confirmed**

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
