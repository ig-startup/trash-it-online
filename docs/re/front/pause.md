# The pause and quitting a level — **Confirmed**

Esc in a level (`wait_retrace_and_tick` 0x2cb6e, `key_down`) calls
`pause_game` (0x1007c) — or, while a `.J` plays back, `exit_game("ESC
touched")`. The pause:

- runs `pause_hud` (0x1aaa8): the panel list 0x973c4, and the menu state
  `pause_state` 0x287c50 = 0, or 2 under option 0x10000000 — battle only:
  `hud_setup` sets 0x20000000 alone for the arcade, so the arcade's pause
  has quit level too;
- sets option 0x2000000 (the clock stops, `entities_settle` and the HUD
  ticks wait), saves the view (`pause_save_screen` 0x2e9a3) and blacks every
  other pixel of it (`screen_checker_clear` 0x10010) — the dimming;
- turns the music to 0x78 of 0x80;
- then loops with `pause_tick` (0x2cc9f) as the tick: the HUD lists, the
  counter 0xa2f10 +1, until bit 0x8000 of 0x287c50 is set; then everything
  is put back.

Esc is not read in that loop: only the menu ends a pause.

**The panel** (list 0x973c4; each sprite's point is its top left —
`draw_panel_icon` 0x2e4b4 draws at the record's x + its offset, stretched
by `+0x10`/`+0x14` px):

| PANEL | at | tick | does |
|---|---|---|---|
| 55 PAUSE | 119, 80 | pause_word_tick 0x1ab36 | bobs down and back, y + table 0x96fe6 (0 1 1 2 2 3 4 5 6 8 9 10 12 10 9 8 6 5 4 3 2 2 1 1 0, round again), a step a tick |
| 52 / 53 / 54 / 53 | 125, 120 | pause_menu_tick 0x1aadc | the plate by the state: 0 RESUME / QUIT LEVEL / QUIT GAME, 1 ARE YOU SURE? YEAH / NAAH, 2 RESUME / QUIT GAME, 3 as 1 |
| 56-58 the arrow | 120, 121 | pause_cursor_tick 0x1ac13 | the menu; its frame steps every 8 ticks, 56 57 58 round; its y eases a quarter of the way a tick to table 0x981ec's row: 0 14 29 / 14 26 / 4 22 / 14 26 |
| 12 Jack's face | -50, 30 | pause_jack_tick 0x1ab60 | drawn 128 px too wide and tall at first, 6 less a tick down to 1; x eases an eighth of the way to 140 a tick; from 139 on it blinks, hidden while `0xa2f10 & 31` < 12 |

The face's frame is 12 + (word 0x3187c4 & 3), and that word is always 0:
it starts 0 in the image, no instruction in G.EXE names it or any dword
over it (0x3187c0-0x3187c3) but this read, and none takes the block's
address to write through. So frame 12, always; frames 13-15 of PANEL.SPR
are "up" signs, not Jack.

**The menu** (`pause_cursor_tick`) reads the keyboard itself, not a
player's keys: `pause_game` points 0x317ca4 at 0x587ba4, the record
`keyboard_input_update` (0x6bcc6, run by `pause_tick` each tick) fills
from `keyboard_read_keys` (0x6bc62) — the cursor arrows (scancodes 0x60
0x61 0x5e 0x63) and Enter (0x1c) as button 0x10 — and the menu takes its
pressed word (`+4`). Down moves the arrow a row while there is one
below (the last rows, table 0x9821c: 2 1 1 1), up a row while not at the
top, each with a sound (0x15fe5, 1); any button (`& 0xf0` — here Enter alone) plays sound
0x30 and picks:

| state | row | does |
|---|---|---|
| 0 | 0 resume | the pause over (`hud_flag_8000` 0x1ac0b) |
| 0 | 1 quit level | level state (`+0x26` of the record at 0x317ca8) = **0x11**; state 1, row 1 |
| 0 | 2 quit game | level state = **0x10**; state 1, row 1 |
| 2 | 0 resume | the pause over |
| 2 | 1 quit game | level state = 0x10; state 3, row 1 |
| 1, 3 | 0 yeah | the pause over, and `level_end_countdown` 0xa2f16 = 25 |
| 1, 3 | 1 naah | back: state − 1, row 0, level state = 3 |

So "are you sure?" opens on naah, and naah comes back on resume.
`logic_frame` (0x2cbb9) counts 0xa2f16 down a tick and ends the level at 0
— 25 ticks of play after yeah. `level_finish` (0x10167) then gives a lost
level (state 3), or one quit with no lives left (0x11 with the record's
lives `+0x24` = 0), the shattering end sequence — not in battle, arcade or
a bonus round (options 0x30400000), nor in a `.J`.

**F.EXE** (`front_after_level` 0x20e1d, `front/world-map.md`):

- **0x10** quit game: the game ends, back to the title (0x12654, 0x21989);
  the panels the level took are dropped.
- **0x11** quit level, with lives left: the panels are dropped (`+0x1c` =
  0), a level below number 12 takes a life, and it is back to the map
  (state 0xb) — no "continue?", and the level's timmy points stay paid.
- **0x11 with no lives**: taken as 3, a level lost — the panels counted,
  "continue?" asked (`continue.md`).
- In the arcade (0x214c2) 0x11 records no time and goes back to the
  arcade's level select (0x18d3c, the ARLVSL_E screen — BATLSL_E for
  battle — answered through 0x12bf2): a level picked there starts the
  teams afresh (turn and best time cleared), none ends it at the title;
  0x10 ends it at once. Battle's handler (the "battle framework",
  0x212d2) takes 0x11 the same way, though its pause cannot write it.

**Clone:** `client/src/scenes/PauseScene.js` (Esc at one keyboard, every
local mode — the clone's coop with battle's menu; online play has no
pause; an arcade level quit goes back to the menu, where the arcade is
picked), `GameScene._pause`/`_unpause`,
`Story.quit`, `WorldMapScene` result `'quit'`. The menu takes the arrows
and Enter, as G.EXE's; no sounds, no music volume. The end sequence is not in the clone.
