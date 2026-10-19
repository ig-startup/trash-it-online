# The gits: timmies, spikes, bombs — **Confirmed** (the core; details open)

The game calls its little walkers *gits* — `"spike git has no block to
lock to"`, `"Bomb git …"`, `"start bonus git"`. Timmies, king timmies,
Tommy, the spiky `SPK`, the walking bomb `BOM` and the bonus `BON` all
run on one driver (VA 0x30069) that each tick handles hits by kind and
then calls the behaviour in the sprite's `+0x54`. Those behaviours were
not functions to Ghidra (only stores into `+0x54` reach them); they are
named in `scripts/ghidra/symbols.d/git.txt`.

**What the level places.** Class 14 is a timmy, class 17 a king timmy —
each in one of two modes (word +0xe): 1, *locked to the block* under
it — 1440 of the 1449 records; 2, free from the start (nine). A
locked timmy sits on its block (VA 0x2ff6b) until the block dies, then
springs free with a random kick (up to 2 px/tick each way, VA 0x3053f).
**Class 32 is not a timmy at all** — it is a spike git (VA 0x1327e), 551
in 76 levels: word +0x12 bit 0 a free walker (510), bit 1 locked to a
block (41). Class
45 is the bomb git, the same way. The level's rules record caps them:
bombs at +0x3c, spikes at +0x3e (VA 0x1ae49).

**Walking.** A free git walks the way it faces, speeding up by `+0x5c` to
`+0x58` — both from its animation's profile, like Jack's (git_set_anim,
VA 0x30462; profile 0 is 4.34 px/tick, 0.12 a tick; spikes at half). Its
walk frame is its x: `x >> 2 & 15` into frames 1-16 of the sheet. A wall
turns it (a skid: `+0x60` a tick until the speed changes sign); no floor
and it falls; past the right edge of the level it turns back. At the
level's bottom a timmy hops now and then (vy -4.5, 20 in 4096 a tick).

**Markers.** Where a git walks onto a block, the block's `.COL` word 2 is
a marker (VA 0x2fbfd, table 0x3f20c8): 1 turns it left, 2 right; 28-30
are actions only for gits whose `.OB` flags have bit 1. Each marker is a
list (0xa3dbb) of 8 actions, one picked at random, which index the
behaviour table 0xa3fc4. In the shipped levels the markers are 0, 1, 2
and 28-30 — so they pace between their turn marks.

**Collecting.** A free timmy (template category 0x605: carried, hit,
*hooverable* 0x200) or Tommy is taken by **the hoover**: its box catches
every sprite of category 0x200 (VA 0x2fc5b), which then trails 40 px
behind, shrinks, and is credited to the player (BCD `+0x64`, count
`+0x68`, VA 0x1a036). That is "collect the timmies". The king timmy has
no 0x200 — it cannot be hoovered.

**Hit.** A spike or bomb the hammer hits stops, swells and is gone with
a puff and a screen shake (VA 0x32b15). A timmy struck on its feet
(sprite flag 0x10 is "on the ground", not "in the air" as first read) is
knocked, and the second knock is its end — below.

What spikes and bombs do — and what that does to Jack — is "What hurts
Jack" below.

**A timmy knocked, and its end** — **Confirmed**. A timmy (or king, or
Tommy) on its feet that the hammer's overhead blow reaches (its hit flag
without the blast bit) jumps at vy -1.5, its speed quartered and jittered
up to 4 px/tick, and counts the knock (`+0x68`). The game allows **one**
(0xa3e38):
- **The first knock** (0x31504, slot 8, sheet frames 18-19): flat on the
  floor, and meanwhile not to be carried or struck (category bits 0, 2
  and 0x800 cleared — the hoover still takes it). From tick 160 on the
  ground it stirs; at 164 it **shakes itself** (0x3172b, slot 9, frames
  20-23-21 a step every 4 ticks), carryable and strikable again, and after
  100 ticks on its feet walks on. A knocked **king** gains the hooverable
  bit, which a king otherwise lacks.
- **The next one is its end** (0x3193e, slot 10, frames 24-25): it turns
  into a winged angel that nothing can touch (category 0), hangs for 10
  ticks, then rises at 0x900 a tick, swaying after a point that drifts
  away (`vx += (point - x) / 64`), and is gone once off screen.
- **A blast's shock** within 70 px (0x32413) pushes it by the same table
  as Jack — vy whole and up if it stood, at most -12; vx halved — and
  counts as a knock: the first shakes it, the next is its end (0x32164,
  the same rise).
- **Dizziness** (`+0x74`): +10 an about-turn, -1 a tick. Over 30 a turn
  lifts it 5 px; at 500 a timmy dies of it, a spike is done for and a
  bomb lights.
- **A falling block** (git_tick 0x30069, for sprites TIMMY 0x35, KTIMMY
  0x3f and TOMMY 0x5b not already under one, `+0x42` bit 2): every tick
  `probe_crusher` (0x60a00) looks for a falling block over it. In the air
  (`+0x40` bit 0x10 clear) a rise turns into a fall, a fall gains half the
  block's `vy` — Jack's rule (`jack/falling-block.md`). On the ground it
  is caught: **timmy_crushed** (0x31bd8) stops it, takes the carry, strike
  and hoover bits away (`+0xc &= 0xfdfa`), notes the block's height, and
  each tick sets its squash from how far the block has come down since:
  `+0x52` (height) = −that, `+0x50` (width) = half of it. Past **20 px**,
  the block gone or another one, or the floor gone from under it, it dies
  as a knocked one does (timmy_angel), thrown up at −(0x38000 + rand >>
  13) — −3.5 px/tick. git_tick eases a squash below 0 back a pixel a tick.
  Clone: `gits.js` `_crushCheck`, `_crushedStep` (it eases the width
  back too).
