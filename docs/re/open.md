# Still open

Nothing in the game's rules or files is known to be unread. What is left
is depth, not breadth: a few routine names that are still a guess (`?` in
the symbol files) and the clone carrying over what is decoded.

Closed since these notes last listed them: T's node 15 (the temple's turning machine, [map-objects](front/map-objects.md)) and the stage bytes `+0x1ce` (dead, [map-dialog](front/map-dialog.md)); scoring (four callers of one BCD adder, no time bonus — [level-record](front/level-record.md)); the swing's starting frame (the ramp is a charge held 0-6, [collapse](logic/collapse.md)); the `.I` second u16 (never read — [i](formats/i.md)); every bit of the level's option word and every field of the rules record ([level-options](levels/level-options.md), [rules-record](levels/rules-record.md)); the in-level panel, its lists and scripts ([hud](front/hud.md)); sound scripts 29–32 (an unwired ambience the rules pick); 0x28bfa4, 0x28bf7e, 0xa2f0e and option 0x40000, all written and never read; the gits striking blocks at marker 28 ([gits](objects/gits.md)); the gates (a toll in timmy points, [map-dialog](front/map-dialog.md)) and the T/U side levels (shows played back from a `.J`, [side-levels](front/side-levels.md)); the panel, the shop and continue screens ([map-panel](front/map-panel.md), [hammer-shop](front/hammer-shop.md), [continue](front/continue.md)); the world map's objects — bins, hats, landmarks, Jack's frames and their animation scripts ([map-objects](front/map-objects.md)); the `PROJ/*.DAT` screen files (sheet names and slots; the frame rectangles and the tail are never read — [proj-dat](front/proj-dat.md)); which `.SCN` texture each backdrop plane samples (0 the ground, 1 the backdrop, the third part unused) and `HEAT` (dead code); the sledge v3 trick; the apocalypse hammer's flight script; the dragon show (table 0x9ff42) and the camera's target list, which an old name had as a "hit queue"; the event/outcome tables
(Jack's, 0xa2f48, is read but for type 9, the unplaced generic thing); why 2T, 4T and BA ask for
more trashing than they hold (a button demolishes the level); the last
unnamed `.OB` classes (the crawler, the rocket, the buttons); `.OBT` field 6 is mass and
field 0 is hit points; the `.OB` record lengths (all 147 files parse
exactly); the physics of a collapsing structure and block strength.
