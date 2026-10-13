# The tile → object map — **Confirmed**

Collision is not rectangle-vs-rectangle. The level keeps one u16 per 8x8
tile naming the object that occupies it, and the lookup (VA 0x69e6a) is:

    if x < 0 or x >= [0x410484] or y < 0 or y >= [0x410482]: return 0
    return tilemap[ row_offset[y >> 3] + (x >> 3) ]

with `row_offset` a dword-per-row table at VA 0x3f5928 and the map itself
at `[0x40f330]`. 0 means empty. Entities are 112-byte records based at
VA 0x3f6178, so the returned index `i` is entity `0x3f6178 + i*112`.

Entity fields seen so far: `+0x08`/`+0x0c` 16.16 position used by the
blitter, `+0x10` behaviour function, `+0x24`/`+0x28` fixed-point x/y,
`+0x26`/`+0x2a` integer x/y, `+0x40` flag byte, `+0x4e`/`+0x50` width and
height, `+0x54`/`+0x56` draw offsets, `+0x58` linked entity, `+0x64`
shape pointer, `+0x68` draw routine.
