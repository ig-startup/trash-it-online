# The timmy bin — **Confirmed, and barely used**

Timmies go into a bin, and there is one per player: classes 18, 19, 20
and 21 are the same constructor differing only in the player index they
load (0, 1, 2, 3), exactly as the four player starts do.

The bin stacks them. Its entity keeps a count at `+0x4a`, and the count
indexes a table at VA 0xa3622 that gives the pile's stage — 0 for the
first four timmies, 1 for the next four, and so on through **nine
stages**, which is exactly how many frames `TIMBIN.SPR` has. The table
turns to -1 at **52**: at that point the bin resets its count, swaps its
routine and credits the player whose index sits in its `+0x54`.

Worth knowing before building it: across all 147 levels there is
**exactly one bin**, in level 8K. Whatever the design intended, the
shipped game hardly uses it.
