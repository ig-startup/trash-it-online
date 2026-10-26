# The forklift — **Confirmed**

`.OB` class 23 (`FORK.SPR`) is a **forklift Jack drives**, with a
five-speed gearbox. It stands only in the rocket levels (0L 2D 5L TL one,
9L three), because it is the only way to move a rocket piece: the
`APOLLO` template's category is 0x81000 — no bit 0, so Jack cannot pick
one up (see [carrying](../jack/carrying.md)) — and the forks search for
exactly 0x1000. See [the crawler](crawler.md) for where the pieces go.

## The parts

Constructor VA 0x1bbc3, payload 12 bytes (x, y, the rest 0 everywhere).
The body (template 0x9838e, frame 8; frame 9 for 6 ticks when it jolts)
runs 0x1c09b and starts a looping engine sound. Children: the rear and
front wheels (frames 0 and 4, 0x1bd41: four frames each, turned by x),
the mast (frame 10, 0x1bd26) and the **forks** (frame 11, 0x1bd87).
`FORK.SPR` also holds the "SPORT BOX" sign (16), a gauge (17) and the
**gear lever, frames 18–22**, which the driver's panel shows (0x1c553:
frame 18 + gear).

## Getting in and out

Jack's event list (0xa2f48), type 6 → 0x1c19f: Jack touches the body,
is not rising faster than 2.82 px/tick, is in animation slot 5, 30 or
74, and his point falls in the seat (hotspot 0x9842a: 6, −16 from the
body, ±10 × ±16, mirrored facing left). He is linked to
the forklift (`+0x5c` the driver, `+0x87` bit 2), drawn just in front of
it, takes state 0x2b7e4 (slot 77), and the forklift gets half his vx.
Each tick (0x2b86b) he sits 2 px behind and 17 px up from the body.
**BUT2** (pressed) gets out. If the forklift drops more than 8 px in a
tick (`+0x86` 0x20/0x40) Jack is thrown off with its fall speed, and so
is the load.

## Driving

The driver's keys become the forklift's control word `+0x86` (0x2b86b):

| key | bit | does |
|---|---|---|
| the way it faces | 2 or 4 | accelerate |
| the other way | 4 or 2 | brake; past −1.07 px/tick it turns round, gear back to 1st |
| BUT1 held | 0x400 | dust when braking |
| BUT1 pressed | 8 | **shift up** (gear `+0x70`, 0–4), with a puff of dust |
| pad button 0x40 pressed | 0x10 | shift down — **no keyboard key does this** |
| UP held | — | forks up a pixel a tick, to 80 px |
| DOWN held | — | forks down, to 0 |

The gearbox (0x1c331), per gear 1–5:

| gear | ratio (0x98474) | push (0x98488) | top speed at 8500 rpm |
|---|---|---|---|
| 1 | 25 | 200 | 3.2 px/tick |
| 2 | 50 | 60 | 6.5 |
| 3 | 80 | 30 | 10.4 |
| 4 | 100 | 15 | 13.0 |
| 5 | 120 | 7 | 15.6 |

`rpm = |vx| / ratio`; accelerating adds `push × ratio` (16.16) per tick,
×1.5 above 6500 rpm, ¼ above 13000; braking takes away twice that. Over
the limit (`+0x60`: 8500, or 14500 for a variant no level places) it
brakes: the code works out `(rpm − limit) / 8` but the braking branch
overwrites it with `push × −2`, so over the limit is braking, and the
pedal does nothing. Off the pedal (and braking) it coasts down by 2000 a
tick and stops under 6000. The engine sound (0x14, started at the
forklift by `play_sound_at`) has its rate follow.

## The forks

The forks (0x1bd87) search what overlaps them with mask 0x1000 (event
list 0x9841a, any type → 0x1c002): a thing whose point lies on the forks
is taken — its category and layer saved, its gravity cancelled. The
search runs only while the forks are off the ground (`+0x72` ≠ 0), and
the forks' hotspot (0x9837a) is 55, −4 from them, ±20 × ±6: a thing on
the forklift's own ground is in reach only with the forks raised one
pixel; one on a ledge, with the forks at its height. Raising
lifts it; it rides at fork height − 4 and moves with the forklift.
**Lowering to the ground, or onto something it lands on, lets go**
(0x1bfca) — which is how a piece ends up lying on the ground beside the
crawler. Moving the forks plays sound 0x15 once per movement.

**Clone:** `client/src/scenes/rocket.js` (`_forkliftTick`, `_gearbox`,
`_forksTick`, `board`), Jack's `driving` state in `Player.js`. Ours: one
who has just got out (or been thrown off) cannot get back in until he
has left the seat. Not in it: the engine sound, the dust, the gear lever
on the panel, shifting down (no key does it).
