# A falling block on Jack — **Confirmed**

Every tick (VA 0x21aef, from Jack's routine) 0x60a00 looks along Jack's
width in the **falling** map (0x69fdf reads the provisional map 0x40f334,
where moving groups are stamped) for a solid block over him:

- in the air: rising, his `vy` flips downward; falling, he gets half the
  block's `vy` on top of his own;
- on the ground without the hat: the block goes in the player's `+0xac`
  and Jack enters **0x29c92** — pinned; each tick the block's descent since
  contact is his squash, `+0x52` (height) down by it and `+0x50` (width) up
  by half of it. When the block stops pressing, or has pressed him more
  than **32 px**, he shoots out at `vy = -6` into **0x29f7a**: flattened —
  see "Flattened, and home to the flag" below;
- on the ground in the hard hat: **0x29e16**, the same pin, but he pops out
  at `vy = -4` into **0x2a199** (slot 69): no sideways push, half gravity
  (0x2400), and a springy wobble of width and height (`+0x50` kicked by
  0x28000, `+0x52` by -0x20000, each damped by `-value * 0x8000`) until he
  lands, back in the hat.
- holding something (`+0x40 & 0x20`), he drops it (0x1e7d5) and goes to
  0x256e9, or 0x26539 in the hat.

The same squash handler (0x21a70: hat → 0x2a199 at -4, else 0x29f7a at
-6) is outcome 2 of a "generic thing" (`.OB` class 26, event 9), which no
shipped level places.

## Flattened, and home to the flag — **Confirmed**

There are no lives and no death: a flattened Jack goes back to his flag.

**Flattened** (`jack_flattened`, VA 0x29f7a, slot 65, sheet frames
323-325, Jack as a pancake). On entry `vx = rand >> 15` either way, `vy`
(already -6) `+= rand >> 15`, the in-the-air bit cleared, a sound. Then:
- rising (`vy < 0`): `x += vx`, `vy += 0x4800`, `y += vy`, `vx` loses 4000
  a tick down to 0; as `vy` turns, the frame timer goes back to 1;
- coming down: **like a leaf, and through everything** — no probe at all.
  For timer phases 0-19 of every 32, `vx ± 0x3000` (+ in even turns of
  32, − in odd ones; not by facing); `x += vx`; `vx` loses 0x1500 a tick;
  and he sinks by half his sideways speed, `vy = |vx| / 2`. The frame is 1
  or 2 by the half of the swing and 0 between (phases 16-25), swapped when
  he faces left. At `y ≥ level_bottom` he lies there, frame 0;
- once the timer passes **150** (counted from the top of the fling, not
  from landing — he may still be in the air) → `jack_fly_to_flag`.

**Home** (`jack_fly_to_flag`, VA 0x2a2fe, slot 64, the tumble frames
277-288, one every 3 ticks). Speeds zeroed, a sound (0x98). Each tick,
toward his flag (`flag_positions[player +0xa8]`):

    v += (flag - pos) >> 6;   v -= v >> 3;   |v| ≤ 16 px/tick;   pos += v

nothing in the way counts. Slower than 1/16 px/tick both ways and within
1/64 px of it, he is put on it (`fall_start` there) and goes to
`jack_stand_hub2` (VA 0x256e9, slot 29) — falling, with air control —
and lands under it.

**The flag** is `.OB` classes 2-5, `(x, y - 10)` per player
(`ob_flag_common`, VA 0x1f499). 103 levels place only player 1's and 12
only the first two; the others keep whatever the last level left. The
clone fans the missing ones out 24 px apart from the last placed one.
Each Jack in the game has a FLAG.SPR entity (`initialise_a_player`, VA
0x21337; templates 0xa34ec… recoloured per player): a striped beacon
turning through frames 0-7 every 2 ticks and bobbing 0-10 px below its
point by `flag_bob` (0x997c0), each player's a quarter-turn further on
(`flag_tick`, VA 0x1f5aa).

The other way home: in the hard hat (`jack_in_hat`, VA 0x247bc), when
`jack_combo_taken` (0x211d2) finds a key combination recorded in the
player's `+0xb0` table, every timmy he holds goes up as an angel
(0x33861) and he flies to the flag — a "give up" move. The combination
itself is not traced (Unsolved).

The clone: `Player._flatStep`, `_homeStep`; `client/src/scenes/flags.js`.
