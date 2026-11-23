# How a structure collapses — **Confirmed, and these notes had it wrong**

This is the game's own mechanic, the clone has nothing like it, and the
earlier version of this section concluded the opposite of the truth:
*"a blow stops at the block it lands on; structures do not collapse in any
level the game ships"*. They do. The reasoning that led there was that the
`.WAM` loader never writes the support counts the damage routine divides
by — which is true, and irrelevant: **the engine recomputes them every few
frames.** A field being absent from the level files says nothing about
whether it is filled at run time.

The game's own word for a falling structure is in one of its debug
strings, *"looked for ccs off end of list"* — a `ccs` is a connected group
of blocks that has come loose.

Every object carries **hit points** in its entity at `+0x18`, from `.OBT`
field 0, and a **mass** at `+0x14`, from `.OBT` field 6 (forced to 1 when
the table stores 0, VA 0x2d028 — the reader below is what settles what
that field means). A hit does not remove a block; it applies a **force**,
and the force travels through the structure:

    damage_down(object, force):                 # VA 0x689e6
        if object.hp == -1: return              # indestructible
        supports = object.+0x5e                 # blocks directly beneath
        if supports and force / supports > 2:
            for each occupied cell in the row under it:
                damage_down(that object, force / supports)
        if force < object.hp: object.hp -= force
        else:                 destroy(object)

    damage_up (VA 0x68a91) is the mirror image — the row above, and the
    count at `+0x5c` — so a blow from below pushes up through a structure.

A blow is therefore **divided among the supports at each step** and stops
when a share drops to 2 or less. A pillar passes a hit straight down; a
wide base soaks it up. That division is the whole feel of the demolition,
and it is the single biggest thing the clone is missing.

The two counts are refreshed by a flood up from the bottom row of the
collision map (VA 0x69b88 → 0x69c07): for every object the ground holds
up, transitively, `+0x5c` = how many objects touch it from above and
`+0x5e` = how many from below. Anything the flood does not reach is loose,
and a second flood (VA 0x69660 → 0x698c2) collects the loose ones into
groups through their contacts. Both run at most **every fifth frame**, and
only if a dirty flag (0x410474, set by any hit, destruction or landing)
says something changed (VA 0x69f04).

A group falls as a rigid body (VA 0x690d6): `vy += 10000`, i.e. 0.15
px/frame² — *not* Jack's 0.28125 — capped at 4 px/frame, with the members
riding at fixed offsets. It is stamped into a second copy of the collision
map each frame (VA 0x69386) and unstamped at the start of the next (VA
0x694ad), which is how group-versus-group contact is tested (VA 0x691e9).

When it lands (VA 0x68b2d) the numbers are:

    speed  = (vy >> 16) + 1                     # 1..5 whole pixels
    weight = the mass of the object hit plus everything stacked on top of
             it, flooded upward                 # VA 0x69850
    force  = weight * speed / 4

applied **both ways** — down into what was hit and up into the block that
hit it — so a collapse damages itself on impact. The group's y is snapped
to the 8px grid and its vy *halved* rather than zeroed, which is the
bounce. Two engine limits are worth knowing before building on this: at
most **50 groups** at once and **40 members** before a group chains a
continuation record.

The other way force arises is any moving sprite striking a block (VA
0x1f28c, and VA 0x1f36d for the other axis):

    force = sprite.mass << (|speed| - 2)        # mass is +0x4c here

needing a speed of at least 3 (5 on the other axis, where the force is
also halved). Jack's own mass is 25 (VA 0x21610); a class-15 dynamite is 5,
or 50000 once lit (VA 0x20bc4 / 0x20bf4) — which is how a stick of
dynamite flattens a building that a hammer chips at.

Destroying a block (`remove_object_data`, VA 0x68724) does not simply
remove it: it clears the block's tiles from the collision map (VA
0x68980), turns the block itself into flying rubble with a randomised
velocity, and spawns a dust puff that cycles through eight variants (VA
0x1f784). How far the rubble is thrown comes from two bit masks, and both
the hammer catalogue (fields +0x34 / +0x38) and the landing impact (a
table of eight masks at VA 0xa4970, indexed by bits of `weight * speed`)
feed them — always values of the form 2^n - 1.

