"""
The symbol map of G.EXE: hand names (symbols.txt) plus the names the
binary gives away by itself, merged into one list for Ghidra, and a
measure of how much of the code has a name yet.

The game is plain C compiled with Watcom, and it describes much of itself
in tables that can be read without understanding the code around them:

  - the class registry (VA 0x992c4) maps each .OB class id to its
    constructor;
  - an object template (28 bytes) starts with a sprite-table index, whose
    record holds the .SPR file name, and carries the state routine the new
    sprite starts in at +4 — so a template, and the routine it starts,
    can be named after the sprite it draws;
  - every state change is `mov edx, <routine>; call set_state`, so every
    state routine can be found, and Jack's start with `mov eax, <slot>;
    call play_anim`.

Usage (from the repository root):

    python3 scripts/ghidra/symbols.py table   > symbols.tsv   # for ApplySymbols.java
    python3 scripts/ghidra/symbols.py entries > entries.txt   # for MarkFunctions.java
    python3 scripts/ghidra/symbols.py coverage decomp.c       # what is named, what is next
    python3 scripts/ghidra/symbols.py strings decomp.c        # library names + string hints
"""
import os
import re
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

from disasm import Code   # noqa: E402
import ob                 # noqa: E402

EXE = os.path.join(REPO, "Trash-it-original", "G.EXE")
HERE = os.path.dirname(os.path.abspath(__file__))
HAND = os.path.join(HERE, "symbols.txt")
#: Written by `symbols.py strings`: names a decompilation gives away.
FROM_STRINGS = os.path.join(HERE, "symbols_lib.txt")

REGISTRY = 0x992c4
SPRITE_TABLE = 0x9984c
SPRITE_RECORD = 102
TEMPLATE_SIZE = 28
SPAWNERS = (0x2ed96, 0x2edbc)
SET_STATE = 0x21d30
PLAY_ANIM = 0x21c26
DATA_LO, DATA_HI = 0x90000, 0xb0000


def load_hand(path=HAND):
    """symbols.txt -> {addr: (kind, name, comment)}"""
    out = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        body, _, comment = line.partition(";")
        addr, kind, name = body.split()[:3]
        out[int(addr, 16)] = (kind, name, comment.strip())
    return out


def ident(text):
    """A file or class description -> a C identifier fragment."""
    return re.sub(r"[^0-9a-z]+", "_", text.lower()).strip("_")


