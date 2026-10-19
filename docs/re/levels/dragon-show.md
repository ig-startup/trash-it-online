# The dragon show (1D's button, the mystical dragon hammer) — **Confirmed**

Level 1D's red button and the mystical dragon hammer's trick (hammer 33)
start the same scripted scene: a giant demon face over the level,
lightning, the camera sweeping across it, the screen going red, then a
blow from below that brings the whole level down while the camera
climbs. About 27 seconds, under CD track 10.

## How it runs

`sequence_start` (VA 0x204be, the 1D handler of option 0x1000, see
[buttons](../objects/buttons.md)) and `dragon_sequence` (0x204c3, Jack in
eax) set an 80-tick timer, note Jack's x (0x28b96a) and his player's
+0xa8 (0x28b95e), and play CD track 10. Neither global has a reader.

`logic_frame` calls `level_sequence_step` (0x20409) every tick: it runs
routine `dragon_steps[step]` (table VA 0x9ff42, 16 entries; step at
0x28b95c), then counts the timer 0x28b960 down and moves to the next step
when it reaches 0. A step that sets no timer advances itself. Entry 0 is
a bare `ret` — the idle state, before and after the show.

All the camera work is done with two **priority camera points**
([camera](../logic/camera.md)): while any priority target lives, the
camera frames only those. One sits at the bottom centre of the level for
1640 ticks; the other (`dragon_cam_point`, 0x28b958) starts 400 px above
it for 1630 ticks and is what the steps move. The camera frames the box
around both — so moving the second point pans and zooms.

The face and the bolts are `VM.SPR` (sprite 0x4d): frame 0 is a red demon
mask (106 × 93), frames 1-4 lightning bolts. Both are drawn stretched to
the size in the entity's +0x50 / +0x52.

| step | VA | ticks | what happens |
|---|---|---|---|
| 0 | 0x1fef8 | 80 | nothing (the start's timer) |
| 1 | 0x1fef9 `dragon_face` | 400 | the two camera points; the face (template 0x9fea2, state `vm_expire`) at the bottom centre, 400 × 400, for 250 ticks; palette targets R G B → 100 (dim); 0xa2f0e = 2 |
| 3 | 0x2000c `dragon_face_closer` | 140 | the face again, 500 × 500, 250 ticks; palette → 70 |
| 5 | 0x1fecf `dragon_lightning` | 285 | `spawn_vm`: a bolt (template 0x9febe, `vm_flicker` — frames 1-4 and a random jitter, the palette flickering) at the bottom centre, 100 × 500, 250 ticks |
| 7 | 0x200b4 `dragon_cam_left` | 0 | the moving point 1000 px left |
| 8 | 0x200c7 `dragon_pan_start` | 0 | sets 370 ticks for step 9 |
| 9 | 0x200e4 `dragon_pan_rise` | 370 | the point 4 px right a tick (a slow pan from far left past the centre); red pulses 150/100 every 32 ticks (ease speed 2). With 70 left: G and B → 0, R → 220 (the screen turns red), the point back to the bottom centre, then up 12 px a tick |
| 10 | 0x20189 `dragon_blast` | 55 | a flash (current R G B = 128, 255, 255); shake 60; `damage_bottom_row` with force −1 (every block on the bottom row hit from below, so the blow climbs the whole structure — see [collapse](../logic/collapse.md)); option word 0x410470 = 0xffff (as in `demolition_tick`); a `DUST.SPR` column 50 × 900 from the bottom centre (`spawn_sized_effect`) |
| 11 | 0x2022e `dragon_rise_on` | 55 | the point up 7 px a tick |
| 12 | 0x2024c `dragon_palette_back` | 0 | palette targets back to 128; 0xa2f0e = 1; sets 280 ticks |
| 13 | 0x20293 `dragon_settle` | 280 | 0x28bf7e back up by 2 a tick, the point up 2 with it, until 0 |
| 14 | 0x202d1 `dragon_end` | — | step and timer 0: idle |

Steps 2, 4 and 6 are the `ret` at 0x200b3 — the waits. Entry 15 is the
`ret` at 0x1fef8 and is never reached.

0x28bf7e goes down 10 a tick for the last 70 ticks of step 9 and 6 a
tick through step 11 (−1030 in all), then back to 0 in step 13. Nothing
reads it: a sweep of every instruction for its address, the dword at
0x28bf7c, and any register loaded with an address near it (a base for an
offset) finds only these steps and `apocalypse_script` zeroing 0x28bf7c.
The same holds for 0xa2f0e (2 during the show's first half, 1 otherwise).
Both are written and never read — whatever they were meant to move (a
backdrop offset, a palette mode) was left unwired.

## What is left

`sequence_handler_unused` (0x1b0ad) is a third option-0x1000 handler that
nothing points at: 80 ticks, a camera point 900 px over the bottom for
good, the sequence globals set but the step left alone.
