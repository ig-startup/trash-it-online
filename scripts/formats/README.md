# scripts/formats/

Decoders for the original game's files. What the formats and the game's
logic are — the notes themselves — live in `docs/re/`, one note per
topic; start from `docs/re/INDEX.md`.

| file | what |
|---|---|
| `le_loader.py` | DOS/4GW LE executable loader (objects, pages, fixups) — how `G.EXE` was read |
| `disasm.py` | disassembly workbench over the LE image: functions, xrefs, strings, constant search, stream-advance tracing. `callers` / `entries` find call sites by byte scan rather than from a linear sweep — a sweep drifts past data and hides whole functions, which is what kept the collapse module's callers invisible |
| `ob.py` | `.OB` startup-code decoder (see `docs/re/formats/ob.md`) |
| `anims.py` | Jack's animation table from `G.EXE` |
| `hammers.py` | the 37-hammer catalogue (partial — see its docstring) |
| `states.py` | Jack's 46-state machine and its transitions |
| `ccs.py` | the structural simulation: the collision map, the support counts, the falling groups, and what a blow does as it travels — run over the real levels |
| `rle.py` | the shared scanline codec |
| `pal.py` `scn.py` `g2.py` `spr.py` `obt.py` | per-format decoders |
| `level.py` | assembles a whole level from `.WAM` + `.I` + `.OBT` + `.G2` |
| `export_sprites.py` | dumps a `.SPR` to PNG frames with alpha, origin in the filename |
| `pak.py` | RNC ProPack unpacker for `FSPR/*.PAK`, with CRC check and PNG render |
| `sound.py` | sample banks → `.wav`, `.XMI` → `.mid`, and the sound scripts from `G.EXE` |
| `demo_render.py` | runs all of the above and writes PNG proofs |
