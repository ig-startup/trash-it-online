# Movement and gravity — **Confirmed**

Velocities are 16.16 fixed point, in pixels per frame, and every moving
entity goes through one shared step (VA 0x22d31):

    x += vx                                    # entity +0x24 += +0x30
    if not on the ground: vy += 0x4800         # entity +0x34, 0.28125 px/frame²
    if y - fall_start > 0x1660000: …           # +0x68 records where the fall began

**A fall longer than 358 pixels is special-cased** — the entity's `+0x68`
holds the y it started falling from, and crossing that distance branches
away before the normal landing code.

Horizontal movement is **not** a velocity set from the key, which is what
the clone does. It accelerates (VA 0x257c0):

    if vx > -maxspeed:  vx -= accel            # still speeding up
    else:               vx -= (maxspeed + vx) >> 5   # ease onto the cap

so Jack builds up speed and eases into his top speed rather than starting
and stopping dead. `maxspeed` is the player struct's `+0x14` and `accel`
its `+0x1c`; the struct is 360 bytes, four of them from VA 0x28b97c, and
the current one is cached at VA 0x28bf2c.

**Top speed and acceleration belong to the animation, not to Jack.**
`play_anim` (VA 0x21c26), whenever the slot changes, looks the slot up in a
u16 index at VA 0xa10d4 and copies a 12-byte record from VA 0xa1172 into
the player: `+0x14` top speed, `+0x1c` acceleration, `+0x20` the rate used
when pushing against the current direction. There are eight records:

| profile | top speed | accel | turn | used by (slots) |
|---|---|---|---|---|
| 0 | 100000 (1.53 px/tick) | 4000 | 8000 | most of them: walk cycle B (3), the windup and strikes (6, 15-21), the hat (22, 23), the hoover (28, 29), in the air (31), carrying |
| 1 | 350000 (5.34) | 12000 | 12000 | the run (0, state 0x22275), standing (1), skid (2), slot 5, into and out of the hat (12, 13), air roll part 1 (55) |
| 2 | 200000 (3.05) | 10000 | 10000 | 30, hitting the ground (32), 49, 74 |
| 3 | 45056 (0.69) | 4000 | 8000 | 43, 63 |
| 4 | 200000 | 8000 | 10000 | pushing (38) |
| 5 | 362000 | 12000 | 12000 | air roll part 2 (56) |
| 6 | 700000 | 12000 | 12000 | 64 |
| 7 | 1400000 (21.4) | 12000 | 12000 | air roll part 3 (57) |

So the run's top speed is set from *standing* (slot 1 already carries
profile 1), and a strike, the hat or the hoover drops the cap to 1.53
px/tick — the `>> 5` ease above is what bleeds
the excess off when that happens. `initialise_a_player` (VA 0x21337) only
seeds `+0x1c`/`+0x20` with 12000 before the first `play_anim` replaces
them. The pointer it puts in `+0x14` is overwritten the same way.

Friction is in the shared step, every tick, keys or no keys: `|vx| > 399`
→ `vx ∓ 2000`, else `vx = 0`.

Letting go of a run drops into the skid, VA 0x2266d, which moves Jack
itself rather than through the shared step and brakes harder: `vx ∓ 5000`
a tick, and once `|vx| < 10000` it zeroes `vx` and hands over to standing.
Pushing the other way brakes by the profile's turn rate instead and, once
`vx` crosses zero, goes straight back into the run. The skid's four frames
step every fourth tick and hold on the last. Running into a wall during
it bounces him: `vx = -vx / 4` (VA 0x227ea).

**The tick is the display's vertical retrace.** `game_main` (VA 0x2c52c) loops
on 0x2cb6e, which waits for retrace (port 0x3da), then runs the logic frame
(VA 0x2cbb9) once — or, if the machine has fallen behind, `elapsed_ms /
13` times, clamped to 1..4 and only changed when two measurements agree
(VA 0x10ad0; the millisecond clock is the PIT read at VA 0x76f26). Both
video set-ups in the binary are 480-line modes — VESA through `0x4f02`,
and mode 13h reprogrammed with misc-output `0xe3` (VA 0x61fd1), the 320x240
"mode X" timing — and those retrace at **60 Hz**. A 30 Hz PIT handler also
exists (divisor 0x9b5c at VA 0x60ccd, handler 0x685e3) but nothing calls
its installer directly. So: 60 ticks a second on a machine that keeps up,
with a catch-up step of 13 ms (≈77 Hz) when it does not.

## Jack's box: x ± 4 — **Confirmed**

What stops Jack is a box far narrower than he looks: **4 px either side
of his x, 42 px up from his feet** (VA 0xa0260, `{4, 42}`; the table
around it holds the other boxes — `{4, 30}` the ladder probe, `{8, 16}` a
small one). His states pass it in `esi`/`edx` to all the probes, 39 call
sites in all:
- `probe_wall_right` (VA 0x60393) reads the columns from `x + 4 + 1` to
  `x + vx + 4`, rows `y - 42` to `y`, all snapped to 8-px cells; a kind-1
  cell stops him at its left edge minus 1. `probe_wall_left` mirrors it.
- `probe_floor` (VA 0x60833) reads the row under his feet,
  `(y + 1) & ~7`, from `(x - 4) & ~7` to `(x + 4) & ~7`. So he stands on
  a ledge until his middle is 4 px past it, and slips past corners that a
  body as wide as his sprite would catch on.

The clone's touch box (what hurts him, the bell, what he picks up) stays
the sprite's 24 px; only the physics body is 8 wide
(`client/src/entities/jackMetrics.js` `BODY_WIDTH`). The original's own
touch boxes are the event boxes and frame rects, not this one.
