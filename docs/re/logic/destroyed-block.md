# What a destroyed block becomes — **Confirmed**

`remove_object_data` (VA 0x68724) keeps the block's entity and turns it
into **rubble**: it swaps the draw routine from 0x2d285 (opaque, through
0x38be8) to 0x2d381, which draws through 0x34ed8 — a blit that writes
`dst = table[src * 256 + dst]` with the 256x256 blend table at 0xbd4e4,
so the rubble is **see-through**. Its state becomes 0x60f60:

- it flies with a random push (`vy = -((rand & mask) + 0x4e29)`, `vx = ±(rand
  & mask)`, the masks those of "What a hammer blow carries") and falls at
  **5000 a tick** (0.076 px/tick²) — *through* everything, to the bottom of
  the level (`0x41044c`), not onto the blocks below;
- on the bottom it bounces, `vy = -(vy / 4)`, puffs dust (0x6125c,
  `DUST.SPR`) and comes to rest;
- resting, it counts down `+0x60` from **2000 ticks** (about 33 s) and every
  tick puts itself on the rubble list (0x3f3390, count 0x3f4022) — the list
  the hoover reads;
- when the count runs out (0x61205) it sinks into the floor a pixel a tick
  until it is gone.

**The dragon's column** (`rubble_mode` 0x41044e = 1, only while
`damage_bottom_row` 0x69f54 runs — step 10 of the dragon show,
`levels/dragon-show.md`). The bottom row's rubble is flung sideways
instead, vx up to ±16 px/tick, no vy (`rubble_fly_to_point` 0x6109e), and
pulled back toward the point at 0x28b96a (the level's middle, or the
dragon) by 20000 a tick while it heads away. Heading in, it rises
(`rubble_column_rise` 0x610f0: vy −8000 a tick) until it is 600 px above
the bottom, its vx quartered, held to the point by ±0x9c400 a tick on the
wrong side and ±20000 on the right one; then it falls back under 5000 a
tick swaying across the point (`rubble_column_fall` 0x6118d), and below
600 px above the bottom it is ordinary falling rubble again (0x60f60). A
column of debris shot up the middle of the screen. Not in the clone.
