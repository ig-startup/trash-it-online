# The keyboard layout, state by state — **Confirmed**

Read off every input test in the state code (`held` is `0x28bf36`,
`pressed` is `0x28bf34`). The hammer is **a mode**, not a button: Jack
starts empty-handed, BUT1 takes the hammer out of his hard hat and puts
it back, and BUT2 is the jump without it and the swing with it.

Empty-handed, standing (0x22892) or running (0x22275):

| input | goes to |
|---|---|
| LEFT / RIGHT | run (cycle A, profile 1) |
| BUT2 pressed | jump (0x22b91) |
| BUT1 pressed | hammer out of the hat (0x22fa5, slot 11) → standing with it (0x23499) — or 0x263a7 (slot 42) when `+0x9a` is set; level option bit 1 forbids it |
| UP held + BUT1 pressed | the hoover (0x24bb6 → 0x24e55); level option bit 4 forbids it |
| DOWN pressed alone, standing | into the hard hat (0x24346); at the top of a ladder, down it (0x29b15) |
| UP held, at a ladder | climb (0x25bda) |
| DOWN held alone, **running** (arrow let go, still moving) | **pick up** (0x267e3, via 0x20ee0) |
| DOWN **with** the arrow, after more than 50 ticks of running | **the roll** (0x29072, VA 0x2265c) — see below |
| UP held, running | push (0x2820b) |
| UP held, standing | 0x28691: the pushing stance, still — holds on to a cannon rolling at him (see Pushing) |

**The roll** (VA 0x29072, 0x2930c, 0x29589). The run counts in `+0x5a`
the ticks the arrow has agreed with the way Jack is going — back to 0
when it is let go or turned — and past 50 (0x32) Down with the arrow
sends him over his hands (slot 55, sheet 252-264). A frame every 4
ticks; from frame 8 on he may go on, and the speed the run gave him
stays while an arrow is held:

- BUT2 held → **the somersault** (slot 57, sheet 277-288 — slot 64's
  tumble uses the same): `vx` × 2.125, `vy` -5.5 px/tick, a frame every
  3 ticks; landing he runs on, or stands if `|vx|` is under 10000;
- the arrow held, from frame 12 → **cartwheeling on his hands** (slot 56,
  sheet 265-276), twelve frames round and round for as long as the arrow
  is held, BUT2 still turning it into the somersault;
- the other arrow → the skid; none → the run, which skids him to a stop.

Before he may go on, no arrow brakes him 5000 a tick down to 10000 and
stands him up. A wall ends it in the run. On the frames his hands or feet
are down (55: up to 8, and 12; 56: 0 and 6) there must be floor under
him, or he falls (0x256e9).

With the hammer out (0x23499 standing, 0x236b9 walking — cycle B,
profile 0, so slower):

| input | goes to |
|---|---|
| BUT2 held | sideways windup (0x23a27) |
| BUT2 held + LEFT/RIGHT | overhead windup (0x23f0f) — so walking with it, BUT2 always gives the overhead one |
| BUT1 pressed | hammer back into the hat (0x2320a, slot 10) |
| UP held + BUT1 pressed | the hoover (0x2a88c) |
| DOWN alone | 0x27ff7: clears `+0x9a`, hides the hammer entity — lays it down? (not traced further); option bit 2 forbids it |

In the hard hat (0x24727): UP pressed comes out (0x244c0); BUT2 pressed
goes to 0x26539 (slot 43) or 0x2a199 (slot 69) depending on 0x60c25.

With the hoover (0x24e55): LEFT/RIGHT walk with it (0x250d9); UP + BUT1
puts it away (0x2ab7a); BUT1 alone goes to 0x25468 (slot 9); DOWN alone
calls 0x28035, which spawns a sprite thrown upward at -2 px/tick —
emptying the bag? (not traced). Option bit 8 forbids both.

Carrying: see "Carrying and throwing" — DOWN puts down, UP aims, BUT1 or
BUT2 throws. In the air: DOWN held + BUT2 pressed goes to 0x2b3ac (not
traced).

The level's option word (0x98224, [level-options](../levels/level-options.md)) switches actions off: bit 1 the
hammer, 2 putting it away (BUT1 or DOWN with it out), 4 the hoover, 8 putting the hoover away.

The clone plays this layout with Z as BUT1 and X (or Space) as BUT2.
Not yet in it: the hammer's and the
hoover's DOWN actions, and the hat's BUT2. One choice is its own:
putting a carried thing down takes a fresh press of Down (the game tests
Down held, so keeping it held after the lift would drop it at once).
The level's option bits 0x01-0x20 are applied (`HAND` in `Player.js`).
