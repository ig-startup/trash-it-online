# The front end's frame: ticks, input, objects — **Confirmed**

What every F.EXE screen runs underneath it. Addresses are F.EXE's; names
in `scripts/ghidra/fexe/symbols.txt` (`fn.py --f`).

**A screen is a loop over `run_ticks` (0x12bf2).** The screen puts its
tick routine at 0x85ede and calls `run_ticks` with a count of ticks, or
with 0 for one frame's worth, until its own done flag (usually 0x139720,
with the fade's 0xd6d5d) is set. `run_ticks` reads the time
(`timer_ms` 0x547fa, the PIT in milliseconds) and runs the routine one to
four times a frame — the time gone / 13 ms, changed only after the same
rate twice ("Rate %d"); flag 0x85edc pins it to one. So the front end, like
the game (`jack/movement.md`), keeps a ≈77 Hz tick whatever the frame rate.

A tick routine is two calls: `frame_end` (0x1a88a, the tick counter
0xd6d4c, the retrace, and the record's `+0x202` = 1) and `screen_tick`
(0x1ab15), which, when `+0x202` is set:

1. reads Esc (scancode 1) — 0x8916e down, **0x89172 the first tick it is
   down** — what every screen means by "Esc";
2. `camera_shake_tick` (0x205ba): while a shake is on, the camera
   (0xc613c x, 0xc6140 y, 16.16) is ± a random amount up to the
   amplitude, the sign by the tick's parity; on odd ticks the amplitude
   grows by its step, turns back past the maximum and stops at 0.
   `camera_shake_start` (0x20588): x amplitude AX, step BX, maximum
   [esp]; y from CX, DX, [esp+4];
3. `random`, `objects_tick` (0x24d4b): first the objects queued for
   removal (bit 4 of +0x90) go back to the free list, then the queued
   new ones (`obj_spawn`) join; then each live object not hidden (+0x90
   & 6) runs its behaviour (+8) and `obj_draw` queues it;
4. `input_tick` (0x52012) and `keyboard_input_update` (0x520e8);
5. `fade_step`, two debug lines (object counts, input devices),
   `scripts_tick` (each live script controller);
6. `draw_objects`, `draw_bars`, and the page flip (0x233f0).

`screen_reset` (0x1a9e3) starts a screen afresh: the sprite pool, the
input records, the camera, both object pools (`objects_reset`), the
random seed back to 0x12345678, no idle timeout. Each screen then calls
`scripts_reset` with the number of controllers it wants.

**Input.** Each player's device word (0x516534 + 0x13c n) is copied to
0xc607c, and `input_player_update` (0x13397) turns it into an 18-byte
record at 0xc608c + 0x12 n:

| offset | what |
|---|---|
| +0 | held now |
| +2 | **pressed** — held now and in neither of the two ticks before |
| +4, +6 | held one, two ticks ago |
| +8 | +4 \| +6 |
| +0xa | **repeat**: the press, then every 4 ticks after 15 held |
| +0xc, +0xe, +0x10 | the repeat's first delay (15), period (3 + 1), counter |

Bits as in the game: L R U D = 1 2 4 8, the buttons from 0x10. The last
player who touched anything is 0xc611e — menus read *that* player's
record, so any pad drives them. A count at 0xc6122, while above 0,
freezes the records (the credits set 90). The keyboard has its own word
too (`keyboard_read_keys` 0x5207f): the cursor keys (scancodes 0x60
0x61 0x5e 0x63) as L R U D and Enter as 0x10, held at 0x513d38, pressed
at 0x513d3c — the shop and the dialogs take either.

**Idle timeout** (`screen_timeout_set` 0x2083e): AX seconds, ×60 ticks,
then the routine in EDX is called once (`screen_timeout_tick` 0x20869,
from `frame_end`); any key of the last player restarts the count; -1
none. The title uses it for the attract mode (`title.md`).

**Objects.** 0x226 objects of 0x10c bytes (0x3760f4) and 0x226 links of
0x14 bytes (0x3735fc), each a free list and a live list
(`obj_pool_init`, `links_init`). `obj_create` (0x24e39) takes one at
once at the head of the live list (`obj_alloc` 0x256e8) — so a newer
object ticks first (`hammer-shop.md`); `obj_spawn` (0x250e0) queues it
for the next tick. `obj_create_picture` (0x1c8bf) is the screens'
backdrop call: a bare object of sheet slot AX at depth CX, x DX, y BX,
frame [esp+4], whose sheet's colours (the slot entry 0x8e62c + 0x58 k:
first, last, palette) go into the screen palette (`palette_set_range`
0x2420b).

**Leaving.** `exit_front` (0x23ee9) formats a message, restores the
video mode, stops and closes the CD (`cd_close`), shuts the sound
(`sound_shutdown`), gives the keyboard back, prints the message and
exits — the way out of F.EXE both for "Exiting FRONT" (to G.EXE) and for
every fatal error. Music is Red Book audio: `cd_play_track` (0x52d06)
stops what plays and starts track AX, `cd_stop` (0x52d8e).
