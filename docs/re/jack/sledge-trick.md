# The sledge hammer v3's trick — **Confirmed**

Hammer 20, the sledge hammer v3, armed by its key combination (D+BUT2,
BUT2, three times; see [combos](combos.md)), turns the next overhead
windup into a throw: Jack slams the sledge into the floor ahead, it
**rebounds straight up through the building, about 1250 px**, hangs, and
falls back onto whatever is under it as a heavy weight — the higher the
drop, the more it doubles.

## The slam

Jack's state `sledge_v3_trick` (0x2a4d8) plays slot 66 for 28 frames,
carrying his slide (vx eased to 0 by 5000 a tick, stopped by walls). At
frame 8 it marks the player's hammer as away (+0x9a = 1), moves the
hammer entity (0x28bf28) 62 px ahead in the way he faces and calls
`sledge_trick_slam` (0x34590):

- the hammer takes frame 60 and looks 1 px down for a floor
  (`probe_level_bottom`, else `probe_floor_ladder`, `& 0x66` — solid
  blocks and platforms).
- **No floor there:** it simply drops — vy +21.4 px a tick, mass
  (+0x4c) 6, the striking flag (+0x41 bit 0x10), routine
  `hammer_dropped`; the camera takes it in for 120 ticks.
- **Floor:** a shake, frame 61, vy −21.4 px a tick, mass 6, the camera on
  it for 780 ticks, the player's +0x160 = 1, routine `sledge_trick_rise`.

## The rebound

`sledge_trick_rise` (0x34686) moves it up by vy and slows it by 12000
(0.18 px/tick²) a tick, **with no collision** — it goes through anything.
While faster than 2 px a tick it throws sparks (`start_effect` with
0x28b918 = vy / 4). That is 117 ticks and about 1250 px.

Once slower than 4 px a tick it starts turning: a frame every 3 ticks
from 61; it stops rising at the top, and at frame 77 (about 48 ticks
later) it becomes a falling weight: frame 60, vy 2000, **mass 12**, the
striking flag, routine `sledge_trick_settle` (0x34747).

## The fall

`sledge_trick_settle` runs the shared sprite physics (0x1f098) with
gravity 20000 (0.31 px/tick²), capped like every loose sprite at
24 px a tick (0x180000) — reached after about 950 px. Landing on a block
at 5 px a tick or more strikes it as any heavy sprite does
([collapse](../logic/collapse.md)):

    force = (mass << (speed - 2)) >> 1      # up and down the structure

With mass 12: 3072 at 10 px a tick, 3 million at 20, **25 million** at
the 24 cap — which means the full fall, from 1250 px up, brings down
any building the trick was thrown into. Thrown into a low one, the
hammer drops short and strikes harder only the longer its fall.

When it stops (vy ≤ 0 after landing) it becomes an ordinary dropped
hammer (`hammer_dropped`, mass 0, the striking flag off) and the
player's +0x160 is cleared — Jack has to go and pick it up.
