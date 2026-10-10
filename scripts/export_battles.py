"""
Export the original's battle game — its sets of levels, the hammer each
level hands every player, the points a place scores and the tie-break —
from F.EXE's own tables (scripts/formats/front.py, README "Playing
together") into shared/battles.json, which the server plays from.

    python3 scripts/export_battles.py
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import front  # noqa: E402

OUT = os.path.join(REPO, "shared", "battles.json")
#: The sets the menu offers; 5-9 repeat set 1 and 10 is the tie-break.
OFFERED = range(5)
TIE_BREAK = 10


def main():
    f = front.Front()
    shop = f.shop()
    sets = f.battle_sets()

    def level(name, hammer, _pic):
        return {"level": "level_" + name, "hammer": hammer,
                "hammerName": shop[hammer][0] if hammer < len(shop) else "guitar"}

    data = {
        "source": "F.EXE VA 0x8d8e0 (sets), 0x13b81 (points), 0x8d768 (tie-break)",
        "sets": [[level(*row) for row in sets[i]] for i in OFFERED],
        # Every player gets this hammer for the tie-break, on the level
        # just played (VA 0x13f53).
        "tieBreakHammer": sets[TIE_BREAK][0][1],
        # Battle points by place, keyed by the number of players.
        "points": {str(n): list(p) for n, p in front.BATTLE_POINTS.items()},
    }
    with open(OUT, "w") as fh:
        json.dump(data, fh, indent=1)
        fh.write("\n")
    print("%d sets (%s levels) -> %s" % (len(data["sets"]),
          ", ".join(str(len(s)) for s in data["sets"]), OUT))


if __name__ == "__main__":
    main()
