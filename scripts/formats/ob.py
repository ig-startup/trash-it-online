"""
`.OB` — the level's startup code (object spawn stream). **Partial.**

An earlier pass concluded `.OB` was editor-only data the game never reads,
because no call to the file loader opens it. That was wrong about what it
*is*: `G.EXE` walks a byte stream of spawn records and calls a constructor
per record, and `.OB`'s bytes are exactly that stream. This is where the
players' start positions, the bell and the timmies come from — none of
which are in `.WAM`.

The interpreter is at VA 0x1e60c:

    ecx = stream; stream = ecx + 2; id = *(u16*)ecx
    look id up in the class registry at VA 0x992c4
        (8-byte records: u16 id, pad, u32 constructor; terminated by id -1)
    call the constructor, which reads its own parameters off `stream`
        and leaves `stream` past them

So a record is `u16 class_id` followed by a payload whose length only the
constructor knows. `SIZES` below is each constructor's advance, recovered
by symbolically tracking the stream pointer from its load of 0x28b924 to
the store back (see `scripts/formats/disasm.py`); summing every `lea`/`add`
along the way, because the pointer is walked in several steps.

**Status: 51 of 147 `.OB` files parse to exactly their length with this
table.** The rest run off the rails, so at least one class has a
content-dependent payload — most likely id 13, whose constructor dispatches
on a subtype (1/2/4/8/16) and may consume a different amount per branch.
Four classes (17, 25, 29, 30) tail-call into shared code and never store
the pointer themselves, so their advance is unknown. Until those are
settled this decoder is a research tool, not something to build level data
from.

    from ob import parse, CLASSES
    recs = parse(open('LEVELS/0A.OB','rb').read())
"""
import struct

#: class id -> payload length in bytes, excluding the 2-byte id.
#: None = not yet recovered.
SIZES = {
    0: 20, 1: 12, 2: 12, 3: 12, 4: 12, 5: 12, 6: 20, 7: 16, 8: 36,
    9: 12, 10: 12, 11: 12, 12: 12, 13: 22, 14: 22, 15: 16, 16: 72,
    17: None, 18: 12, 19: 12, 20: 12, 21: 12, 22: 12, 23: 12, 24: 20,
    25: None, 26: 46, 27: 20, 28: 20, 29: None, 30: None, 31: 46,
    32: 20, 33: 22, 34: 16, 35: 12, 36: 12, 37: 12, 38: 12, 39: 12,
    40: 12, 41: 12, 42: 12, 43: 12, 44: 16, 45: 16, 46: 16,
}

#: What a class is, where the constructor says so plainly.
CLASSES = {
    9: 'player 1 spawn',
    10: 'player 2 spawn',
    11: 'player 3 spawn',
    12: 'player 4 spawn',
    13: 'sprite entity (subtype in payload; subtype 16 = the bell)',
}

#: Constructors for the four players differ only in the player index they
#: write, and each reads `u16 x, u16 y` as its first two parameters. The
#: spawn y the game actually uses is this y plus 20 (VA 0x1f54f).
SPAWN_IDS = {9: 0, 10: 1, 11: 2, 12: 3}
SPAWN_Y_BIAS = 20


class Undecoded(Exception):
    """The stream ran into a class whose payload length is not known."""


def parse(data, strict=True):
    """
    Walk a `.OB` stream into `[(class_id, offset, payload), ...]`.

    With `strict`, a stream that does not end exactly on a record boundary
    raises — which is the point: a clean finish is the evidence the size
    table is right, so silently tolerating a ragged tail would hide the
    very thing worth knowing.
    """
    out = []
    p = 0
    while p < len(data):
        if p + 2 > len(data):
            raise Undecoded(f'trailing byte at {p}')
        cid = struct.unpack_from('<H', data, p)[0]
        if cid not in SIZES:
            raise Undecoded(f'unknown class id {cid} at offset {p}')
        n = SIZES[cid]
        if n is None:
            raise Undecoded(f'class {cid} has no known payload size (offset {p})')
        if p + 2 + n > len(data):
            raise Undecoded(f'class {cid} payload overruns the file at {p}')
        out.append((cid, p, data[p + 2:p + 2 + n]))
        p += 2 + n
    if strict and p != len(data):
        raise Undecoded(f'stream ended at {p}, file is {len(data)}')
    return out


def spawns(records):
    """Player start positions from parsed records, as {player: (x, y)}."""
    found = {}
    for cid, _off, payload in records:
        if cid in SPAWN_IDS:
            x, y = struct.unpack_from('<hh', payload, 0)
            found[SPAWN_IDS[cid]] = (x, y + SPAWN_Y_BIAS)
    return found


if __name__ == '__main__':
    import glob
    import os
    import sys

    pattern = sys.argv[1] if len(sys.argv) > 1 else 'Trash-it-original/LEVELS/*.OB'
    ok = bad = 0
    for path in sorted(glob.glob(pattern)):
        data = open(path, 'rb').read()
        try:
            recs = parse(data)
        except Undecoded as e:
            bad += 1
            print(f'{os.path.basename(path):<10} FAILED  {e}')
            continue
        ok += 1
        print(f'{os.path.basename(path):<10} {len(recs):3d} records  '
              f'spawns={spawns(recs)}')
    print(f'\n{ok} parsed, {bad} failed')
