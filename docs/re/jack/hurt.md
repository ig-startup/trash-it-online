# What hurts Jack: spikes, needles, bombs, blasts — **Confirmed**

Names in `scripts/ghidra/symbols.d/hurt.txt` and `git.txt`.

**How a touch is told apart.** Jack's template carries an event list
(VA 0xa2f48): an array of outcomes indexed by the *other* sprite's event
type, which is its template's word at `+0xa`. A placed spike or bomb
(templates 0x93904, 0x939ec) is type 0 — nothing; only once walking do
they get templates of their own: the bomb git 0xa3ecc is **type 10**, the
spike git 0xa3ee8 **type 11**, and a spike's needle 0x93920 **type 12**.
The outcomes (not functions to Ghidra — only the table reaches them):

| type | outcome | what |
|---|---|---|
| 10 | 0x128c5 | a bomb on the ground starts chasing him — it does not hurt |
| 11 | 0x12491 | a walking spike hurts him (if its box, raised 24 px, overlaps him); the spike turns about unless it is bristling |
| 12 | 0x125c1 | a needle hurts him |
| 5 | 0x1d7e1 | the touch-lit dynamite (see above) |

**Hurt** (0x12491 / 0x125c1, shared). Nothing happens while `+0x7c`, his
invulnerability, runs. Otherwise for 50 ticks no event reaches him
(player `+0x15a`), he and the git **trade speeds** — each then held to
2-4 px/tick across and 2-3 up or down, or with none sent 2 apart
(0x12b54, 0x12bc1) — he is lifted half a pixel off the floor and drops
what he carries. Then:
- **Out of the hat**: invulnerable for **400 ticks** (0x2b9fd), up at
  **vy -4**, across at least 2, into slot 73 (0x2b152): it **spills
  eight timmies** (player `+0x15e`; each thrown up at -6 with a random
  kick, off his count — 0x338d0), slides with friction 2000 a tick, and
  landing at 1.5 px/tick or faster bounces at an eighth of the speed;
  slower he lands (0x25dfc). While invulnerable he blinks: the draw mode
  swaps every other 4 ticks, for the last 100 every 4 of 16 (0x2ba0f).
- **In the hat**: the hat bounces (0x26539, slot 43 — the hat frame,
  steerable, landing bounces at a quarter) and no event reaches him for
  17 ticks. No timmies, no invulnerability. Coming out of the hat (slot
  13) and at its frame 4 or later, he is counted out of it and just
  stands.

The UFO's bolt (0x1264b) is the same with speed 3 and no trade: up at 3,
across at least 3 — backwards if he stood still — and the eight timmies
the UFO set in `+0x15e`.

**The spike bristles** (spike_tick 0x332ef → spike_bristle 0x32cfb). Its
`.OB` record picks how often (word +0xe, a radio choice: lowest set bit
into the masks at 0x93af8) — never (471 of 543), every 1024 ticks (24),
512 (46) or 64 (2); its age starts at 500 and a bit. When `age & mask`
is 0 it stops (vx less 8000 a tick), its spines come out a frame every 4
ticks (slot 19, sheet frames 26-33), it shivers from tick 30, and **at
tick 50 eight needles fly** (0x12711, table 0x93898): from 12 px above
it, a fan upward at about 2-4 px/tick, each jittered. A needle falls at
0x2400 a tick, loses 2000 of vx a tick, turns frame 35 → 42 on its way
down, passes through everything and is gone below the level. After tick
100 the spines go back in (0x32f39) and the spike walks on.

**The bomb chases** (0x33a1f, slot 27). Touched on the ground it takes
its toucher's player number and goes after him: `vx += dx / 32` (`/ 64`
late in each 256 ticks), less `vx / 8`, at most 8 px/tick; a wall throws
it back at a quarter; more than 300 px across or 120 up or down and it
walks again. When it has stayed under 1.125 px/tick for **21 ticks** —
caught up with him — it **lights** (0x32550: smoke, the fuse a frame
every 4 ticks) and then **blows** (0x327c8: flickering; at tick 30 two
`BLAM` flashes, the shock, a shake, and `blow_at(x, y - 15)` with the
level's own force — rules `+0x44 << +0x46`, 30000 << 3 in most bomb
levels — rubble mask 0x7ffff, cells 10 across and 16 up and down, four
of them). The hammer's overhead blow pops a bomb or a spike harmlessly
(0x32b15: it swells and is gone with a puff and a shake). In the shipped
levels: 88 bombs in 14 levels (the `M` section, some `I` and `T`), none
locked to a block; the cap is the rules' `+0x3c`.

**A blast's shock** (blast_light_neighbours, 0x1d8d1 — the dynamite's
and the bomb's) marks every Jack, timmy and spike within 70 px with the
hit flag and `+0x4e = 0x4001`. Jack takes it in 0x2bc86: drops what he
carries, no events for 17 ticks, and — unless invulnerable — is pushed
by his distance from it each way, along table 0x98c6c (11 px/tick under
16 px, 6 at 50, none from 76; halved, quartered in the hat, and always
up when he stands). **Within 30 px** (his middle, 21 px above his feet)
**he is hurt** as above, losing four timmies. In the hat the hat bounces.