class Derive:
    """Names read off the binary's own tables and call patterns."""

    def __init__(self, code):
        self.c = code
        self.mem = code.mem
        self.base = code.base
        self.data = code.read(DATA_LO, DATA_HI - DATA_LO)

    def sprite_name(self, index):
        raw = self.c.read(SPRITE_TABLE + index * SPRITE_RECORD, 16)
        name = raw.split(b"\0")[0].decode("latin-1")
        return name if re.fullmatch(r"[A-Z0-9_]+\.SPR", name) else None

    def classes(self):
        """{class id: constructor VA} from the registry."""
        out = {}
        for i in range(64):
            cid, = struct.unpack_from("<H", self.c.read(REGISTRY + i * 8, 2))
            if cid == 0xFFFF:
                break
            out[cid] = self.c.u32(REGISTRY + i * 8 + 4)
        return out

    def _sites(self, opcode, target_set, window=16):
        """`<opcode> imm32` followed within `window` bytes by a call into
        target_set -> [(site VA, imm, call target)]."""
        mem, base, found = self.mem, self.base, []
        for i in range(len(mem) - 5):
            if mem[i] != opcode:
                continue
            imm = int.from_bytes(mem[i + 1:i + 5], "little")
            for j in range(i + 5, min(i + 5 + window, len(mem) - 5)):
                if mem[j] == 0xE8:
                    rel = int.from_bytes(mem[j + 1:j + 5], "little", signed=True)
                    t = base + j + 5 + rel
                    if t in target_set:
                        found.append((base + i, imm, t))
                    break
        return found

    PROLOGUE = {0x50, 0x51, 0x52, 0x53, 0x55, 0x56, 0x57}   # push reg

    def template_at(self, va):
        """(sprite name, start state) if `va` looks like an object template:
        a sprite-table index first, and at +4 a routine that opens with a
        push — or None."""
        if not DATA_LO <= va < DATA_HI:
            return None
        idx, = struct.unpack_from("<H", self.c.read(va, 2))
        spr = self.sprite_name(idx) if idx < 256 else None
        state = self.c.u32(va + 4)
        if spr and self.c.in_code(state) and self.mem[state - self.base] in self.PROLOGUE:
            return spr, state
        return None

    def templates(self):
        """{template VA: (sprite name, start state)}: everything a spawn
        site loads, and every other dword in the image — an operand, an
        entry of a pointer table — that points at a template."""
        out = {}
        for _site, tpl, _t in self._sites(0xB8, set(SPAWNERS)):   # mov eax, imm32
            idx, = struct.unpack_from("<H", self.c.read(tpl, 2)) if DATA_LO <= tpl < DATA_HI else (999,)
            spr = self.sprite_name(idx) if idx < 256 else None
            if spr:
                state = self.c.u32(tpl + 4)
                out[tpl] = (spr, state if self.c.in_code(state) else None)
        for blob, base in ((self.mem, self.base), (self.data, DATA_LO)):
            for i in range(len(blob) - 4):
                v = int.from_bytes(blob[i:i + 4], "little")
                if v not in out:
                    hit = self.template_at(v)
                    if hit:
                        out[v] = hit
        return out

    def states(self):
        """Every routine handed to set_state, or stored straight into an
        entity's routine field: `mov dword ptr [reg + 0x10], imm32`."""
        found = {imm for _s, imm, _t in self._sites(0xBA, {SET_STATE})  # mov edx, imm32
                 if self.c.in_code(imm)}
        mem = self.mem
        for i in range(len(mem) - 7):
            if (mem[i] == 0xC7 and mem[i + 1] & 0xC0 == 0x40
                    and mem[i + 1] & 7 != 4 and mem[i + 2] == 0x10):
                imm = int.from_bytes(mem[i + 3:i + 7], "little")
                if self.c.in_code(imm):
                    found.add(imm)
        return sorted(found)

    def anim_slot(self, routine):
        """The slot a state plays first, if it opens with play_anim(slot)."""
        mem, off = self.mem, routine - self.base
        for i in range(off, min(off + 24, len(mem) - 10)):
            if mem[i] == 0xB8 and mem[i + 5] == 0xE8:
                rel = int.from_bytes(mem[i + 6:i + 10], "little", signed=True)
                if routine - off + i + 10 + rel == PLAY_ANIM:
                    return int.from_bytes(mem[i + 1:i + 5], "little")
        return None

    def all(self):
        out = {}
        for cid, ctor in self.classes().items():
            what = ob.CLASSES.get(cid, "")
            short = ident(what.split(" — ")[0].split("(")[0])[:24] if what else "unknown"
            out[ctor] = ("f", "ob_class_%d_%s" % (cid, short),
                         ".OB class %d constructor%s" % (cid, ": " + what if what else ""))
        for st in self.states():
            slot = self.anim_slot(st)
            if slot is not None and slot < 80:
                out.setdefault(st, ("f", "jack_slot%d_%x" % (slot, st),
                                    "state routine; plays Jack's slot %d" % slot))
            else:
                out.setdefault(st, ("f", "state_%x" % st, "state routine (set_state)"))
        for tpl, (spr, state) in self.templates().items():
            stem = ident(spr[:-4])
            out[tpl] = ("d", "tpl_%s_%x" % (stem, tpl), "object template: %s" % spr)
            if state:
                prev = out.get(state)
                if prev is None or prev[1].startswith("state_"):
                    out[state] = ("f", "%s_tick_%x" % (stem, state),
                                  "start state of a %s sprite" % spr)
        return out


def merged(code):
    names = Derive(code).all()
    if os.path.exists(FROM_STRINGS):
        names.update(load_hand(FROM_STRINGS))
    names.update(load_hand())
    return names


