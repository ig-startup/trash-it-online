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

A second mode (`0x41044e`, state 0x6109e) sends rubble flying sideways
towards a point instead; not traced.
