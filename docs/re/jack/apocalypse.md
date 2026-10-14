# The apocalypse hammer's flight — **Confirmed**

Hammer 29, the apocalypse hammer v3, armed by its key combination (see
[combos](combos.md)), turns the next sideways windup into a set piece: the
hammer leaves Jack, climbs out of the level while the camera draws back
until the whole level is a speck, then **the player steers it down** like
a bomb, the camera zooming in with it, and it lands with a force that
grows with its speed — up to 16 million, enough to flatten anything.

## The start

`apocalypse_start` (0x15260, from `jack_windup_side` when the player's
one-shot flag for hammer 29 is 1; once at a time, 0xcd84c bit 0):
saves the hammer's routine and +0x48, sets the player's +0x160, makes the
hammer a priority camera target for good ([camera](../logic/camera.md)),
remembers the input word of the player (0xcd844 ← 0x28bf24), and sets its
routine to `apocalypse_script` with the script pointer (+0x60) at
`apocalypse_flight` (0x93ddc).

## The script

Words: an opcode, its arguments. `apocalypse_script` runs opcodes until
one returns 1 (`wait`), then each tick lets the frame ramp and the eases
run until the step that `wait` was for is done, then reads on.
Opcode routines: table 0x93d98.

| op | args | does |
|---|---|---|
| 0 frame | n | frame n |
| 1 rate | n | ticks per frame |
| 2 frame_to | n | step the frame toward n, one per `rate` ticks; done there |
| 3 wait | | stop reading until the pending step is done |
| 4 timer | n | +0x4a = n |
| 5 vel | dx dy dh | px a tick in x, y and **height** |
| 6 ease_y | n | ease y toward level_bottom + n (`ease_by_sixteenth`: 1/16 a tick, at most 6 px) |
| 7 ease_x | n | ease x toward x + n |
| 8 until_height | n | done when height > −n |
| 9 / 11 | | hold / free the camera's x and y where they are |
| 12 / 13 | | hold x, y and width / the width only |
| 10 dive | | frame 0x4f, the steered dive below |
| 14 | | 0x28bfa4 = 1 (cleared at impact; no reader found) |
| 15 / 16 | | the trail on / off (`apocalypse_trail`: an `APOCS.SPR` every 4 ticks) |

The **height** is +0x2c (16.16), raised by −vh each tick, and while the
camera's width is held it is `height + 250` (0x28bf86): the higher the
hammer, the further the camera draws back.

The flight, `apocalypse_flight` decoded:

    vel 0 0 0;  op14;  frame 61;  rate 4
    ease_x +450;  ease_y bottom-250;  frame_to 73;  wait      # swings out beside Jack
    trail_on;  hold width
    vel 0 0 -4;   until_height 60;   wait                     # lifts off
    vel 0 0 -15;  ease_y bottom-100;  until_height 1200; wait # climbs, 15 a tick
    ease_x -100;                      until_height 2000; wait
    ease_y bottom-350;  ease_x +150;  until_height 3000; wait
    ease_y bottom-150;  ease_x -150;  until_height 5000; wait
    hold x, y
    vel -2 -2 -6;  frame_to 78;  wait                         # turns over, slowing
    vel -2 -2 -4;  until_height 5300;  wait
    vel -2 -2 -2;  until_height 5500;  wait
    vel -2 -2 -1;  until_height 5600;  wait
    trail_off;  vel 0 0 0;  dive

So the camera ends about 5850 px wide — the whole level on screen.

## The dive

From `dive` on (+0x6c bit 0x40) the hammer is the player's. Each tick,
from that player's held input word ([controls](controls.md)):

- RIGHT / LEFT: vx ± 10000 (16.16), to ± 4 px a tick; DOWN / UP the
  same for vy. Nothing slows it back down.
- BUT2 held: the fall speed (+0x38) grows by 11000, to −48 px a tick.
  Without it, it falls at what it had: −1 px a tick, then −4 once
  +0x4e has counted down its 50 ticks.
- The camera's held x, y and width (0x28bf8c, 0x28bf88, 0x28bf84) move
  by vx, vy and the fall speed; the hammer is drawn at the camera's x,
  and at its y plus +0x4e + 15 — it drifts to the centre of the screen.

When the width drops under 170 it strikes: all camera holds and option
bits 0x4000-0x20000 are cleared, and `blow_at` hits an 8 × 8 box at the
hammer with the force and rubble mask of `apocalypse_blow_table`
(0x93ce0), picked by −(fall speed in px) / 2:

| index | 0-3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | … | 22 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| force | 1 | 500 | 600 | 700 | 900 | 1500 | 2000 | 4000 | 8000 | 16000 | 32000 | doubling | 16 384 000 |

A fall slower than 8 px a tick strikes with force 1 — nothing. Holding BUT2 all the way down
reaches about −44 px a tick (index 22). The table is 23 entries long and
the opcode table follows it: an index of 23 or 24 (a fall of 46-48 px a
tick, the speed cap) would read routine addresses as the force.

Then, by what `blow_walk_cells` reports:

- **struck a block but broke nothing** → `apocalypse_fall`: shake 60, it
  bounces up (vy −4 px), falls under gravity 0x4800, bouncing at half
  speed off the level's bottom, and when the bounce dies goes back.
- **otherwise** (broke something, or hit nothing) → `apocalypse_fly`:
  120 ticks rising 12 px a tick and speeding off sideways, the camera
  following two fixed points 1500 and 2500 px above for 200 ticks.

Both end in `apocalypse_return` (0x157f7): after 120 ticks the hammer
eases back to 32 px over its owner and takes its saved routine again.

## Not known

Who reads option 0x98226 bit 2 (set by `dive`) and 0x28bfa4.
