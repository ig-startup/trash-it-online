# `PROJ/*.DAT` — a front-end screen's sprite sheets — **Confirmed**

Every F.EXE screen (the world maps `LVSL<n>_E.DAT`, continue, credits,
the shop, the battle screens …) has one. The decoder is
`scripts/formats/projdat.py`; all 37 files parse to the byte.

| size | field |
|---|---|
| u16 | sheet count |
| u16 | rectangle count (the tail) |
| per sheet: char[14] | the `.SPR` name in `FSPR/`, NUL-terminated; bytes after the NUL are junk (LSJACK's `OW\x08`) |
| i16 | frame count |
| i16 | slot — the sheet's index in F.EXE's sprite table (0x8e5dc, 0x58 bytes each) |
| per frame | `ff 00` x y w h (10 bytes), or `fe 00` w h (6 bytes) |
| the tail | rectangle count x (x, y, w, h) |

**What F.EXE reads** (`dat_read_sheet_list` 0x26db1, through
`load_screen_sheets` 0x26d77 from `load_screen_resources` 0x2424a): the
sheet name and the slot — it copies the name into the slot's record and
returns the slots, -1 ended, for `load_sheets_into_slots` 0x26bf4 to load
each `.SPR` (`sprite_load_into_slot` 0x25b43, into one pool of
0x177000 bytes from 0x39c3d8 — "Need %ld more bytes of sprite memory").
Any other frame type than 0xff / 0xfe stops it ("Invalid type detected").
It **steps over** the frames, and the tail is never read: nothing else in
F.EXE touches the file's buffer (0x39a3d8).

So a screen's objects, where they stand and how fast they animate are
not in these files: they are made in code — `map_screen_init` 0x1fcc2
creates the map's objects through 0x24e39 and sets each one's x (+0x22),
y (+0x26) and frame (+0x94) by hand. The file only says LSJACK has 0x88
frames; how they split is the code's (`map-objects.md`).

**What the frames and the tail are.** Neither binary reads them, so for
the game they are nothing; what follows is where they likely come from —
a note on the files' origin, which these binaries cannot settle. The `ff` rectangles all
fall in x 640..2042, y 0..511: a 2048 x 512 page addressed a byte a pixel,
the left 640 columns left free — the shape of PlayStation video memory
(1024 x 512 16-bit words) holding 8-bit textures beside the display. A
640 x 480 picture is cut at row 256 into two strips (LVSL8SPR: 1024,0
640x224 and 1024,256 640x255), as a 256-high texture page would need.
The `fe` sheets, only w and h, are the animated ones — LSJACK, the films,
the team colours, credits and framework Jacks — not kept resident. The
tail reserves more of the page: on every world map two 34x33 boxes
(Jack's size), on A two 140x126 more, four 54x62 on the battle screen.
The sizes are the `.SPR` frames' rounded up (21 → 22, 13 → 16), and some
sheets have grown since (YELMEDFT 90 frames, the file lists 65; LSPANEL
15, lists 13) — the DOS game never noticed, for it never looks. Most
likely the files are the console version's layout, shipped along.
