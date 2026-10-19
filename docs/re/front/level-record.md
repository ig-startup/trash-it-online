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
- **Inferred:** the same while shaking it off (slot 9, `git_hoovered_9`,
  whose decompiled body makes the same two calls);
- binned (`timbin_swallow` 0x2f7ea): `gits` +1.

Each also adds to a BCD copy (`+0x64`, `+0x6c`) and the total at 0x287bfc
for the HUD.

Clone: `GameScene._backToMap` hands the three to `Story` (`played`,
`won`); `gits.js` counts per player, with these worths.
