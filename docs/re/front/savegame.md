# Saved games: the SAVEGAME file and its screens — **Confirmed**

How the story is saved and loaded. Addresses are F.EXE's; names in
`scripts/ghidra/fexe/symbols.txt` (`fn.py --f`). The messages still
speak of a "memory card" ("memory card load unsuccessful", "the memory
card in slot … contains no trash it save games") — the PC version keeps
the console's words over a plain file.

**QUEST starts at a choice** (`quest_start_screen` 0x137c8,
`PROJ/GAMRST_E.DAT`; from `front_after_level` 0x20e1d): three rows, UP /
DOWN, a button to take one, Esc back to the title (3).

| row | does |
|---|---|
| 0 new game | world 0, 5 lives, no hammer, score and timmy points 0, every node's counts cleared |
| 1 load | `game_load`; with no file or no saves, the "contains no trash it save games" message |
| 2 password | `password_screen` (`front-end.md`): the world, 5 lives, its hammer |

**Saving** is offered on `GAMSAV_E.DAT` (`save_screen` 0x16c6b) each
time a new world is entered after the last one is won, and after world
8: two rows, save or go on. Saving (`game_save` 0x19252) picks a slot
(`save_slot_pick` 0x1970f: the six names listed, a seventh row to
cancel) and names it `"<world> t-<timmy points>"` from the world name
table (0x8da47) — a name another slot already has gets a `.` and then a
count after it. Then the whole file is written back; the screen shows
"saved" for 90 ticks, or a failure for 150.

**The file** `SAVEGAME` is exactly 0x2000 bytes (`savegame_read`
0x18fd4 accepts no other size: 1 read, 2 short, 3 missing). The first
0x200 bytes are not used; then six slots of 0x130 bytes:

| slot offset | size | record (F) | what |
|---|---|---|---|
| 0x00 | 32 | — | the name |
| 0x20 | u16 | `+0x06` | player 1's hammer |
| 0x22 | u16 | `+0x24` | the level |
| 0x24 | 48 × u8 | `+0x188` | each node trashed |
| 0x54 | u16 | `+0x1b8` | the node Jack stands on |
| 0x56 | u16 | `+0x28` | lives |
| 0x58 | u16 | `+0x26` | the world |
| 0x5a | u16 | `+0x04` | players (saved, not loaded back) |
| 0x5c | u16 | `+0x1ba` | |
| 0x5e | 48 × u16 | `+0x20a` | the timmy points each node paid |
| 0xbe | 48 × u16 | `+0x26a` | the panels each node gave |
| 0x120 | u32 | `+0x1be` | timmy points |
| 0x124 | u32 | `+0x14` | score |
| 0x128 | u16 | `+0x1bc` | |
| 0x12a | 4 × u8 | `+0x2c` | each pad's button layout (`options.md`) |
| 0x12e | u16 | `+0x30` | the music setting (`options.md`) |

Loading (`game_load` 0x190a3) copies it all back but the players, and
clears `+0x1ce` (six bytes). The copy in `Trash-it-original/` is all
zeros — no saves.

Not in the clone: it has no saving yet.
