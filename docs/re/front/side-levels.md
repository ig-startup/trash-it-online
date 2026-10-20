# The side levels T and U: shows, not levels — **Confirmed**

Six worlds carry a side node numbered 29 (T) and five one numbered 30 (U)
— TJ UJ, TH UH, TC, TS US, TL, TI UI (`front.py`, node kind 2). They are
ordinary levels — each has its bell (a subtype-1 bell, TL a timmy bin's
subtype 2) — and they are the only story levels with a `.J` recording
(`formats/j.md`). Every address below is G.EXE's unless it says F.EXE.

**The recording plays itself.** `load_level` (0x1074b) looks for
`LEVELS\<name>.J` (0x107b2) and, unless the game is recording
(0x96bc4 = 1, `/RECORD`), finds it ("autoplay file found"), opens it
(0x179eb) and sets 0x96bc6 = 1: playback. The players and their hammers
come from the file (`read_pad_or_playback` 0x17923, `formats/j.md`): every
T/U show is one Jack (the five long files **inferred** so), with the hammer it was recorded with — TJ TC TS UH
UI UJ the sledge v1, TH the warhammer v2, TI the splitter v3, TL and US
the bio hammer v1. From then on `read_joypad` (0x6b65f) takes each player's
word from the recording (`demo_next_word` 0x17976), in pad mode 6
(`jack/controls.md`), and reads the real keys only to see whether a
button (input & 0xf0) is down: if so, `exit_game("Joypad has been
touched")` — the show is over, straight back to F.EXE.

**It cannot be won.** When the recording runs out, `demo_next_word` sets
0x3187f0 and `game_main` (0x2c52c) ends the level; `level_finish`
(0x10167) skips the end sequence while 0x96bc6 is set, and
`print_level_counters` (0x10a62) writes state **0x11** — "quit" — into
the record whatever happened, the bell rung or not. F.EXE's
`front_after_level` (0x20e1d) takes 0x11 below number 12 as a life lost;
at 29 and 30 it costs nothing and trashes nothing. So a T/U node is never
trashed: fire on it (map_fire_pressed, `world-map.md`) plays the show
again, every time, and its film (node word 13: TL 32, TI and UI 0) is
never reached.

What the shows show: TJ hammers through the junkyard with the sideways
windup (pad 0x80) and looks round the level with the look button
(0x200); UJ, TL use the overhead windup, the jump, carrying — the pad's
tricks, one level each.

**Clone:** a T/U node says it is the original's show and stays open
(`Story.fire`); the recordings are not played yet — that needs the pad's
layout in `Player.js` and a tick-exact run (the open item "demos").
