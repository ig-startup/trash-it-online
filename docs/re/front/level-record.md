# What a level leaves for the front end — **Confirmed**

`TRASHIT.DAT`'s record is shared: G.EXE reads it through 0x317ca8, F.EXE
through 0xd6d1c, and **G.EXE's pointer is 4 bytes further on** — G's
`+0x20` number is F's `+0x24`, G's `+0x26` state F's `+0x2a`. Below, both
offsets.

At the end of a level G.EXE's `print_level_counters` (0x10a62, called
from `game_main`) writes three counters (`logic/counters.md`), and
`jack_touch_panel` has been adding to a fourth:

| G | F | what | how F.EXE uses it (0x20e1d, `map_node_trashed` 0x20072) |
|---|---|---|---|
| `+0x0c` | `+0x10` | the **rubble**: 0x287bf0, each piece hoovered its area / 16, doubled under option 0x80 (`add_rubble_score` 0x19fd2, `count_hoovered` 0x61327; any player's hoover) | won: added to the **score** (`+0x14`) |
| `+0x14` | `+0x18` | **player 1's** timmies + gits (player struct `+0x68` + `+0x70`, 0x28b9e4 + 0x28b9ec) — the other players' are not counted | won: added to the **timmy points** (`+0x1be`), and kept per node (`+0x20a`) |
| `+0x18` | `+0x1c` | **panels** taken, +1 each (`jack_touch_panel` 0x1bacb) | any level played to its end: added to the **lives**, kept per node (`+0x26a`, a replay takes them back — `map-dialog.md`), then cleared — before "continue?" is asked |
| `+0x1c` | `+0x20` | the timer, 0x96fb0 | not read |

A level quit — and every level played back from a `.J`, for which G
writes state 0x11 (0x96bc6, `front/side-levels.md`) — skips all of it
and costs a life instead, below level 12 (0x20e1d).

**What a timmy is worth** to its hoover's player (`git_hoovered`
0x322c5 and the tail at 0x31b6e it shares with `git_hoovered_8`):

- hoovered walking: `timmies` +1 (popup 0);
- hoovered knocked flat (slot 8): +2 (popup 3); a king timmy — which can
  only be hoovered knocked — `gits` +20 (popup 6);
- the same while shaking it off (slot 9): `git_hoovered_9` (0x31bbf) is
  `git_hoovered_8` with animation 12 for 11 — it jumps into 0x31aaf, the
  same code, from the animation call on;
- binned (`timbin_swallow` 0x2f7ea): `gits` +1.

Each also adds to a BCD copy (`+0x64`, `+0x6c`) and the total at 0x287bfc
for the HUD.

**The popup** (spawn_got_popup 0x11a92, sprite 0x5a `GOT.SPR`, sound
`play_sound_then_step`): the number is popup 0, 3 or 6 — the first of three GOT
frames saying +1, +2, +20 — put at the timmy, 0-3 px right. It lives 30
to 45 ticks (frame counter & 15 + 30) and steps through its three frames
every 4 (got_animate 0x11bf9). Its motion is one of four (table
0x9372c, by a random & 3): 0 and 3 rise 1-4 px a tick (0x11b99); 1 eases
toward a point 64-191 px above, 1/32 of the way a tick (0x11ba9); 2
falls at 0-4 px a tick, pulled up 0x3a98 a tick while below that point,
and bounces off it keeping a quarter of its speed (0x11bc4). Its time out
(die_after_timer_puff 0x1cebe), it goes in **a puff**: spawn_at_frame_centre
(0x11c6e) puts `BLOI.SPR` (sprite 0x59) at the thing's point, stretched by
as much as the thing's frame exceeds 32 px either way, seven frames three
ticks each (puff_tick 0x11d4b). The same puff marks a panel, a clock and
the super hoover picked up (0x1bacb, 0x12096, 0x1b48c). Clone: `popups.js`.

Clone: `GameScene._backToMap` hands the three to `Story` (`played`,
`won`); `gits.js` counts per player, with these worths.

**Scoring, all of it.** Every BCD addition in G.EXE goes through
`bcd_add_score` (0x19b9d), a plain eight-digit packed-BCD adder (the
"in fives" an old name gave it is the rules record turning its time into
BCD, five then one at a time). It has four callers, and they are the
whole of the score: the rubble hoovered (`add_rubble_score`, area / 16,
doubled under option 0x80), the timmies (`player_add_timmies`, 1 / 2 / 20),
the gits (`player_add_gits`, the bin's and the knocked ones') — those three
above — and the rules record's clock. The clock is added to with
`bcd_add_clock` (a clock picked up, +0:25) and counted with
`bcd_sub_clock`; `level_finish` adds no time bonus. Beyond the level:
battle points by place (8/4/2/1, `game-types.md`), lives from panels and
the timmy points the shop spends (F.EXE, `map-panel.md`, `hammer-shop.md`).

**A life for 10000 of rubble.** The story panel's rubble number
(0x287bec, BCD — the same additions as 0x287bf0) has a tick of its own,
`rubble_extra_life_tick` (0x1a9b0, list 0x97284): once it is past 10000
it flashes for 64 ticks, then 10000 comes off it (`bcd_sub`) and off the
record's score (`+0x10`, a plain 10000), the record's lives (`+0x24`) go
up by one, 32 panel sparks fly off Jack 1 and sounds 0x8d and 0x8c play.
It can come round again in the same level. The rubble the level reports
at its end (`+0x0c`, from 0x287bf0) is not reduced, so in all a life costs
10000 of score. Only the story's panel carries this tick. Nothing in
G.EXE clears 0x287bec — it starts at 0 because G.EXE is run afresh for
each level (F.EXE exits to start it, `frame.md`), so the 10000 must be
hoovered within one level. "Past" is strictly more: `0x10000 <` in BCD.
The flash counts 64 down; the life comes on the tick it reaches 1. The
sparks are `spawn_panel_spark`'s (the panel taken throws the same 32 at
the Jack who took it): each starts at a random 16-bit point and eases
onto Jack 1's feet plus a 64-step sine of 73 px (table 0x98b96,
`orbit_wobble` 0x1d252), x a quarter of the way a tick, y an eighth,
twinkling through PANEL.SPR 21-36 with sound 0x88 each time its x step
comes round; after 50-177 ticks it flies off sideways (`spark_fly`).
Clone: `GameScene._lifeTick`, sparks in `popups.js`.