def decomp_bodies(path):
    """decomp.c -> {addr: (name, body)}"""
    text = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r"^// ==== (\S+) @ ([0-9a-f]+)\n", text, flags=re.M)
    return {int(parts[i + 1], 16): (parts[i], parts[i + 2])
            for i in range(1, len(parts) - 2, 3)}


#: Where the linked libraries (Miles Sound System, the C runtime) start.
LIBRARY_LO = 0x6d000

STRING_REF = re.compile(r"\bs_[A-Za-z0-9_]*?_000([0-9a-f]{5})\b")


def cmd_strings(code, decomp_path):
    """Name the Miles Sound System wrappers after the call they log — each
    one writes "AIL_<name>(…)" to its debug log — into symbols_lib.txt, and
    list, for the rest, the strings a function uses: the game's own error
    messages often name the function they are in ("BUG in record_pad_entry")."""
    hand = load_hand()
    lines = ["# Generated by `symbols.py strings` from a decompilation: each Miles",
             "# Sound System wrapper logs the call it makes, \"AIL_<name>(…)\".",
             "# Do not edit; a name in symbols.txt wins over one here.", ""]
    hints = []
    for addr, (name, body) in sorted(decomp_bodies(decomp_path).items()):
        texts = []
        for m in STRING_REF.finditer(body):
            t = code.cstring(int(m.group(1), 16))
            if t and t not in texts:
                texts.append(t)
        ail = [m.group(1) for t in texts for m in [re.match(r"(AIL_\w+)\(", t)] if m]
        # In the library's own code only: in the game's, a constant such as
        # 600001 can land on a string's address and read as a pointer to it.
        if ail and addr >= LIBRARY_LO and addr not in hand:
            lines.append("0x%x  f  %s  ; logs \"%s(\"" % (addr, ail[0], ail[0]))
        elif texts and name.startswith("FUN_"):
            hints.append("0x%06x  %s" % (addr, " | ".join(repr(t)[1:-1] for t in texts[:4])))
    with open(FROM_STRINGS, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("%d library names -> %s" % (len(lines) - 4, FROM_STRINGS))
    print("\nunnamed functions and the strings they use:")
    print("\n".join(hints))


def cmd_table(code):
    for addr, (kind, name, comment) in sorted(merged(code).items()):
        print("%x\t%s\t%s\t%s" % (addr, kind, name, comment))


def cmd_entries(code):
    fs = {a for a, (k, _n, _c) in merged(code).items() if k == "f"}
    for a in sorted(set(code.entries()) | fs):
        print("%x" % a)


def cmd_coverage(code, decomp_path, top=40):
    bodies = decomp_bodies(decomp_path)
    names = merged(code)
    hand = load_hand()
    # Named in the dump, or named since in the symbol files.
    heads = {a: (names[a][1] if a in names and names[a][0] == "f" else n)
             for a, (n, _b) in bodies.items()}
    named = [a for a, n in heads.items() if not n.startswith("FUN_")]
    print("functions in the dump:     %d" % len(heads))
    print("with a name:               %d (%.0f%%)" % (len(named), 100.0 * len(named) / max(1, len(heads))))
    print("  of those, by hand:       %d" % sum(1 for a in named if a in hand))
    print("symbols: %d by hand, %d in total" % (len(hand), len(names)))

    calls = {}
    for _site, m, t in code._branches():
        if m == "call":
            calls[t] = calls.get(t, 0) + 1
    todo = sorted(((calls.get(a, 0), a) for a, n in heads.items()
                   if n.startswith("FUN_")), reverse=True)
    print("\nunnamed, most called first:")
    for n, a in todo[:top]:
        print("  0x%06x  %4d calls  %5d lines" % (a, n, bodies[a][1].count("\n")))


def main(argv):
    code = Code(EXE)
    cmd = argv[0] if argv else "table"
    if cmd == "table":
        cmd_table(code)
    elif cmd == "entries":
        cmd_entries(code)
    elif cmd == "strings":
        cmd_strings(code, argv[1])
    elif cmd == "coverage":
        cmd_coverage(code, argv[1], int(argv[2]) if len(argv) > 2 else 40)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
