# The percentage check — **Confirmed, and these notes had it wrong**

The mission text promises "trash NN% to free the bell", and the game
computes that percentage: when an object is removed (`remove_object_data`,
VA 0x68724) it increments `destroyed_count` and stores
`destroyed_count * 100 / level_object_total` in `destroyed_percent`
(VA 0x410464). The total is the `.WAM` header's object count — every
object, the unbreakable ones (hit points -1, which `damage_down` and
`damage_up` skip) included — so a level's ceiling is its breakable share.

The authors knew it: of the 39 subtype-8 bells, most ask for exactly the
ceiling or a point or two under it (0K 28 of 28, 1K 61/61, 5T 70/70,
7A 97/97, AA 88/88, 5M 88/88). Three ask for more than the level holds —
**2T 87 of 81, 4T 100 of 80, BA 100 of 87** — and, as the code reads,
their bell never shows. Not checked in the running game.

An earlier version of this section said nothing reads it back. **The
subtype-8 bell does** (VA 0x340af, `state_340af`): it compares its own
+0x54 — payload +18 — with `destroyed_percent` every tick and comes out
when the share is reached. The search that missed it was looking for the
locked-block bell, subtype 16, which no level uses.
