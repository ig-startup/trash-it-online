"""
Export the original's 37 hammers — what each blow carries, and its look.

    python3 scripts/export_hammers.py

Writes:
  shared/hammers.json                          one record a hammer, in the
                                               catalogue's order (G.EXE VA
                                               0xa1e04 — the index the
                                               battle sets name)
  client/public/sprites/hammers/<STEM>.png     its 61 frames in one strip
  client/public/sprites/hammers/<STEM>.json    a Phaser atlas of them, each
                                               frame carrying its anchor

A hammer's sprite file is its data file's stem: `sla.dat`, the sledge v1,
draws from `SLA.SPR`. Every sheet has the same 61 frames in the same order,
so the lists that pick a hammer frame for each of Jack's animations
(anims.hammer_lists, `hammerBySlot` in propFrames.json) fit them all.

The fields (see "What a hammer blow carries" in scripts/formats/README.md):

  lo, hi        +0x3c / +0x40   the sideways blow's force ramp
  mask          +0x34           the rubble a blow throws (debris mask)
  overLo/overHi +0x44 / +0x46   the overhead strike's ramp
  type          +0x48           1 and 4 halve the blow; with 0 they set how
                                many blocks one blow strikes (VA 0x1fcd3)
  reach         +0x4a..+0x50    ahead, down, across, deep — from Jack's feet
  overBox       +0x5e +0x60 +0x62  the overhead strike's box: ahead, wide, high
"""
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "formats"))

import _png  # noqa: E402
import pal  # noqa: E402
import spr  # noqa: E402
import hammers  # noqa: E402
from disasm import Code  # noqa: E402

REPO = os.path.dirname(HERE)
ORIG = os.path.join(REPO, "Trash-it-original")
OUT_PNG = os.path.join(REPO, "client", "public", "sprites", "hammers")
OUT_JSON = os.path.join(REPO, "shared", "hammers.json")
PREFIX = "sprites/hammers"

# VA 0x1fcd3: per type, whether the force is halved and how many blocks one
# blow may strike. Type 4 picks 2 or 3 at random; type 0 is 3 and halved
# unless the caller passes flag bits the clone has not traced.
TYPES = {
    0: {"halves": True, "strikes": 3},
    1: {"halves": True, "strikes": 3},
    2: {"halves": False, "strikes": 1},
    3: {"halves": False, "strikes": 2},
    4: {"halves": True, "strikes": [2, 3]},
}
OVER_DY = -13  # the overhead box's top, from Jack's feet (VA 0x2f1d7)


def _u32(rec, off):
    return struct.unpack_from("<I", rec, off)[0]


def _s16(rec, off):
    return struct.unpack_from("<h", rec, off)[0]


def _atlas(sheet, palette, stem):
    """Lays a sheet's frames out in one strip; -> atlas JSON."""
    frames = spr.load(os.path.join(ORIG, "SPR", sheet))
    bitmaps = [spr.frame_bitmap(f, transparent=None) for f in frames]
    width = sum(w for w, _, _ in bitmaps) + len(bitmaps)
    height = max(h for _, h, _ in bitmaps)
    canvas = [(0, 0, 0, 0)] * (width * height)
    atlas = {"frames": {}, "meta": {"image": "%s.png" % stem, "size": {"w": width, "h": height}}}
    x = 0
    for i, (f, (w, h, img)) in enumerate(zip(frames, bitmaps)):
        for row in range(h):
            for col in range(w):
                v = img[row][col]
                if v is not None:
                    canvas[row * width + x + col] = palette[v] + (255,)
        atlas["frames"][str(i)] = {
            "frame": {"x": x, "y": 0, "w": w, "h": h},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
            # where Jack's feet are in the frame — the anchor
            "ax": -f["ox"], "ay": -f["oy"],
        }
        x += w + 1
    _png.write_rgba(os.path.join(OUT_PNG, "%s.png" % stem), width, height, canvas)
    return atlas


def main():
    exe = os.path.join(ORIG, "G.EXE")
    code = Code(exe)
    palette = pal.merge(
        pal.decode(os.path.join(ORIG, "LEVELS", "0A.PAL")),
        pal.decode(os.path.join(ORIG, "SPR", "JACKS.PAL")))
    os.makedirs(OUT_PNG, exist_ok=True)

    out = []
    for i, h in enumerate(hammers.read(exe)):
        rec = code.read(h["va"], hammers.RECORD_SIZE)
        stem = h["file"].split(".")[0].upper()
        kind = _s16(rec, 0x48)
        record = {
            "index": i,
            "name": h["name"],
            "sprite": stem,
            "lo": _u32(rec, 0x3c),
            "hi": _u32(rec, 0x40),
            "mask": _u32(rec, 0x34),
            "overLo": _s16(rec, 0x44),
            "overHi": _s16(rec, 0x46),
            "type": kind,
            **TYPES[kind],
            "reach": {"dx": _s16(rec, 0x4a), "dy": _s16(rec, 0x4c),
                      "w": _s16(rec, 0x4e), "h": _s16(rec, 0x50)},
            "overBox": {"dx": _s16(rec, 0x5e), "dy": OVER_DY,
                        "w": _s16(rec, 0x60), "h": _s16(rec, 0x62)},
            "atlas": {"image": "%s/%s.png" % (PREFIX, stem), "data": "%s/%s.json" % (PREFIX, stem)},
        }
        out.append(record)
        atlas = _atlas(stem + ".SPR", palette, stem)
        with open(os.path.join(OUT_PNG, "%s.json" % stem), "w") as fh:
            json.dump(atlas, fh, separators=(",", ":"))

    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    print("%d hammers -> %s" % (len(out), OUT_JSON))


if __name__ == "__main__":
    main()
