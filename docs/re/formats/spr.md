# `.SPR` — sprite sheet — **Confirmed**

| offset | size | field |
|---|---|---|
| 0 | u32 | total file size (self-referential) |
| 4 | u16 | frame count N |
| 6 | u16 | offset of the frame table (always 8) |
| 8 | N x u32 | frame offsets — **relative to byte 8**, not to the file start |
| … | | the frames |

Frame:

| offset | size | field |
|---|---|---|
| 0 | i16 | width |
| 2 | i16 | height |
| 4 | i16 | origin x (draw offset from the entity position; usually negative) |
| 6 | i16 | origin y |
| 8 | var | scanlines (see the codec above), exactly `height` of them |

The "offsets are relative to byte 8" detail is what the first pass
missed: `G.EXE` keeps a pointer to `file + 8` and indexes off that
(VA 0x2e371, 0x2e3bb), then adds 8 more to reach a frame's scanlines
(VA 0x6a596).

Verified: `SPR/JACKS.SPR` = **329 frames, all 329 decoding to exactly
their declared height**, and rendering to recognisable frames of Jack;
across the whole archive, 243/243 `.SPR` files and 5362/5362 frames.

`TRASHIT/CHAR.SPR` uses the same header but its frames are raw
uncompressed 8x8 pixels (72 bytes each) — it is the text font, not a
sprite sheet. `spr.is_font()` / `spr.font_glyphs()` handle it.

A frame wider than 253 pixels cannot be a scanline (a row's length is one
byte), and the front end's screens are stored **raw** instead: `w * h`
pixels row by row after the 8-byte header (and a few bytes of padding).
"5362/5362 decoding" above counted those as decoding — to a single row.
Nine of them are the world maps, the 640 x 480 frame of each map sheet
(frame 5 of `FSPR/JUNKMP.SPR` is the junkyard); `spr.parse` reads them
since 2026-10-14.
