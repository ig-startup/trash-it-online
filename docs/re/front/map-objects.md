# The world map's objects: bins, hats, landmarks, Jack — **Confirmed**

What stands on a world's picture and how it moves. Every address is
F.EXE's; the paths and the walk are in `world-map.md`, the screen file in
`proj-dat.md`.

**Objects** are made from 0x20-byte templates by `obj_create` 0x24e39
(template in EAX; the new object in 0x39a0cc): word 0 the sheet's slot →
+0x8c, word 1 → +0x9a (the draw depth; Jack's is 0x1cb, the landmarks' 3), dword 4 the
behaviour run every tick → +8, dword 0x18 → the slot's entry in 0xd66ac.
An object's x is +0x22, y +0x26, frame +0x94, and it is drawn at x, y
plus the frame's origin (`obj_draw` 0x234bf); bit 8 of +0x92 pins it to the screen
(the panel); `obj_remove` 0x2561c (bit 4 of +0x90) queues it for deletion.
A smaller depth is drawn nearer: T's node 15 goes to 0x1cd, behind Jack's
0x1cb, once he is lower on the screen than it, and the landmarks (3) are
the picture's own fences and signs, cut out for Jack to pass behind.
Bit 0x40 of +0x91 draws by y instead — Jack sets it on himself, a node's
depth -1 sets it, and a bin drops it when crushed flat (0x1f5f7 gives it
0x1cb then). Its reader is the draw queue (`obj_draw` 0x234bf, at
0x237d0): with the bit, the list an object goes into is its depth less
how far it stands below the screen's top (`y - (camera y - 128)`, 0 when
above it, at most 349) — the lower on the screen, the nearer. The lists
are 0x89c bytes each from 0x2653c0 (0x2382b).

**The map's templates** (0x89f7a + 0x20 k):

| template | sheet | behaviour | what |
|---|---|---|---|
| 0x89f7a | LVSL8FLM | 0x1f6c9 | on A: frame (tick / 5) & 7 |
| 0x89f9a | LVSL8FLM | 0x1f6f1 | on A: 8 + (tick / 5) & 7 |
| 0x89fba | LVSL8SPR | 0x1f713 | on A: frame 4 or 8, by turns every 30 ticks |
| 0x89fda | LSPANEL | 0x202ea | the panel's pieces (`map_screen_init` makes 3 + 6 + 6 + 2) |
| 0x89ffa | YELMEDFT | 0x1e9da | the panel's font |
| 0x8a01a | LSJACK | 0x1f941 | Jack (`map_jack_tick`) |
| 0x8a03a | LEVSLBIN | 0x1f5f7 | a level's **bin** — 89 nodes |
| 0x8a05a | LVSL7SPR | 0x1f689 | world T's node 15, the temple's turning machine — a fan spinning on a pipe-organ block, 60 × 105 drawn at its frame's own offset (141, 48) from the node's (0, 0); frames 0-7 every 3 ticks (0x89dc6); its depth is 0x1cd while Jack's y is 152 or more, else 1, so he passes in front of it below and behind it above. The node only carries it: level -1, open from the start, on no path |
| 0x8a07a | LS_HAT | 0x1f73f | a side level's **hat** — 10 nodes |
| 0x8a09a | the world's | 0x1c9ba (nothing) | a still **landmark** — 26 nodes |
| 0x8a0ba, 0x8a0da | the world's | 0x1f7ad, 0x1f7cd | drawn **until** its node is trashed — the C bonus and D exit points (and 3T) |
| 0x8a0fa, 0x8a15a | the world's | 0x1f7ed, 0x1f80a | drawn **once** its node is trashed — DS, CH |
| 0x8a11a, 0x8a13a | LSSHOP | 0x1f3a1, 0x1eaf4 | the shop |

`map_screen_init` writes the world's own slot (world table +0xa) into
0x8a09a, 0x8a0da, 0x8a0fa. The picture itself is frame (world table
+0xc) of the world's sheet (0x1db14).

