"""
Export the in-level panel's icon lists and scripts that the clone plays.

    python3 scripts/export_hud.py

Writes `client/src/scenes/hudScripts.json`: for each list named below, its
sprite entries — frame, position, the script its tick hands over — as
`hud.py` reads them out of G.EXE (see docs/re/front/hud.md). The ops are
named as in `hud.py`'s `OPS`; `hudPanel.js` plays them.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

from disasm import Code  # noqa: E402
import hud  # noqa: E402

OUT = os.path.join(REPO, "client", "src", "scenes", "hudScripts.json")

#: list VA → name, and the sheet frames that are exported as props.
LISTS = {
    "countdown": 0x97374,
}


def main():
    code = Code(os.path.join(REPO, "Trash-it-original", "G.EXE"))
    out = {}
    for name, va in LISTS.items():
        items = []
        for e in hud.entries(code, va):
            if e["kind"] != 2:
                continue
            ops = hud.script(code, e["script"]) if e["script"] else []
            items.append({
                "sheet": e["sheet"], "frame": e["frame"], "x": e["x"], "y": e["y"],
                "script": [[n, *args] for n, args in ops],
            })
        out[name] = items
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    print("%d lists -> %s" % (len(out), OUT))


if __name__ == "__main__":
    main()
