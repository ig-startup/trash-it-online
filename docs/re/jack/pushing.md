# Pushing — **Confirmed**

UP held on the run goes into **0x2820b** (slot 38, sheet 207-222: arms
out, leaning in), standing into **0x28691** (slot 52, frame 245, the same
stance still). Neither pushes anything by itself — 0x2820b is a walk with
movement profile 4 (top 3.05 px/tick, accel 8000, turn 10000) whose frame
is his x, `(x >> 3) & 15`, run backwards facing left. Pushing back the
other way faster than 0x2bf20 (2.75 px/tick) skids him; with no direction
he brakes 5000 a tick and below 10000 stands in 0x28691, and a direction
from there walks again. BUT2 jumps, BUT1 does what it does from standing.

What makes it pushing is a search both states run while UP is held
(0x284e5 / 0x28771): sprites whose category has **bit 1** (template
`+0x10` set to 2 for the call, VA 0x2f0ab), up to the list at 0x3f1670,
whose frame his push point touches — x ± 18, 17 px up, inside a 4 px
strip at the frame's near side and between 30 and 3 px above its y
(`push_point_at_edge` 0x2ddd6) — and that are coming at him — `vx <= 0`
facing right, `vx > 0` facing left. The first is linked both ways (`jack[4]
= obj`, `jack+0x41 |= 0x20`; `obj[4] = jack`, `obj+0x41 |= 0x40`); one
another player holds is taken from him, and he gets a 3-tick wait
(`+0xa4`). The link lasts while they overlap. A linked sprite copies its
holder's `vx` every tick (VA 0x27f96) — and then runs its own physics and
friction on top, so it lags him slightly and he stays against it.

Of the whole cast **only one template has category bit 1: CWHL.SPR**, the
cannon's wheel. Pushing is for cannons.