**Which node has what** — `map_place_jack` 0x1dbd9 walks the world's
nodes and, for each with a template (node words 6-7, `icon` in
`front.py`), makes one at x = word 8, y = word 9, frame = word 12; word
10 is its depth, -1 for by y (bit 0x40); word 11 goes to 0x3724b8 first.
The object keeps its node's index (+0xbc) and is listed at 0x139648; the
node just won (0x13971c) is flagged (+0xc0 = 1). The world sheet's
landmarks stand at 0,0 — their frames carry their place as the origin.

**The animation scripts** (`script_start` 0x1d351 gives an object a
controller, run by `script_tick` 0x1ca9a; controllers are also F.EXE's
text writers, "couldn't find a free Text ctrl"). A script is dwords; one
under 0x8000 is a value — the frame, unless a mode is set — shown for
the current delay; the rest are commands:

| command | does |
|---|---|
| `eaa0 d` | the delay: each value shows d ticks (0 → 1) |
| `ea9c t` | wait t ticks; -1 forever |
| `ea9f n k` | jump back n entries, k times; -1 forever |
| `eaac n` | skip a random number of the next entries (`random` 0x202eb) — a random phase |
| `eaa4 v` | the controller's tag (+0x70) |
| `eaaf s` | play sound s (0x21a3b) |
| `ea93 m` | the mode: 0 frame, 1 +0xbc, 2 +0xc0, 3 and 4 the controller's own |
| `eaa1 a v` | the word at address a = v — how the title figure's swing tells the menu it has hit (`title.md`) |
| `eaa2 a v` | the same, a dword |
| `eaad` | the script ends, its controller freed (`script_stop` 0x1d45a) |
| `eaae` | the object removed (`obj_remove`) |

A **bin** (LEVSLBIN: frames 0-3 the lid lifting, 4-6 the bin crushed
flat) picks its script once (`map_bin_tick` 0x1f5f7):

- not trashed (0x89dfa): delay 3, a random phase, 0 1 2 3 2 1 for ever —
  the lid rattles;
- trashed (0x89e36): frame 6, held;
- won just now (0x89efe): frame 0, 40 ticks, sound 1, then 4 5 6 a frame
  every 5 ticks, held.

A **hat** (`map_hat_tick` 0x1f73f, LS_HAT 16 frames): not trashed
(0x89e4a) 0-11 a frame every 4 ticks from a random phase; trashed
(0x89e9e) frame 15; won just now (0x89ebe) 40 ticks, sound 45, then 0 12
13 14 15.

**Jack** (`map_jack_tick` 0x1f941): LSJACK's 136 frames are 8 standing
poses (0-7) and then eight walks of 16 — direction d (1 right … 8 up-right,
as in `world-map.md`) stands on frame d-1 (table 0x1e9d1) and walks
frames 8 + 16 (d-1) on (table 0x1e9c8). Walking, his frame is the walk's
first + ((tick / 2) & 15): a new one every 2 ticks, and as he moves a
pixel a tick, every 2 pixels; every 16 ticks sound 0x15, his step.
Stopped on a point, the standing pose.

**The tick** is one frame of the screen: `frame_end` 0x1a88a counts
0xd6d4c and waits for the vertical retrace (0x50990): 60 a second. F.EXE
sets its screen as G.EXE does — mode 13h with the misc-output register
rewritten to 0xe3 (0x50d66, 0x50d80; also 0x50e9f), the 480-line "mode
X" timing, or a 640 x 480 VESA mode — and both retrace at 60 Hz
(`jack/movement.md`). Its screens wait through 0x12bf2, which catches up
by the PIT clock / 13 ms when a frame runs late (`continue.md`).

**In the clone**: `scripts/export_worldmap.py` writes each node's object
(`icons`) and the sheets; `WorldMapScene.js` plays the bin and hat scripts
above as [frame, ticks] steps, the loops off the tick count, and orders
them by these depths (a node's -1 and Jack by y). The sounds are not in.
