# The in-level panel (HUD) — **Confirmed**

What G.EXE draws over a level: the clock, the counters, the countdown, the
double-points and super-hoover banners, the pause menu, the forklift's
gauges. `scripts/formats/hud.py` dumps every list, icon and script below
from G.EXE; the routines are in `scripts/ghidra/symbols.d/hud.txt`.

**Lists.** `panel_script_run` (VA 0x196db) walks a list of 20-byte entries
`{item*, s16 x, s16 y, value*, tick*, out*}` to a null item. The item's
word 0 is its kind: 1, 4, 5 a **number** (`panel_icon_add` 0x19931, ten
slots at 0x287044) — word 1 its digit sheet, BNUM (57) big or SNUM (58)
small, `value*` the BCD dword it shows; 2 a **sprite** (`panel_icon_alloc`
0x197e8, sixteen 0x94-byte records at 0x28729c) — word 1 its frame, word 2
its sheet, word 3 flags. `tick*` runs every tick (`hud_objects_tick`
0x19ad0). The ticks are reached only through these words, so Ghidra had
folded most of them into their neighbours; they are named now.

**Scripts.** Most sprite ticks are a stub that hands the record a script
(`hud_run_script` 0x1a199) for `hud_script_step` (0x1a1fb), which runs
ops until one waits. A record is a stretchable rectangle — x, y (16.16) and
a width and height it is drawn to:

| op | args | does |
|---|---|---|
| 1-4 | target | ease the left / right / top / bottom edge to it (`hud_ease_axis` 0x1a4a7: speed up, brake four times as hard) |
| 5 | n | wait n ticks |
| 6-9 | speed, acceleration | for edges 1-4 |
| 10 | — | stop every motion |
| 11, 12 | v (16.16) | drift x / y by v a tick |
| 13 | w, h | the size |
| 14 | x, y | the position |
| 15 | n | shake the screen (`request_shake`) |
| 16 | frame | the frame |
| 17 | — | **go**: the players are let go (`players_bade_clear`, option 0x1000000 off) |
| 18 | id | a sound |
| -1 | — | the end |

**What a level shows** (`hud_setup` 0x195e5, by game type and options —
see `levels/level-options.md`):

- **Story** (type 0), unless option 0x100000 (the T/U shows): the clock
  (BNUM, top centre, `hud_clock_tick` 0x19dce — frozen while the players
  are held or the game paused; one second per 60 ticks; at 0 the level is
  lost; under 0:20 it flashes, from 0:10 it beeps; a clock picked up makes
  it swell); PANEL 1, the weight, with the rubble score (0x287bec) top
  left; PANEL 0 with the timmy total (0x287bfc) top right. Then the
  **countdown** (list 0x97374): PANEL 47 "3" flies in and becomes 2 and 1
  (op 16), 48 drops and shrinks away, PANEL 50 "GO" drops with a shake and
  its `go` starts the level — the players stand still until then.
- **A bonus round** (option 0x400000): only the clock (list 0x9752c), then
  the countdown.
- **Battle** (type 1): the clock at the left, then the countdown.
- **Arcade** (type 2): a stopwatch counting up (`hud_stopwatch_tick`
  0x19edb, a step per 7 ticks, frozen the same way); with a target (level
  state +0x1c) PANEL 51 drops in with the target number, waits 100 ticks,
  and the countdown follows as the number shrinks into the corner.
- **Option 0x40000000** (rules +0x36 == 2 — the 39 levels whose bell waits
  for a share trashed): PANEL 46, a bomb and "%", slides in at the left
  with a number that starts at 100 and ticks down one a frame to what is
  still to trash — the bell's percentage less `destroyed_percent`, made BCD
  by `sum_by_table` (0x1a950); it flashes when it gets there.
- **Game 0x14** (a demo playing): DEMO.SPR, wobbling (list 0x9725c).

**Banners.** Double points (`double_points_on` 0x1a516) flies DOUBLE and
RUBBLE (PANEL 4, 5) in one of three ways picked by `random & 7` (table
0x98148: ways 1 and 2 three times in eight, way 0 twice). The super hoover
taken flies FORK 16 across and back (list 0x97608). A list at 0x9762c of
four more banners (scripts 0x97acc-0x97c04) is run by no code found.

**Pause** (`pause_hud` 0x1aaa8, list 0x973c4): PAUSE (PANEL 55)
wobbling, the menu plate by the pause state 0x287c50 — 52 "resume / quit
level / quit game", 53 "are you sure? yeah / naah", 54 "resume / quit
game" (battle and arcade) — the arrow (PANEL 56-57) moved by the pad, and
Jack (PANEL 12) zooming in. Bit 0x8000 of 0x287c50 takes them all away.
The menu and what quitting does: [pause](pause.md).

**The forklift** (`jack_touch_forklift`, table 0x98434 per player): FORK
17 and 18 + gear (`forklift_panel_gear` 0x1c553) and, for player 0, the
rev needle REV.SPR (`forklift_rev_needle` 0x1c5fe, eased two a tick).

Clone: its own text panel under the view (`GameScene.js`, the HUD camera); none of the above is the original's yet.
