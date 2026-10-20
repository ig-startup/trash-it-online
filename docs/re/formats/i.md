# `.I` — per-object shape index — **Confirmed**

4 bytes per object, in the same order as the `.WAM` records, loaded whole
into 0x3f09a4 (`level_load_objects` 0x2cce9, at most 0xc80 bytes — 800
objects). First u16 is the `.G2` shape index; this is the indirection
that lets several objects of the same *type* (same size/strength) wear
different graphics.

The second u16 is 0 or 1 (41743 ones, 9984 noughts over the 147 levels)
and **G.EXE never reads it**: the only instruction that touches the table
is the shape read at 0x2d0a7 (`[i*4 + 0x3f09a0]`, objects counted from 1),
and nothing addresses 0x3f09a2 or 0x3f09a6. It does not follow the
object's `.COL` kind or its `.G2R` routine either — most likely a flag of
the level editor that was saved with the file.
