# About these notes

Reverse-engineered from the original game (used under the user's
written permission from Atari for personal, non-commercial use).

Method: the first pass cross-referenced byte patterns across the level
and sprite directories and got the container framing but not the pixel
encoding. The second pass disassembled `G.EXE` itself, which settled
everything: `G.EXE` is a DOS/4GW **LE executable**, so it needs an LE
loader (parse the object table, map the pages, apply the fixups) before
any disassembler sees real code. `scripts/formats/le_loader.py` does
that; the addresses quoted below are virtual addresses in that image.

Every format below is now decoded and rendered. Archive-wide check:
**all 243 `.SPR` files (5362 frames) and all 147 levels decode with
zero errors** — every frame yields exactly its declared height, every
`.WAM` is exactly `8 + 8*object_count` bytes, and every `.G2` shape
matches its object type's declared size. Run `demo_render.py`
to reproduce the proofs (background screens, the shape library, Jack's
sprite sheet, and a whole level assembled from its files).

## Confidence key

- **Confirmed**: decoded from the game's own code and verified by
  rendering / byte-exact reconstruction.
- **Inferred**: fits every sample checked, but not traced through the
  code.
- **Unsolved**: investigated, no working decode.
