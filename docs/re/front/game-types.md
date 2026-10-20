# Playing together: the game types — **Confirmed** (`front.py arcade`)

The record's `+0xde` is the game type; the story above is type 0. Two
more are for several people, and neither uses the world map.

**The bell takes one ring per player, in every type.** G.EXE sets a ring
count to `player_count` (VA 0x212d4). A player who touches the bell is
out of the level — his Jack and its hammer flagged done (`+0x42 |= 0x20`)
— and the count drops; **the level is won when the count reaches 0**, so
with two Jacks on a story level both have to get there
(`bell_touch_tick`, VA 0x34114).

**Clocks.** The time limit is the rules record's +0x38, in minutes and
seconds as decimal digits (`315` is 3:15; `ob.py`), held as packed BCD
that carries at 60 (VA 0x19cea); a level with 0 keeps the default 20:00
(the BCD 0x2000 in the data). A story or battle clock counts down one
second per 60 ticks (VA 0x19dce); at 0 the level is lost (state 3); under
0:20 it flashes, from 0:10 it beeps. A clock taken adds 0:25.
Story limits run 0:11 to 9:00; every B level and all K levels but 0K
have 0.

**Type 1, battle** (VA 0x212d2, "battle framework"). Up to four players
at once play a **battle set** — a fixed list of B levels, each with the
hammer every player gets for it:

| set | levels |
|---|---|
| 0 | 1B 2B AB CB DB |
| 1 | 0B 5B 8B 6B BB |
| 2 | 3B 4B 7B 9B 6B |
| 3 | 0B DB 2B 3B 6B 7B 1B BB EB 8B |
| 4 | 6B 0B 1B 2B 3B 4B 5B DB 7B 8B 9B AB BB EB CB |

The order in which players ring the bell is their **place** (written to
the record's `+0x34` by VA 0x1a688), and when only one player is left
his clock is cut to 1:00 if it shows more. After each level every place
scores **battle points**: 2/1 with two players, 4/2/1 with three, 8/4/2/1
with four (VA 0x13fa1); a player who never rang scores nothing. After
the last level of the set the most points win (VA 0x13e80). A tie is
played off: only the tied players, on the level just played, all with
hammer 36 — **the guitar** (set 10, VA 0x8d768; the random pick at
VA 0x13f53 loops until it lands on that same level).

**Type 2, arcade** (VA 0x214c2). Teams (`+0x108` of them, the current
one at `+0x10a`) take turns on one K level picked from the arcade list,
each with that row's hammer and its mission line. In this mode the clock
starts at 0 and **counts up**, one step every 6 ticks (VA 0x19edb, so
probably tenths of a second); the time a team
finishes in goes back in the record's `+0x20`, the best time so far is
kept at `+0x104` (starting at BCD 0x99999, which any time beats) and handed to the next team to
beat (VA 0x195e5 puts it on the panel). When every team has played,
VA 0x11df6 runs — the results, if there was more than one team — and the
menu offers to play again.

Who the teams are (F.EXE, read 13.10.2026): the number of **players** is
picked once, before the teams (VA 0x19d2b → record `+4`), and the teams
are then entered one screen after another (VA 0x177df), each time
"another team" or "start", four at most. So every team is all the
players at once on the K level — the same keys, the same Jacks — and the
teams take the keyboard in turn. The clock (G.EXE VA 0x19edb) is a
packed-BCD m:ss.t that adds a tenth every 6 ticks and **stops at
60:00.0** (`cmp 0x60000`); nothing in the arcade runs out of time. The
results (VA 0x11e2c) put the team times at `+0x158` in order (VA 0x20730)
and let equal times share a place.

**Before the level** (F.EXE, read 20.10.2026). Battle and arcade both
pick on a **reel** (`level_select_init` 0x18a3c, ARLVSL_E / BATLSL_E):
two 225-px pictures side by side scroll as one strip
(`level_select_reel` 0x18daa). Holding LEFT or RIGHT while it is at rest
sets it going; the speed grows by 1 a tick to 15, then the push turns
round and it slows to a stop. The row under it is the choice — arcade, one
of the 15 rows of 0x8d6f0 (world 19 = K, level, hammer for all four
players, the index at `+0xe0`); battle, one of the 5 sets (`+0xfc`). A
button once it has stopped takes it; Esc goes back to the title
(`level_select_tick` 0x18cbd).

Then **"Get ready"** (`get_ready_screen` 0x1a08d, `GETRDY_<lang>.DAT`):
arcade shows its mission lines and waits up to 12000 ticks; battle
**types its rules out letter by letter** (`get_ready_type_text` 0x1a316)
from `grbattle.spr` — 96 letters in English, 68 French, 47 German, 66
Italian, 106 Spanish (0x19ef1) — after 25 ticks, one every second tick,
a click every third. A button pressed before the end makes it four letters a
tick; when the text is out the screen waits 480 ticks (40 if hurried).
The first 60 ticks take no input (`get_ready_tick` 0x19fbb); after that a
button (battle: only once the text is out) starts the level, Esc goes back.
