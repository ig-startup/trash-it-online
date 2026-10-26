# Sound — `SBANK.0`, `.WVL`, `.XMI`, the scripts — **Confirmed**

All Miles Sound System 3.x; `sound.py` reads all four.

- `SFX/SBANK.0` (67 samples, the game) and `FSFX/SBANK.0` (60, the front
  end): a 0x800-byte directory of `{u32 offset, u32 size}`, ended by a
  size with a zero low word (the game's own test). Each entry is a whole
  RIFF WAVE, 11025 Hz, 8- or 16-bit mono; some still carry their
  authoring names (`EXPLOS1.AIF`) and 1996 dates.
- `SFX/0A.WVL` — a Miles wave library: 32-byte `WAVE_ENTRY` records
  (bank, patch, root key, offset, size, format, flags, rate), 8 patches
  of 2–4 s at 22050 Hz. The music is phrases, not notes — which is why a
  six-minute XMI has 152 notes.
- `SFX/0?.XMI` — one per section letter, `FORM XDIR / CAT XMID`, three
  sequences each (they differ). XMIDI runs at a fixed 120 Hz; `sound.py
  export` writes them as `.mid` at that clock.
- **CD audio.** Four moments play a Red Book track off the game's CD
  instead (`cd_play_track` 0x6d48f, through Miles' `AIL_redbook_*`, only if
  a CD drive was opened): track **5** the double points (`double_points_on`),
  **6** a bonus round (`music_start` under option 0x400000), **7** a level's
  end (`level_finish`), **10** the 1D show (`dragon_sequence`). The copy
  in `Trash-it-original/` has no audio tracks, so the clone has nothing to
  play there. A game file not found on the disk is looked for on the CD,
  the CD audio stopped first if need be (`resolve_path_cd`, `cd_audio_stop`).
- The **sound scripts** live in G.EXE, not a file: 154 pointers at VA
  0x95f9c, a sound id indexes them; then the per-sample loop table at
  0x96204 (67 × `(start, end)`), right behind it. A script is a priority
  then ops — `play sample @rate+rnd&mask`, `wait`, pan/pitch moves, `end`
  — run by the interpreter at 0x1631c through 21 handlers at 0x9641c.
  The sound ids quoted in these notes (0x58, 0x59, 0x37 …) are indexes
  into it: `sound.py scripts G.EXE` names the sample each one plays.
  The handlers are named `sound_op_*` (`symbols.d/sound.txt`). Scripts
  29–32 play nothing — priority 0, a lone `skip` (op 14, its five words
  stepped over) and `end`: they are what the rules record's +0x2a picks
  into 0x287c6c (1/2/4/8 → 29/30/31/32), which nothing reads — an
  ambience per level that was never wired up (`levels/rules-record.md`).

**Which sound what plays** — the `play_sound` calls in G.EXE, the id read
off the `mov eax, imm` before each call (the decompiler drops the
register argument): Jack's jump and landing 0x6f, a step on run frames 2
and 10 0x1a, the side and overhead wind-ups 0x0c and 0x0d, the hammer or
hoover in and out of the hat 0x10 (`jack_hammer_to_hat`), taking hold
0x6c, a throw let go 0x6b, a ladder rung 0x53 up / 0x54 down on climb
frames 0 and 8, flattened 0x6e, flying home 0x98, out of the hat 0x3e, the
hat's hop 0x52; a blow on a block the material's sound (table 0x9fefe,
1-10, each struck cell a tick later, `blow_walk_cells`), and 0x28 when it
brought down more than 20 cells; a group or a piece of rubble landing the
material's landing sound (table 0x9ff14, `group_landed`, `rubble_state`);
the bell 0x5a a ring, 0x43 the last ring, 0x8f / 0x82 freed by the
percentage / the bins; dynamite 0x58 struck, 0x38 lit by a touch, 0x59
the blast; a teleporter pad opening or closing in view 0x36, sending 0x37;
the GOT popup 0x64.

The hat, read again: ducking in (from standing, a skid, the hammer or
the hoover) is 0x10, coming out on Up 0x11 (`jack_in_hat`), and 0x3e only
when his head meets something on the way out and he drops back in
(`jack_out_of_hat`); on the move in it, 0x56 on frames 7 and 11. A timmy
knocked by the hammer 0x19 (`git_tick`); a spike in view mutters 0x44
every 16 ticks, one spike a tick, and bristles 0x50 (`spike_tick` — sprite
0x54, the git whose animations run at half speed, is the spike); a spike
or bomb gone, its BLAM, 0x6a. A bonus git struck 0x75, bursting 0x3e. The
UFO hums 0x48 while in view (`looped_sound_add`, stopped and restarted by
`looped_sounds_update` as it leaves and re-enters the view), 0x84 struck,
0x85 a spark, 0x86 a beam ring after 30 ticks, 0x87 a bolt, 0x29 blown
up. The sucker: 0x4d the landing wobble, 0x49 + 0x4a armed, 0x49 a catch,
0x4b the throw, 0x4c the empty hop. The seesaw 0x4f tipped, 0x4e its rider
launched. The cannon: 0x2f a ball into the bowl, 0x31 + 0x30 the spark
starting along the fuse, 0x13 the shot, 0x3f its wheel each 32 px, 0x3c a
cannonball landing. The hoover's motor 0x16 from its list's show to its
hide, then 0x17; 0x18 a piece caught. The clock: 0x3a each turn, 0x3b
burst by the hammer, 0x93 taken; the HUD clock 0x63 each of the last ten
seconds. The bubble 0x76 at each hop, the dispenser 0x3e a ball, the super
hoover 0x94-0x97 at once. The pause menu 1 a row, 0x30 a pick.
`play_sound_at` (bubble, forklift, cannons) also pans by the source's
place in the view and fades as the view widens; the clone plays them
centred, at full volume.

**Voices**: 15 (the sample handles `ail_startup` gets); a sound takes a
free one, else the next round the ring whose priority is no higher (never
0x7fff), else it is not played (`sound_voice_alloc` 0x1618f). A `play`
replaces the voice's sample, at volume 100; scripts step once a logic
tick (`sound_tick` 0x162c7). `level_finish` stops them all
(`sound_stop_all` 0x167b3). The clone: `client/src/audio/sfx.js`, data
from `scripts/export_sounds.py`; the pan ops are not played. Not played
yet, for want of the thing in the clone: the hard landing 0x57, the ground
pound 0x69, the stomp 0x70, skid dust 0x51, the bell's glow 0x41/0x42,
the sign 0x3d, the HUD target 0x90, a group landing's 0x1b, the forklift
0x14 and its super hoover 0x99. The bonus round's object: 0x29 each frame it
cracks on, 0x29 twice and 0x27 when it bursts.
