"""
The hammer catalogue in `G.EXE`. **Partially decoded.**

Trash It gives each Jack his own hammer — the command line takes them
(`/JACKS Numjacks jack1ham jack2ham...`) and the game logs
`Loading hammers... :`. They are a table of 104-byte records starting at
VA 0xa1e04, each naming a data file and carrying a display name in
English plus a pile of numbers.

Record layout:

| offset | size | field |
|---|---|---|
| 0x00 | 12 | data file name, NUL padded (`sla.dat`, `slb.dat`, …) |
| 0x10 | u16 | an index that rises by one down the table |
| 0x12 | 34 | display name (`the sledge hammer v1`) |
| 0x34 | u32 | → the wielder's player struct +0x80 |
| 0x38 | u32 | → player struct +0x84 |
| 0x3c | u32 | → player struct +0x74 |
| 0x40 | u32 | → player struct +0x78 |
| 0x48 | u16 | → player struct +0x88 |
| 0x5e | u16 | → the hammer entity's +0x58 |
| 0x60 | u16 | → the hammer entity's +0x5a |
| 0x62 | u16 | → the hammer entity's **+0x5c** |

`initialise_a_player's_hammer` (VA 0x216c0) does the copying, through a
pointer table at VA 0xa2d0c indexed by the chosen hammer.

What each number *means* is mostly not settled — the readers reach those
player fields through a register, so searching for the addresses finds
nothing. What the values themselves say, across all 37 hammers:

- **+0x34 and +0x38 are bit masks.** Every value in both columns is
  2^n - 1: 255, 1023, 4095, 8191, 32767, 65535, 131071, … 1048575. The
  debris code masks a random number exactly this way when it throws a
  smashed block, and the masks grow with the hammer's rank, so these
  read as how wide the rubble scatters.
- **+0x3c and +0x40 are the blow's force ramp (see README, "What a hammer
  blow carries"): minimum and maximum.** Below, an earlier reading of +0x40
  as a price, kept for the record because the front end may also use it:
- **+0x40 was read as a price.** It rises monotonically down the whole catalogue —
  150, 300, 900 … 1000000, 30000000 — and the joke hammers at the end sit
  at 4294967295, the u32 ceiling, which is how you make something
  unbuyable. The front end talks about "timmy points available", and
  timmies are the collectible.
- **+0x62 was written down here as "the resistance the damage routine
  tests". That was wrong** — the divisor in the damage routine is a
  *block's* own support count, a different field on a different object
  (see README.md). What +0x62 does reach is the hammer sprite's `+0x5c`,
  which VA 0x1fd5a copies into a spawn template at 0x9fef6 along with
  +0x5e and +0x60; the spawner at VA 0x2f156 is where the trail stops.
  It does climb with rank all the same — 14 for a sledge v1, 39 for the
  silliest one in the table.
- +0x3c is neither monotonic nor obviously damage: it is 100 for most of
  the late hammers while +0x40 explodes past them.

    python3 scripts/formats/hammers.py
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from disasm import Code  # noqa: E402

TABLE_VA = 0xa1e04
RECORD_SIZE = 104

#: offset -> what the field is copied into, where that is known
DESTINATIONS = {
    0x34: 'player +0x80',
    0x38: 'player +0x84',
    0x3c: 'player +0x74',
    0x40: 'player +0x78',
    0x48: 'player +0x88',
    0x5e: 'hammer +0x58',
    0x60: 'hammer +0x5a',
    0x62: 'hammer +0x5c (resistance)',
}


def _text(raw):
    end = raw.find(b'\0')
    return raw[:end if end >= 0 else len(raw)].decode('latin-1')


def read(exe, limit=64):
    """-> list of dicts(file, id, name, fields) for every hammer."""
    code = Code(exe)
    out = []
    for i in range(limit):
        base = TABLE_VA + i * RECORD_SIZE
        rec = code.read(base, RECORD_SIZE)
        if len(rec) < RECORD_SIZE:
            break
        data_file = _text(rec[0:12])
        name = _text(rec[0x12:0x34])
        if not data_file.endswith('.dat') or not name:
            break
        out.append({
            'va': base,
            'file': data_file,
            'id': struct.unpack_from('<H', rec, 0x10)[0],
            'name': name,
            'fields': {off: (struct.unpack_from('<I', rec, off)[0] if off < 0x4c
                             else struct.unpack_from('<H', rec, off)[0])
                       for off in sorted(DESTINATIONS)},
        })
    return out


def _main():
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    hammers = read(os.path.join(repo, 'Trash-it-original', 'G.EXE'))
    print(f'{len(hammers)} hammers\n')
    heads = '  '.join(f'{hex(o):>5}' for o in sorted(DESTINATIONS))
    print(f"{'file':<10}{'name':<26}{heads}")
    for h in hammers:
        vals = '  '.join(f'{h["fields"][o]:>5}' for o in sorted(DESTINATIONS))
        print(f'{h["file"]:<10}{h["name"]:<26}{vals}')
    print('\nwhere each column goes:')
    for off, dest in sorted(DESTINATIONS.items()):
        print(f'  {hex(off):>5} -> {dest}')


if __name__ == '__main__':
    _main()
