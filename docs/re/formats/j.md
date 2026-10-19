# `.J` — demo recordings — **Confirmed**

15 files (0D-4D, and the side levels T*, U*): the joypad of up to four
players, recorded with `/RECORD` and played back with `/PLAYBACK` (VA
0x177da, 0x17923); the front end runs 0D-4D as its attract mode ("into
demo mode with %s seq lev %d"), and **any** level that has one plays it
when loaded (`load_level` 0x107b2 — the T/U side levels of the story map,
`front/side-levels.md`). Played back, the words are pad mode 6
(`jack/controls.md`): 0x40, 0x80 and the look button 0x200 are all in
use. Four equal blocks, one a player — 4012 bytes
each (12012 in the larger files):

| offset | size | field |
|---|---|---|
| 0 | u16 | ticks recorded |
| 2 | u16 | events |
| 4 | u32 | the recorder's write pointer (junk on disk) |
| 8 | events × (u16, u16) | (ticks, pad bits): the pad held for that many ticks |
| 4008 | u16 | the player's hammer (shop index), set on load (0x17923) |
| 4010 | u16 | in block 0: the number of players − 1 |

The players' buffers in memory are 4012 bytes apart (0x253014, stride
0xfac) whatever the file's size: `open_level_file` (0x179eb) reads
exactly 0x3eb0 = 16048 bytes into 0x253014. Of a 48048-byte file (TC TS
UH UI UJ, blocks of 12012) only that much comes in, and G takes it as
4012-byte blocks: player 0's header and his first 1000 events (all five
have at most 186), and at 4008 and 4010 two words of block 0's unused
tail — 0 in all five, so the sledge v1 and one player.

Checked on all 15: the events' ticks add up to the header's, exactly.
0D is one player for 2 minutes; 4D has all four. A run of 1000 ticks is
split (VA 0x1781c). During playback a real button press ends the demo
("Joypad has been touched", `read_joypad` 0x6b65f, input & 0xf0), and a
level played back always ends in state 0x11 (`print_level_counters`
0x10a62).
