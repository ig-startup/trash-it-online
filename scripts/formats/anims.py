"""
Jack's animation table, read out of `G.EXE`.

The client's frame→pose mapping was read off a numbered contact sheet by
eye, which is why several poses are wrong: a single frame lifted out of a
sequence reads as something else entirely (the one picked for "falling"
belongs to a get-up sequence and looks like climbing down a ladder).

The game does not guess. It keeps a flat array of pointers at VA 0xa11d2,
one slot per animation, each pointing at a list of u16 frame numbers in
`SPR/JACKS.SPR`. The slot is the number a state passes to `play_anim`
(VA 0x21c26, which reads `[slot*4 + 0xa11d2]`).

**These notes used 0xa11ca until 2026-10-06** — eight bytes early, so every
slot number was two higher than the game's, and `states.py`, which looks
states' `play_anim` arguments up here, named every state after the
animation two slots along. The frame lists themselves were right; only
the numbering moved. The same index also selects the state's movement
profile (top speed, acceleration, turn rate — see `MOVES`).

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
the same swing at different paddings (slots 24-27, 66): the same frames
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
TABLE_VA = 0xa11d2
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
    0: 'walk/run cycle A',
    2: 'skid to a halt after running',
    3: 'walk/run cycle B',
    6: 'hammer strike, sideways (37-54), blending back into the walk',
    7: 'hammer strike, overhead (55-70), blending back into the walk',
    8: 'reach into the hat and pull the hoover out — reverse',
    9: 'reach into the hat and pull the hoover out',
    10: 'reach into the hard hat (71-90)',
    11: 'reach into the hard hat — reverse',
    12: 'duck down into the hard hat',
    13: 'come back up out of the hard hat',
    14: 'hard-hat mode, moving',
    15: 'hammer strike with no windup — held button (47-54)',
    16: 'hammer strike with no windup — held button',
    17: 'hammer strike with no windup — held button',
    18: 'hammer strike with no windup — held button',
    19: 'hammer strike with no windup, longer hold',
    20: 'hammer strike with no windup, longer hold',
    21: 'hammer strike with no windup, longer hold',
    22: 'hard-hat mode, still',
    24: 'overhead strike, swing only (59-70) — fastest hammer',
    25: 'overhead strike, swing only — fastest hammer',
    26: 'overhead strike, swing only — medium hammer',
    27: 'overhead strike, swing only — slow hammer',
    28: 'hoover, single frame',
    29: 'walking with the hoover',
    31: 'fall: start',
    32: 'fall: hit the ground',
    33: 'climbing a ladder',
    34: 'fall: down A',
    35: 'fall: down B',
    36: 'jump back up onto your feet',
    37: 'carrying something above your head',
    38: 'pushing something along',
    39: 'pick an object up',
    41: 'put an object down',
    42: 'unidentified (240-243)',
    43: 'unidentified (101, 244)',
    44: 'pick up, first two frames',
    45: 'pick an object up',
    46: 'pick up, single frame',
    47: 'throw an object',
    48: 'carrying something above your head',
    49: 'pick up, first two frames',
    50: 'pick up, first two frames',
    51: 'pick an object up',
    52: 'unidentified (245)',
    55: 'air roll, part 1 — carries you further sideways',
    56: 'air roll, part 2',
    57: 'air roll, part 3',
    58: 'hard landing and get up',
    60: 'top out off the ladder onto the platform',
    61: 'top out off the ladder onto the platform',
    63: 'hammer lying on the ground',
    65: 'hammer on the ground, 3 frames',
    66: 'overhead strike, swing only — slowest hammer',
    67: 'peering out from under the hard hat (too low to stand up)',
    74: 'loading-screen animation, not in play',
    77: 'loading-screen animation, not in play',
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
        if not inside and i > 2:
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
