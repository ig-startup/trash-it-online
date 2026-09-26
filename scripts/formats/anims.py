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

#: What the frames show. Named by someone who played the original, off
#: rendered strips; guessing from the pictures alone got two of them
#: wrong first (71-90 is Jack reaching into his hard hat, not a swing,
#: and 140-174 is a fall and the jump back up, not a ride on something),
#: so nothing here is named from the pixels alone.
#:
#: Note how much of this the clone has no mechanic for at all: ladders,
#: the hoover, carrying, pushing, throwing, hard-hat mode.
KNOWN = {
    2: 'walk/run cycle A',
    4: 'skid to a halt after running',
    5: 'walk/run cycle B',
    8: 'hammer strike, sideways (37-54), blending back into the walk',
    9: 'hammer strike, overhead (55-70), blending back into the walk',
    10: 'reach into the hat and pull the hoover out — reverse',
    11: 'reach into the hat and pull the hoover out',
    12: 'reach into the hard hat (71-90)',
    13: 'reach into the hard hat — reverse',
    14: 'duck down into the hard hat',
    15: 'come back up out of the hard hat',
    16: 'hard-hat mode, moving',
    17: 'hammer strike with no windup — held button (47-54)',
    18: 'hammer strike with no windup — held button',
    19: 'hammer strike with no windup — held button',
    20: 'hammer strike with no windup — held button',
    21: 'hammer strike with no windup, longer hold',
    22: 'hammer strike with no windup, longer hold',
    23: 'hammer strike with no windup, longer hold',
    24: 'hard-hat mode, still',
    26: 'overhead strike, swing only (59-70) — fastest hammer',
    27: 'overhead strike, swing only — fastest hammer',
    28: 'overhead strike, swing only — medium hammer',
    29: 'overhead strike, swing only — slow hammer',
    30: 'hoover, single frame',
    31: 'walking with the hoover',
    33: 'fall: start',
    34: 'fall: hit the ground',
    35: 'climbing a ladder',
    36: 'fall: down A',
    37: 'fall: down B',
    38: 'jump back up onto your feet',
    39: 'carrying something above your head',
    40: 'pushing something along',
    41: 'pick an object up',
    43: 'put an object down',
    44: 'unidentified (240-243)',
    45: 'unidentified (101, 244)',
    46: 'pick up, first two frames',
    47: 'pick an object up',
    48: 'pick up, single frame',
    49: 'throw an object',
    50: 'carrying something above your head',
    51: 'pick up, first two frames',
    52: 'pick up, first two frames',
    53: 'pick an object up',
    54: 'unidentified (245)',
    57: 'air roll, part 1 — carries you further sideways',
    58: 'air roll, part 2',
    59: 'air roll, part 3',
    60: 'hard landing and get up',
    62: 'top out off the ladder onto the platform',
    63: 'top out off the ladder onto the platform',
    65: 'hammer lying on the ground',
    67: 'hammer on the ground, 3 frames',
    68: 'overhead strike, swing only — slowest hammer',
    69: 'peering out from under the hard hat (too low to stand up)',
    76: 'loading-screen animation, not in play',
    79: 'loading-screen animation, not in play',
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
