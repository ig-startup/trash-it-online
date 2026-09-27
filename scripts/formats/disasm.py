"""
Disassembly workbench for the Trash It binaries.

The format notes in README.md were won by disassembling `G.EXE` by hand,
one address at a time. Anything about *game logic* — how a structure
collapses, what ends a level, where Jack starts — needs following control
flow across many functions, so this wraps the LE loader in the queries
that kept being repeated:

    from disasm import Code
    c = Code("Trash-it-original/G.EXE")

    c.func(0x18255)            # disassemble one function, until it returns
    c.xrefs(0x2df37)           # who calls this address
    c.callers(0x2df37)         # ditto, by byte scan — catches what the
                               # linear sweep misses
    c.strings("spawn")         # find a string, get its VA
    c.strxref("Invalid")       # find the string AND who points at it
    c.reads(0x3f6178)          # instructions touching a global

Addresses everywhere are virtual addresses in the mapped LE image, the
same ones README.md quotes.

Run it directly for a quick look:

    python3 disasm.py G.EXE func 0x18255
    python3 disasm.py G.EXE xrefs 0x2df37
    python3 disasm.py G.EXE str spawn
"""
import re
import sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

from le_loader import LE


class Code:
    def __init__(self, path):
        self.le = LE(path)
        self.md = Cs(CS_ARCH_X86, CS_MODE_32)
        self.md.detail = True
        # obj1 is the code segment; obj2 is data. Disassembling only obj1
        # keeps the linear sweep from drowning in data-as-instructions.
        self.code = self.le.objects[0]
        self.base = self.code['base']
        self.mem = bytes(self.code['mem'])
        self._calls = None
        self._branch = None

    # ── reading ───────────────────────────────────────────────────────────

    def read(self, va, n):
        return self.le.va_read(va, n)

    def u32(self, va):
        b = self.read(va, 4)
        return int.from_bytes(b, 'little') if len(b) == 4 else None

    def in_code(self, va):
        return self.base <= va < self.base + len(self.mem)

    # ── disassembly ───────────────────────────────────────────────────────

    def disasm(self, va, count=40):
        """Linear disassembly of `count` instructions from `va`."""
        off = va - self.base
        return list(self.md.disasm(self.mem[off:off + count * 16], va, count))

    def func(self, va, limit=400):
        """
        Disassemble from `va` to the end of the function.

        Stops at a `ret` that no forward jump inside the body targets, so
        functions with several exits still come out whole.
        """
        out = []
        off = va - self.base
        targets = set()
        for ins in self.md.disasm(self.mem[off:off + limit * 16], va, limit):
            out.append(ins)
            if ins.mnemonic.startswith('j'):
                for op in ins.operands:
                    if op.type == 2:  # immediate — a direct branch
                        targets.add(op.imm)
            if ins.mnemonic in ('ret', 'retf') and not any(
                    t > ins.address for t in targets):
                break
        return out

    def show(self, insns, mark=()):
        """Format instructions, annotating anything that looks like a VA."""
        lines = []
        for ins in insns:
            note = self._annotate(ins)
            flag = '>>' if ins.address in mark else '  '
            lines.append(f'{flag} {ins.address:#08x}  {ins.mnemonic:<7} '
                         f'{ins.op_str:<38}{note}')
        return '\n'.join(lines)

    def _annotate(self, ins):
        notes = []
        for m in re.finditer(r'0x[0-9a-f]+', ins.op_str):
            v = int(m.group(0), 16)
            s = self.cstring(v)
            if s and len(s) >= 3:
                notes.append(f'"{s}"')
        return ('   ; ' + ' '.join(notes)) if notes else ''

    # ── strings ───────────────────────────────────────────────────────────

    def cstring(self, va, maxlen=120):
        """The NUL-terminated printable string at `va`, or None."""
        b = self.read(va, maxlen)
        if not b:
            return None
        end = b.find(b'\0')
        if end <= 0:
            return None
        s = b[:end]
        if not all(32 <= c < 127 or c in (9, 10, 13) for c in s):
            return None
        return s.decode('latin-1')

    def strings(self, pattern, min_len=4):
        """All strings in the image matching `pattern`, as (va, text)."""
        rx = re.compile(pattern, re.I)
        found = []
        for o in self.le.objects:
            mem = bytes(o['mem'])
            for m in re.finditer(rb'[\x20-\x7e]{%d,}' % min_len, mem):
                s = m.group(0).decode('latin-1')
                if rx.search(s):
                    found.append((o['base'] + m.start(), s))
        return found

    # ── cross references ──────────────────────────────────────────────────

    def _index_calls(self):
        """One linear sweep of the code object, indexing branch targets."""
        if self._calls is not None:
            return self._calls
        idx = {}
        for ins in self.md.disasm(self.mem, self.base):
            if ins.mnemonic in ('call', 'jmp') or ins.mnemonic.startswith('j'):
                for op in ins.operands:
                    if op.type == 2:
                        idx.setdefault(op.imm, []).append(
                            (ins.address, ins.mnemonic))
        self._calls = idx
        return idx

    def xrefs(self, va):
        """Direct call/jmp sites targeting `va`."""
        return self._index_calls().get(va, [])

    def callers(self, va):
        """
        Call sites reaching `va`, found by scanning for `E8 rel32`.

        `xrefs` reads a linear sweep, and a linear sweep drifts: one jump
        table or one run of data and every instruction after it decodes at
        the wrong offset until the stream happens to resynchronise. Whole
        functions are invisible that way — the collapse module's callers all
        were. Matching the five bytes of a direct call instead depends on no
        alignment at all, so it finds every one of them.
        """
        out = []
        for a, m, t in self._branches():
            if t == va:
                out.append((a, m))
        return out

    def _branches(self):
        """Every direct near call/jmp in the image, as (site, mnemonic, target)."""
        if self._branch is None:
            found = []
            for i in range(len(self.mem) - 5):
                op = self.mem[i]
                if op in (0xe8, 0xe9):
                    rel = int.from_bytes(self.mem[i + 1:i + 5], 'little',
                                         signed=True)
                    found.append((self.base + i,
                                  'call' if op == 0xe8 else 'jmp',
                                  self.base + i + 5 + rel))
            self._branch = found
        return self._branch

    def entries(self):
        """
        Every address called by a direct call, sorted — the function list.

        This is what seeds a Ghidra import (see `scripts/ghidra/MarkFunctions.java`):
        a flat binary has no symbols and auto-analysis finds almost nothing,
        but a call target is a function by definition.
        """
        return sorted({t for _, m, t in self._branches()
                       if m == 'call' and self.in_code(t)})

    def consts(self, value):
        """
        Every instruction whose operand text contains `value`.

        The blunt way to find who touches a global or a magic number, and
        the only way that also catches `mov eax, [0x3f6178]` style reads
        that no call index would show.
        """
        needle = f'0x{value:x}'
        hits = []
        for ins in self.md.disasm(self.mem, self.base):
            if needle in ins.op_str:
                hits.append(ins)
        return hits

    def strxref(self, pattern):
        """Strings matching `pattern` together with the code pointing at them."""
        out = []
        for va, s in self.strings(pattern):
            out.append((va, s, self.consts(va)))
        return out


