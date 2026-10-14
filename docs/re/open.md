# Still open

- The `.I` second u16; the `HEAT` draw mode (-1); which `.SCN` texture
  each backdrop plane samples.
- Sound scripts 29–32 are a lone `skip` (op 14) whose five words the
  interpreter ignores — something else must read them.
- `F.EXE`: what a gate node (kind 4) charges; node words 17 and 18; the
  C/D one-object screens (`G.EXE` VA 0x10c1f builds them).
- `F.EXE`'s screen files `PROJ/*.DAT`: past the sheet names and the
  per-frame sizes, how the screens' objects and their animation rates are
  laid out (the map Jack's frame rate, the landmarks, `LEVSLBIN`).
- Why 2T, 4T and BA ask for more trashing than they hold.
- What sets the swing's starting frame — the operating range of the force
  ramp (see the collapse section; the formula itself is confirmed).
- What the individual bits of the level's option byte (0x98224, and a
  second at 0x98226) do. `ob.py` lists every field of the rules record
  that sets them; nothing yet traces a reader.
- What the remaining `.OB` classes are — the enemies and pickups are
  in there (the UFO, class 31, is read).
- `"event list contains no outcome for object type %d"` (VA 0x90e0c):
  there is an event/outcome table keyed by object type that nothing here
  has looked at.
- Scoring beyond the packed-BCD adder and the rules record's +0x38.

Closed since these notes last listed them: `.OBT` field 6 is mass and
field 0 is hit points; the `.OB` record lengths (all 147 files parse
exactly); the physics of a collapsing structure and block strength.
