"""
Name the fields of G.EXE's structures in a Ghidra dump.

The decompiled C reaches every structure through raw offsets —
`*(int *)(in_EAX + 0x24)`, `*(short *)(current_player + 0x9c)` — and this
rewrites the ones it can be sure of into field names from `fields.txt`:

    *(int *)(in_EAX + 0x24)              ->  in_EAX->x
    *(short *)(current_player + 0x9c)    ->  current_player->anim_changed
    *(short *)(&DAT_003f6182 + i * 0x70) ->  objects[i].y_px
    *(short *)(&DAT_003f6182 + b)        ->  OBJECT_AT(b)->y_px   (b in bytes)

**How it knows what a pointer is.** Not from names. It reads the machine
code (G.EXE, through scripts/formats/disasm.py) and follows, register by
register, where a structure pointer goes:

  - every state routine — anything handed to set_state, stored into a
    sprite's `+0x10`, or named by a template as its start state — is
    entered with the sprite in EAX (the sprite loop at VA 0x2ec8d, and
    Jack's at VA 0x21941, both `mov eax, <sprite>` then call);
  - set_state's targets are Jack's states, so their sprite is Jack, and
    Jack's `+0x54` is his player struct;
  - `mov r, [0x595cc8]` (last_spawned) is a sprite, `mov r, [0x28bf2c]`
    (current_player) a player struct;
  - Watcom's calling convention keeps every register but EAX across a
    call — this checks, per callee, which ones it really clobbers — so a
    register keeps what it holds until written;
  - a function is taken to receive a sprite in a register only when
    **every** call site in the binary passes one there.

A register-level fact becomes a decompiler variable through Ghidra's
naming (`in_EAX` is EAX on entry, `extraout_ECX_03` is ECX after some
call, `param_1` of a `__fastcall` is ECX), and a local copy (`iVar3 =
in_EAX;`) inherits it when every assignment to it is of the same kind.
Each rewritten access is then checked against the machine code: the
offset must be one the function really touches through that kind of
pointer, or the access is left alone.

Usage:

    python3 scripts/ghidra/fields.py decomp.c > decomp_fields.c
    python3 scripts/ghidra/fields.py --stats decomp.c       # what it rewrote
    python3 scripts/ghidra/fields.py --evidence sprite      # every [reg+off] by offset
    python3 scripts/ghidra/fields.py --funcs sprite         # who receives one, in which register
"""
import collections
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))
sys.path.insert(0, HERE)

FIELDS = os.path.join(HERE, "fields.txt")

# ── fields.txt ─────────────────────────────────────────────────────────────

SIZES = {"u8": 1, "s8": 1, "u16": 2, "s16": 2, "u32": 4, "s32": 4,
         "fix": 4, "ptr": 4, "code": 4}


def size_of(ctype):
    if ctype.endswith("*"):
        return 4
    m = re.fullmatch(r"(\w+)\[(\d+)\]", ctype)
    if m:
        return SIZES[m.group(1)] * int(m.group(2))
    return SIZES[ctype]


def load_fields(path=FIELDS):
    """fields.txt -> {struct: {offset: [(size, ctype, name, meaning), ...]}}"""
    out = collections.defaultdict(lambda: collections.defaultdict(list))
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        body, _, meaning = line.partition(";")
        struct, off, ctype, name = body.split()[:4]
        out[struct][int(off, 16)].append((size_of(ctype), ctype, name, meaning.strip()))
    return out


# ── the machine code: who holds what ───────────────────────────────────────

REG = {}
for _fam, _subs in {"eax": "eax ax al ah", "ebx": "ebx bx bl bh",
                    "ecx": "ecx cx cl ch", "edx": "edx dx dl dh",
                    "esi": "esi si", "edi": "edi di", "ebp": "ebp bp"}.items():
    for _s in _subs.split():
        REG[_s] = _fam
GPRS = ("eax", "ebx", "ecx", "edx", "esi", "edi", "ebp")

