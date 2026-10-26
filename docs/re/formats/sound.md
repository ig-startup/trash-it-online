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
  six-minute XMI has 152 notes: nearly every key is the root, 60, so a
  note plays its phrase as recorded, cut at the note's duration.
- `SFX/0?.XMI` — one per section letter, `FORM XDIR / CAT XMID`, three
  sequences each, and the three are **one tune at three volumes**: they
  differ only in the channel volumes set at tick 0 (controller 7 = 43, 85,
  127) — the AUDIO CONF setting picks one (`front/options.md`). XMIDI runs
  at a fixed 120 Hz; `sound.py export` writes them as `.mid` at that clock.
  Each loops forever from its FOR (controller 0x74, near tick 50) to its
  NEXT (0x75, at the end) — `music_start` sets loop count 0.
- **Which file.** `audio_init` (0x16cc7) takes the level's name (`8K`),
  puts `0` over its first letter and loads `0K.XMI` (`"%s.XMI"`); this
  copy has none for sections D, E and U (what a failed load does — the
  "Error loading" string — is not read). The wave library is
  `"0a.WVL"`, the same for every section, though `sprintf` is still handed
  the name: the source surely said `"%s.WVL"` (same length), and this copy
  — an old-games.ru rip — was patched to load the one file it kept.
  **Inferred**, not checked against a full CD: `0A.XMI`, `0I.XMI` and
  `0T.XMI` use only patches 0–7, which 0A.WVL has; the other eight ask for
  8–15 (TIMB chunk and program changes), whole verses of them, and get
  silence — and if each section had its own library, even I and T play
  A's phrases here. The clone plays 0A's tune in every section
  (`export_music.py`, `client/src/audio/music.js`).
- **Pause and stop.** `pause_game` sets flag 2 of 0x96474, `sound_tick` →
  `music_pause_resume` (0x17059) stops the sequence, and flag 4 on leaving
  resumes it where it was; a phrase cut by the pause is not played again.
  `level_finish` stops it; so does **every `cd_play_track`**, which sets
  flag 2 before it looks for a CD — the double points and the 1D show end
  the level's music for good, CD or not.
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

**Voices**: 15 (the sample handles `ail_startup` gets); a sound takes a
free one, else the next round the ring whose priority is no higher (never
0x7fff), else it is not played (`sound_voice_alloc` 0x1618f). A `play`
replaces the voice's sample, at volume 100; scripts step once a logic
tick (`sound_tick` 0x162c7). The clone: `client/src/audio/sfx.js`, data
from `scripts/export_sounds.py`; the pan ops are not played.
