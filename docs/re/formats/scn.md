# `.SCN` — background textures, drawn in perspective — **Confirmed**

A `.SCN` is 256-pixel-wide textures, one byte a pixel, no header (see
`scn.py`; the old "3072-byte lead-in and 320x200 layers" reading sheared
every row and is gone). What the game does with them is a **perspective
renderer**, not a blit: its camera has a depth (`0x28bf40`, the zoom; the
sprites are scaled by `0x50000000 / (camera z - sprite z)` too, VA
0x6ae1e), and the backdrop is drawn row by row through an affine scanline
mapper (VA 0x18acc, 256x256 source, both indices masked to 8 bits):

- **The horizon** (VA 0x1c759): row `100 + (20.0 / (SDE[0] - camera z)) ×
  camera y`, held to 0..199.
- **Below it** (VA 0x18f74), from the horizon down to row 199: a plane
  whose texture scale is `SDE[1]`, offset every tick by `SDE[4]` and
  `SDE[5]` × 0x1000 — an **auto-scroll**, -5 and -5 in 12 levels (drifting
  cloud or water), 0 elsewhere.
- **Above it** (VA 0x1c895), from the horizon up: a farther plane, its
  step `(SDE[0] - camera z) / 320 >> SDE[2]` a row; it stops once the
  texture runs out unless `SDE[3]` says to carry on to the top (59
  levels), and the rest is filled plain (0x6d2ab).
- Which planes are drawn at all is the **graphics detail** setting
  (`0x287c70` / `0x287c72`, four presets at VA 0x1c69f-0x1c70d), not the
  level: at the lowest the backdrop is a plain fill (0x6d2f4).

The clone draws texture 0 flat and tiled — the look of the lowest detail
level with a texture. Doing it as the game does needs the camera's depth,
which the clone does not model.