LAST_SPAWNED = 0x595cc8
CURRENT_PLAYER = 0x28bf2c
SET_STATE = 0x21d30
LIBRARY_LO = 0x6d000

#: The kinds a register can hold. "jack" is a sprite known to be Jack, so
#: that his +0x54 can be read as his player struct.
SPRITE, JACK, PLAYER = "sprite", "jack", "player"


def meet(a, b):
    if a == b:
        return a
    if {a, b} == {SPRITE, JACK}:
        return SPRITE
    return None


#: Loads that produce a known kind: [kind of base, offset] -> kind.
LOADS = {(JACK, 0x54): PLAYER,      # Jack's owner is his player struct
         (PLAYER, 0x00): JACK,      # and the player's first field is Jack
         (PLAYER, 0x4c): SPRITE,    # the hoover
         (PLAYER, 0x54): SPRITE}    # the hammer
#: Globals that hold a kind.
GLOBALS = {LAST_SPAWNED: SPRITE, CURRENT_PLAYER: PLAYER,
           0x3f16f0: SPRITE,        # the sprite loop's cursor (VA 0x2ec62)
           0x28bf28: SPRITE}        # current_player's hammer (VA 0x218c9)


class Func:
    __slots__ = ("va", "end", "insns", "name", "entry", "clobbers", "facts",
                 "after_call", "sites", "mem", "_info_cache", "_flowed")


