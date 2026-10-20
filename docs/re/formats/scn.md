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
The whole file is read to VA 0x257634 (`level_load_objects`, at most
0x2fa00 bytes), so the textures sit 0x10000 apart.

- **Below it** (VA 0x18f74), from the horizon down to row 199: the
  **ground**, a floor plane receding to the horizon, sampled from
  **texture 0** (0x257634, `+ (v & 0xff) << 8`), each row at the distance
  of table 0x96ab4; its texture scale is `SDE[1]`, offset every tick by `SDE[4]` and
  `SDE[5]` × 0x1000 — an **auto-scroll**, -5 and -5 in 12 levels (drifting
  cloud or water), 0 elsewhere.
- **Above it** (VA 0x1c895, called with 0x267634), from the horizon up:
  an upright **backdrop** at distance `SDE[0]`, sampled from **texture 1**
  bottom row first — the skyline, fences, walls. Its step `(SDE[0] - camera z) / 320 >> SDE[2]` a row; it stops once the
  texture runs out unless `SDE[3]` says to carry on to the top (59
  levels), and the rest is filled plain (0x6d2ab) with the colour of texture 1's
  top-left pixel.
- Which planes are drawn at all is the **graphics detail** setting
  (`0x287c70` / `0x287c72`, four presets at VA 0x1c69f-0x1c70d), not the
  level: at the lowest the backdrop is a plain fill (0x6d2f4).

In 0C, texture 0 is brick paving and texture 1 a cloudy sky with
chimneys over a fence; in 5T, stone paving and a stone wall with a face.

**The third part** (124 of the 147 files, 64000 bytes after the two
textures) is a 320x200 picture that the game **never draws**. It lands in
the buffer at 0x277634, which `save_screen_rect` (0x1ccac) uses as scratch
for sprites drawn with the screen saved under them. In every section but
I it is the same developer's scribble — *"I'm a 320 x 200"* — with only
the background index changed; the I levels (0I-9I, CI, TI, UI) carry a
sunset sky there instead. The only code that reads the buffer as a
picture is an unreferenced routine at 0x1cd94 that doubles it to 320x400.

**`HEAT`** is dead too: draw mode -1 (template word +0x18 with
0x8000 | 0x4000, VA 0x2d50e) is set by none of the game's templates,
and `heat_tick` (0x60d5d, the `upd_HEAT` routine — a script by Jack's
animation slot 4) is referenced from nowhere.

The clone draws texture 0 flat and tiled — the look of the lowest detail
level with a texture. Doing it as the game does needs the camera's depth,
which the clone does not model.
