# Trash It Online

A browser remake of the DOS game Trash It (1997, Atari): the original's
own assets and rules, read out of its binaries, in Phaser 3 + Node.

## Starting a session

Read this file and the wiki's `status.md` and `backlog.md` (path in `WIKI.md`) —
nothing else up front. Everything below is read when the task needs it.

## Where things are

| what | where |
|---|---|
| what the original does — formats, rules, routines | `docs/re/INDEX.md` → one note |
| a routine of G.EXE, decompiled | `python3 scripts/ghidra/fn.py show <name\|0xVA>` (`--f` for F.EXE) |
| names of routines, globals, struct fields | `scripts/ghidra/symbols.txt`, `symbols.d/*.txt`, `fields.txt` |
| decoders of the original's files | `scripts/formats/` (list in its README) |
| exporters original → client assets | `scripts/export_*.py` (`scripts/README.md`) |
| the game | `client/src/` — `scenes/GameScene.js` + one module per object kind |
| server, shared config | `server/src/`, `shared/` |
| project history, decisions, sessions | the wiki (`WIKI.md`) — not needed to write code |

The original's files are in `Trash-it-original/` (gitignored, copyright).

## Reverse engineering, one routine at a time

1. Find the topic in `docs/re/INDEX.md`; read that note only.
2. `fn.py brief|show <name>` for the routines it lists; `fn.py where <name>`
   for what already cites one; `fn.py grep <regex>` to search the code.
3. Nothing in mind? `fn.py frontier` lists unnamed routines called from
   named ones — the next thing to read.
4. Record what you established, where it belongs:
   - a name → `symbols.d/<area>.txt` (or `symbols.txt`), one line, a guess with "?";
   - a struct field → `fields.txt`;
   - the behaviour → the topic's note in `docs/re/` (new topic: new file,
     title line `# Title — **Confirmed|Inferred|Unsolved**`);
   - then `python3 scripts/re_index.py` to rebuild the index.
5. `scripts/ghidra/run.sh` (2 min, writes `~/ghwork/g`) only when the
   names in the dump's bodies need refreshing — `fn.py` already resolves
   new names from the symbol files.

Clone code that follows the original cites the note, e.g.
`// see docs/re/objects/cannon.md`, and the routine by name and VA — that
is what `fn.py where` and the index's "clone" column find.

## Commands

```bash
export PATH="$HOME/.local/bin:$PATH"   # node lives in ~/.local
npm run build && npm --prefix server install   # build wipes jest otherwise
npm start            # :3000, serves the client too
npm test             # server tests
npm run lint
```

## Ending a session

Notes in `docs/re/` + `re_index.py`, then the wiki: a one-line entry in
`changelog.md`, statuses in `backlog.md`, `status.md` if the state changed.
No session logs.
Commit messages: `feat:|fix:|docs:` + a plain-English sentence.
