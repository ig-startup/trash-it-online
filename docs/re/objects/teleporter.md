# The teleporter — **Confirmed**

`.OB` class 27 (constructor VA 0x347c1, 20-byte payload), 93 in 22
levels: `x, y`; at +14 bit 0 keeps it on for good (`+0x54 |= 3`); at +16
its own number, under 8 (`"teleport id exceeds limit"`), which puts it in
the table at 0x3f20a4; at +18 the number of the pad it sends to (`+0x58`).
TELLY.SPR, template 0xa4190 (state 0x34890), is a pad — frames 0-9 open
and close it — and while it is open a beam stands over it, frame 10, a
sprite of its own (0xa41ac, state 0x34a26). The pad is a physical sprite
(0x34d3e → 0x1f098, box ± 10): it settles onto what is under it.

- **The cycle** (`+0x54` bits, VA 0x34961-0x34a1c): 2 asks it to open — it
  makes the beam and steps 0 → 9 on the frame counter's `& 3`, then is
  open (0x20) for `+0x4a` = 180 ticks; 4 asks it to close — 9 → 0, the beam
  shrinks away (0x34cda) — and it stays shut (0x40) 180 ticks before
  asking to open again. Bit 1 skips the open countdown: always on. Every
  pad in the exported levels has it.
- **The beam** grows over about 20 ticks (offsets to its width and height,
  tables 0xa41f6 and 0xa41cc) and shrinks by 0xa4262 / 0xa421e. Each tick
  it searches for category 0x10000 — Jack's, whose category is the u32
  0x10804 — and sends on (0x34b5b) what it meets that is **in the air and
  not carrying** (`+0x40 & 0x30` clear), if the pad it names is open, has
  more than 30 ticks of it left and room for one more of its eight
  passengers. Sound 0x37; the passenger is held 8 above the beam.
- **The far pad** (0x34bcb) squeezes each new passenger — width offset
  `+0x50` down a pixel a tick, height `+0x52` up — until it is 6 px wide,
  moves it 12 above itself, and lets it out the same way back.
- **No ping-pong.** A passenger stays on the far pad's list after it is
  let out, and the beam leaves it alone until it has left the beam (VA
  0x34aa4-0x34b15) — it comes out standing in that pad's beam.
