# `.WAM` — level geometry and object placement — **Confirmed**

| offset | size | field |
|---|---|---|
| 0 | u16 | level width in 8x8 tiles |
| 2 | u16 | level height in tiles |
| 4 | u16 | object count N |
| 6 | u16 | unused (0 in every sample) |
| 8 | N x 8 bytes | object records |

Object record: `u16 type` (index into `.OBT`), `u16 x`, `u16 y` (pixels,
top-left), `u16` unused.

Verified: `0A.WAM` is exactly `8 + 8*371` bytes, the level is 231x121
tiles (1848x968 px), and object x positions step by exactly the shape
widths.
