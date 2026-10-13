# Dynamite — **Confirmed**

Class 15's constructor (VA 0x1d2d5) reads the word at payload +14 and
makes one of two sticks — the clone's exporter used to read it as "a
linked pair", which it is not:

| +14 | template | state | lit by | count |
|---|---|---|---|---|
| 1 | 0x98c84 | 0x1d405 | a hammer: it reads the sprite hit flag (`+0x40 & 0x80`) the **overhead** strike sets (sound 0x58) | 63 |
| 2 | 0x98ca0 | 0x1d7bb + a sparking child (0x98cd8) | **Jack touching it**: its event type (template `+0xa`) is 5, and outcome 5 of Jack's event list (0xa2f48, an array by type) is VA 0x1d7e1 | 139 |

Once lit: 35 ticks of the stick hopping (offset tables 0x98d3c/0x98d6a),
a flame (0x98cbc, state 0x1d584) for 25 more (0x98db2), then a countdown
of ten steps of eleven ticks (VA 0x1d60b) — about 170 ticks, 2.8 s. The
blast then:

- calls the hammer's blow routine (VA 0x1f8c5 → 0x1f905) at the stick
  with force **20,000,000**, extents 8 and 8 — the 3x3 cells around it —
  up to 4 blocks, flags 3 so it travels **down and up** (damage_down and
  damage_up), and rubble masks 0x3ffff;
- runs a sprite search 70 px either way (VA 0x1d8d1) that sets the hit
  flag, force 0x4001, on what it catches — which lights the next stick;
- shakes the screen by 30 and plays sound 0x59.

The 3x3 reach is small: a stick has to be against what it is meant to
bring down. Sticks are physical sprites (VA 0x1f098, with the same `vx =
-vx/4` off walls as Jack's skid), and the way to get one there is to
carry it — see "Carrying and throwing" below. A lit stick can still be
picked up: lighting clears bit 2 of its category, not bit 0.

The other dynamite (template 0xa011c, VA 0x20b84 — spawned by the
`DIS.SPR` sign and by one more object) is a different thing: when "lit"
it has mass 50000 and smashes through what it lands on, and nothing
lights it after it is made.
