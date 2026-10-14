# `.OB` — the level's startup code — **Confirmed**

The earlier conclusion here was that `.OB` is editor data the game never
reads. The premise was right — no call to the file loader at VA 0x2df37
opens a literal `.OB` — but the conclusion was wrong. `G.EXE` interprets a
**spawn bytecode stream** (`FUN_0001e5c8`, VA 0x1e5c8), and `.OB` is that
stream:

    count = *(u16*)file          # the first word is a record count
    stream = file + 2
    repeat count times:
        id = *(u16*)stream; stream += 2
        find id in the class registry at VA 0x992c4
        call its constructor, which reads its parameters off `stream`

The registry holds **47 classes** (8-byte records: `u16 id`, pad,
`u32 constructor`; terminated by id -1). An unknown id logs
`could not find object id %d in startup code.`

Each class's payload length is its constructor's net advance of the
stream pointer (global 0x28b924). `scripts/formats/ob.py` carries the
table; it came out of Ghidra's decompilation, because the pointer is
walked in several steps and reading only the last one gives wrong
lengths.

**All 147 files parse to exactly their length**, consuming exactly the
number of records their header declares.

That leading count is what defeated two earlier attempts: parsing from
offset 0 reads it as a class id and everything after is off by one
record. With lengths alone and no count, 51 of 147 files happened to
resync and looked like partial success — which is the trap. The fix came
from reading the interpreter in decompiled form, where the count is one
line.

**Identified classes:**

| id | what |
|---|---|
| 9, 10, 11, 12 | start position for player 1..4 — `i16 x, i16 y`, and the game spawns at **y + 20** (VA 0x1f54f) |
| 13 | sprite entity; the word at payload +14 selects the behaviour (1, 2, 4, 8, 16 — 16 is the bell) |
| 14 | **timmy**, the collectible; locks to the block at its position exactly as the bell does |

Class 9 appears in all 147 levels; 32 levels carry all four starts. Class
14 is the most common record in the archive at 1142 — about eight timmies
a level.

## Object templates name the classes — **Confirmed**

A constructor does not describe its object inline. It passes the spawner
(VA 0x2ed96 / 0x2edbc) a 28-byte **template**, and the template's first
u16 is an index into the sprite table at VA 0x9984c, which carries the
`.SPR` filename inline. So a class's identity is just the name of the
sprite its template points at, and 64 templates cover the whole cast:

| class | spawns |
|---|---|
| 0 | `BCSAW.SPR` |
| 1 | `LEAD.SPR` |
| 6 | `CFIR` / `CWHL` / `CFIX.SPR` |
| **13** | **`BELL.SPR`** |
| 14 | `TIMMY.SPR` and `KTIMMY.SPR` — the king timmy |
| 15 | `DYNA.SPR` — dynamite |
| 17, 32 | `TIMMY.SPR` |
| 22 | `SUCKER.SPR` |
| 23 | `FORK.SPR` — the [forklift](../objects/forklift.md) |
| 24 | `FORK.SPR` frames 12–15 — a spinning cog in a block, inert ([buttons](../objects/buttons.md)) |
| 25 | `BUBBLE.SPR` — the double-points bubble in a block (no level) |
| 26 | a generic thing, 12 words (no level) |
| 28, 29, 30 | `REDBUT.SPR` — red, green, blue [buttons](../objects/buttons.md) |
| 34 | nothing — skips 16 bytes |
| 35–43 | `APOLLO.SPR` — rocket pieces 8…0 ([crawler](../objects/crawler.md)) |
| 44 | `CRAWL.SPR` — the crawler-transporter |
| 45 | `TIMMY.SPR` — the bomb git ([gits](../objects/gits.md)) |
| 46 | `PANEL.SPR` |

`VAC.SPR` — the hoover — has a template too (VA 0xa3444), which confirms
it as an object rather than only an animation.

## The bell — **Confirmed**

