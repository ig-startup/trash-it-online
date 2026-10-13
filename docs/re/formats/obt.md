# `.OBT` — object type table — **Confirmed**

8 bytes per record, indexed directly by the `.WAM` `type` field.

| offset | field | note |
|---|---|---|
| 0 | u16 graphic id | 0xffff / 0xfffe are sentinels (stored as -1; 0xfffe also sets a flag bit) |
| 2 | u16 width | in 8x8 tiles — **verified** against every shape |
| 4 | u16 height | in tiles — **verified** |
| 6 | u16 **mass** | forced to 1 when stored as 0; the level loader copies it to the entity's `+0x14`, and the collapse pass sums it up a pile to get the force of an impact (VA 0x69850) — **confirmed by its reader** |
