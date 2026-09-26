"""Tiny dependency-free PNG writer used by the format decoders/demos.

Not a Trash It format — just a helper so demo_render.py doesn't need
Pillow installed. Writes 8-bit RGB or RGBA PNGs from flat pixel lists.
"""
import struct
import zlib


def _chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))


def write_rgb(path, w, h, rgb_pixels):
    """rgb_pixels: flat list/bytes of length w*h, each entry an (r,g,b) tuple."""
    rows = []
    for y in range(h):
        row = bytearray([0])  # filter type 0 (none)
        for x in range(w):
            r, g, b = rgb_pixels[y * w + x]
            row += bytes([r, g, b])
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # color type 2 = RGB
    idat = zlib.compress(raw, 9)
    sig = b"\x89PNG\r\n\x1a\n"
    with open(path, "wb") as f:
        f.write(sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))


def write_rgba(path, w, h, rgba_pixels):
    """rgba_pixels: flat list of length w*h, each entry an (r,g,b,a) tuple."""
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            r, g, b, a = rgba_pixels[y * w + x]
            row += bytes([r, g, b, a])
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # color type 6 = RGBA
    idat = zlib.compress(raw, 9)
    sig = b"\x89PNG\r\n\x1a\n"
    with open(path, "wb") as f:
        f.write(sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))


def indices_to_rgb(indices, palette):
    return [palette[i] for i in indices]


def indices_to_rgba(indices, palette, transparent_index=0):
    out = []
    for i in indices:
        r, g, b = palette[i]
        a = 0 if i == transparent_index else 255
        out.append((r, g, b, a))
    return out
