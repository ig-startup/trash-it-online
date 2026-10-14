"""
One function of G.EXE at a time, out of the decompilation run.sh wrote —
so a session reads the routine it is working on, not a 1.7 MB file.

Names come from the symbol files as they are now (symbols.txt,
symbols.d/, symbols_lib.txt), so a name given since the last Ghidra run
already works here; the body still shows the names of that run.

    python3 scripts/ghidra/fn.py show  <name|0xVA>   body, then callers and callees
    python3 scripts/ghidra/fn.py brief <name|0xVA>   signature, size, callers, callees
    python3 scripts/ghidra/fn.py where <name|0xVA>   which notes (docs/re) and clone files cite it
    python3 scripts/ghidra/fn.py grep  <regex>       functions whose body matches, with the line
    python3 scripts/ghidra/fn.py frontier [N]        what to read next: unnamed functions
                                                     called from named ones, most callers first
                                                     (game code only; --lib for the libraries)
    python3 scripts/ghidra/fn.py progress            how much of the game code is named by hand,
                                                     by count and by lines, per 16 KB of address

The decompilation is read from $TRASHIT_GHWORK (default ~/ghwork/g),
decomp_fields.c there; pass --raw for decomp.c.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = os.environ.get("TRASHIT_GHWORK", os.path.expanduser("~/ghwork/g"))
CLONE = ("client/src", "server/src", "shared")

HEAD = re.compile(r"^// ==== (\S+) @ ([0-9a-f]+)\n", re.M)
CALL = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")


def load_symbols():
    """{addr: name} for functions, from every symbol file, symbols.txt last."""
    files = [os.path.join(HERE, "symbols_lib.txt")]
    d = os.path.join(HERE, "symbols.d")
    files += sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".txt"))
    files.append(os.path.join(HERE, "symbols.txt"))
    out = {}
    for path in files:
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            body = line.split(";")[0].split()
            if len(body) >= 3 and body[0].startswith("0x") and body[1] == "f":
                out[int(body[0], 16)] = body[2]
    return out


class Decomp:
    def __init__(self, raw=False):
        path = os.path.join(WORK, "decomp.c" if raw else "decomp_fields.c")
        if not os.path.exists(path):
            sys.exit("no %s — run scripts/ghidra/run.sh %s first" % (path, WORK))
        text = open(path, encoding="utf-8", errors="replace").read()
        parts = HEAD.split(text)
        self.bodies = {int(parts[i + 1], 16): (parts[i], parts[i + 2])
                       for i in range(1, len(parts) - 2, 3)}
        syms = load_symbols()
        self.name = {a: syms.get(a, n) for a, (n, _b) in self.bodies.items()}
        self.addr = {}
        for a, (n, _b) in self.bodies.items():
            self.addr[n] = a
        for a, n in syms.items():
            self.addr[n] = a
        self._callees = None

    def find(self, key):
        if re.fullmatch(r"(0x)?[0-9a-fA-F]{5,8}", key):
            a = int(key, 16)
        elif key in self.addr:
            a = self.addr[key]
        else:
            hits = sorted(n for n in self.addr if key in n)
            sys.exit("no function %r%s" % (key, ("; did you mean: " + ", ".join(hits[:15])) if hits else ""))
        if a not in self.bodies:
            # inside a function: the one that starts last before it
            starts = [s for s in self.bodies if s <= a]
            if not starts:
                sys.exit("0x%x is before the first function" % a)
            s = max(starts)
            print("// 0x%x is inside %s @ 0x%x" % (a, self.name[s], s))
            a = s
        return a

    def callees(self):
        if self._callees is None:
            self._callees = {}
            for a, (_n, b) in self.bodies.items():
                out = []
                for m in CALL.finditer(b.split("{", 1)[-1]):
                    t = self.addr.get(m.group(1))
                    if t is not None and t != a and t in self.bodies and t not in out:
                        out.append(t)
                self._callees[a] = out
        return self._callees

    def callers(self, a):
        """Every function that calls it or takes its address."""
        rx = re.compile(r"\b(%s)\b" % "|".join(
            re.escape(n) for n in {self.name[a], self.bodies[a][0]}))
        return sorted(c for c, (_n, b) in self.bodies.items()
                      if c != a and rx.search(b.split("{", 1)[-1]))

    def label(self, a):
        return "%s @ 0x%x" % (self.name[a], a)


def unnamed(n):
    return n.startswith("FUN_") or n.startswith("state_") and re.fullmatch(r"state_[0-9a-f]+", n)


def cmd_show(d, key, body=True):
    a = d.find(key)
    text = d.bodies[a][1].rstrip()
    print("// %s, %d lines" % (d.label(a), text.count("\n") + 1))
    if body:
        print(text)
    else:
        sig = text.split("{", 1)[0].strip()
        print(re.sub(r"\s+", " ", sig))
    print("// callers: " + (", ".join(d.label(c) for c in d.callers(a)) or "none in the dump"))
    print("// callees: " + (", ".join(d.label(c) for c in d.callees()[a]) or "none"))


def cmd_where(d, key):
    a = d.find(key)
    pats = ["-e", d.name[a], "-e", "0x%x" % a, "-e", "0x%06x" % a]
    for where in (["docs/re"], list(CLONE), ["scripts"]):
        r = subprocess.run(["git", "grep", "--untracked", "-n", "-w", "-I"] + pats + ["--"] + where,
                           cwd=REPO, capture_output=True, text=True)
        lines = [l for l in r.stdout.splitlines() if not l.startswith("scripts/ghidra/symbols")]
        print("== %s: %d" % (" ".join(where), len(lines)))
        for l in lines[:20]:
            print("  " + l[:200])


def cmd_grep(d, regex):
    rx = re.compile(regex)
    for a in sorted(d.bodies):
        lines = [l.strip() for l in d.bodies[a][1].splitlines() if rx.search(l)]
        if lines:
            print("%s: %s" % (d.label(a), " | ".join(lines[:3])[:220]))


#: Where the linked libraries (Miles Sound System, the C runtime) start.
LIBRARY_LO = 0x6d000


def cmd_frontier(d, top=30, lib=False):
    """Unnamed functions reached from named code. The more named callers,
    the more context there is to name it from; small ones go first among
    equals."""
    named_callers = {}
    for c, ts in d.callees().items():
        if unnamed(d.name[c]):
            continue
        for t in ts:
            if unnamed(d.name[t]) and (lib or t < LIBRARY_LO):
                named_callers.setdefault(t, []).append(c)
    rows = sorted(named_callers.items(),
                  key=lambda kv: (-len(kv[1]), d.bodies[kv[0]][1].count("\n")))
    total = sum(1 for a in d.bodies if unnamed(d.name[a]) and (lib or a < LIBRARY_LO))
    print("unnamed%s: %d of %d functions; %d of them called from named code\n"
          % ("" if lib else " game code", total, len(d.bodies), len(rows)))
    for a, cs in rows[:top]:
        print("0x%06x  %4d lines  <- %s" % (
            a, d.bodies[a][1].count("\n"),
            ", ".join(d.name[c] for c in sorted(cs)[:4]) + (" …" if len(cs) > 4 else "")))


def hand_named():
    """Addresses named in symbols.txt and symbols.d/ — by a person reading
    the routine, not generated from strings or callers (symbols_lib.txt)."""
    files = [os.path.join(HERE, "symbols.txt")]
    d = os.path.join(HERE, "symbols.d")
    files += sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".txt"))
    out = set()
    for f in files:
        for line in open(f, encoding="utf-8"):
            m = re.match(r"0x([0-9a-fA-F]+)\s+f\s", line)
            if m:
                out.add(int(m.group(1), 16))
    return out


#: Ghidra's marks of bytes that are not code. A "function" carrying one and
#: called by nothing is data cut up as code — the table the blitters use
#: from 0x3967b to 0x5c000 is most of them — and is left out of the count.
NOT_CODE = ("bad instruction", "overlaps instruction")


#: The blitters' step table (scale_step_table); everything Ghidra cut out of it.
DATA_RANGES = ((0x3967b, 0x5c000),)


def is_data(d, a):
    if any(lo <= a < hi for lo, hi in DATA_RANGES):
        return True
    body = d.bodies[a][1]
    return any(m in body for m in NOT_CODE) and not d.callers(a)


def cmd_progress(d):
    named = hand_named()
    game = [a for a in d.bodies if a < LIBRARY_LO]
    data = [a for a in game if is_data(d, a) and a not in named]
    code = [a for a in game if a not in data]
    size = {a: d.bodies[a][1].count("\n") for a in code}
    done = [a for a in code if a in named]
    total = sum(size.values())
    print("game code: %d routines (%d lines); %d data blocks Ghidra took for code left out"
          % (len(code), total, len(data)))
    print("named by hand: %d (%.0f%%), %d lines (%.1f%%)\n" % (
        len(done), 100.0 * len(done) / len(code),
        sum(size[a] for a in done), 100.0 * sum(size[a] for a in done) / total))
    step = 0x4000
    for lo in range(min(code) & ~(step - 1), LIBRARY_LO, step):
        part = [a for a in code if lo <= a < lo + step]
        if not part:
            continue
        left = [a for a in part if a not in named]
        print("0x%05x  %3d of %3d unnamed, %5d of %5d lines" % (
            lo, len(left), len(part), sum(size[a] for a in left), sum(size[a] for a in part)))


def main(argv):
    raw, lib = "--raw" in argv, "--lib" in argv
    argv = [x for x in argv if x not in ("--raw", "--lib")]
    if not argv or argv[0] not in ("show", "brief", "where", "grep", "frontier", "progress"):
        sys.exit(__doc__)
    d = Decomp(raw)
    cmd = argv[0]
    if cmd == "progress":
        cmd_progress(d)
    elif cmd == "frontier":
        cmd_frontier(d, int(argv[1]) if len(argv) > 1 else 30, lib)
    elif len(argv) < 2:
        sys.exit(__doc__)
    elif cmd == "show":
        cmd_show(d, argv[1])
    elif cmd == "brief":
        cmd_show(d, argv[1], body=False)
    elif cmd == "where":
        cmd_where(d, argv[1])
    elif cmd == "grep":
        cmd_grep(d, argv[1])


if __name__ == "__main__":
    main(sys.argv[1:])
