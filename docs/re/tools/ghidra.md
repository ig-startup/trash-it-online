# Reading `G.EXE` in Ghidra

Ghidra has no DOS/4GW LE loader, so the image goes in flat
(`export_flat.py`), seeded with the function entry points and named from
the symbol map, and is dumped as one C file. One script does all of it,
in about two minutes:

    scripts/ghidra/run.sh [work dir]        # -> <work dir>/decomp.c, default ~/ghwork/g

The dump stays there between sessions. Read it a function at a time:

    python3 scripts/ghidra/fn.py show  <name|0xVA>   # body, callers, callees
    python3 scripts/ghidra/fn.py brief <name|0xVA>   # signature and the call graph only
    python3 scripts/ghidra/fn.py where <name|0xVA>   # which notes and clone files cite it
    python3 scripts/ghidra/fn.py grep  <regex>       # which functions match, one line each
    python3 scripts/ghidra/fn.py frontier            # what to name next

**The symbol map** (`scripts/ghidra/`) is what makes the dump readable:
`jack_fly_to_flag(...)` and `current_player` rather than `FUN_0002a2fe`
and `DAT_0028bf2c`. Three sources, in order of precedence:

- `symbols.txt` — by hand: everything these notes establish, one line a
  symbol with its address, kind (`f` function, `d` data), name and a
  one-line meaning; a guess says so with "?".
- `symbols_lib.txt` — generated from a dump by `symbols.py strings`:
  the Miles Sound System wrappers, each named after the `AIL_…(` call it
  logs, and **module helpers** — a function every caller of which belongs
  to one object or subsystem is `<module>_sub_<addr>`: whose it is is
  certain, what it does is still to be read.
- derived from the binary each time by `symbols.py`: the 47 class
  constructors from the registry (`ob_class_<id>_<sprite>`), every object
  template by the sprite it draws (`tpl_<sprite>_<addr>`) and the state
  it starts in (`<sprite>_tick_<addr>`), and every routine installed with
  `set_state` or stored into an entity's `+0x10` (`state_<addr>`).

`symbols.py coverage decomp.c` counts what has a name and lists the rest,
most called first — the order to read them in. The game's own code is
0x10000-0x6cfff; above that are the linked libraries (Miles, the Watcom
C runtime). Many of the game's error messages name the function they are
in (`"BUG in 'record_pad_entry'"`), and `symbols.py strings` lists those
too.

**F.EXE** (`fn.py … --f`, names in `scripts/ghidra/fexe/`) is laid out the
same way: the front end 0x10000-0x2a8a3, then the blitters' step table to
0x503f7 (`scale_step_table`, 151 row pointers and rows of 16.16 steps —
Ghidra cut it into 23 "functions", left out of the count), then the
engine G.EXE shares (input, VGA, palette, camera, debug text; most of it
named "as G's" by `fexe/match_g.py`), the Watcom C runtime pieces and
Miles' own C part (its timer service over the PIT and int 8, DPMI
vectors, the DOS file calls its log uses) up to 0x55560, where the
library line is. A few routines Ghidra never cut out as functions
(`get_ready_tick` 0x19fbb, `level_select_tick` 0x18cbd,
`map_draw_tick` 0x1fb47, `quest_start_drift_tick?` 0x13624) are named
all the same; the fragments it did cut from the middle of one carry the
owner's name and `_tail`.

**Field names.** The C reaches every structure through raw offsets —
`*(int *)(in_EAX + 0x30)`. `fields.py` rewrites the ones it can prove
into names from `scripts/ghidra/fields.txt` (`in_EAX->vx`), and `run.sh`
writes that as `decomp_fields.c` next to `decomp.c`. It knows what a
pointer is from the machine code, not from names: state routines get
their sprite in EAX (and set_state's are Jack's), `current_player` and
`last_spawned` are what they say, Jack's `+0x54` is his player, and a
register keeps its kind until something writes it — Watcom saves every
register but EAX, and each callee is checked for what it really clobbers.
Every rewrite is then checked against the instructions: the function must
really touch that offset, at that size, through that kind of pointer.
Two things it has to get right that cost a wrong answer otherwise:

- the decompiler types a global afresh in each function, so
  `current_player + 2` is byte 8 in `play_anim` (an `int *`) and byte 2
  elsewhere; the scale is settled per function from its unambiguous uses;
- offsets can be decimal — the sprite sheet pointer is `in_EAX + 200`.

Over the dump: about 2200 accesses named, 72 left alone because the code
did not confirm them. Blocks reached through a computed pointer are not
followed yet — only direct `objects[i]` / `&DAT_003f61xx + b` forms are.

One gotcha that costs a run: **no path given to `analyzeHeadless` may
contain a directory whose name starts with a dot** — it refuses with
*"Path element starting with '.' is not permitted"*, so a project under
`~/.cache` or `~/.claude` fails before it starts.