Class 13 is the bell, and it is in `.OB` after all. **135 of the 147
levels carry exactly one**, at `(payload x + 11, payload y + 16)`, and
118 of those land inside the level bounds. The 12 without one are the
`T*`/`U*` files, which look like test levels.

The earlier dead end was a wrong assumption, not a wrong decode: the
subtype word at payload +14 selects which *behaviour* the bell gets
(VA 0x33e79 dispatches 1, 2, 4, 8, 16), and 16 is only the variant that
locks itself to the block underneath and waits for it to be smashed. No
shipped level uses 16 — they use 1 (90x), 8 (39x) and 2 (6x). Reading
"subtype 16 is the bell" as "the bell is subtype 16" cost an afternoon
of looking for a bell that was in front of us the whole time.

Which means the locking behaviour described above is real but not what
most levels do.

**What subtype 1 does — the behaviour 90 of the 135 levels use — is
simply "touch it and the level is over".** Its per-frame routine
(VA 0x34114) runs the usual collision helper, and when the bell comes up
touched it sets `+0x162` on the player who did it and hands off to the
code that puts the level state at 2. No percentage, no block, no gate.

So a clone that ends the level when a player reaches the bell is right
for 90 levels, and the elaborate locking variant is the exception that
no level actually ships.

**The other subtypes hold the bell back** (`ob.py`, `BELL_SUBTYPE_*`).
The constructor (VA 0x33d1d) copies payload +16 into entity +0x56, +18
into +0x54 and +20 × 60 into the timer at +0x4a; every subtype but 1
clears the entity's flag 8, which hides it and keeps it from being
touched. When the condition comes true the bell gets subtype 1's
routine, its flag back, a kick of -4 px/tick upward and a hit
(`queue_hit`) — it pops into view.

| subtype | lets go when | levels |
|---|---|---|
| 2 | level option 0x800 is set — by the last timmy bin filling (VA 0x2f7ea) or the last rocket piece stacked on the pad (VA 0x116c9, see the crawler) — or the timer runs out | 6: 0L 2D 5L 8K 9L TL; timers 32767 s and 9999 s, so never |
| 4 | some player's counter at +0x28b9d8 reaches +16 | none |
| 8 | `destroyed_percent` ≥ +18 (VA 0x340af), with a sound | 39, at 28 to 100% |
| 16 | the block under it dies | none |

## Off the map: the street, the posts and the flags — **Confirmed**

Of 255 player starts, 75 fall outside the `.WAM` bounds (-19, -98, -130, …,
and in 4M and 5M past the right edge), and 17 of 135 bells do too. They
are not mistakes: **the level stands in a street.** The floor is the
level's bottom edge at any x — when an entity's y reaches the level height
(`[0x41044c]`, rows × 8) it lands there (VA 0x609bc), whatever the tile
map says — and every off-map start sits 3 to 33 px above it. At load
(VA 0x2cf19) the street's ends are set to `(-256) & ~7` and
`(width + 0x107) & ~7`, i.e. 256 px past each side, and a PANEL.SPR post
is stood on each at the bottom edge (VA 0x2f623; frame 16, the right one
mirrored). So players walk in from the street, and some bells are out on
it.

Class 2 (FLAG.SPR, in every level) is not decoration either: it is the
player's **flag**, where he comes back to. Its constructor (VA 0x1f499;
0x1f4fe… for players 2-4) stores `x, y - 10` per player at VA 0x28b928 and
a bobbing flag entity per player at 0x28b948 (templates 0xa34ec…, one
colour each). When Jack is knocked out (state 0x2a199, slot 69: thrown up
with a random sideways kick), after 150 ticks he goes to state 0x2a2fe
(slot 64) and flies to his flag on a damped spring — `v += (flag - pos) >>
6`, then `v -= v >> 3`, capped at 16 px/tick — and once he is within
1/64 px of it and slower than 1/16 px/tick he is set down on it (VA 0x2a4a8) and stands again. The
flags are usually just off the map too, next to the starts.
