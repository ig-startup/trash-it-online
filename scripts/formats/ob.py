"""
`.OB` — the level's startup code (object spawn stream). **Decoded.**

An earlier pass wrote `.OB` off as editor data the game never reads. The
premise was right — no call to the file loader opens a literal `.OB` — but
the conclusion was wrong: `G.EXE` interprets a spawn bytecode stream, and
`.OB` is exactly that stream. This is where the players' start positions
and the timmies come from; none of it is in `.WAM`.

The interpreter is `FUN_0001e5c8` at VA 0x1e5c8:

    count = *(u16*)file            # the first word is a record count
    stream = file + 2
    repeat count times:
        id = *(u16*)stream; stream += 2
        find id in the class registry at VA 0x992c4
            (8-byte records: u16 id, pad, u32 constructor; ends at id -1)
        call the constructor, which reads its own parameters off `stream`
            and leaves it past them

That leading count is what defeated the first attempt: parsing from offset
0 reads it as a class id, and everything after is off by one record.

A record is `u16 class_id` plus a payload only the constructor knows the
length of. `SIZES` is each constructor's net advance of the stream pointer
(global 0x28b924), read out of Ghidra's decompilation — the pointer is
walked in several steps, so the last `add` alone gives the wrong answer.

**All 147 `.OB` files parse to exactly their length**, consuming exactly
the number of records their header declares.

    from ob import parse, spawns
    recs = parse(open('LEVELS/0A.OB','rb').read())
"""
import struct

#: class id -> payload length in bytes, excluding the 2-byte id.
SIZES = {
    0: 20, 1: 12, 2: 12, 3: 12, 4: 12, 5: 12, 6: 20, 7: 16, 8: 36,
    9: 12, 10: 12, 11: 12, 12: 12, 13: 22, 14: 22, 15: 16, 16: 72,
    17: 22, 18: 12, 19: 12, 20: 12, 21: 12, 22: 12, 23: 12, 24: 20,
    25: 16, 26: 46, 27: 20, 28: 20, 29: 20, 30: 20, 31: 46,
    32: 20, 33: 22, 34: 16, 35: 12, 36: 12, 37: 12, 38: 12, 39: 12,
    40: 12, 41: 12, 42: 12, 43: 12, 44: 16, 45: 16, 46: 16,
}

#: What each class spawns. Read off the object templates rather than
#: guessed: a constructor passes the spawner a 28-byte template whose
#: first u16 is an index into the sprite table at VA 0x9984c, and that
#: table holds the `.SPR` filename inline. So the class's identity is
#: simply the name of the sprite it creates.
CLASSES = {
    0: 'BCSAW.SPR',
    1: 'LEAD.SPR',
    6: 'CFIR/CWHL/CFIX.SPR',
    9: 'player 1 start',
    10: 'player 2 start',
    11: 'player 3 start',
    12: 'player 4 start',
    13: 'the bell (BELL.SPR)',
    14: 'timmy, and the king timmy (TIMMY/KTIMMY.SPR)',
    15: 'DYNA.SPR — dynamite',
    17: 'TIMMY.SPR',
    22: 'SUCKER.SPR',
    23: 'FORK.SPR',
    32: 'TIMMY.SPR',
    44: 'CRAWL.SPR',
    46: 'PANEL.SPR',
}

#: Class 13 draws the bell wherever its record puts it, offset by this.
#: The constructor adds them before storing the entity position
#: (VA 0x33d47 and 0x33d5f).
BELL_X_BIAS = 11
BELL_Y_BIAS = 16

#: The word at class 13 payload +14 picks which behaviour the bell gets
#: (VA 0x33e79 dispatches on 1, 2, 4, 8, 16). Only 1, 8 and 2 occur in
#: the shipped levels. 16 is the variant that locks itself to the block
#: underneath and waits for it to be destroyed — and no level uses it,
#: which cost an afternoon of assuming the bell *was* subtype 16.
BELL_SUBTYPE_LOCKED = 16

#: The four player-start classes, and the index each one writes. Every
#: constructor reads `i16 x, i16 y` and spawns at **y + 20** (VA 0x1f54f).
SPAWN_IDS = {9: 0, 10: 1, 11: 2, 12: 3}
SPAWN_Y_BIAS = 20

class Undecoded(Exception):
    """The stream ran into a class whose payload length is not known."""


def parse(data, strict=True):
    """
    Walk a `.OB` stream into `[(class_id, offset, payload), ...]`.

    With `strict`, a file whose records do not land exactly on its end
    raises. That is the point: finishing clean, on the record count the
    header declares, is the evidence the size table is right, so
    tolerating a ragged tail would hide the one thing worth knowing.
    """
    if len(data) < 2:
        raise Undecoded('file is too short to hold a record count')
    count = struct.unpack_from('<H', data, 0)[0]
    out = []
    p = 2
    for _ in range(count):
        if p + 2 > len(data):
            raise Undecoded(f'stream ran out at {p} with records still to read')
        cid = struct.unpack_from('<H', data, p)[0]
        if cid not in SIZES:
            raise Undecoded(f'unknown class id {cid} at offset {p}')
        n = SIZES[cid]
        if p + 2 + n > len(data):
            raise Undecoded(f'class {cid} payload overruns the file at {p}')
        out.append((cid, p, data[p + 2:p + 2 + n]))
        p += 2 + n
    if strict and p != len(data):
        raise Undecoded(f'{count} records ended at {p}, file is {len(data)}')
    return out


def bells(records):
    """Bell positions from parsed records, as [(x, y, subtype), ...]."""
    out = []
    for cid, _off, payload in records:
        if cid == 13:
            x, y = struct.unpack_from('<hh', payload, 0)
            subtype = struct.unpack_from('<H', payload, 14)[0]
            out.append((x + BELL_X_BIAS, y + BELL_Y_BIAS, subtype))
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
              f'bells={bells(recs)}  spawns={spawns(recs)}')
    print(f'\n{ok} parsed, {bad} failed')
