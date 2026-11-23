"""
The hammers' key combinations in `G.EXE` — see docs/re/jack/combos.md.

Each hammer record (pointer table `hammer_record_ptrs`, VA 0xa2d0c) holds
at +0x58 a pointer to its combo list: pairs of u32 (sequence, handler),
ended by a 0 sequence. A sequence is i16 input words ended by -1; a 0 word
is a tick with nothing held. Words: L R U D = 1 2 4 8, BUT1 0x10, BUT2
0x20, the pad's extra buttons 0x40 0x80 — so most tricks are listed twice,
a pad spelling and a keyboard one.

    python3 scripts/formats/combos.py            # every hammer's list
    python3 scripts/formats/combos.py --check    # the keyboard spellings
                                                 # against client/src/scenes/combos.js
"""
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from le_loader import LE  # noqa: E402

RECORDS = 0xa2d0c
HAMMERS = 37
LIST_AT = 0x58
HANDLERS = {
    0x1dead: 'arm',          # arm_hammer_trick
    0x1e037: 'warp',         # warp_to_bell
    0x204c3: 'dragon',       # dragon_sequence
    0x204f4: 'moola',        # moola_demolition
}
PAD = 0x40 | 0x80
KEYS = [(1, 'L'), (2, 'R'), (4, 'U'), (8, 'D'), (0x10, 'B1'), (0x20, 'B2'), (0x40, 'P40'), (0x80, 'P80')]


def read(path):
    """{hammer: [(handler name, [words])]} in the order the game registers them."""
    le = LE(path)
    u32 = lambda va: struct.unpack('<I', le.va_read(va, 4))[0]  # noqa: E731
    i16 = lambda va: struct.unpack('<h', le.va_read(va, 2))[0]  # noqa: E731

    def words(va):
        out = []
        while i16(va + 2 * len(out)) != -1:
            out.append(i16(va + 2 * len(out)))
        return out

    table = {}
    for h in range(HAMMERS):
        at = u32(u32(RECORDS + 4 * h) + LIST_AT)
        pairs = []
        while u32(at):
            fn = u32(at + 4)
            pairs.append((HANDLERS.get(fn, hex(fn)), words(u32(at))))
            at += 8
        table[h] = pairs
    return table


def spell(ws):
    return ' '.join('+'.join(n for b, n in KEYS if w & b) or '-' for w in ws)


def check(table, js_path):
    """The keyboard spellings (no pad bits) against SEQUENCES in combos.js."""
    src = open(js_path, encoding='utf-8').read()
    js = {m.group(1): [int(x, 0) for x in m.group(2).split(',') if x.strip()]
          for m in re.finditer(r'^\s+(\w+): \[([\dxa-fA-F,\s]*)\]', src, re.M)}
    # sequencesFor(): which hammer's list the named sequence is read from
    named = {'sledge': (20, 'arm'), 'apocalypse': (29, 'arm'),
             'dragon': (33, 'dragon'), 'moola': (34, 'moola')}
    want = {}
    for name, (h, fn) in named.items():
        keys = [w for f, w in table[h] if f == fn and not any(x & PAD for x in w)]
        keyboard = [w for w in keys if w != table[0][-1][1]]   # not the shared arm
        want[name] = keyboard[0]
    want['warp'] = [w for f, w in table[0] if f == 'warp' and not any(x & PAD for x in w)][0]
    want['arm'] = [w for f, w in table[0] if f == 'arm'][0]
    bad = 0
    for name, ws in want.items():
        ok = js.get(name) == ws
        bad += not ok
        print(f'{"ok " if ok else "BAD"} {name:10} {spell(ws)}')
        if not ok:
            print(f'    combos.js: {spell(js.get(name) or [])}')
    return bad


if __name__ == '__main__':
    repo = os.path.join(os.path.dirname(__file__), '..', '..')
    table = read(os.path.join(repo, 'Trash-it-original', 'G.EXE'))
    if '--check' in sys.argv:
        sys.exit(1 if check(table, os.path.join(repo, 'client', 'src', 'scenes', 'combos.js')) else 0)
    for h, pairs in table.items():
        print(h)
        for fn, ws in pairs:
            print(f'  {fn:8} {spell(ws)}')
