# The timmy bin — **Confirmed**

8K's "collect the timmies". The bin is a robot with a hammer (`TIMBIN.SPR`,
9 frames) that eats timmies one at a time; once it has eaten the level's
number of them, the bell appears.

**One per player.** Classes 18, 19, 20 and 21 are one constructor
(`ob_timmy_bin_common`, VA 0x2f72c) differing only in the player index
they load (0-3), kept at `+0x54`. The bin stands at `(x + 17, y + 16)` of
its record and is a physical sprite: it falls until something holds it
up (`sprite_physics`). Across all 147 levels there is **exactly one bin**,
player 0's, in 8K, on a pedestal near the right edge.

**Catching** (`timbin_wait`, VA 0x2f785). Each tick it looks for a sprite
of category 0x400 — a free timmy has it (0x605, see `gits.md`) — that is
not carried (sprite flags 0x40200402 clear) and whose **foot point** is in
the box `timmy_bin_mouth` (VA 0xa361a): 19 × 8 px from `x - 9, y - 8`,
i.e. at the bin's own foot (`sprite_find_in_box` 0x2f26e,
`point_in_facing_box` 0x2f2f0). It takes it only if the timmy is **coming
down** (`vy > 0`). Walking timmies have vy 0, so they have to fall or be
thrown in.

**Swallowing** (`timbin_swallow`, VA 0x2f7ea), 52 ticks:
- The first tick kills the timmy and spawns a stand-in
  (`tmpl_binned_timmy` 0xa35ea, TIMMY.SPR, "obj_binned_TIMMY") at the bin's
  `x, y - 6`, one draw level behind it (`+0x48` = bin's − 1).
- Each tick steps a counter; `timmy_bin_stages` (0xa3622) gives the bin's
  frame — 0 ×4, 1 ×4, 2 ×4, 3 ×13, 4 ×4, 5 ×4, 6 ×11, 7 ×4, 8 ×4, then −1.
  The hammer winds up and comes down.
- `timmy_bin_binned` (0xa368c), 10-byte rows by tick: the stand-in's
  frame word (0x4000 hide from here on, 0x8000 show again — the hammer
  lists' convention), dx, dy from the bin's foot, and `+0x50`/`+0x52`,
  px added to its width and height. It sits at dy −6/−5 for 12 ticks, is
  hidden at 12, peeks out at 25 as frame 18 (flat) widened by 3, 2, 1 px,
  hides at 33, and at 42 shoots up to dy −39 squeezed 12 px thinner,
  falls back to −32 and hides at 50.
- At tick 12 the bin **hops**: vy −3 px/tick, off the ground, with a puff
  (`spawn_blow_puff`), two sideways effects (`effect_pair_sideways`
  0x1e54d) and a screen shake if its `+0x41` bit 0x80 is set (meaning
  not read).
- At −1: the stand-in is killed, the bin back to frame 0 and to
  `timbin_wait`, a GOT.SPR popup rises (`spawn_got_popup` 0x11a92 — the
  hoover's catches make the same one), and `player_add_gits(1)` credits
  the timmy to the bin's player — not to whoever threw it.

**The count.** The rules record's `+0x3a` is loaded into
`timmies_to_bin` (0xa3578; VA 0x1ae49, only when non-zero). Each swallowed
timmy decrements it; the one that brings it to 0 sets level option 0x800
(and the music level `0xcd836` to 150). The subtype-2 bell waits on that
bit (`ob.md` "The bell"). In 8K: 31 timmies, 10 to bin.

The clone: `client/src/scenes/timmyBins.js`; the stand-in is drawn behind
the bin, which assumes a lower `+0x48` draws further back (Inferred). Not
in the clone yet: the GOT popup, the puff, the music level.