**What a hammer blow carries** — **Confirmed** (found in Ghidra, from the
`damage_down` caller side rather than the hammer record's side). The
strike state at VA 0x23cef reaches the blow at its impact frame:

    t     = 6 - hammer_entity.+0x5a          # frames from swing start to impact
    force = lo + ((hi - lo) >> t)            # VA 0x23d54..0x23d66
    lo    = wielder.+0x74                    # hammer record +0x3c
    hi    = wielder.+0x78                    # hammer record +0x40
    VA 0x23d93 -> 0x1f83d -> 0x1fcd3 -> 0x1f905 (walks the blow's box cell
    by cell, calling damage_up 0x68a91 / damage_down 0x689e6 on each block)

**The ramp is a charge, and the hammer key is held to build it.** Pressing
the key from a standing or walking state enters the windup, VA 0x23a27,
which plays slot 6 — the first frames of the sideways strike (37-43) —
but does not let it run: while the key stays down (VA 0x2110d), the
animation frame index (player `+0x10`) steps only when the entity's frame
timer `+0x4a` reaches `+0x58`, and every step raises `+0x58` by one. It
starts at 1, so the frames come 1, 2, 3, 4, 5, 6 ticks apart and the
index caps at **6 after 21 ticks** (VA 0x23a66-0x23a98). Jack can creep
meanwhile, `vx ± 0x8000` per tick.

Letting go (VA 0x23b61) copies the index into Jack's `+0x5a`, switches to
the strike state VA 0x23cef, and that plays slot **15 + charge** — slots
15-21, the follow-through 47→54→47 in two lengths. At its impact frame
the formula above runs with `t = 6 - charge`. A full charge carries `hi`;
a tap carries `lo + (hi-lo)/64`. For a sledge v1 that is **10 against
150**. (A full charge also picks a different sound, 0xe rather than 0xc,
VA 0x23b88.) Two things this overturns:

- **Record `+0x40` is the hammer's maximum force, not (only) a price.** It
  is the top of the ramp. The joke hammers at 4294967295 are not "unbuyable",
  they flatten anything — which fits them being the silly ones. The shop
  does not read it: F.EXE prices a hammer from its own item record (`+4`,
  [hammer-shop](../front/hammer-shop.md)).
- **`+0x3c` is the minimum**, the floor of the ramp (8 for a sledge v1,
  100 for most late hammers).

**Where the blow lands** (VA 0x1f83d → 0x1f905): from Jack's own position
— his feet, the entity point every sprite is drawn from — the hammer
record's `+0x4a` ahead and `+0x4c` down (53 and -12 for a sledge v1), then
outward in 8 px steps (0, +8, -8, +16, …) for as far as `+0x4e` across and
`+0x50` down allow, each step one cell of the collision map
(`0x69e6a` is a plain `>> 3`). A sledge's extents are 4 and 7, under one
step, so **its blow is a single 8x8 cell**, and the "up to 3 blocks" its
type allows never comes into play. That cell is where the head is drawn
(next paragraph), 24 px past the end of Jack's own frame.

**The hammer is its own sprite.** Jack's frames do not include it. The
hammer entity (template 0xa3038, routine VA 0x20890) copies Jack's
position every frame and shows a frame of `SPR/SPA.SPR` taken from a list
that runs alongside each animation: `play_anim` puts `[slot*4 + 0x9ff88]`
in the player's `+0x58`, and the hammer shows entry [Jack's frame index].
Standing, running and skidding all use 0xa10b0, the hammer on the
shoulder (SPA frames 0-15); the strike runs 26 → 33, and frame 33 —
54x16, anchored 14 px ahead of Jack — puts the head exactly over the
blow's cell. The hoover's slots have no list. `anims.hammer_lists()`
reads them.

The top two bits of a list word are sticky switches (VA 0x20905):
`0x4000` hides the hammer from that frame on, `0x8000` shows it again —
slot 70, drawing the hoover, hides it at the frame the hammer has gone
into the hat, and slot 71, putting the hoover back, shows it as it comes
out. Ducking into the hard hat (slot 12) hides it too (VA 0x20940), and
nothing in the hat states brings it back: the one other place that does
is the way into a swing, state 0x23499 (VA 0x234c3). So after the hat,
Jack's hammer is away until he next swings.

The hoover itself is one strip each way, not the two halves the clone
used: `UP` held with `BUT1` pressed starts 0x2a88c (slot 70, sheet frames
71-81 then 122-113), which ends in 0x24e55, the hoover held (slot 28);
a direction walks it, 0x250d9 (slot 29); and the same keys again run
0x2ab7a (slot 71, the strip backwards) back to standing.

