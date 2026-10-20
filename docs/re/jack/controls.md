# Controls and the jump — **Confirmed**

The game asks for six keys per player, in this order (VA 0x912c9):
LEFT, RIGHT, UP, DOWN, BUT1, BUT2 — and the input word the states test
(`0x28bf36` held, `0x28bf34` just pressed, copied from the player's
`+0x24` / `+0x28` each tick, VA 0x218a0) carries them as bits 1, 2, 4, 8,
0x10, 0x20. Bits 0x40 and 0x80 are two more buttons used when the
player's control mode (`+0x166`) is 4 or more.

| action | test | input |
|---|---|---|
| jump | VA 0x20e9f, from standing, running, skidding | BUT2 (0x20) pressed |
| duck into the hard hat | VA 0x22a66 | DOWN alone, pressed |
| the hoover | VA 0x2371f | BUT1 (0x10) pressed with UP held — unless the level's option bits 2 / 4 at 0x98224 forbid it |
| sideways windup | VA 0x2110d | button 0x80 (mode ≥ 4), or BUT2 (mode 2) |
| overhead windup | VA 0x21185 | button 0x40 (mode ≥ 4), or BUT2 with a direction (mode 2) |

**Where the input comes from.** 0x6b79b gives each player a device
(`+0x2a`) and a control mode (`+0x166`): the keyboard is device 1, mode
2, read by 0x6bbef as exactly those six bits (LEFT excludes RIGHT, UP
excludes DOWN); device 2 is the analogue joystick on port 0x201 (two
axes, two buttons), also mode 2; the GrIP pads are mode 6, with four
buttons 0x10-0x80 that 0x6bcec can remap. Demo playback is mode 6 too
(0x17956). Nothing ever sets 0x40 or 0x80 from a keyboard — so on the
keyboard every action is a combination of the six, and the raw `& 0x40`
tests (picking up from standing, VA 0x22ad1, and from the air, 0x22e89)
are pad-only.

**The pad's layout** (mode 4 and up — the GrIP pads, and every `.J`
recording, played back in mode 6). The state code asks through small
predicates (0x20ee0 … 0x21298) that test the keyboard's combination in
mode 2 and a pad button in mode ≥ 4:

| predicate | keyboard (mode 2) | pad (mode ≥ 4) |
|---|---|---|
| pick up while running (0x20ee0) | DOWN alone held | 0x40 held |
| put down / aim, holding (0x20f1d) | DOWN or UP held | 0x40 held |
| 0x20fa5 | DOWN held | 0x40 held |
| aim ends (0x20fe1) | no BUT1/BUT2 held | 0x40 held |
| 0x21022 | UP held | 0x80 held |
| 0x2105e drops it from the word | UP | 0x80 |
| 0x21084 | BUT2 pressed | 0x80 pressed |
| side strike (0x210c0) | BUT2 pressed + LEFT/RIGHT held | 0x40 pressed |
| sideways windup held (0x2110d) | BUT2 held | 0x80 held |
| 0x21149 | BUT2 held | 0x40 held |
| overhead windup held (0x21185) | BUT2 + LEFT/RIGHT held | 0x40 held |
| fly to the flag from the hat (0x211d2) | the armed flag | exactly 0x50 held (mode 6) |
| BUT1 pressed (0x21220) | BUT1 pressed | 0x80 pressed |
| BUT1 held (0x2125c) | BUT1 held | 0x40 held |

So on a pad 0x80 is the hammer and the sideways swing, 0x40 the overhead
swing, the pick-up and the throw's aim, BUT2 (0x20) stays the jump. Bit
0x200 is the look button (`camera_look_input` 0x1dcaa): held, the D-pad
moves that player's camera offset 32 a tick up to ±400 x, ±200 y instead
of moving Jack; let go, it comes back 32 a tick. In mode < 5 a player
flag (`+0x41` bit 1) makes BUT1 held stand for it (0x21298).
