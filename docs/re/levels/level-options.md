# The level's option word (0x98224) — **Confirmed**

One dword of switches, `level_options` at VA 0x98224 (the "second option
byte" 0x98226 of older notes is its upper half). Some bits come from the
rules record (`rules-record.md`, VA 0x1ae49), some from the game type,
some are set and cleared while the level runs. Every one of the 97
instructions in G.EXE that touch 0x98224-0x98227 was read (a byte-pattern
sweep, not the decompiler, so none hides in a folded routine).

| bit | set by | does |
|---|---|---|
| 0x01 | rules +0x12 bit 1 (3T) | no hammer: BUT1 never takes it out (jack_stand, jack_run, jack_push, the hoover's UP+BUT1) |
| 0x02 | rules +0x16 bit 1 (no level) | the hammer stays in hand: BUT1 and DOWN with it out do nothing |
| 0x04 | rules +0x1a bit 1 (3T 8K, every C and D) | no hoover: UP+BUT1 never takes it out |
| 0x08 | rules +0x1e bit 1 (every C and D) | the hoover stays in hand: BUT1 and DOWN with it out do nothing |
| 0x10 | rules +0x0e bit 1 (every C and D) | every player starts with the hammer out (load_level → 0x22fa5), unless 0x01 |
| 0x20 | rules +0x0e bit 2 (no level) | every player starts with the hoover out (→ 0x24bb6), unless 0x04 |
| 0x40 | rules +0x22 bit 1 (no level, with demolish_all at load); demolition_tick at its end | the level is demolished — written, never tested |
| 0x80 | double_points_on (the bubble) | double points for 1920 ticks: rubble scores twice (add_rubble_score), the rubble icon wobbles |
| 0x100 0x200 0x400 | a button pressed (button_tick: its colour's bits) | the hidden buttons of that colour come out (`objects/buttons.md`) |
| 0x800 | the last timmy bin full (timbin_swallow); the last rocket piece on (crane_arm_tick) | frees the subtype-2 bell (bell_wait_option_800) |
| 0x1000 | a button whose colour bit it is | option_1000_watch fires the rules' +0x26 handler once (the 1D show, the demolition) |
| 0x2000 | option_1000_watch | 0x1000 handled |
| 0x4000 0x8000 | the apocalypse's camera locks (apo_op_cam_lock_xy) | camera_frame_targets holds x / y (`logic/camera.md`) |
| 0x10000 | apo_op_cam_lock_width | the camera's width held |
| 0x20000 | the apocalypse script's dword clear (`& 0xfffc3fff` clears 0x4000-0x20000) | nothing reads it |
| 0x40000 | apo_op_dive | nothing reads it |
| 0x80000 | super_hoover_on; off in super_hoover_tick | the super hoover: the hoover blinks, its box is 2048 × 1024 (hoover_tick) |
| 0x100000 | rules +0x2e bit 1 (the T and U shows) | hud_setup leaves the story panel out — no clock, no counters |
| 0x200000 | rules +0x32 bit 1 (the same ten) | sets 0x9385c: with a GrIP pad, spawn_pad_display puts ten JOY.SPR buttons on screen — the pad's presses shown as the recording plays |
| 0x400000 | bonus_round_setup | a bonus round: its own clock list, blow_walk_cells, music_start plays 0x6d48f instead of the level's XMI, level_finish skips the end sequence |
| 0x1000000 | hud_setup; bell_touch_tick when the last ring is rung; bonus_object_tick | the players are held: the clock stops; the countdown's `go` (hud_script_step op 17) lets them go |
| 0x2000000 | pause_game, while paused | the clock stops, entities_settle and hud_objects_tick wait |
| 0x8000000 | bell_touch_tick, a ring with more to go | nothing reads it |
| 0x10000000 | hud_setup, game type 1 (battle) | the bell's places (bell_finish_place), no knock limit (timmy_knock_limit 0x7fff), the pause menu without "quit level" (pause_hud), camera_player_follow's other form, level_finish skips the end sequence |
| 0x20000000 | hud_setup, game type 2 (arcade) | the same, and hud_number_draw / bell_finish_place's arcade forms |
| 0x40000000 | rules +0x36 == 2 (the 39 levels whose bell asks for a share trashed) | the panel's bomb-and-% counter (list 0x972fc): what is still to trash, `front/hud.md` |

So no shipped level forbids the hammer but 3T (a show), and every bonus
round starts with the hammer out and the hoover forbidden.

Clone: bits 0x01-0x20 are exported per level as `handOptions`
(`ob.hand_options`, left out when 0: 3T 0x05, 8K 0x04, every C and D
0x1c) and applied in `client/src/entities/Player.js` (`HAND`,
`drawAtStart`): BUT1 and UP+BUT1 as the tests above, and the draw at the
level's start. Where the clone's hoover BUT1 swaps it for the hammer
(slot 71) whether or not UP is held, it is blocked only with UP held under
0x01, as in jack_hoover_held; the DOWN actions it gates are not in the
clone.
