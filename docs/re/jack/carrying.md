# Carrying and throwing — **Confirmed** (except where noted)

**What can be picked up** is the template's business: Jack's search
(0x26971 → 0x2f0ab) walks the sprite list with his own template's search
mask (`+0x10`) set to 1 for the call, so it takes what has bit 0 in its
category word (template `+0xc`). In the cast: the hammer-lit dynamite
(0x98c84), `LEAD.SPR`, `CSAW`/`BCSAW`, the fire-extinguisher dynamite
(`CFIR`, 0xa011c), `TIMMY`, `TOMMY` and `KTIMMY` — and *not* the dynamite
that lights at a touch (0x98ca0, category 0x100).

**Taking hold** (0x21d51): Jack's frame and the object's must overlap
(0x2ef85), and his grab point — 11 px ahead of his feet, 5 up (VA
0xa0288) — must fall inside the object's frame (0x2dcb3). Then the two
are linked both ways (`jack[0] = obj`, `jack+0x41 |= 2`; `obj[0] = jack`,
`obj+0x41 |= 4`), and Jack's velocity becomes the average of his and the
object's.

**The states**, slot numbers as `play_anim` has them:

| state | slot | frames | what |
|---|---|---|---|
| 0x267e3 → 0x26971 | 44, 50 | 223-224 | bend for it; searches every tick while the button is held |
| 0x26c6a / 0x26e2c | 39, 51 | 223-230 | lift it |
| 0x26fe0 | 40 | 231 | standing, holding it overhead |
| 0x270e1 | 37 | 191-206 | walking with it |
| 0x27a94 | 48 | 191-206 | in the air with it |
| 0x27356 | 45 | 223-230 | put it down |
| 0x2767d | 47 | 232-235 | take aim |
| 0x27954 | 41 | 236-239 | let fly |

From standing with it, 0x20f1d decides: on the keyboard layout (mode 2)
DOWN puts it down and UP takes aim; on a four-button pad (mode ≥ 4)
button 0x40 aims, 0x40 with DOWN puts down. **Picking up** itself is
raw button 0x40 from standing and skidding (VA 0x22ad1, 0x227af) —
pad only — and, on the keyboard, DOWN held alone while running (0x225e1
via 0x20ee0), which is also what keeps the bend going. See "The
keyboard layout" below.

**The throw.** While he aims, the frame index (`+0x10`) steps 3, 8, 13
ticks in (`+0x58` growing by 5); at the last one the arc is drawn
(0x15bcb). Each tick a direction ahead or back moves the reach index
`+0x74` (0..31, from 16) and Up or Down the lift index `+0x76` (0..7,
from 4). The aim ends when the button test 0x20fe1 fails — in mode 2 a
press of BUT1 or BUT2. The object leaves at

    vx = ±reach[+0x74]   0.5 … 3.0 px/tick in 32 even steps (VA 0x93eb0)
    vy = -lift[+0x76]    0.5, 1.0 … 4.0 px/tick (VA 0x93f30)

from 10 px ahead of him and 41 up; the arc steps it with `vx` losing
2000 a tick and `vy` gaining 0x4800, for at most 68 ticks. Release
(0x27954 → 0x221b9) first checks the object can move a pixel ahead —
against a wall it is not thrown. In flight it is the sprites' shared
step 0x1f098: off a wall `vx = -vx/4`; landing slower than 1.5 px/tick
it settles, faster and it calls the object's own routine (a bounce in
the clone — **ours**). Where a carried object sits over his head is not
traced; the clone puts it on his head, 41 px up.

The jump (state 0x22b91, slot 5 — frames 6-12) starts at `vy = -4.5`
px/tick. From its eighth tick, while the key is held and Jack is still
rising, it adds lift: `vy -= boost`, the boost starting at 0x5400 and
falling by 0x6f0 a tick until spent (VA 0x22bf8-0x22c2d). A tap clears
36 px; a held jump about half as much again.
