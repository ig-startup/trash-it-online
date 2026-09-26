"""
Jack's state machine, recovered from `G.EXE`.

The clone's player logic was written from the outside in — a few flags
and timers that looked about right — and every animation complaint from
play-testing traced back to that. This is the real thing to rebuild it
against.

Each state is a function. An entity's current one lives at `+0x10`, and
switching is always the same two instructions:

    mov edx, <state function>
    call 0x21d30            # set_state(entity in eax, routine in edx)

so every transition in the binary can be found by looking for that pair.
There are **46 states and 174 transitions**.

A state announces its animation the same way:

    mov eax, <slot>
    call 0x21c26            # play animation <slot>

and the slot indexes the animation table `anims.py` reads, which is
already named. So a state can be named by what Jack looks like while he
is in it — the one thing about this binary that a person can confirm at
a glance.

Two states are hubs: 0x22892, which 19 transitions lead to, and
0x256e9, with 29. Everything comes back to them.

    python3 scripts/formats/states.py          # the table
    python3 scripts/formats/states.py --dot    # graphviz, if you want it drawn
"""
import os
import pickle
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anims import KNOWN as ANIM_NAMES  # noqa: E402

SET_STATE = '0x21d30'
PLAY_ANIM = '0x21c26'

#: Names that do not come from the animation, argued from the graph.
EXTRA = {
    0x22892: 'the hub every action returns to — 19 transitions lead here',
    0x256e9: 'the second hub — 29 transitions lead here',
}


def _sweep(exe_index):
    with open(exe_index, 'rb') as fh:
        insns, _ = pickle.load(fh)
    return insns


def machine(insns):
    """-> (states, transitions) where states maps entry -> {anim, to}."""
    pos = {a: i for i, (a, m, o) in enumerate(insns)}

    entries = set()
    sites = []
    for i, (addr, mnem, ops) in enumerate(insns):
        if mnem == 'call' and ops == SET_STATE:
            for j in range(i - 1, max(0, i - 8), -1):
                _a, m2, o2 = insns[j]
                hit = re.fullmatch(r'edx, (0x[0-9a-f]+)', o2)
                if m2 == 'mov' and hit:
                    target = int(hit.group(1), 16)
                    entries.add(target)
                    sites.append((addr, target))
                    break

    ordered = sorted(entries)

    def span(entry):
        start = pos[entry]
        after = [s for s in ordered if s > entry]
        return start, (pos[after[0]] if after else len(insns))

    def animation(entry):
        start, stop = span(entry)
        for j in range(start, stop):
            _a, mnem, ops = insns[j]
            if mnem == 'call' and ops == PLAY_ANIM:
                for k in range(j - 1, max(start - 1, j - 6), -1):
                    _b, m2, o2 = insns[k]
                    hit = re.fullmatch(r'eax, (0x[0-9a-f]+|\d+)', o2)
                    if m2 == 'mov' and hit:
                        return int(hit.group(1), 0)
        return None

    # which state a transition site sits inside
    owner = {}
    for entry in ordered:
        start, stop = span(entry)
        for j in range(start, stop):
            owner[insns[j][0]] = entry

    states = {e: {'anim': animation(e), 'to': set()} for e in ordered}
    for site, target in sites:
        home = owner.get(site)
        if home is not None:
            states[home]['to'].add(target)
    return states, sites


def name_of(state, info):
    if state in EXTRA:
        return EXTRA[state]
    slot = info['anim']
    if slot is None:
        return 'sets no animation'
    return ANIM_NAMES.get(slot, f'animation slot {slot}, not identified')


def _main():
    here = os.path.dirname(os.path.abspath(__file__))
    index = os.environ.get('TRASHIT_INDEX')
    if not index or not os.path.exists(index):
        print('Set TRASHIT_INDEX to the pickled capstone sweep '
              '(see disasm.py) — this reads the whole code segment once.')
        return
    states, sites = machine(_sweep(index))

    if '--dot' in sys.argv:
        print('digraph jack {')
        for s, info in states.items():
            print(f'  "{s:#x}" [label="{s:#x}\\n{name_of(s, info)}"];')
            for t in sorted(info['to']):
                print(f'  "{s:#x}" -> "{t:#x}";')
        print('}')
        return

    print(f'{len(states)} states, {len(sites)} transitions\n')
    for s, info in states.items():
        print(f'{s:#08x}  anim {str(info["anim"]):>4}  {name_of(s, info)}')
        if info['to']:
            print('            -> ' + ' '.join(f'{t:#x}' for t in sorted(info['to'])))
    print(f'\n(unnamed states are ones whose animation slot {here and ""}'
          'anims.py has not identified yet)')


if __name__ == '__main__':
    _main()
