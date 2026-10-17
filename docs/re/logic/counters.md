# Counters — **Confirmed**

A level-state record (pointer at VA 0x317ca8) holds the three counters
the debug print names (`timmies %d rubble %d timer %d`, VA 0x10abd):
`+0x14` timmies, `+0x0c` rubble, `+0x1c` timer — what F.EXE does with
them: `front/level-record.md`. `+0x26` is a state enum
taking 2, 3, 0x10 and 0x11. Separately, the level loader counts objects
by their `.G2R` routine into 0x3f166a (static) and 0x3f166c
(destructible) — and reads neither back, so they are diagnostics.

`.G2R` really is validated to 1 or 2 only (VA 0x2d0d3): the 1/2/4/8/16
values dispatched at VA 0x33e79 are the `.OB` sprite subtypes, a
different thing.
