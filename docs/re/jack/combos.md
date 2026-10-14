# Key combinations: the hammers' tricks and cheats — **Confirmed**

Each hammer record (`hammer_record_ptrs`, 0xa2d0c) carries at `+0x58` a
list of (key sequence, handler) pairs; `initialise_a_players_hammer`
registers the chosen hammer's list for the player (`combo_register`,
0x1df22), and every tick `combos_check` (0x1df6c) steps each sequence
against the player's input word (`combo_step`, 0x1dfc6).

A sequence is a list of input words ended by −1. The step advances when
the input word equals the next entry, so `0` entries mean "nothing held"
— three zeros, three ticks released. A wrong word, or 10 ticks without a
change, starts the sequence over. Keys: L R U D = 1 2 4 8, BUT1 0x10,
BUT2 0x20; 0x40/0x80 are the pad's extra buttons, so each trick has a
pad spelling and a keyboard spelling.

## What every hammer has

| keys (keyboard) | pad | handler | does |
|---|---|---|---|
| BUT1, release, BUT1, release, BUT1, release | the same | 0x1dead `arm_hammer_trick` | sets the player's flag for this hammer (`+0xb0 + hammer×2 = 1`) |
| R, R, L, then BUT1 five times (released between) | 0x40 ×5 | 0x1e037 `warp_to_bell` | **Jack jumps to the bell** (0x3f209a, 10 px above) — a cheat |

The armed flag lasts **one tick**: `logic_frame` clears every player's
flag for his hammer each frame (0x2ba7d), so the combination has to end
while Jack is already in the state that spends it. It is spent by:

- **any hammer, in the hard hat** — `jack_in_hat` → 0x211d2: armed (or,
  on a pad, BUT1 + 0x40 held) → the palette flashes and Jack **flies back
  to his flag** (0x33861). This is the "hat to flag" route the
  keyboard-layout note was missing.
- **hammer 20, the sledge hammer v3**, overhead windup → state 0x2a4d8
  (slot 66, 28 frames; at frame 8 something 62 px ahead, 0x34590) — not
  traced further.
- **hammer 29, the apocalypse hammer v3**, sideways windup → the hammer
  flies off on its own (`apocalypse_start`, 0x15260).

## Hammers with more

| hammer | keys | handler |
|---|---|---|
| 20 sledge v3 | D+BUT2, BUT2, three times (pad: D, 0x40 ×3) | arm |
| 29 apocalypse v3 | BUT2, L+BUT2, BUT2, D+BUT2, BUT2, L+BUT2, BUT2, U+BUT2, BUT2 (pad: 0x80 with L D L U) | arm |
| 33 mystical dragon | the bell-warp keys | **0x204c3**: CD track 10 and the [dragon show](../levels/dragon-show.md) (table 0x9ff42) — the same one 1D's button starts; it runs before the warp |
| 34 THE ULTIMATE MOOLA | R, BUT2, L, BUT1, U, BUT2, D, BUT1 (pad: R 0x80 L B1 U B2 D 0x40) | **0x204f4**: the 80-tick count and the **demolition of the whole level** |