The hammer type (record `+0x48` low u16, wielder `+0x88`) then shapes it
at VA 0x1fcd3: types 1 and 4 halve the force, and every type also sets
how many blocks one blow may strike (1..3; type 4 picks 2 or 3 at random).
Type 0 is **aimed**: `jack_strike` (0x23d71) passes the input word held
as the blow lands, and with UP (4) the blow strikes one block at full
force, with DOWN (8) two at full force, with neither three at half. The
type-0 hammers are the specials — the apocalypse hammers, the bfh, the
dragon, the future v2 and v3 and the rest of the 16 (`shared/hammers.json`
`aimed`). Clone: `hammerForce` / `hammerStrikes` take the keys
(`Player.heldAim`). The
upper u16 of that same u32 (53 for a sledge v1, 51 for a warhammer) lands
in the wielder's `+0x8a`, which VA 0x1f83d uses as the blow's horizontal
reach in front of Jack — so reach is per-hammer too. Block hit points run
25..5000 in the shipped levels (24464 is the heavy stuff), so a sledge v1
at full ramp (150) clears the weak half and has to be swung repeatedly at
the rest — which is the design.

The `shr 0x12` at VA 0x1fba6 is something else: it reads `force >> 18`
(clamped to 63 and 500) to pick the dust and the camera shake, and it is
zero for any ordinary hammer. Only dynamite and the joke hammers reach it.

**The overhead strike hits sprites, not blocks.** Its force (above) goes
to VA 0x1fd94, which builds a box from the hammer entity's `+0x58`,
`+0x5c`, `+0x5a` (record `+0x5e`, `+0x62`, `+0x60`; for a sledge v1, 40
ahead, 13 up, 27 wide, 14 tall — mirrored when facing left, VA 0x2f1d7)
and hands it to the sprite search at VA 0x2f156. That walks the sprite
list, keeps those whose class mask meets 4, and for up to 32 of them sets
the attacker (`+8`), the force (`+0x4e`) and the hit flag (`+0x40 |=
0x80`). Three things read that flag: a clock, `CLOK.SPR` (VA 0x11edd —
it bursts into twelve pieces and is gone), a hanging sign, `DIS.SPR`
(VA 0x5f3c0 — it swings, amplitude `force >> 5` clamped to 3..32), and a
landed UFO, which goes to VA 0x14935 (`ufo_hit`) with sound 0x84 — see The UFO.
The hammer-lit kind of dynamite reads it too (see Dynamite).

The wielder's `+0x74`/`+0x78` (player struct, not his sprite) never
differ from the record: `initialise_a_players_hammer` (0x216c0) copies
them from record `+0x3c`/`+0x40` at each level's load and nothing else
writes them — a hammer bought is another record, copied at the next level.

**The strike state's exits** (`jack_strike` 0x23cef), each tick:
- the animation run out: on with the hammer, walking (0x236b9) if
  `|vx| > 10000`, else standing (0x23499);
- on a new frame, BUT2 pressed (0x21084) while the hammer's frame is at
  most 53 and lower than last tick's (`+0x5c`) — the swing coming back
  up — straight into the windup again (0x23a27): a quick second blow;
  (Frame is Jack's own `JACKS.SPR` frame at `+0x44`: the sideways list
  runs 47-54, so the swing's return is any frame under 54 lower than the
  last.) The overhead swing (`jack_swing_over` 0x24174) has the same exit
  in another form: BUT2 pressed *with* an arrow held (0x210c0) once the
  frame is 64 or more (its list is 59-70) goes to the overhead windup
  (0x23f0f); an unfinished list ends in standing (0x23499). Clone:
  `Player._quickSecondBlow`;
- meanwhile he slides, `vx` eased 5000 a tick and zeroed under 10000,
  walls stopping him (0x60393 / 0x60496);
- no floor under him: from standing a 2 px/tick hop (`vy` −2) as he
  leaves it, else the fall (0x25813); at the level's bottom, the common
  tail (0x27767).

`scripts/formats/ccs.py` reproduces all three floods over the real level
files, which is how the above was checked rather than argued: across
**all 147 levels and 51727 objects, not one cell is claimed by two
objects** — the game's own `"overwritten block"` complaint never fires —
and only **3 objects in 2 levels are loose at load** (8B has two, 9I one),
each hovering exactly one tile above what should hold it up. A wrong
reading of the map layout or the contact test would have thousands of
blocks falling the moment a level opened.
