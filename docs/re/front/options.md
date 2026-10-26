# The options: audio and controllers — **Confirmed**

The two screens behind the title's OPTIONS (`title.md`). Addresses are
F.EXE's; names in `scripts/ghidra/fexe/symbols.txt` (`fn.py --f`).

**AUDIO CONF picks the level music** (`audio_config` 0x153d3, the
"audio configuration" screen). It is a picture of a pad whose four
buttons are wired to four round windows; each window holds an icon —
a crossed-out note (none) and a small, a medium and a large note
(PDCNBG_E frames 7, 8, 9, 10). Pressing a button sets the record's
`+0x30` at once (`audio_config_tick` 0x15291):

| button | `+0x30` | icon | G.EXE plays |
|---|---|---|---|
| 0x20 | 3 (the default, `front_init`) | small note | tune 0 |
| 0x80 | 2 | medium note | tune 1 |
| 0x40 | 0 | large note | tune 2 |
| 0x10 | 1 | crossed out | no music |

then the chosen icon blinks for 23 steps of 4 ticks and the screen
closes (or when the idle timeout runs out). G.EXE reads it as its own
record's `+0x2c`: the music sequence is `0x96afa[+0x2c]` — 2, -1, 1, 0 —
the sequence number in the section's `.XMI` (three each,
`formats/sound.md`); anything outside 0..2 leaves the music off. The
three sequences are the same tune at channel volume 127, 85 and 43, so
the setting **is the music volume** — large note loud, medium, small note
(the default) quiet — or none.

**CONTROLLER CONFIG — who plays on what** (`pad_config` 0x10ad6). Four
columns, one a player (the blue, red, green and yellow lamps of
CONPAD.SPR's picture), and five device rows, each cell drawn allowed,
chosen or not allowed (`pad_config_draw` 0x10bd1):

| row | device | allowed for |
|---|---|---|
| 0 | the keyboard | every player — but not player 1 when joystick A is in, nor anyone when GrIP pads are |
| 1 | a joystick | players 1 and 2, with joystick A |
| 2, 3 | two pads | player 1 only, with joystick A / B |
| 4 | a Gravis GrIP pad ("GRIP") | one player per pad found |

`detect_devices` (0x105dd) finds joysticks A and B and counts the GrIP
pads; `pad_config_defaults` (0x1062d) fills the table at 0x852d0 (18
bytes a player: the device, then a word per row, 1 = allowed). With
GrIP pads every player that has one is on it; without, player 1 takes
joystick A if there is one, player 2 joystick B, and the rest the
keyboard. The cursor (`pad_config_cursor_tick` 0x10e83), driven by
any pad: LEFT / RIGHT a player, UP / DOWN the next allowed row, below
the last the DONE plate (row 5). Fire on a row:

- **another device** — the player takes it; player 1 on a pad (rows 2,
  3) takes both joystick ports, so player 2 goes back to the keyboard;
  player 1 on the joystick gives player 2 one too if joystick B is in,
  and player 2 on the joystick puts player 1 on it as well;
- **the keyboard again** — redefine the player's six keys
  (`keys_redefine_start` 0x10053, "press a key...."), stored per player
  at 0x51653c + 0x13c n;
- **row 3 or 4 again** — the button layout (`pad_layout_screen`
  0x14f07, "blue player reconfigure your controller"): UP / DOWN through
  three layouts, a button to keep it, in the record's `+0x2c + player`
  (G.EXE's `+0x28 + player`, the remap of `jack/controls.md`);
- **DONE** — the screen ends; on leaving, `front_main` writes each
  player's device and keys into the record (`apply_player_input`
  0x1125b: `+0x70 + 14 n`, the keys from `+0x72`; the joystick setup at
  `+0xa8`) — "Setting player_input" — for G.EXE to read (`+0x6c` and
  on there).

Clone: the clone has its own key setup, not this screen.