def _main():
    path, cmd = sys.argv[1], sys.argv[2]
    c = Code(path)
    if cmd == 'func':
        print(c.show(c.func(int(sys.argv[3], 0))))
    elif cmd == 'dis':
        n = int(sys.argv[4]) if len(sys.argv) > 4 else 40
        print(c.show(c.disasm(int(sys.argv[3], 0), n)))
    elif cmd == 'xrefs':
        for a, m in c.xrefs(int(sys.argv[3], 0)):
            print(f'{a:#08x}  {m}')
    elif cmd == 'callers':
        for a, m in c.callers(int(sys.argv[3], 0)):
            print(f'{a:#08x}  {m}')
    elif cmd == 'entries':
        for va in c.entries():
            print(f'{va:x}')
    elif cmd == 'str':
        for va, s in c.strings(sys.argv[3]):
            print(f'{va:#08x}  {s!r}')
    elif cmd == 'strxref':
        for va, s, ins in c.strxref(sys.argv[3]):
            print(f'{va:#08x}  {s!r}')
            for i in ins:
                print(f'          <- {i.address:#08x} {i.mnemonic} {i.op_str}')
    elif cmd == 'consts':
        for i in c.consts(int(sys.argv[3], 0)):
            print(f'{i.address:#08x}  {i.mnemonic:<7} {i.op_str}')
    else:
        raise SystemExit(f'unknown command {cmd}')


if __name__ == '__main__':
    _main()
