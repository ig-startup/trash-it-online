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
