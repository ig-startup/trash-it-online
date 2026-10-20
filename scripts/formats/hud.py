"""
The in-level panel (HUD) of G.EXE: its icon lists and their little scripts.

    python3 scripts/formats/hud.py [G.EXE]          every list, icon and script

See docs/re/front/hud.md. A *list* is what `panel_script_run` (VA 0x196db)
walks: 20-byte entries `{item*, s16 x, s16 y, value*, tick*, out*}` up to
a null item. The item says what the entry is:

    word 0  kind: 1/4/5 a number (panel_icon_add 0x19931, 10 slots),
            2 a sprite (panel_icon_alloc 0x197e8, 16 records of 0x94)
    word 1  a sprite's frame, or a number's digit sheet (BNUM 57, SNUM 58)
    word 2  a sprite's sheet (the level's sprite table, 0x9984c), or a
            number's first frame
    word 3  flags, words 4-5 (kind 2) passed on

`value*` is what a number shows (a BCD dword); `tick*` runs each tick. Most
sprite ticks are three-instruction stubs that hand the record a *script*
(`hud_run_script` 0x1a199) for `hud_script_step` (0x1a1fb): u16 opcodes
on a 4-byte stride, each followed by its dword arguments.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from disasm import Code  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPRITE_TABLE, SPRITE_RECORD = 0x9984C, 102
RUN_SCRIPT = 0x1A199

#: The lists, by who runs them (call sites of panel_script_run).
LISTS = {
    0x97284: 'story: the clock, the score and timmy counters (hud_setup)',
    0x97374: 'the countdown 3, 2, 1, GO (hud_setup; the arcade after its target)',
    0x97478: 'battle: the clock (hud_setup, type 1)',
    0x974A0: 'arcade: the stopwatch (hud_setup, type 2)',
    0x97338: 'arcade: the target, when level state +0x1c is set',
    0x9752C: 'bonus round (option 0x400000): its clock',
    0x972FC: 'option 0x40000000 (rules +0x36 == 2): the extra counter',
    0x9725C: 'game 0x14 (load_level): one sprite',
    0x973C4: 'the pause panel (pause_hud)',
    0x97554: 'double points, way 0 (table 0x98148 by random & 7)',
    0x97590: 'double points, way 1',
    0x975CC: 'double points, way 2',
    0x97608: 'the super hoover (super_hoover_on)',
    0x97158: 'the forklift, player 0 (table 0x98434)',
    0x971A8: 'the forklift, player 1',
    0x971E4: 'the forklift, player 2',
    0x97220: 'the forklift, player 3',
}

#: hud_script_step's opcodes: name, dword arguments.
OPS = {
    1: ('left_to', 1), 2: ('right_to', 1), 3: ('top_to', 1), 4: ('bottom_to', 1),
    5: ('wait', 1),
    6: ('left_speed', 2), 7: ('right_speed', 2), 8: ('top_speed', 2), 9: ('bottom_speed', 2),
    10: ('stop', 0), 11: ('drift_x', 1), 12: ('drift_y', 1),
    13: ('size', 2), 14: ('at', 2), 15: ('shake', 1), 16: ('frame', 1),
    17: ('go', 0), 18: ('sound', 1), 0xFFFF: ('end', 0),
}


def sheet_name(c, index):
    raw = c.read(SPRITE_TABLE + index * SPRITE_RECORD, 16)
    name = raw.split(b'\0')[0].decode('latin-1')
    return name if name.endswith('.SPR') else '#%d' % index


def script_of(c, tick):
    """The script a stub tick hands over, or None."""
    if not tick:
        return None
    for ins in c.disasm(tick, 8):
        if ins.mnemonic == 'mov' and ins.op_str.startswith('edx, 0x'):
            return int(ins.op_str[5:], 16)
        if ins.mnemonic == 'ret':
            return None
    return None


def script(c, va, limit=64):
    """[(op name, [args])] up to `end`."""
    out = []
    for _ in range(limit):
        op, = struct.unpack('<H', c.read(va, 2))
        name, n = OPS.get(op, ('?%d' % op, 0))
        args = list(struct.unpack('<%di' % n, c.read(va + 4, 4 * n)))
        out.append((name, args))
        va += 4 + 4 * n
        if op == 0xFFFF or name.startswith('?'):
            break
    return out


def entries(c, va):
    out = []
    while True:
        item, x, y, value, tick, dest = struct.unpack('<IhhIII', c.read(va, 20))
        if item == 0:
            return out
        kind, a, b, flags = struct.unpack('<4h', c.read(item, 8))
        # a number names its digit sheet first (BNUM, SNUM), a sprite its frame
        sheet, frame = (a, b) if kind in (1, 4, 5) else (b, a)
        out.append({'item': item, 'kind': kind, 'frame': frame,
                    'sheet': sheet_name(c, sheet), 'flags': flags, 'x': x, 'y': y,
                    'value': value, 'tick': tick, 'out': dest,
                    'script': script_of(c, tick)})
        va += 20


def main():
    exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'Trash-it-original', 'G.EXE')
    c = Code(exe)
    for va, what in LISTS.items():
        print('list 0x%x — %s' % (va, what))
        for e in entries(c, va):
            kind = 'number' if e['kind'] in (1, 4, 5) else 'sprite'
            print('  %-6s %s frame %d at (%d, %d)%s tick %s' % (
                kind, e['sheet'], e['frame'], e['x'], e['y'],
                ' value 0x%x' % e['value'] if e['value'] else '',
                hex(e['tick']) if e['tick'] else '-'))
            if e['script']:
                print('         script 0x%x: %s' % (e['script'], '; '.join(
                    n + (' ' + ' '.join(str(a) for a in args) if args else '')
                    for n, args in script(c, e['script']))))


if __name__ == '__main__':
    main()
