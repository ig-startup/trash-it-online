# The front end: worlds, paths, passwords — **Confirmed** (`front.py`)

`F.EXE` was decompiled with the same pipeline as `G.EXE`
(`scripts/ghidra/fexe/run.sh`); every address here is `F.EXE`'s. The
record in `TRASHIT.DAT` is the front end's own: `+0x24` number, `+0x26`
world, `+0x28` lives, `+0x188` a trashed flag per map node, `+0x1be` the
timmy points the shop spends. The shipped file is a new game standing on
world J's first level, with exactly the path nodes trashed.

**Nine worlds, nine screens.** World N (the record's `+0x26`, 0..8) plays
section N — J H C S L I A T M — and its map is the table at VA 0x8d534:
a 16-byte row per world, the first word pointing at 40-byte node
records ending at id -1, the second naming the screen's text file
`lvslN_e.dat`. N is also the `LVSPATN.PAK` picture, and it is *not* the
world's index: S is screen 5 and L screen 4, A is 8 and T is 7.

| node word | meaning |
|---|---|
| 0 | id = the number of its point in the LVSPAT picture |
| 1 | level number; -1 for a path corner or junction |
| 2 | kind: 1 level, 2 side level, 3 world exit, 4 gate |
| 3 | warp: standing here sends Jack to that node (VA 0x1e708) |
| 4 | open from the start (path nodes) — copied to `+0x188` on entry, VA 0x200e8 |
| 6-7 | the map-screen object drawn for it; 8, 9 its x, y |
| 13 | film played when it is won (VA 0x12896) — `D\SMK\<name>.SMK`, names at VA 0x89180 |
| 14 | stage, stored as the record's `+0x1bc` when won |
| 16 | a gate's price — 840, 1400 in T, 600 in M; what it charges is not traced |
| 17, 18 | no reader found |

Jack moves pixel by pixel along the 255-coloured paths (VA 0x1e1c1) and
**cannot step over a point that is not trashed**: a level is a stop until
it is won. How he walks, faces and warps, and what fire does on each kind
of node: `world-map.md`. Path nodes start trashed. A kind-3 exit that is trashed sends
the front end to state 5 — next world, the map reset (VA 0x200e8), and
the new world's password shown. The first six worlds branch, so some
levels can be walked past once a neighbour is won; A, T and M are
straight lines. `front.py graph` prints each map as the level pairs its
paths join.

A won level can be replayed only while the timmy points it paid out are
still in hand, and a level of a stage below the last one won cannot be
entered at all (VA 0x1de35) — so going past a world's midpoint shuts its
first half.

**Films** (node word 13): worlds end with `inter1` … `inter6`, the game
with `end`. Five secret films give player 1 a special hammer
(VA 0x12bbb): 8A `bfh`, the A exit `qua` (quality), 3T `gal` (galactic),
the T exit `dra` (dragon), 3M `moo` (moola).

**Passwords** (VA 0x8da23, checked at VA 0x15d55 against the first nine):

| password | world | name | hammer given |
|---|---|---|---|
| fuckit | J | junkyard | sledgehammer v1 |
| tank | H | haunted | sledgehammer v2 |
| boggin | C | chemical | piledriver v3 |
| pleb | S | toy room | spikeball v1 |
| bostin | L | launchpad | volcanic v1 |
| minging | I | planet | splitter v2 |
| shatner | A | city | future v3 |
| glitter | T | temple | quality |
| smudge | M | moons lab | dragon |

A password starts its world at node 1 with 5 lives, no score, no timmy
points, and players 1 and 2 holding the hammer from VA 0x8da1a; a new
game is the same with world J and the sledgehammer v1. The password of
a world is shown on arriving there (VA 0x168d5).

**The hammer shop** (VA 0x89860, 36 records): the front end numbers
hammers its own way — the ten v1s, the ten v2s, the ten v3s, then the
specials — each record carrying a name and the word the shop adds back
when a hammer is traded in (VA 0x1b92a), 0 to 3945 for the
thirty, 12000 to 30000 for the specials. The specials' names are blank
in the table. The shop itself: `hammer-shop.md`.

**Arcade** (VA 0x8d6f0, rows `section, number, hammer, picture`): the
fifteen K levels with their mission lines (above, under "Objectives").
The battle sets are a table of their own (VA 0x8d8e0) — see below.
