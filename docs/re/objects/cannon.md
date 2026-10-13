# The cannon — **Confirmed**

`.OB` class 6 (constructor VA 0x5f69a, 20-byte payload): `i16 x, y` — the
wheel's position — then at +14 which way it faces (1 left, 2 right) and at
+18 what it stands on: **2 a wheel** (CWHL, template 0xa4470, category 6 —
pushable, and hit by the overhead blow) or **1 a fixed carriage** (CFIX,
0xa448c, category 0, `+0x64 |= 4`). On it the constructor stacks three
parts of CFIR.SPR that follow it each tick: the barrel with its fuse
(frame 0, template 0xa441c), and two halves of the breech (frames 10 and
9, 0xa4438 and 0xa4454 — the second shown only while the first is on 10).
All four share the one anchor. 46 levels carry 60 of them; in 0H, 0S, 2H
and 3I among the exported ones.

The wheel (state 0x5f8b0): its frame is `(x >> 1) & 3`, backwards facing
left; it takes its holder's speed (0x27f96); gravity 0x4800 and friction
2000 a tick, zeroed below 10000 (0x5fd1e). The overhead blow's hit flag,
on the ground and on wheels only, throws it up at `vy = -0x30d40` and
turns it round (`+0x40 ^= 4`, VA 0x5f944).

**It is loaded with a cannonball, from behind.** `.OB` class 7 (VA
0x20b58, 16-byte payload: `x, y`, and at +14 which ball — 2 is the big
one) places balls, CFIR.SPR frame 12 or 13 on template 0xa011c: category
0x841, so Jack can pick one up and throw it. The big ball weighs 50000
(`+0x4c`), the small one 5, and both strike what they hit (`+0x41 |=
0x10`). These are the "other dynamite" the Dynamite section mentions.

1. **Taken in.** Every tick a ball comes down (`vy > 0`) it runs a sprite
   search with mask 0x20 (VA 0x20c26 → 0x2f36b, its event list 0xa0250),
   which only the barrel answers. Its one outcome, 0x20e13, tests the
   ball's point against the barrel's hotspot 0xa4518 — centre (-19, -4),
   half-size 11 x 5, x mirrored facing left (test VA 0x2dfc7): **the bowl
   at the back of the breech**, not the muzzle. A hit links the two,
   clears the barrel's category bit 0x20 (no second ball) and plays sound
   0x2d or 0x2f.
2. **Rocking.** For 62 ticks the ball sits at `(cannon.x + dx ∓ 19,
   cannon.y - dy)` from table 0xa0154 (to 1234) — rocking in the bowl,
   dying away — then is hidden and the breech goes to frame 11 (VA 0x20d4f).
3. **The fuse.** That frame is what 0xa4438 waits for: it spawns a spark
   (BLAM.SPR frames 9-14, cycling a tick each, template 0xa44a8), which
   waits 20 ticks and then steps along the fuse's 29 points (0xa4522, x
   mirrored facing left) one every `+0x62` ticks — 5 on wheels, 10 on a
   carriage.
4. **The shot.** At the end the barrel goes to 0x5f964: a frame every 6
   ticks (it swells, 1-6, then kicks, 7-8). On frame 6 the ball leaves at
   `(x ± 20, y - 32)` through 0x6010e at 45° with the speed of the power in
   `+0x60` — **3 on wheels (9.6 px/tick), 4 on a carriage (12.7)**, table
   0xa44e0 — and the wheels take half its speed back as recoil. On frame 8,
   once it has stopped rolling, everything resets and bit 0x20 is back.

A ball in flight is an ordinary physical sprite (0x1f098). Landing on a
block at 5 px/tick or more it strikes it (VA 0x1f36d) with `mass << (speed
- 2) >> 1`, both up and down the structure; hitting one sideways at 3 or
more (0x1f28c), `mass << (speed - 2)` one way. Rubble flies wider for the
big ball (mask 0x7ffff against 0x3fff).

Sprites land as the probes have it, `& 0x66` (VA 0x1f206): on solid blocks
and on platforms (kinds 1, 2, 5, 6), and walls are only solid ones.
