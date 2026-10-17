# The world map: walking the paths — **Confirmed** (`export_worldmap.py`)

How Jack gets about F.EXE's level-select screen; what the nodes are is in
`front-end.md`. Every address is `F.EXE`'s. The clone's map is
`client/src/scenes/WorldMapScene.js` with `client/src/story/Story.js`;
`scripts/export_worldmap.py` walks every path once, exactly as below, and
the client replays the pixels.

**What is drawn.** A world's screen is `PROJ/LVSL<n>_E.DAT` (n as in
`front-end.md`): it names the sheets the screen uses — the world's own
(`JUNKMP`, `CASTMP`, `CHEMMAP`, `LVSL4SPR` … `LVSL9SPR`; A's file names its
film sheet `LVSL8FLM` first), then `LSJACK`, `LSSHOP`, `LEVSLBIN`,
`YELMEDFT`, `LS_HAT`, `LSPANEL`. The picture is the world sheet's raw
640 x 480 frame (see `formats/spr.md`); its other frames are landmarks
placed at their own origins. The paths are `FSPR/LVSPAT<n>.PAK`, the
same size: 0 nothing, 255 path, 1..127 the point of node *id*.

**Jack on the map** is `LSJACK.SPR`, 136 frames: the screen file's header
for it is `OW`, 8, 0x88 — eight animations of seventeen, then a w, h per
frame. Animation d-1 is direction d: 1 right, 2 down-right, 3 down (his
face to us), 4 down-left, 5 left, 6 up-left, 7 up (his back, the braces
crossed), 8 up-right. **Inferred:** how fast the frames step — the clone
steps one every two pixels.

**The walk** (map_fire_pressed 0x1de35 runs once a tick): Jack stands on
a pixel `(x, y)` (0xd9810, 0xd980a) and knows the neighbour he came from,
`came` (0xd981c), numbered as 0x1e539 reads them — 0 1 2 across the row
above, 3 4 5 (4 himself), 6 7 8 below.

- *Starting* (map_walk_step 0x1e1c1). The arrows are pairs, the map being
  isometric: UP may go to 1 or 2, DOWN to 6 or 7, LEFT to 0 or 3, RIGHT
  to 5 or 8 — tried in that order, each of the pair that is path moving
  him (both, if both are: the second on flags read before the first move).
  It needs the arrow **held**, or the push after a warp. On a trashed
  point any arrow will do; on any other pixel — an untrashed point, or
  path — only the arrow whose pair holds `came`, **back the way he came**.
- *Walking* (0x1e09f, then 0x1e5c9). Each tick one pixel: never to `came`
  or himself; on the first tick after an arrow only along its pair (0xd981b,
  cleared that tick even when nothing along the pair is path, so he may
  stand a tick); a point before plain path; else the first neighbour in
  order. He goes on without the arrow.
- *Stopping*: stepping onto a point stops him there (0xd981e = 1, the point
  in 0xd981f) — every point, the open path corners too. With the arrow
  still held he sets off again next tick, so held he walks through; at a
  level not yet trashed only turning back is open, so a level is a stop
  until it is won.
- *Warps* (map_take_warp 0x1e708): stopped on a node whose word 3 is set,
  and not having just come from there (0xd981d), he is put on the paired
  point with `came` = 4 and walks off by himself; the keys are not read
  for 35 ticks (0xd980e).
- *Facing* (map_pick_jack_facing 0x1e788): the walk is run 32 steps ahead,
  each step's offset weighted 32 - k; `|dy| * 10000 / |dx|` under 0x102c
  is level, from 0x3cf0 upright, between a diagonal, and the table at
  0x1dbc1 gives the direction by quadrant. A new one is taken after it has
  held two ticks (0x1e923).

**Coming back from a level** (0x1dbd9): Jack is put on the record's node
with `came` = 4. On a level he lost — untrashed — no arrow's pair holds 4,
so **he cannot walk off it**: fire plays it again. The clone keeps that.

**Fire** (any button, input & 0xf0) with him stopped on a point, then
map_process_node 0x1ffe9 when the front end comes round:

| node | not trashed | trashed |
|---|---|---|
| level (kind 1) | play it — unless its stage is below the last won (+0x1bc), refused | play again, while the timmy points it paid are in hand and the stage allows |
| number > 11 (kind 2: C bonus 12, T/U 29/30) | play it | refused |
| exit (kind 3) | play its D screen (number 13) | the world is done: next world |
| gate (kind 4) | 0x24e39 mode 1 — what it charges is not traced | — |

Winning trashes the node (map_node_trashed 0x20072), sets the stage, and
adds the level's timmy points to the shop's money.

**Lost** (VA 0x20e1d): a level asks "continue?" (0x1590e, `continue.md`)
and a yes costs a life — with none left the game is over; a bonus screen, a side level or
an exit's D costs nothing. A D won ends the world at once.

**Not in the clone yet**: the T/U side levels and the gates are refused
(the C/D bonus rounds are in: `levels/bonus-round.md`); the films; the landmarks and bins drawn over the picture
(`LEVSLBIN`, the world sheet's other frames — the clone marks the levels
with dots); the shop. The screen and its panel: `map-panel.md`.