class Machine:
    """Per-function register facts over G.EXE's code."""

    def __init__(self, bodies, names=None):
        from disasm import Code
        import symbols
        self.code = Code(symbols.EXE)
        self.names = names or {}
        starts = sorted(a for a in bodies if self.code.in_code(a))
        self.funcs = {}
        for i, va in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else va + 0x400
            end = min(end, va + 0x4000)
            f = Func()
            f.va, f.end, f.name = va, end, bodies[va][0]
            off = va - self.code.base
            f.insns = []
            for ins in self.code.md.disasm(self.code.mem[off:end - self.code.base], va):
                f.insns.append(ins)
            f.entry = {}
            self.funcs[va] = f
        self._clobbers()
        self._seed()
        self._propagate()

    # registers each function may change for its caller
    def _clobbers(self):
        direct = {}
        for va, f in self.funcs.items():
            written, pushed, calls = set(), set(), set()
            for ins in f.insns:
                m = ins.mnemonic
                if m == "push" and ins.op_str in REG:
                    pushed.add(REG[ins.op_str])
                if m == "pusha" or m == "pushad":
                    pushed.update(GPRS)
                if m == "call":
                    t = self._target(ins)
                    if t is not None:
                        calls.add(t)
                    continue
                if m == "pop":
                    continue
                try:
                    _r, w = ins.regs_access()
                except Exception:
                    continue
                for r in w:
                    fam = REG.get(ins.reg_name(r))
                    if fam:
                        written.add(fam)
            direct[va] = (written, pushed, calls)
        clob = {va: (w - p) | {"eax"} for va, (w, p, _c) in direct.items()}
        for _ in range(20):
            changed = False
            for va, (w, p, calls) in direct.items():
                new = set(clob[va])
                for t in calls:
                    new |= clob.get(t, {"eax", "ecx", "edx", "ebx"})
                new -= p
                new.add("eax")
                if new != clob[va]:
                    clob[va], changed = new, True
            if not changed:
                break
        for va, f in self.funcs.items():
            f.clobbers = clob[va]

    @staticmethod
    def _target(ins):
        op = ins.operands[0] if ins.operands else None
        if op is not None and op.type == 2:   # immediate
            return op.imm
        return None

    def _seed(self):
        """State routines take their sprite in EAX; set_state's are Jack's."""
        import symbols
        d = symbols.Derive(self.code)
        jack = {imm for _s, imm, _t in d._sites(0xBA, {SET_STATE}) if self.code.in_code(imm)}
        states = set(d.states())
        for _tpl, (_spr, st) in d.templates().items():
            if st:
                states.add(st)
        self.jack_states = jack
        self.states = states
        for va in states:
            if va in self.funcs:
                self.funcs[va].entry = {"eax": JACK if va in jack else SPRITE}
        self.seeds = {va: dict(self.funcs[va].entry) for va in states if va in self.funcs}

    # one function's facts, forward, must-hold (intersection at joins)
    def _flow(self, f):
        insns = f.insns
        idx = {ins.address: i for i, ins in enumerate(insns)}
        targets = collections.defaultdict(list)     # insn index -> predecessor indices
        falls = [True] * len(insns)
        for i, ins in enumerate(insns):
            m = ins.mnemonic
            if m.startswith("j"):
                t = self._target(ins)
                if t is not None and t in idx:
                    targets[idx[t]].append(i)
                if m == "jmp":
                    falls[i] = False
            if m in ("ret", "retf", "iret", "iretd"):
                falls[i] = False
        facts_in = [None] * len(insns)
        facts_out = [None] * len(insns)
        after_call = {}
        sites = []
        mem = []

        info = self._info(f)

        def transfer(i, fin):
            kills, dst, src = info[i]
            fact = {r: v for r, v in fin.items() if r not in kills}
            if dst:
                how, a, b = src
                if how == "reg":
                    new = fin.get(a)
                elif how == "glob":
                    new = GLOBALS.get(a)
                else:
                    new = LOADS.get((fin.get(a), b))
                if new:
                    fact[dst] = new
            return fact

        # iterate to a fixpoint; None = not yet reached
        for _round in range(50):
            changed = False
            for i in range(len(insns)):
                preds = list(targets.get(i, []))
                if i > 0 and falls[i - 1]:
                    preds.append(i - 1)
                if i == 0:
                    ins_fact = dict(f.entry)
                    known = [facts_out[p] for p in preds if facts_out[p] is not None]
                    for k in known:
                        ins_fact = {r: meet(v, k.get(r)) for r, v in ins_fact.items()}
                        ins_fact = {r: v for r, v in ins_fact.items() if v}
                elif not preds:
                    ins_fact = {}       # reached only through a jump table, or not at all
                else:
                    known = [facts_out[p] for p in preds if facts_out[p] is not None]
                    if not known:
                        continue
                    ins_fact = dict(known[0])
                    for k in known[1:]:
                        ins_fact = {r: meet(v, k.get(r)) for r, v in ins_fact.items()}
                        ins_fact = {r: v for r, v in ins_fact.items() if v}
                if ins_fact != facts_in[i]:
                    facts_in[i] = ins_fact
                    facts_out[i] = transfer(i, ins_fact)
                    changed = True
            if not changed:
                break
        for i, ins in enumerate(insns):
            fin = facts_in[i] or {}
            if ins.mnemonic in ("call", "jmp"):
                t = self._target(ins)
                if t is not None and t in self.funcs and (ins.mnemonic == "call" or t not in idx):
                    sites.append((ins.address, t, dict(fin)))
                if ins.mnemonic == "call":
                    after_call[ins.address] = facts_out[i] or {}
            for op in ins.operands:
                if op.type == 3 and op.mem.base != 0:
                    k = fin.get(REG.get(ins.reg_name(op.mem.base)))
                    if k:
                        mem.append((k, op.mem.disp, op.size, ins.address,
                                    op.mem.index != 0))
        f.facts = facts_in
        f.after_call = after_call
        f.sites = sites
        f.mem = mem

    def _info(self, f):
        """Per instruction: (registers it kills, register a mov writes, source)."""
        if getattr(f, "_info_cache", None) is not None:
            return f._info_cache
        out = []
        for ins in f.insns:
            m, ops = ins.mnemonic, ins.operands
            if m == "call":
                t = self._target(ins)
                clob = self.funcs[t].clobbers if t in self.funcs else (
                    {"eax"} if t is None else {"eax", "ecx", "edx", "ebx"})
                out.append((frozenset(clob), None, None))
                continue
            if m == "pop":
                k = REG.get(ins.reg_name(ops[0].reg)) if ops and ops[0].type == 1 else None
                out.append((frozenset([k]) if k else frozenset(), None, None))
                continue
            try:
                _r, w = ins.regs_access()
            except Exception:
                w = []
            kills = frozenset(REG[ins.reg_name(r)] for r in w if ins.reg_name(r) in REG)
            dst = src = None
            if m == "mov" and len(ops) == 2 and ops[0].type == 1 and ins.reg_name(ops[0].reg) in GPRS:
                s = ops[1]
                if s.type == 1 and ins.reg_name(s.reg) in GPRS:
                    dst, src = ins.reg_name(ops[0].reg), ("reg", ins.reg_name(s.reg), 0)
                elif s.type == 3 and s.size == 4 and s.mem.index == 0:
                    if s.mem.base == 0:
                        dst, src = ins.reg_name(ops[0].reg), ("glob", s.mem.disp & 0xffffffff, 0)
                    elif REG.get(ins.reg_name(s.mem.base)):
                        dst, src = ins.reg_name(ops[0].reg), ("load", REG[ins.reg_name(s.mem.base)], s.mem.disp)
            out.append((kills, dst, src))
        f._info_cache = out
        return out

    def _propagate(self):
        """Entry facts from call sites: a register holds a kind on entry when
        every call site agrees."""
        # every byte-level call site, so that a caller outside any function
        # we decoded counts as "unknown"
        covered = collections.defaultdict(list)
        for a, m, t in self.code._branches():
            if m == "call" and t in self.funcs:
                covered[t].append(a)
        starts = sorted(self.funcs)
        import bisect
        insn_addrs = {}
        for va, f in self.funcs.items():
            for ins in f.insns:
                insn_addrs[ins.address] = va

        def owner(a):
            i = bisect.bisect_right(starts, a) - 1
            if i < 0:
                return None
            va = starts[i]
            return va if a < self.funcs[va].end else None

        unknown_callers = set()
        for t, addrs in covered.items():
            for a in addrs:
                if a in insn_addrs:
                    continue
                if owner(a) is None:
                    unknown_callers.add(t)     # a call from code we did not decode
        for f in self.funcs.values():
            f._info_cache = None
            f._flowed = None
        for _round in range(30):
            for f in self.funcs.values():
                if f._flowed != f.entry:
                    self._flow(f)
                    f._flowed = dict(f.entry)
            incoming = collections.defaultdict(list)
            for f in self.funcs.values():
                for _a, t, fact in f.sites:
                    incoming[t].append(fact)
            changed = False
            for va, f in self.funcs.items():
                if va in self.seeds:
                    new = dict(self.seeds[va])
                elif va in unknown_callers or not incoming.get(va):
                    new = {}
                else:
                    facts = incoming[va]
                    new = dict(facts[0])
                    for k in facts[1:]:
                        new = {r: meet(v, k.get(r)) for r, v in new.items()}
                        new = {r: v for r, v in new.items() if v}
                if new != f.entry:
                    f.entry, changed = new, True
            if not changed:
                break

    # evidence: offsets each kind is accessed at
    def evidence(self, kind):
        out = collections.defaultdict(list)
        for f in self.funcs.values():
            for k, disp, size, addr, indexed in f.mem:
                if k == kind or (kind == SPRITE and k == JACK):
                    out[disp].append((size, addr, f.va, indexed))
        return out

    def offsets_in(self, va):
        """{kind: {(offset, size)}} a function touches through known pointers."""
        out = collections.defaultdict(set)
        f = self.funcs.get(va)
        if f:
            for k, disp, size, _a, _i in f.mem:
                out[k].add((disp, size))
                if k == JACK:
                    out[SPRITE].add((disp, size))
        return out


