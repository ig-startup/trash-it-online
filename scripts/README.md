# scripts/

Tools that turn the original 1997 game's files into assets the web client
can use. They read from `Trash-it-original/` (gitignored — the original
game, used under the user's written permission from Atari) and write into
`client/`.

| script | what it does |
|---|---|
| `export_jack_frames.py` | Jack's animation frames from `SPR/JACKS.SPR` → `client/public/sprites/jack/<colour>/*.png` + `client/src/entities/jackFrames.json`. Edit `ANIMS` to change which poses ship. |
| `export_props.py` | The bell and the sledgehammer → `client/public/sprites/props/` + `client/src/entities/propFrames.json`. |
| `export_level.py` | Whole levels → one packed texture atlas of block artwork per level, the wall behind them, `client/public/levels/level_<name>.json` (served and loaded per game, not bundled — the server reads it too), and the play order in `shared/levels.json`. Takes level names, or `--all` for every playable level — 125, leaving out the T*/U* test levels and twelve one-object screens; with no arguments it exports a default batch of twelve. |
| `extract_sprite.py` | Older tool: cuts a sprite out of a screenshot with a flood fill. Superseded by the decoders, kept for screenshots of things we have no sprite file for. |
| `formats/` | The decoders themselves, plus notes on every file format — see `formats/README.md`. |

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
