# `.PAK` — RNC ProPack — **Confirmed**

Ten files in `FSPR/`, all RNC method 2 (F.EXE logs `"failed to
'unpropack()' RNC buffer"`). `pak.py` unpacks every one and each matches
the CRC-16 in its header, so the decode is byte-exact.

- `LVSPAT1..9.PAK` — 640×480 bytes, but not a picture: 255 draws the
  paths of level-select screen N, and single pixels 1..N (13 to 32 a
  screen, 201 in all) number points along them. 201 against 147 levels —
  not one point per level: they are the nodes of the world maps,
  levels and path corners alike (see "The front end").
- `WARNING.PAK` — a 20-byte header (16 bits per pixel, 2 bytes, …, u16
  width 640, u16 height 256) and 640×256 **RGB555** — the anti-piracy
  screen. Read as 8-bit, it looks like two interleaved half-images.
