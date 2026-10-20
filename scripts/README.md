# scripts/

Tools that turn the original 1997 game's files into assets the web client
can use. They read from `Trash-it-original/` (gitignored — the original
game, used under the user's written permission from Atari) and write into
`client/`.

| script | what it does |
|---|---|
| `export_jack_frames.py` | Jack's animation frames from `SPR/JACKS.SPR` → `client/public/sprites/jack/<colour>/*.png` + `client/src/entities/jackFrames.json`. Edit `ANIMS` to change which poses ship. |
| `export_props.py` | The bell and the sledgehammer → `client/public/sprites/props/` + `client/src/entities/propFrames.json`. |
| `export_level.py` | Whole levels → one packed texture atlas of block artwork per level, the wall behind them, `client/public/levels/level_<name>.json` (served and loaded per game, not bundled — the server reads it too), and the play order in `shared/levels.json` — the original's: section by section (J, H, C, S, L, I, A, T, M, B, K, D), numbers ascending, first 0J. Takes level names, `--all` for every playable level — 125, leaving out the T*/U* side levels and twelve one-object screens — or `--bonus` for those twelve, the story's bonus screens (kept apart in `shared/levels.json` as `bonus`, with their object's sheet and the round's numbers from G.EXE); with no arguments it exports a default batch of twelve. |
| `export_worldmap.py` | The story's nine world maps → `client/public/worldmap/`: each map's picture, its nodes, and every walk between its points, worked out as F.EXE walks them (`docs/re/front/world-map.md`), plus the map Jack `LSJACK.SPR` as one atlas. |
| `export_sounds.py` | The game's sound effects: `SFX/SBANK.0`'s 67 samples → `client/public/sounds/sfx_NN.wav`, and G.EXE's 154 sound scripts (table 0x95f9c) → `client/src/audio/sounds.json`, which `client/src/audio/sfx.js` plays (`docs/re/formats/sound.md`). |
| `extract_sprite.py` | Older tool: cuts a sprite out of a screenshot with a flood fill. Superseded by the decoders, kept for screenshots of things we have no sprite file for. |
| `formats/` | The decoders themselves, plus notes on every file format — see `docs/re/INDEX.md`. |

All three exporters are safe to re-run; they overwrite what they produced.
Each writes its manifest next to the PNGs, so the client always loads a
matching set.

The exporters do not invent artwork, but `export_level.py` does invent the
things the original stores somewhere we haven't decoded yet: spawn points,
the bell's position, and hit points. Those are marked in its docstring.

All 147 levels decode, and exporting the lot costs roughly 13 MB of
artwork. The default batch is twelve levels spanning the game's range —
industrial towers, a factory, a pagoda, a nursery, a mine — for about
1.1 MB.
