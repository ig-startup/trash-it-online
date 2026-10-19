"""
Trash It (1997 DOS) — F.EXE's screen files, `PROJ/*.DAT`.

CONFIDENCE: confirmed, from the reader (F.EXE VA 0x26db1) and by all 37
files parsing to the byte. See docs/re/front/proj-dat.md.

Layout
------

    u16  sheet count
    u16  rectangle count (the tail)
    sheet count x:
        char[14]  file name, NUL-terminated (bytes past the NUL are junk)
        i16       frame count
        i16       slot (index into F.EXE's sprite table, 0x8e5dc, 0x58 each)
        frame count x:
            0xff, 0, i16 x, i16 y, i16 w, i16 h    (10 bytes)
            0xfe, 0, i16 w, i16 h                  (6 bytes)
    rectangle count x: i16 x, i16 y, i16 w, i16 h

F.EXE uses only the names and the slots; it steps over the frames and
never reads the tail.

    python3 scripts/formats/projdat.py Trash-it-original/PROJ/LVSL1_E.DAT
"""
import struct
import sys


def decode(path):
    """
    -> {"sheets": [{"name", "slot", "frames": [(x, y, w, h) or (w, h)]}],
        "rects": [(x, y, w, h)]}
    """
    with open(path, "rb") as fh:
        data = fh.read()
    sheets_n, rects_n = struct.unpack_from("<HH", data)
    p = 4
    sheets = []
    for _ in range(sheets_n):
        name = data[p:p + 14].split(b"\0")[0].decode("latin-1")
        count, slot = struct.unpack_from("<hh", data, p + 14)
        p += 18
        frames = []
        for _ in range(count):
            kind = data[p]
            if kind == 0xff:
                frames.append(struct.unpack_from("<4h", data, p + 2))
                p += 10
            elif kind == 0xfe:
                frames.append(struct.unpack_from("<2h", data, p + 2))
                p += 6
            else:
                # F.EXE logs "Invalid type detected" here
                raise ValueError("%s: frame type 0x%02x at 0x%x" % (path, kind, p))
        sheets.append({"name": name, "slot": slot, "frames": frames})
    rects = [struct.unpack_from("<4h", data, p + 8 * i) for i in range(rects_n)]
    p += 8 * rects_n
    if p != len(data):
        raise ValueError("%s: %d bytes left over" % (path, len(data) - p))
    return {"sheets": sheets, "rects": rects}


if __name__ == "__main__":
    for path in sys.argv[1:]:
        d = decode(path)
        print(path)
        for s in d["sheets"]:
            print("  %-14s slot %3d  %3d frames  %s" % (
                s["name"], s["slot"], len(s["frames"]), s["frames"][:2]))
        for r in d["rects"]:
            print("  rect", r)