# ── the rewrite ────────────────────────────────────────────────────────────

CTYPE_SIZE = {"char": 1, "byte": 1, "undefined1": 1, "undefined": 1, "bool": 1,
              "short": 2, "ushort": 2, "undefined2": 2,
              "int": 4, "uint": 4, "undefined4": 4, "long": 4, "ulong": 4,
              "float": 4, "code": 4}
STRUCT_OF = {SPRITE: ("sprite",), JACK: ("jack", "sprite"), PLAYER: ("player",)}
#: Globals that hold a kind, by the name the symbol map gives them.
GLOBAL_NAMES = {"current_player": PLAYER, "last_spawned": SPRITE}
OBJECTS = 0x3f6178
OBJECT_SIZE = 0x70

DECL = re.compile(r"^\s+([A-Za-z_][\w ]*?)\s*(\*+)?\s*(\w+);", re.M)
REGVAR = re.compile(r"^(?:in|unaff)_E([A-D]X|SI|DI|BP)$")
COPY = re.compile(r"\b(\w+) = \(?(?:\w+ \*?\)?)?\s*(\w+);")
#: *(T *)(V + k), *(T *)((int)V + k), *(T *)V
ACCESS = re.compile(r"\*\((\w+) (\*+)\)(?:\((\(int\))?(\w+) \+ (0x[0-9a-f]+|\d+)\)|(\w+)\b(?! *[\[(+]))")
INDEX = re.compile(r"\b(\w+)\[(0x[0-9a-f]+|\d+)\]")
#: *(T *)(&DAT_003f61xx + i * 0x70), and + b where b is already a byte offset
OBJ_ACCESS = re.compile(r"\*\((\w+ ?\*?) \*\)\(&DAT_00([0-9a-f]{6}) \+ ((?:\(\w+\))?\w+)( \* 0x70)?\)")


