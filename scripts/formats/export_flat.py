"""
Write the mapped LE image as one flat binary, for loading into Ghidra.

Ghidra has no DOS/4GW LE loader, and pointing it at `G.EXE` raw gets the
same nothing a disassembler gets: the DOS stub, then noise. `le_loader.py`
already maps the objects, copies the pages and applies the fixups, so the
fix is to hand Ghidra the result of that instead of the file.

The output is one contiguous span from the first object's base to the end
of the last, zero-filled across the gap between them, so the file's
offsets and the image's virtual addresses differ by exactly `base`. Load
it as a raw binary, processor `x86:LE:32:default`, at that base, and every
address matches the ones in README.md and in `disasm.py` output.

    python3 scripts/formats/export_flat.py Trash-it-original/G.EXE out.bin
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from le_loader import LE  # noqa: E402


def flatten(path):
    """-> (base_address, bytes) for the whole mapped image."""
    le = LE(path)
    base = min(o['base'] for o in le.objects)
    end = max(o['base'] + len(o['mem']) for o in le.objects)
    buf = bytearray(end - base)
    for o in le.objects:
        start = o['base'] - base
        buf[start:start + len(o['mem'])] = o['mem']
    entry = le.objects[le.startobj - 1]['base'] + le.eip
    return base, bytes(buf), entry


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'Trash-it-original/G.EXE'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'flat.bin'
    base, data, entry = flatten(src)
    with open(dst, 'wb') as fh:
        fh.write(data)
    print(f'{src} -> {dst}')
    print(f'  base      0x{base:08x}')
    print(f'  size      {len(data)} bytes (0x{len(data):x})')
    print(f'  entry     0x{entry:08x}')
    print(f'  load with: -loader BinaryLoader -loader-baseAddr 0x{base:x} '
          f'-processor x86:LE:32:default')


if __name__ == '__main__':
    main()
