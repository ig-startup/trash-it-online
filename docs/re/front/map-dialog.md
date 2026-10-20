# The map's dialog: play, buy back, toll gates — **Confirmed**

What fire on a node asks before anything is played. Every address is
F.EXE's; the clone is `client/src/scenes/mapDialog.js`, asked from
`Story.fire` and answered in `WorldMapScene`.

**The sign** (template 0x8a13a, behaviour 0x1eaf4): LSSHOP frame 1 — the
metal "TRASH-IT" board on two poles — pinned to the screen (`+0x92` bit
8), coordinates as the panel's (`map-panel.md`: the screen's (x + 160,
y + 128)). It starts at (−154, −384) going down at 16 px a tick, slowed
by 0x84d0 a tick; where its speed reaches 0 it stops (sound 0x23) and its
words are written. While it is up (0x139714 set) Jack's keys are locked
(0xd980e = 1000). Answered, the words go and it leaves at 6 px a tick
down, sped 3 a tick upward, gone below −80 px a tick; then the keys are
free again.

**What map_fire_pressed asks** (`+0xc0` of the sign; `world-map.md`):

| node | mode | words (YELMEDFT, centred on x 0, at y) |
|---|---|---|
| a level not trashed, an exit numbered ≤ 11 not trashed | 3 | "timmy points@available: N" −56, "play level?" 0, "yes ~ no" 24 |
| a level trashed — while the points it paid are in hand | 0 | "timmy points@available: N" −72, "buy your way" −29, "in for" −13, "P timmies" 3, "1 continue ?" or "0 continues" 19, "yes ~ no" 41 |
| a gate (kind 4) not trashed, toll ≤ points | 2 | "timmy toll gate" −64, "you need" −40, "T timmies" −24, "you have" −8, "M timmies" 8, "open gate?" 32, "yes ~ no" 48 |
| the same, toll > points | 1 | … "try again!" 32 — its '~' twelve lines lower, off the sign |
| (not from the map's fire) | 4 | "quit game@@are you sure?@yes ~ no" −40 |

- **N, the points available** = 2 × node word 17 + 20 × node word 18:
  word 17 is the level's timmies, word 18 its king timmies (checked
  against the levels: the kings match exactly; word 17 counts the
  dispensers' too). Two a timmy knocked, twenty a king — the most a
  level can pay (`level-record.md`).
- **P, the price of a replay** is what the level paid when won (record
  `+0x20a[node]`), "timmy" for 1; the continue is shown when the level's
  panels gave a life last time (`+0x26a[node]`, kept for every level
  played, 0x20e1d).
- **T, the toll** is node word 16: T's gates 840 and 1400, M's 600.

**The answer** (the '~' glyph object, 0x1e9da): it draws nothing until an
arrow is pressed — left shows YELMEDFT 43 (←, yes), right 42 (→, no),
swaying 0 1 2 1 every 4 ticks; a button gives `+0xbc` = 4 if the arrow
is 42, else **3 — yes, also when no arrow was pressed**.

- yes, mode 3: the level is played (map_start_node 0x1ff5a).
- yes, mode 0 (0x1f134): the points it paid are taken back (`+0x1be` −=
  `+0x20a[node]`, which goes to 0), and so are the lives it gave (`+0x28`
  −= `+0x26a[node]`, to 0); a byte per stage at `+0x1ce` (indexed by the node's
  stage, word 14) is lowered — dead: the four instructions that touch the
  six bytes (found by their displacement) clear them at a new game, a
  password and a world's start (0x15dcf, 0x19190, 0x20160) and lower one
  here (0x1f176); none raises or reads them, nor does G.EXE (its `+0x1ca`); then it is played.
- yes, mode 2 (0x1f244): the gate is trashed — Jack may walk through — and
  the toll taken from the points.
- mode 1, or no: the sign goes.
- mode 4, yes: front-end state 7, fade out — the game is left.

**The YELMEDFT colours** are the shop's on the map too: its letters use
indices 225-255 only, and those entries are the same in all nine map
palettes, in HAMSHP_E.PAL and in YELMEDFT.PAL — whichever palette the
screen has, they look alike. The clone draws them as in the shop.
