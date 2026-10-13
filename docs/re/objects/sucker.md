# The sucker — **Confirmed**

`.OB` class 22 (constructor VA 0x18fba, 12-byte payload `x, y`), in 72
levels, 154 of them: SUCKER.SPR, a base (frame 0, template 0x96de0, state
0x19058) and a red cup on it (frame 1, 0x96dfc, state 0x193cb), drawn at
the base's `+0x5e, +0x5c`. Category 0x1805: it can be carried, and the
overhead blow reaches it. It is a spring for throwing things up.

- **Landing** (on the ground and not yet wobbling, VA 0x190a9) sets the
  cup off along table 0x96e18 — a wobble, sound 0x4d.
- **The overhead blow** (its hit flag, VA 0x19065) arms it: `+0x50 = 64`,
  category bits 0 and 2 cleared (not to be picked up or struck again),
  sounds 0x49 and 0x4a, state 0x19105.
- **Armed, empty**, it searches for category 0x800 each tick (list 0x96e44
  → 0x1947e). Something in the air and falling (`vy > 0`) that overlaps it
  is caught: put at its x, 18 above it (`+0x60, +0x62 = 0, -18`), sound
  0x49. Jack and three other types (event types 0, 0x35, 0x3f, 0x5b) are
  frozen in place by `+0x40 |= 0x400020`; anything else has its state set
  aside for 0x1951a while it is held. Category 0x800 is Jack's, the
  dynamite's and the cannonballs', among others.
- **The count** steps `+0x50 -= 2` every `+0x6c` ticks — 12 while empty,
  so a little over six seconds. Holding something it plays the sink (cup
  table 0x96e54) and then sets `+0x6c = 0`, so the rest goes in a tick a
  step.
- **At zero, with a rider** (VA 0x19169): the rider is lifted 10 px and
  thrown straight up at **`vy = -0xe30d0` (-14.2 px/tick, about 360 px)**,
  its state given back; the cup springs (0x96ee4) and it resets (0x19347:
  everything zeroed, category bits 0 and 2 back). **Empty**, it hops
  instead (0x19264): the cup rises along 0x96e90 while 0x96e64 runs, then
  it leaves the ground 42 px up at `vy = -0x61a80` (-6.1 px/tick).
