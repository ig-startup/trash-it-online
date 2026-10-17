# The world map's screen: the camera and the panel — **Confirmed**

How F.EXE shows a world map. Every address is F.EXE's; the walk is in
`world-map.md`, what stands on the map in `map-objects.md`.

**The screen is 320 x 200** and the map 640 x 480: the map is seen
through a window that follows Jack. Screen coordinates are centred on
the camera — x from -160 to 160, y from -128 to 72 — so the picture's
top left is drawn at the camera minus (160, 128) (0x1fa7d, `0x1db6c`), and
the clip box is the camera's -160..160, -150..100 (0x1348a, 0x13579).

**The camera** (0xc613c x, 0xc6140 y, 16.16): starts on Jack
(`map_screen_init` 0x1fcc2). Every tick (0x1fa7d, after the walk —
0x1f9c0 copies Jack's x, y into the target 0xd6d14, 0xd6d10) it moves by
(target - camera) / 16, rounded toward 0 (`camera_follow` 0x1348a), then
its whole part is held to x 160..480 and y 128..408 — the sheet's 20 x 15
tiles of 32 (0x1fc24) less half the screen, 72 below — the fraction
kept.

**The panel** (`map_screen_init`; objects of template 0x89fda, LSPANEL,
pinned to the screen by bit 8 of `+0x92`):

| LSPANEL frame | at (screen, top left 0,0) | the number beside it, at | record |
|---|---|---|---|
| 1 a gold timmy | (20, 20) | (40, 30) | `+0x1be` timmy points |
| 0 a grey heap | (134, 20) | (155, 30) | `+0x14` the score |
| 12 Jack | (264, 20) | (287, 30) | `+0x28` lives |

Each number has six digit objects (0x137228, 0xec210, 0x139640 — two for
lives). Every tick (0x201a4) all are hidden, then `panel_number` 0x2025a
writes the number with "%d": a digit's frame is its character - 0x2e
(frames 2-11 are 0-9), shown (bit 0x10 of `+0x90`), the next one its
width + 2 further on. LSPANEL's frames 13, 14 (two bars) are not placed
here.

**Where the numbers come from:** a won level adds the record's `+0x10`
to the score and `+0x18` to the timmy points (`map_node_trashed`
0x20072); `+0x1c` is added to the lives after any level (0x20e1d).
**Unsolved:** what G.EXE writes into `+0x10`, `+0x18`, `+0x1c` — the
clone keeps the score and timmy points at 0.

Clone: `client/src/scenes/WorldMapScene.js` (`_follow`, `_writeNumber`),
the sheet from `scripts/export_worldmap.py` (`panel`).
