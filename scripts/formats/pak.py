"""
Trash It (1997 DOS) — .PAK: an RNC ProPack (method 2) compressed file.

CONFIDENCE: confirmed. F.EXE logs `"failed to 'unpropack()' RNC buffer
%x"` (string at VA 0x800e8) and every .PAK starts with the RNC magic.
This decoder unpacks all ten FSPR/*.PAK files and each result matches
the CRC-16 stored in its header, so the decode is byte-exact.

Header (18 bytes, BIG-endian — RNC came from the Amiga):

    0   "RNC"      magic
    3   u8         method (always 2 here)
    4   u32        unpacked size
    8   u32        packed size (file size - 18)
    12  u16        CRC-16 of the unpacked data
    14  u16        CRC-16 of the packed data
    16  u8         leeway (in-place decode slack; unused here)
    17  u8         pack chunk count

Method 2 is an LZ77 variant over one bit stream that shares the byte
stream with literals: control bits are pulled MSB-first a byte at a
time, literal bytes and the low byte of every offset are taken straight
from the byte stream in between. The CRC is the reflected CRC-16 with
polynomial 0xA001 (the "ARC" CRC), seed 0.

What the PAKs contain:

    LVSPAT1..9.PAK   307200 bytes = 640x480 8-bit, but not a picture:
                     0 is empty, 255 draws the paths of level-select
                     screen 1..9, and single pixels 1..N (13..32 per
                     screen) number points along them. What the numbers
                     mean -- levels or just waypoints -- is for F.EXE to
                     say; 201 points against 147 levels says not one
                     point per level. (Loaded next to lvsl<N>_e.dat.)
    WARNING.PAK      327700 bytes = 20-byte header + 640x256 16-bit
                     RGB555 pixels: the anti-piracy warning screen.
                     Header, five u32: 16 (bits per pixel), 2 (bytes
                     per pixel), 0x0005000c (unread), 0, then u16 width
                     640 and u16 height 256.

CLI:
    python3 pak.py FILE.PAK                 header + CRC check
    python3 pak.py FILE.PAK out.bin         write the unpacked bytes
    python3 pak.py FILE.PAK out.png [PAL]   render: a 16-bit image as is,
                                            an 8-bit one 640 wide (paths
                                            white, numbered points red)
"""
import struct
import sys


def crc16(data):
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
        table.append(c)
    crc = 0
    for b in data:
        crc = table[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc


def header(buf):
    if buf[:3] != b"RNC":
        raise ValueError("not an RNC file")
    method = buf[3]
    usize, psize, ucrc, pcrc, leeway, chunks = struct.unpack_from(
        ">IIHHBB", buf, 4)
    return dict(method=method, unpacked=usize, packed=psize,
                unpacked_crc=ucrc, packed_crc=pcrc, leeway=leeway,
                chunks=chunks)


class _M2:
    def __init__(self, src, pos):
        self.src = src
        self.pos = pos
        self.buf = 0
        self.cnt = 0

    def byte(self):
        b = self.src[self.pos]
        self.pos += 1
        return b

    def bit(self):
        if self.cnt == 0:
            self.buf = self.byte()
            self.cnt = 8
        b = (self.buf >> 7) & 1
        self.buf = (self.buf << 1) & 0xFF
        self.cnt -= 1
        return b

    def bits(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | self.bit()
        return v


def _unpack_m2(src, usize):
    s = _M2(src, 18)
    out = bytearray()
    s.bits(2)                       # lock flag + key flag
    while len(out) < usize:
        if not s.bit():             # 0: literal byte
            out.append(s.byte())
            continue
        if not s.bit():             # 10: count 4..9, or a literal run
            count = 4 + s.bit()
            if s.bit():
                count = ((count - 1) << 1) + s.bit()
            if count == 9:
                n = (s.bits(4) << 2) + 12
                out += src[s.pos:s.pos + n]
                s.pos += n
                continue
            offset = _offset(s)
        elif not s.bit():           # 110: count 2, short offset
            count = 2
            offset = s.byte() + 1
        else:
            if s.bit():             # 1111: long count (or chunk end)
                count = s.byte() + 8
                if count == 8:
                    s.bit()         # 1 = another chunk follows
                    continue
            else:                   # 1110: count 3
                count = 3
            offset = _offset(s)
        start = len(out) - offset
        if start < 0:
            raise ValueError("RNC: offset before start of output")
        for i in range(count):
            out.append(out[start + i])
    return bytes(out[:usize])


def _offset(s):
    off = 0
    if s.bit():
        off = s.bit()
        if s.bit():
            off = ((off << 1) | s.bit()) | 4
            if not s.bit():
                off = (off << 1) | s.bit()
        elif off == 0:
            off = s.bit() + 2
    return ((off << 8) | s.byte()) + 1


def unpack(buf, check=True):
    h = header(buf)
    if h["method"] != 2:
        raise ValueError("RNC method %d not supported" % h["method"])
    out = _unpack_m2(buf, h["unpacked"])
    if check and crc16(out) != h["unpacked_crc"]:
        raise ValueError("RNC: CRC mismatch (%04x != %04x)"
                         % (crc16(out), h["unpacked_crc"]))
    return out


def load(path):
    return unpack(open(path, "rb").read())


def image(out):
    """A 16-bit image (WARNING.PAK) as (w, h, rgb pixels); None otherwise."""
    if len(out) < 20:
        return None
    bpp, _, _, _ = struct.unpack_from("<4I", out, 0)
    w, h = struct.unpack_from("<2H", out, 16)
    if bpp != 16 or 20 + w * h * 2 != len(out):
        return None
    px = []
    for (v,) in struct.iter_unpack("<H", out[20:]):
        px.append((((v >> 10) & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31,
                   (v & 31) * 255 // 31))
    return w, h, px


def _main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    buf = open(argv[1], "rb").read()
    h = header(buf)
    out = unpack(buf)
    print("%s: method %d, %d -> %d bytes, crc %04x OK, chunks %d"
          % (argv[1], h["method"], h["packed"], h["unpacked"],
             h["unpacked_crc"], h["chunks"]))
    if len(argv) >= 3 and not argv[2].lower().endswith(".png"):
        open(argv[2], "wb").write(out)
    elif len(argv) >= 3:
        from _png import write_rgb
        img = image(out)
        if img:
            write_rgb(argv[2], *img)
        else:
            w = 640
            h_ = len(out) // w
            write_rgb(argv[2], w, h_, [(0, 0, 0) if v == 0 else
                                       (255, 255, 255) if v == 255 else
                                       (255, 0, 0) for v in out[:w * h_]])
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
