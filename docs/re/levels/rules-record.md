# The level's rules record — **Confirmed**

Class 16 is in 146 of the 147 levels and has the largest payload of any
class, 72 bytes. Its constructor (VA 0x1ae49) does one thing: it is a
bank of switches. Each word either sets a bit in the global option byte
at VA 0x98224 or is copied into a global of its own. This is what makes
one level play differently from another, and `scripts/formats/ob.py`
lists every field with how the 146 levels spread across its values.

Every field is now traced (`ob.py` RULES has each with its spread):

| offset | what |
|---|---|
| +0x0e, +0x12, +0x16, +0x1a, +0x1e, +0x22, +0x2e, +0x32, +0x36 | bits of the level's option word — [level-options](level-options.md): the hammer and hoover rules, the T/U shows' panel, the % counter |
| +0x26 | what a button's option 0x1000 sets off: 2 the 1D show (0x204be), 4 the demolition (0x1b0f6; 2T 4T BA) — [the buttons](../objects/buttons.md) |
| +0x2a | 1/2/4/8 → sound id 29/30/31/32 stored at 0x287c6c, which nothing reads: an ambience never wired up (the I levels pick 32, the M levels and CC CH DC DH 31, the rest 29). Those four "scripts" are priority-0 lone `skip`s |
| +0x38 | the **time limit**, minutes and seconds as decimal digits (315 = 3:15), turned into packed BCD five at a time (VA 0x19b9d); 0 keeps 20:00. An earlier version of this note took it for a score |
| +0x3a | the timmies the bin wants (0xa3578, 10 by default) — [timmy bin](../objects/timmy-bin.md) |
| +0x3c, +0x3e | the most bomb and spike gits alive at once — [gits](../objects/gits.md) |
| +0x40, +0x42 | the force of a git striking a block: Tommy's, the others' (`git_strike_block`, [gits](../objects/gits.md)) |
| +0x44, +0x46 | a bomb's force and its shift — [hurt](../jack/hurt.md) |
