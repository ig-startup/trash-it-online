"""
Jack's animation table, read out of `G.EXE`.

The client's frame→pose mapping was read off a numbered contact sheet by
eye, which is why several poses are wrong: a single frame lifted out of a
sequence reads as something else entirely (the one picked for "falling"
belongs to a get-up sequence and looks like climbing down a ladder).

The game does not guess. It keeps a flat array of pointers at VA 0xa11ca,
one slot per animation, each pointing at a list of u16 frame numbers in
`SPR/JACKS.SPR`.

A list's length is bounded two ways and you need both:

- the lists are packed back to back, so a list runs until the next list
  that the pointer array references;
- a list shorter than that gap ends on a 0xffff sentinel.

Take whichever comes first. Using only the sentinel merges neighbours
(the long walk cycles have no sentinel at all); using only the gap runs
past the short ones into their neighbour's frames.

Frame entries carry flags in the top two bits — `0x4000` and `0x8000`,
masked off by `FRAME_MASK`. They land on the frames where a swing
connects, so they are event markers, not frame numbers. Several slots are
the same swing at different paddings (slots 26-29, 68): the same frames
with frames repeated to stretch the timing, which is how the hammers get
their different swing speeds.

    python3 scripts/formats/anims.py                 # print the table
    python3 scripts/formats/anims.py --json out.json
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from disasm import Code  # noqa: E402

#: The pointer array, and the address range its frame lists live in.
TABLE_VA = 0xa11ca
LIST_LO, LIST_HI = 0xa0300, 0xa1200

FRAME_MASK = 0x3fff
FLAG_SHIFT = 14
END = 0xffff

#: What the frames show, confirmed by rendering each slot as a strip.
#: Slots not listed here are not identified yet.
KNOWN = {
    2: 'walk/run cycle A',
    5: 'walk/run cycle B',
    12: 'hammer swing, standing (frames 71-90)',
    13: 'hammer swing, standing — reverse',
    14: 'duck down into the hard hat',
    15: 'come back up out of the hard hat',
    16: 'hard-hat mode, moving',
    24: 'hard-hat mode, still',
    26: 'hammer swing, crouched — fastest',
    27: 'hammer swing, crouched — fastest',
    28: 'hammer swing, crouched — medium',
    29: 'hammer swing, crouched — slow',
    33: 'grey drum: start',
    34: 'grey drum: sit down onto it',
    36: 'grey drum: ride A',
    37: 'grey drum: ride B',
    38: 'grey drum: crash off it',
    57: 'tumble through the air, part 1',
    58: 'tumble through the air, part 2',
    59: 'tumble through the air, part 3',
    60: 'hard landing and get up',
    62: 'bend over and straighten up',
    65: 'hammer lying on the ground',
    67: 'hammer on the ground, 3 frames',
    68: 'hammer swing, crouched — slowest',
}


def table(exe):
    """
    -> {slot: {'va', 'frames', 'flags'}} for every resolvable slot.

    `frames` are frame numbers into JACKS.SPR with the flag bits removed;
    `flags` is {position in the list: flag value} for the marked frames.
    """
    code = Code(exe)
    slots = []
    for i in range(128):
        va = code.u32(TABLE_VA + 4 * i)
        inside = va is not None and LIST_LO <= va <= LIST_HI
        if not inside and i > 4:
            break
        slots.append(va if inside else None)

    starts = sorted({v for v in slots if v})

    def read(va):
        following = [s for s in starts if s > va]
        cap = ((following[0] if following else LIST_HI) - va) // 2
        raw = []
        for k in range(min(cap, 256)):
            word = struct.unpack_from('<H', code.read(va + 2 * k, 2), 0)[0]
            if word == END:
                break
            raw.append(word)
        return raw

    out = {}
    for i, va in enumerate(slots):
        if va is None:
            continue
        raw = read(va)
        out[i] = {
            'va': va,
            'frames': [w & FRAME_MASK for w in raw],
            'flags': {j: w >> FLAG_SHIFT for j, w in enumerate(raw) if w >> FLAG_SHIFT},
        }
    return out


def _main():
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    exe = os.path.join(repo, 'Trash-it-original', 'G.EXE')
    t = table(exe)

    if '--json' in sys.argv:
        path = sys.argv[sys.argv.index('--json') + 1]
        json.dump({str(k): {'va': hex(v['va']), 'frames': v['frames'],
                            'flags': {str(a): b for a, b in v['flags'].items()}}
                   for k, v in t.items()}, open(path, 'w'), indent=1)
        print(f'{len(t)} slots -> {path}')
        return

    print(f'{len(t)} animation slots\n')
    for slot, v in t.items():
        frames = v['frames']
        shown = frames[:16]
        tail = '…' if len(frames) > 16 else ''
        note = f"   {KNOWN[slot]}" if slot in KNOWN else ''
        mark = f"  flags={v['flags']}" if v['flags'] else ''
        print(f"{slot:3d}  {v['va']:#08x}  n={len(frames):3d}  "
              f"{shown}{tail}{mark}{note}")


if __name__ == '__main__':
    _main()