def _pointee(decls, var):
    """Size the decompiler scales `var + k` by, or None for a global."""
    d = decls.get(var)
    if d is None:
        return None
    base, stars = d
    if not stars:
        return 1
    if len(stars) > 1:
        return 4
    return CTYPE_SIZE.get(base, 1)


def _field(fields, kind, off, size):
    for st in STRUCT_OF[kind]:
        for fsize, _ct, name, _m in fields.get(st, {}).get(off, []):
            if fsize == size:
                return name
    return None


def rewrite(fields, machine, va, body, stats, scales=None, votes=None):
    """One function's body with field names. `scales` says how each global
    pointer scales `g + k` here; `votes` collects the evidence for that."""
    scales = scales or {}
    f = machine.funcs.get(va)
    entry = f.entry if f else {}
    decls = {}
    for base, stars, var in DECL.findall(body.split("{", 1)[-1]):
        decls.setdefault(var, (base.strip(), stars or ""))
    kinds = {}
    for var in decls:
        m = REGVAR.match(var)
        if m:
            k = entry.get("e" + m.group(1).lower())
            if k:
                kinds[var] = k
    for g, k in GLOBAL_NAMES.items():
        if g not in decls:
            kinds[g] = k
    # local copies: every assignment to it is of the same kind
    for _ in range(4):
        assigned = collections.defaultdict(set)
        for dst, src in COPY.findall(body):
            if dst in decls and not REGVAR.match(dst):
                assigned[dst].add(kinds.get(src))
        for var, ks in assigned.items():
            if len(ks) == 1 and None not in ks:
                kinds[var] = ks.pop()
    touched = machine.offsets_in(va)

    def ok(kind, off, size):
        seen = touched.get(kind, set())
        return (off, size) in seen or (kind == JACK and (off, size) in touched.get(SPRITE, set()))

    def name_for(var, k, size, explicit_bytes):
        kind = kinds.get(var)
        if not kind:
            return None
        scale = 1 if explicit_bytes else (_pointee(decls, var) or scales.get(var))
        cands = [k * s for s in ((scale,) if scale else (1, 2, 4))]
        hits = {(o, _field(fields, kind, o, size)) for o in cands
                if _field(fields, kind, o, size) and ok(kind, o, size)}
        if len(hits) == 1 and not scale and votes is not None and k:
            votes[var][hits.copy().pop()[0] // k] += 1
        if len(hits) != 1:
            if any(_field(fields, kind, o, size) for o in cands):
                stats["unverified"] += 1
            return None
        stats[kind] += 1
        return hits.pop()[1]

    def sub_access(m):
        ctype, stars, cast, var, k, bare = m.groups()
        size = 4 if len(stars) > 1 else CTYPE_SIZE.get(ctype)
        if size is None:
            return m.group(0)
        if bare:
            var, k, cast = bare, "0", None
        name = name_for(var, int(k, 0), size, bool(cast))
        return "%s->%s" % (var, name) if name else m.group(0)

    def sub_index(m):
        var, k = m.groups()
        if var not in kinds:
            return m.group(0)
        size = _pointee(decls, var) if var in decls else scales.get(var)
        if not size:
            return m.group(0)
        name = name_for(var, int(k, 0), size, False)
        return "%s->%s" % (var, name) if name else m.group(0)

    def sub_obj(m):
        ctype, addr, idx, scaled = m.groups()
        off = int(addr, 16) - OBJECTS
        size = 4 if ctype.endswith("*") else CTYPE_SIZE.get(ctype)
        if not 0 <= off < OBJECT_SIZE or size is None:
            return m.group(0)
        for fsize, _ct, name, _m in fields.get("object", {}).get(off, []):
            if fsize == size:
                stats["object"] += 1
                if scaled:
                    return "objects[%s].%s" % (idx, name)
                return "OBJECT_AT(%s)->%s" % (idx, name)
        return m.group(0)

    body = ACCESS.sub(sub_access, body)
    body = INDEX.sub(sub_index, body)
    body = OBJ_ACCESS.sub(sub_obj, body)
    return body


def rewrite_dump(path, out=sys.stdout, stats=None):
    import symbols
    stats = stats if stats is not None else collections.Counter()
    text = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r"^(// ==== \S+ @ ([0-9a-f]+)\n)", text, flags=re.M)
    bodies = symbols.decomp_bodies(path)
    machine = Machine(bodies)
    fields = load_fields()
    out.write(parts[0])
    for i in range(1, len(parts) - 2, 3):
        va, body = int(parts[i + 1], 16), parts[i + 2]
        # the decompiler types a global afresh in every function, so how
        # `g + k` scales is settled per function, by its unambiguous uses
        votes = collections.defaultdict(collections.Counter)
        rewrite(fields, machine, va, body, collections.Counter(), votes=votes)
        scales = {g: v.most_common(1)[0][0] for g, v in votes.items()
                  if len(v) == 1}
        out.write(parts[i])
        out.write(rewrite(fields, machine, va, body, stats, scales))
    return stats, machine


def main(argv):
    if len(argv) == 2 and not argv[1].startswith("--"):
        rewrite_dump(argv[1])
    elif len(argv) == 3 and argv[1] == "--stats":
        import io
        stats, _m = rewrite_dump(argv[2], io.StringIO())
        for k, n in stats.most_common():
            print("%-12s %6d" % (k, n))
    elif len(argv) == 3 and argv[1] in ("--evidence", "--funcs"):
        import symbols
        dump = os.environ.get("DECOMP", os.path.expanduser("~/ghwork/g/decomp.c"))
        m = Machine(symbols.decomp_bodies(dump))
        if argv[1] == "--evidence":
            for disp, uses in sorted(m.evidence(argv[2]).items()):
                sizes = collections.Counter(u[0] for u in uses)
                print("+0x%-4x %4d  %s" % (disp, len(uses), dict(sizes)))
        else:
            for va, f in sorted(m.funcs.items()):
                regs = [r for r, k in f.entry.items() if k == argv[2] or
                        (argv[2] == SPRITE and k == JACK)]
                if regs:
                    print("0x%06x  %-32s %s" % (va, f.name, " ".join(regs)))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
