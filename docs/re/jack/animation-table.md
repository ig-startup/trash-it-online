# Jack's animation table — **Confirmed**

The client's poses were picked off a numbered contact sheet by eye, and
several are wrong — a frame lifted out of the middle of a sequence reads
as a different action entirely. The game keeps the real thing: a flat
array of pointers at VA 0xa11d2, **79 slots**, each pointing at a list of
u16 frame numbers into `SPR/JACKS.SPR`. The slot number is the argument a
state passes to `play_anim` (VA 0x21c26, `[slot*4 + 0xa11d2]`).

**Until 2026-10-06 these notes put the array at 0xa11ca**, eight bytes
early. The frame lists were right, but every slot number was two too high,
and since `states.py` names a state by looking its `play_anim` argument up
in that table, **every state was named after the animation two slots
along.** The frame-number table below was never affected; the state names
in the section after it were, and are corrected there.

A list's length needs both bounds: the lists are packed back to back, so
one runs until the next list the array references, *and* a list shorter
than that gap ends on an `0xffff` sentinel — take whichever comes first.
The long walk cycles carry no sentinel; the short lists do.

The top two bits of a frame entry (`0x4000`, `0x8000`) are event markers,
not part of the frame number. They fall on the frames where a swing
connects.

The table is named in `scripts/formats/anims.py`. Naming it needed
someone who played the original — guessing from rendered strips got two
wrong (frames 71-90 look like a swing but are Jack reaching into his hard
hat; 140-174 look like riding something but are a fall and the jump back
up), so none of it is named from the pixels alone.

| frames | what |
|---|---|
| 1-16, 21-36 | the two walk/run cycles |
| 17-20 | skid to a halt after running |
| **37-54** | **hammer strike, sideways** |
| 47-54 | the same strike with the windup cut off — the held-button version |
| **55-70** | **hammer strike, overhead** |
| 59-70 | the overhead swing alone, in five paddings — one per hammer speed, with an event flag on the connect |
| 71-90 | reach into the hard hat |
| 113-122 | …and pull the hoover out (the two are always chained) |
| 123-138 | walking with the hoover |
| 91-100 / 100-91 | duck down into the hard hat, and come back up |
| 101-112 | hard-hat mode, moving |
| 317-322 | peering out from under the hat where the gap is too low to stand |
| 175-190 | climbing a ladder |
| 289-300 | topping out off the ladder onto the platform |
| 140-174 | a fall, and the jump back up onto your feet |
| 252-288 | air roll — carries you further sideways |
| 301-316 | hard landing and get up |
| 191-206 | carrying something above your head |
| 207-222 | pushing something along |
| 223-230 / 232-235 / 236-239 | pick an object up, throw it, put it down |
| 323-325 | a hammer lying on the ground |
| 326-328 | loading-screen animation, not used in play |

Worth reading that list for what the clone has no mechanic for at all:
ladders, the hoover, carrying, pushing, throwing, hard-hat mode, and two
distinct hammer strikes where the clone has one.

Not every slot is a clean frame list — slot 4 (state 0x23499) points at
0xa10d0, two words before the movement-profile index (below), and runs on
into it.
