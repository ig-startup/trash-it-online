# Still open

- The `.I` second u16.
- Sound scripts 29–32 are a lone `skip` (op 14) whose five words the
  interpreter ignores — something else must read them.
- `F.EXE`: node words 17 and 18; T's node 15, an object with no level;
  the stage byte `+0x1ce` (only cleared and lowered).
- Who reads option 0x98226 bit 2 and 0x28bfa4, both set during the
  apocalypse hammer's flight ([apocalypse](jack/apocalypse.md)).
- Who reads 0x28bf7e (the dragon show lowers it by 1030 and lets it back —
  a backdrop offset?) and 0xa2f0e (2 in the show's first half, else 1).
  See [dragon show](levels/dragon-show.md).
- What sets the swing's starting frame — the operating range of the force
  ramp (see the collapse section; the formula itself is confirmed).
- What the individual bits of the level's option byte (0x98224, and a
  second at 0x98226) do. `ob.py` lists every field of the rules record
  that sets them; nothing yet traces a reader.
- Scoring beyond the packed-BCD adder and the rules record's +0x38.

Closed since these notes last listed them: the gates (a toll in timmy points, [map-dialog](front/map-dialog.md)) and the T/U side levels (shows played back from a `.J`, [side-levels](front/side-levels.md)); the panel, the shop and continue screens ([map-panel](front/map-panel.md), [hammer-shop](front/hammer-shop.md), [continue](front/continue.md)); the world map's objects — bins, hats, landmarks, Jack's frames and their animation scripts ([map-objects](front/map-objects.md)); the `PROJ/*.DAT` screen files (sheet names and slots; the frame rectangles and the tail are never read — [proj-dat](front/proj-dat.md)); which `.SCN` texture each backdrop plane samples (0 the ground, 1 the backdrop, the third part unused) and `HEAT` (dead code); the sledge v3 trick; the apocalypse hammer's flight script; the dragon show (table 0x9ff42) and the camera's target list, which an old name had as a "hit queue"; the event/outcome tables
(Jack's, 0xa2f48, is read but for type 9, the unplaced generic thing); why 2T, 4T and BA ask for
more trashing than they hold (a button demolishes the level); the last
unnamed `.OB` classes (the crawler, the rocket, the buttons); `.OBT` field 6 is mass and
field 0 is hit points; the `.OB` record lengths (all 147 files parse
exactly); the physics of a collapsing structure and block strength.
