# The seesaw and the weight — **Confirmed**

`.OB` class 0 is a seesaw (`BCSAW.SPR`, or `CSAW.SPR` when the record's
word at +0x12 is 1 — same behaviour), in 43 levels; class 1 is the
20-ton weight (`LEAD.SPR`), in 42. Names in
`scripts/ghidra/symbols.d/seesaw.txt`.

**The seesaw** stands 26 px below its record's y and settles like any
sprite. Its `+0x44` says which end is down: frame 0 the left, frame 1
the right (the record's word at +0xe: 1 for frame 0). Each end is
tested with two boxes, 40x24, 31 px either side of it: one 21 px up
(table 0x9977c) for what comes down through it, one 3 px up (0x9978e)
for what stands there. Each end can have one rider (`+0x54` left, `+0x58`
right).

**Tipping** (VA 0x1ecc9). Something coming down into the *raised* end
moves it, and the rider of the other end is launched (VA 0x1ed40): lifted
30 px, then sent up at the speed that came down less 0x7fff — but if that
is under 0x13880 (1.22 px/tick) the seesaw does not move at all. With no
rider it always tips. It plays a sound.

- **The weight** falling into a raised end tips it; failing, it bounces
  off at three quarters of its speed and, if it was barely moving
  sideways, gets a kick of 4000 + random & 0x3fff toward the other end.
  Come to rest on a *down* end, it rides it: snapped to x - 33, y - 3
  (left, frame 2) or x + 47, y (right, frame 1).
- **Jack** dropping through a raised end tips it too (VA 0x28af9); standing
  on the down end of an empty seesaw he rides it, turned away from it.
  So the trick is the original's: stand on the low end and drop the
  weight on the high one, or jump on the high end to fling the weight.
- **The overhead blow** tips it from the end it reaches (VA 0x1eba3), with
  the blow's force from `+0x4e` as the speed — on what scale the sprite
  force is, not read.

The weight weighs 25 (`+0x4c`), which is what a thrown one hits blocks
with. Landing, it sets the hit flag on the sprites under it with ids 0x35
TIMMY, 0x36, 0x3f KTIMMY, 0x45 REDBUT (the buttons) and 0x5b TOMMY
(VA 0x1ea81).
