# A falling block on Jack — **Confirmed**

Every tick (VA 0x21aef, from Jack's routine) 0x60a00 looks along Jack's
width in the **falling** map (0x69fdf reads the provisional map 0x40f334,
where moving groups are stamped) for a solid block over him:

- in the air: rising, his `vy` flips downward; falling, he gets half the
  block's `vy` on top of his own;
- on the ground without the hat: the block goes in the player's `+0xac`
  and Jack enters **0x29c92** — pinned; each tick the block's descent since
  contact is his squash, `+0x52` (height) down by it and `+0x50` (width) up
  by half of it. When the block stops pressing, or has pressed him more
  than **32 px**, he shoots out at `vy = -6` into **0x29f7a**: flattened
  (slot 65, sheet frames 323-325, Jack as a pancake), thrown with a random
  `vx` (`rand >> 15`, either way), then flapping across the floor (±0x3000
  a tick, friction 0x1500) for **150 ticks** before he gets up;
- on the ground in the hard hat: **0x29e16**, the same pin, but he pops out
  at `vy = -4` into **0x2a199** (slot 69): no sideways push, half gravity
  (0x2400), and a springy wobble of width and height (`+0x50` kicked by
  0x28000, `+0x52` by -0x20000, each damped by `-value * 0x8000`) until he
  lands, back in the hat.
- holding something (`+0x40 & 0x20`), he drops it (0x1e7d5) and goes to
  0x256e9, or 0x26539 in the hat.

The same squash handler (0x21a70: hat → 0x2a199 at -4, else 0x29f7a at
-6) is outcome 2 of a "generic thing" (`.OB` class 26, event 9), which no
shipped level places.
