# Level names, sections and the order of play — **Partly confirmed**

A level is not chosen by name. The game is started with a **section and a
number**, `load_level(section, number)` (VA 0x1074b, which logs `"section
%d level %d"`), taken from the shared record both programs keep in
`TRASHIT.DAT` (0x2cc bytes: number at +0x20, section at +0x22; `G.EXE`
reads it through the pointer at 0x317ca8, `F.EXE` through 0xd6d1c). The
file name is built from the pair (VA 0x10a46):

    name[0] = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[number]
    name[1] = "JHCSLIATMJHCSLIATMBKDX"[section]

and `parse_level_name()` (VA 0x2c499) does the reverse for a name given on
the command line (`USAGE: TRASHIT LevelName`). So **the letter is the
section** and the first character the number in it — which is why `AA`,
`BK`, `EK` exist: numbers 10-14 of sections A, K and B. Sections 0-8 run
**J, H, C, S, L, I, A, T, M**; 9-17 repeat those letters (for numbers 12-28 — the C and D bonus
screens — `load_level` adds 9 to the section at VA 0x10890 and takes the
9 and 12 off again before `bonus_round_setup(section, number - 12)` at
0x1097d; nothing between reads it, so the round trip does nothing — a
leftover);
18-21 are B, K, D and X. Each letter is one look — the wall behind a
section's levels is the same from 0 to 9.

**The first level is 0J** — section 0, number 0 — on two counts: the
table's own first section is J, and the shipped `TRASHIT.DAT` holds 0 and
0 at +0x20/+0x22, the state a new game starts from.

The clone plays them in that order — section by section as numbered,
numbers ascending within one (`play_order()` in `export_level.py`).

How `F.EXE` moves on is traced now — see the next section. In short:
world N of the story plays section N, Jack walks a map from level to
level, and a world is left through its exit node, so **the clone's
order is the original's main line**. What it leaves out are the side
nodes: the T/U levels, the C/D one-object screens (numbers 12 and 13 of
the sections they name), and the branches that let a player skip
ahead. (The history at `+0x158 + 4 * +0x10a` and `+0x104` copied into
`+0x20`, VA 0x215b2-0x215f8, belong to the team games, `+0x10a` being
the current team.)
