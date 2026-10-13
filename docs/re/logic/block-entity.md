# A block's entity, and the frame it lives in — **Confirmed**

The level's objects live in one array of 112-byte entities at VA 0x3f6178,
indexed from 1 (index 0 means "no object", which is what an empty cell in
the collision map holds). The level loader (VA 0x2cce9) fills them, and
these are the fields the mechanics above use:

| offset | field |
|---|---|
| 0x00 | flags; bit 0 alive, bit 2 reached by the ground flood, bit 4 free to be grouped, bit 5 group head, bit 6 already in a group, bit 7 counted by the weight sum |
| 0x02 | `.WAM` type — the `.OBT` index |
| 0x04 | vy, 16.16 (on a group head: the whole group's) |
| 0x08 / 0x0c | y / x, 16.16 |
| 0x10 | height in pixels, 16.16 |
| 0x14 | **mass**, from `.OBT` field 6 |
| 0x18 | **hit points**, from `.OBT` field 0; -1 is indestructible |
| 0x1c / 0x20 | while falling: this member's fixed offset from its group |
| 0x44 | the object's own id, as stamped into the collision map |
| 0x46 / 0x48 | tile x / tile y |
| 0x4a / 0x4c | width / height in tiles |
| 0x4e / 0x50 | width / height in pixels |
| 0x5c / 0x5e | objects touching it from above / below |
| 0x64 / 0x68 | its `.G2` shape, and the routine its `.G2R` byte selects |

A group head is one of these same entities with bit 5 set, borrowing
`+0x30`/`+0x34` for its member array, `+0x38`/`+0x3c` for the list of
members with nothing beneath them, `+0x52` for the group's total mass,
`+0x56` for the member count and `+0x40` for the continuation record once
it passes 40 members.

The collision map is one u16 per 8x8 cell with a row stride of the level's
tile width, and the row table at VA 0x3f5928 is simply `row[i] = i *
stride` (VA 0x69eb3). There are two of them: the live map at 0x40f330 and
a provisional copy at 0x40f334 that a falling group is stamped into.

The frame is one function, VA 0x2cbb9, and it calls in this order:

    0x135fc  0x162c7  0x2bfda  0x1c821
    0x68b2d   <- the structural pass: falling groups, landings, rebuild
    0x20409  0x2043c  0x2eadb  0x6b90f  0x6b400  0x2d1b5  0x1e1ca
    0x1e16e  0x60e82  0x6b533  0x15ccd  ...  0x2c911  0x2f9ce

so the structures settle *before* the sprites move, and 0x2d1b5 (which
builds the draw list by testing every object against the camera) runs
after both.
