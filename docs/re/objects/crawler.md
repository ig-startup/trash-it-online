# The crawler: building the rocket — **Confirmed**

The levels whose bell waits for "the last of a crawling kind" (0L 2D 5L
9L TL) have no crawling enemy. `CRAWL.SPR` is the **crawler-transporter**
of a launch pad, and `.OB` classes 35–43 are the pieces of an **Apollo
rocket** (`APOLLO.SPR`, the constructors' own error string: `"too many
rocket bits???"`). Jack brings the pieces to the crawler one at a time,
in order, on a [forklift](forklift.md) — he cannot lift one himself; the crawler drives each to the pad and a crane arm stacks it.
When the last piece is on, level option 0x800 is set and the subtype-2
bell pops (see the bell section of [.OB](../formats/ob.md)).

## The pieces — classes 35–43

One constructor with nine entry points (VA 0x1195e…0x11993): class 43
enters with index 0, 42 with 1, … 35 with 8. Each spawns template
0x9362e (`APOLLO.SPR`, routine 0x11a1b) at payload `(x, y)`, sets the
frame to its index, stores itself in the table at 0x936c2 and counts
into `rocket_bits_left` (0x935b8). Payload 12 bytes; only x and y used.

| index | class | frame | the piece |
|---|---|---|---|
| 0 | 43 | 0 | the engine nozzles |
| 1 | 42 | 1 | the first stage, finned |
| 2 | 41 | 2 | a stage |
| 3 | 40 | 3 | the interstage |
| 4 | 39 | 4 | a stage |
| 5 | 38 | 5 | a skirt |
| 6 | 37 | 6 | the service module |
| 7 | 36 | 7 | the capsule |
| 8 | 35 | 8 | the escape tower |

A loose piece is a plain carriable sprite (`sprite_physics` +
`apply_friction`, 0x11a6c). The one the crawler wants next
(`rocket_next_bit`, 0xcd510) **blinks**: 8 frames of every 32 it is drawn
with the draw mode at 0xa1c48 (0x11a43).

## The crawler — class 44

Payload 16 bytes: x, y, then word 7, whose lowest set bit is how many
pieces are **already stacked** when the level starts. The constructor
(VA 0x111fb) builds:

- the **pad**, frame 13, at `(x, y)`, does nothing;
- the **crawler**, frames 0–7 (`+0x62` base + `x & 3`, so the tracks
  turn as it moves), locked on the block under it (`tile_at`; none →
  `"crawler has no block to lock to"`) at block + (64, 31); that x is
  its home (`+0x5c`);
- its **lift**, frame 8, a child riding at crawler y + `+0x30`, eased
  toward the crawler's `+0x58` (0 up, 18 px down) by `ease_toward`
  (0.72 px/tick, 0.24 within 6 px);
- the **crane arm**, frames 9/10 (alternating with its y), above the pad,
  and its **hand**, frame 11 open / 12 closed;
- the **tower**: frame 14 at pad x − 41, seven frame-15 segments every
  61 px up, frame 16 on top.

The crawler's states (`+0x60`, table 0x936f6):

| state | VA | does |
|---|---|---|
| 0 | 0x11596 | waits; event list 0x936e6 runs 0x11803 on an `APOLLO` sprite touching it |
| 1 | 0x11683 | creeps (0.15 px/tick) to the piece's x + 14, then raises the lift |
| 2 | 0x115ae | once the lift is up, drives (0.78 px/tick) to pad x + 14; starts the arm (its target `+0x54` = −10) |
| 3 | 0x1162a | once the hand grips, the piece hangs 8 px under the arm, which rises to the piece's stack height; lift down, tracks frames 4–7 |
| 4 | 0x115f2 | once the lift is down, drives home → 0 |

**A piece is taken only if it lies on the ground** (entity `+0x40` bit
0x10) **and its index is the next one wanted** (0x11803). Anything else
touching the crawler is ignored, so the pieces go on strictly
bottom-up. Taking one increments `+0x66` and `rocket_next_bit`.

The arm (0x116c9) lets go at the height from `rocket_stack_heights`
(0x9369e, px above the pad: 8, −8, −68, −141, −177, −253, −272, −318,
−348); the piece turns static, `rocket_bits_left` drops, and **at 0 the
level option byte gets 0x800**. The arm waits 35 ticks and goes back up.

## One rocket over three levels

| level | already stacked (word 7) | to bring |
|---|---|---|
| 0L, 2D, TL | none (1 → bit 0) | 0–2 |
| 5L | 0–2 (8 → bit 3) | 3–5 |
| 9L | 0–5 (64 → bit 6) | 6–8 |

5L and 9L still place the earlier pieces in `.OB`; `crawler_prestack`
(0x11539) puts them on the stack on the first tick and counts them off.
The rocket is built across the story — engines, then the middle, then
the capsule and tower in 9L. Nothing launches it: the level simply ends
at the bell.
