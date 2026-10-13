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
