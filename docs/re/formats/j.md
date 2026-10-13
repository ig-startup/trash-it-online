# `.J` — demo recordings — **Confirmed**

15 files (0D-4D, and the test levels T*, U*): the joypad of up to four
players, recorded with `/RECORD` and played back with `/PLAYBACK` (VA
0x177da, 0x17923); the front end runs them as its attract mode ("into demo
mode with %s seq lev %d"). Four equal blocks, one a player — 4012 bytes
each (12012 in the larger files):

| offset | size | field |
|---|---|---|
| 0 | u16 | ticks recorded |
| 2 | u16 | events |
| 4 | u32 | the recorder's write pointer (junk on disk) |
| 8 | events × (u16, u16) | (ticks, pad bits): the pad held for that many ticks |

Checked on all 15: the events' ticks add up to the header's, exactly.
0D is one player for 2 minutes; 4D has all four. A run of 1000 ticks is
split (VA 0x1781c). During playback a real key press ends the demo
("Joypad has been touched").
