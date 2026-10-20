# The title screen, its menus, the attract mode — **Confirmed**

What F.EXE shows before a game starts. Addresses are F.EXE's; names in
`scripts/ghidra/fexe/symbols.txt` (`fn.py --f`); the frame underneath in
`frame.md`.

**The front end's states** (`front_states` 0x208f5): the record's `+0x206`
picks a routine from 0x8daa0 and runs it until 0x18475a is set — 0 the
title (0x2098c), 1 the story (`front_after_level` 0x20e1d), 2 battle
(`battle_framework` 0x212d2), 3 arcade (`arcade_framework` 0x214c2);
`game-types.md` has the last two. `front_to_title` (0x21989) puts 0 back.
On the very first run (`front_init` 0x1ac0e: the record's `+0xd8` is not
yet 0xabbabad) the record is cleared and three films play before the
title: `gt`, `arcalogo` (the GT and Arcane logos) and `front`, the intro.

**The title** (`title_init` 0x21857): `PROJ/FRMWRK_E.DAT`, CD track 8,
the picture (slot 3) at the screen's top left, and the menu handler
`title_menu`. Its tick (`title_tick` 0x20920) runs the handler, the
start transition and the frame.

**Menus** are a handler run each tick (`menu_set_handler` 0x12882; the
first call sets the menu up). `menu_open` (0x126cd) takes a 0-ended list
of item strings — only for the debug output; what the player sees are
words from the sheet, one object each (`menu_word` 0x12aee). `menu_tick`
(0x126f8): UP and DOWN move the cursor round the list with a sound, any
button (`& 0xf0`) chooses. The words (`menu_word_tick` 0x1293e) drop in
from above one after another, each 3 ticks after the last, fall at
≈4.9 px/tick² and bounce on their row until they settle; the word under
the cursor is drawn as a silhouette in colour 254. A choice sends them
all off to the right at 40 px/tick, rising, with a random tilt, the
first one shaking the camera; when it is gone past x 20 the handler acts.

| menu | items | each does |
|---|---|---|
| `title_menu` 0x209c6 | start · options · quit | start → `start_menu`; options → `options_menu`; quit → "QUIT selected", `exit_front` with the record's word 0 = -1 |
| `start_menu` 0x20c50 | battle · arcade · story | after the start transition: `battle_framework`, `arcade_framework`, the story (state 1); Esc back to the title menu |
| `options_menu` 0x20afe | pad config · audio config · done | pad config (0x153d3), audio config (0x10ad6), done → the title menu |

The start menu's strings are blank: its three words are pictures only.
Choosing in it starts `title_start_transition` (0x13069): a camera
shake, the next picture, 90 ticks, a fade out and the CD stopped, then
the game type runs. (Two more lists sit at 0x8dc94: "1 player" /
"2 players", unused here.)

**The attract mode.** The title menu sets a 30-second idle timeout; when
it runs out (`attract_next` 0x21716) the next byte of the list 0x8dcb0
is taken, the record's `+0xe2` counting through it:

    2  3  *  4  0  *  1   (then from the start)

A number is a demo: state 0, the level's result `+0x2a` = 0xc, one
player, world 0x14 (**D**) and that level — `0D.J` … `4D.J` played back
by G.EXE ("into demo mode with %s seq lev %d", `formats/j.md`). A `*`
(99) is the credits instead.

**The credits** (`credits_screen` 0x113f5): `PROJ/CREDITS.DAT`, CD track
4, a script turning the pages. A button skips to the next page while
there are fewer than 5 shown (and freezes the input for 90 ticks); on
page 5 there is a 6-second timeout, after which any button ends it
(`credits_end` 0x1142e, fade out).

**The movie selector** — a hidden screen: on the title, hold **UP** and
**Esc** together for 250 ticks (`title_tick`: player 1's held word
exactly 4, the Esc key) and `movie_select` (0x1ae0c) opens
`PROJ/MOVIESEL.DAT`. LEFT / RIGHT step through 25 films by name (0x1ada4),
fire plays it (`play_smacker`), Esc goes back to the title (CD track 8):

| # | name | film | # | name | film |
|---|---|---|---|---|---|
| 0-9 | sledgehammer v3 … apocalypse hammer v3 | `slc` `bic` `bec` `voc` `wac` `spc` `pdc` `fuc` `sbc` `apc` | 17 | quality hammer | `qua` |
| 10 | game over movie | `gameover` | 18 | galactic hammer | `gal` |
| 11 | end of level 1 movie | `inter1` | 19 | the ultimate moola | `moo` |
| 12 | end of level 2 movie | `inter2` | 20 | end of level 3 movie | `inter3` |
| 13 | end of level 6 movie | `inter6` | 21 | end of level 4 movie | `inter4` |
| 14 | game complete movie | `end` | 22 | dr moonbeam sucking up the universe | `lab` |
| 15 | dragon hammer | `dra` | 23 | trash-it! title movie | `front` |
| 16 | bfh | `bfh` | 24 | lauchpad movie (sic) | `inter5` |

The films are the film table's (0x89180, by the numbers at 0x892d0);
`inter5` is the launchpad's.
