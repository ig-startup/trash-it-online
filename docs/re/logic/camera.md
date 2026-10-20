# The camera and its targets — **Confirmed**

The camera does not follow Jack: it frames a **list of targets**, and
anything can join that list for a while — a bell that pops out, a hidden
button that appears, a launched see-saw load, a fixed point a script
places. The clone's camera (`client/src/scenes/GameScene.js`,
`_updateCamera`) frames the Jacks only; the list is what it lacks.

## The list

`camera_targets` (VA 0x287d84): 32 entries of 16 bytes.

| offset | what |
|---|---|
| +0 | the entity, or 8 for a fixed point; 0 = free |
| +4 | ticks left (s16); −1 for good |
| +8 | flags: 2 the count waits until the entity stops (vx = vy = 0), 4 a fixed point, 8 **priority**, 0x10 skipped |
| +0xc, +0xe | the point's x, y (fixed points only) |

- `camera_track` (0x1d9d6): entity eax, ticks dx, flags ebx; joins only
  when cx is 2, or cx is 1 and the entity's +0x41 has bit 0x80.
- `camera_point` (0x1da48): point (ax, dx) for bx ticks, flags 4.
- `camera_target_remove` (0x1da39): frees slot ax.

Each tick `camera_targets_bounds` (0x1daa7) counts the ticks down, drops
an entity target whose +0x40 bit 2 is set, and takes the box round all
live targets — **round the priority ones alone, when there are any.**

## Framing

`camera_update` (0x2bfda), by the mode `choose_camera` picks (0x28bf60):
1 frame the targets, 2 hold a point, 3 debug keys. In mode 1,
`camera_frame_targets` (0x2c22f):

    x0 -= 60;  x1 += 60;  y0 -= 102;  y1 += 60
    width  = max(x1 - x0, (y1 - y0) * 320 / 200)
    centre = box centre
    option 0x98225 bit 0x40: x  = 0x28bf8e      (the apocalypse's locks)
    option 0x98225 bit 0x80: y  = min(0x28bf8a, level_bottom - 50)
    option 0x98226 bit 1:    width = 0x28bf86

`camera_ease` (0x2c198) moves an eighth of the way a tick in x and y, a
quarter in width, keeps y at least 90 over the ground; `camera_set_target`
(0x2be4e) clamps the width to 320…0x27ff, adds the shake, and sets the
scale 320 / width and the visible box.

## Who adds targets

| who | VA | ticks | flags |
|---|---|---|---|
| each Jack | `initialise_a_player` 0x214eb | for good | 0 |
| a hidden button appearing | `button_hidden` 0x17390 | 120 | 0 |
| the bell coming free (subtypes 2, 4, 8, locked) | 0x33fd3, 0x34040, 0x340a5, 0x340fa | 180 | 0 |
| the bell touched | `bell_touch_tick` 0x341f2, 0x3423a | 60, then 900 | 0, then **8** |
| the sucker armed | `sucker_armed` 0x191d8 | 120 | 2 |
| the super hoover | `spawn_super_hoover` 0x1b447 | 180 | 0 |
| a see-saw's load | `seesaw_launch` 0x1eda0 | 120 | 2 |
| a cannon's shot | `launch_at_45` 0x60170 | 120 | 2 |
| the sledge v3 slam | `sledge_trick_slam` 0x3462b, 0x34653 | 120, 780 | 0 |
| the apocalypse hammer | `apocalypse_start` 0x152f6 | for good | **8** |
| the demolition (2T 4T BA) | `demolition_start` 0x1b0f6 | 800, a point 1900 px over the bottom | 4 |
| the MOOLA demolition | `moola_demolition` 0x204f4 | 400, 1600 px over the bottom | 4 |
| the dragon show | [dragon show](../levels/dragon-show.md) | 1640 / 1630, priority points | 4+8 |
| Jack in the hat; the bonus round; the apocalypse's flight | 0x247e1, 0x10ddc, 0x15654 | 70; for good; 200 — points | 4 |

So when the bell is rung, the camera turns to it alone for 900 ticks; and
a demolition draws the camera back to show the whole level fall.
