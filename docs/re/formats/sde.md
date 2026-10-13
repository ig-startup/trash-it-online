# `.SDE` — background settings + scene sprites — **Confirmed**

Not a flat settings block: a 0x40-byte header followed by an array.

| offset | size | field |
|---|---|---|
| 0x00 | 8 x i32 | the backdrop (see `.SCN`): [0] the far plane's distance (520-1094), [1] the near plane's texture scale (0-2), [2] the far plane's step shift (1-2), [3] carry the far plane to the top (0/1), [4] [5] auto-scroll a tick (0, or -5 in 12 levels), [6] [7] split into bytes at VA 0x18255 — always 0 |
| 0x3c | u16 | scene sprite count N (max 40) |
| 0x40 | N x 44 | scene sprite records |

**Verified: all 147 `.SDE` files are exactly `0x40 + 44*N` bytes**, with N
read from offset 0x3c (0 to 36 across the archive).

The array is the level's decorative sprites — `G.EXE` calls them scene
sprites (`num_scene_sprites: %d`), caps them at 40
(`Warning. Reached MAX_SCENE_SPRITES!`, VA 0x17f8b) and sorts them by the
dword at record +0x0c before drawing, so that field is a depth key. A
record is filled from a live entity at VA 0x17fa2: `+0x00` = the entity's
type word, `+0x04..+0x0f` = its `+0x24..+0x2f` (which puts x at record
+0x06 and y at +0x0a).

One header field is identified: the u32 at 0x00 feeds the horizon
calculation at VA 0x1c7ad, which scales by 20.0 in 16.16 fixed point and
clamps the result to rows 0..199. It is a background scroll reference,
not gameplay.

**`.SDE` holds no gameplay placement** — no spawns, no bell. Those are in
`.OB`.
