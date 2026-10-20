# The hammer shop — **Confirmed**

Where the story's timmy points are spent. Every address is F.EXE's; the
clone is `client/src/scenes/ShopScene.js`, the money in `Story.js`, the
data from `scripts/export_worldmap.py` (`export_shop`).

**Calling it** (map_shop_flight 0x1f3a1, a map object's tick): Jack
stopped on a point whose node is no warp (word 3 = 0), the second button
(input & 0x20), nothing else going on. With a special hammer in hand
(record `+6` ≥ 30: bfh, quality, galactic, dragon, moola, spoon) it is
refused with a sound. Else LSSHOP frame 0 — the house — drops from
(Jack's x − 90, −240) to Jack's y − 225 and on, slowed by 0x15f90 a tick
until it stops (sound 0x27; a bobbing script, 0x89f2e); 90 ticks later
it goes — 10 before that Jack is taken (his `+0xbc` = 1) — waits 100
ticks, climbs at 0x9c40 a tick per tick, and past y −440 the map fades
out (4 of 128 a tick) and the front end goes to state 10, the record's
node (`+0x1b8`) being the point Jack stood on. The house falls at **10 px
a tick** — `map_shop_flight` sets its speed's whole part (`+0x46`, of the
16.16 `+0x44` that `obj_move` adds to y) to 10 as it starts it.
**Jack taken** (`map_jack_taken` 0x1f827, every tick of `map_jack_tick`):
standing faced to us (direction 3) while the house is about, from `+0xbc`
= 1 he narrows — his drawn width (`+0xa4`, the blitter's stretch) going
down at a speed that starts at −0.15 and gathers 0.15 a tick — and past
10 px narrower drops his y order and goes one depth behind the house; at
22 px narrower (`+0xbc` = 2) he rises with it, his y and height moved by
a speed gathering 0.18 a tick, until 150 px up he is removed (`obj_remove`).
**The second button is fire too, where the shop does not take it.**
`map_fire_pressed` takes any button (`& 0xf0`), but new map objects go
in at the head of the list (0x256e8), so the shop's (made after Jack's,
0x1fd7a) ticks first: on a point with no warp it starts and sets
0x13971e, and Jack's tick then skips fire. Refused — a special hammer —
or on a warp, the same press goes on to Jack's tick as fire. The clone
does the same, and Jack is taken as above (`WorldMapScene.js`, `TAKEN`).

**The money.** Entering (shop_init 0x1b632) the hammer in hand is traded
in: its worth (shop table 0x89860, record `+4`; `front-end.md`) is added
to the timmy points (`+0x1be`). Leaving without buying (hammer_shop
0x1b92a) takes it back. So a hammer costs its price less the one given
up. The points do not travel: arriving in a new world sets them to 0
(front_after_level, 0x2125f). A won level pays its timmies into
`+0x20a[node]`; it can be replayed only while the points hold that much
(map_fire_pressed 0x1e037), and replaying it takes them back
(`map-dialog.md`) — spend them and it is shut; losing it pays
nothing and opens it again (0x21106).

**The screen** (`PROJ/HAMSHP_E.DAT`, one palette, HAMSHP_E.PAL): slot
0x8a HAMSHP_E, 0x22 YELMEDFT, 0x21 STATSPR, and HSHAMS. An object at
(x, y) is drawn at the picture's (x + 160, y + 128) plus its frame's
origin; the bars at (x + 160, y + 100).

| HAMSHP_E | what |
|---|---|
| 89, 90 | the picture: bottom strip, the rest (320 wide — `formats/rle.md`) |
| 0-9 | the money's red digits |
| 12-14 | the round buttons lit: buy, film, back |
| 16 | the ? over a cell not sold here |
| 20-22 | the cursor's brackets |
| 23-52 | the name plates, alphabetical |
| 53 | the glow on the hammer in hand |
| 54-61 | TIMMIES GIRTH SPLAT CONTROL RANGE RESTRIKE AREA SPREAD |
| 62-68 | SINGLE WHAMMY, DOUBLE YOKER, TRIPLE POKER, QUAD SLAMMER, RANDOM, CONTROLLABLE, NORMAL |
| 69-78 | small green digits (the price) |

- **The grid** (template 0x89ab0, shop_grid_tick 0x1c82b): HSHAMS, twenty
  254 x 175 frames of all thirty hammers turning, a frame every 4 ticks,
  at (−186, −137). Five columns, six rows, a cell 51 x 29: each column is
  two kinds, v1 v2 v3 of each — sledge/bio, ball-pein/volcanic,
  warhammer/splitter, piledriver/future, spikeball/apocalypse. The cursor
  numbers them **column × 6 + row** (0x1b5c6) — the order of the item
  table 0x897e8 and of the films `sla` … `apc`; the cover and sale tables
  **row × 5 + column**.
- **What a world sells** (0x8d90c, 30 flags a world), J H C S L I A T M:
  4 5 6 6 6 6 3 0 30 — J sledge v1, v2, warhammer v1, piledriver v1; T
  nothing; M all thirty. The rest get a ? (shop_cover_closed 0x1c659).
- **The hammer in hand** glows in its cell (shop_owned_glow 0x1c70c, cell
  table 0x89ad0), browsing only, drawn half and half through HAMSHP_E.STP
  (template mode word 0xa00d: draw mode −2; checked against HAMSHP_E.PAL,
  the table is the average — mean error 27 against 248 for the sum). The
  brightness it writes, 0x14 / 0x28 every 4 ticks, is never drawn: nothing
  in F.EXE's renderer reads an object's `+0xd4..+0xdf` (the three readers
  only test `+0xd6` ≥ 0xa8 / 0xaa to show an object at all).
- **Money**: five digits at (−60, −71), leading noughts left out
  (shop_money_digits 0x1bfed).

**Item record** (0x897e8, 32 bytes): name, `+4` price, `+6` hammer index,
`+8` plate (frame 23 + n), `+0xa`/`+0xc` girth bar (red part, green
part), `+0xe`/`+0x10` splat bar, `+0x12` control (frame 54 + n), `+0x14`
range bar (red only), `+0x16` restrike (54 + n), `+0x18`/`+0x1a` area
w × h, `+0x1c`/`+0x1e` spread w × h.

**The cursor** (shop_cursor_tick 0x1b31a, state in 0xd6dba):

- *1, browsing* — left/right through columns 0..5 with wrap, column 5
  being the buttons (cursor 30: on the "back" button); up/down
  through rows 0..5 with wrap. Fire on 30 leaves; on a hammer sold here
  → state 2; on one not sold, a sound. The brackets cycle 20 21 22 21 a
  frame every 3 ticks (its brightness, 0x80 / 0x46 every 5, is not drawn —
  the cursor does not flash).
- *2, the buttons* — up/down through buy, film, back, starting on back.
  The button is drawn as a silhouette (colour 254), steady. The card
  builds a step every 5 ticks (shop_card_tick 0x1c34f): the plate at
  (−252, −240); TIMMIES and the price; GIRTH and its bar; SPLAT; CONTROL
  and its word; RANGE; RESTRIKE and its word; AREA and STATSPR 0 at
  (−62, −2); SPREAD (moved 120 right) and STATSPR 1 at (58, −2). Labels
  at (−205, dy − 156) for dy 0, 15 … 90, 92; the bars (shop_bar 0x1c2e4,
  draw_bars 0x26efb) 4 rows — red 0xf2 0xf3 0xf3 0xf2, green 0x28 0x27
  0x27 0x28 — growing 5 px a tick; the rings (`shop_ring_tick` 0x1c0da)
  grow from nothing to w × h, the longer side 2 px a tick and the other in
  proportion — 4 each when square — both set to w × h once the width is
  there; `obj_draw` keeps a stretched frame's centre across and its bottom.
  Out of state 2 the card goes (the plate, the words, the bars, the rings
  moved to y 200 and hidden); the grid and the ?s stay under it.
  - *buy*: the hammer in hand → "you already own it!", 80 ticks, back to
    1. Else "buy the" / "<name> ?" / "yes ~ no" (state 3).
  - *film* (state 7, 0x1b5f0): `D\SMK\` film number cursor + 1, then
    back to 2. Not on the disc the clone reads; it shows nothing.
  - *back*: 30 ticks, then 1.
- *3, yes or no* — starts on yes; left yes, right no (0xd6dc6). An arrow
  (YELMEDFT 43 ←, 42 →) stands where the '~' is, swaying 0 1 2 3 4 3 2 1.
  No → 30 ticks, back to 1. Yes (shop_buy 0x1bf01): points < price →
  "you can't afford it!!", 80 ticks, back to 1; else "bought it!", record
  `+6` = the item's hammer, the points less its price, and after 80
  ticks (state 6) the shop is left.

**The words** (English, record `+0x204` = 0; tables of five languages at
0x89784 …): in YELMEDFT, centred on x −24 (flag 0x8000 of write_line
0x1d4e0), the message at y −37, the question at −67, −45, −23. The font
template 0x89b2c: letters from frame 0 either case, digits from 32,
signs by table (! 26, ? 27, - 28, : 29, . 30, , 31, ' 46, % 44), a
space 7 wide, a letter its width + 1, '@' a new line 15 down.

The grid and the ?s never hide: neither tick touches its visible bit
(`+0x90` bit 0x10, which the plate, the glow and the rings clear outside
their states), and no pointer to the grid is kept; the card is drawn over
them, depth 1 against 499 and 498. 0x1c273, which an earlier note took
for the rings' tick (+3 a tick), is dead code: no call, no jump, and the
one dword equal to it sits in the HAMSHP_E data block with no reader.
