"""
DOS/4GW LE executable loader — how G.EXE was read.

The Trash It binaries (G.EXE the game, F.EXE the editor) are Watcom
32-bit protected-mode programs: a small DOS stub followed by a Linear
Executable (LE) image at `e_lfanew`. A disassembler pointed at the raw
file sees the stub and then garbage, which is why the first
reverse-engineering pass could not resolve string -> function xrefs.

This module maps the LE image the way DOS/4GW does — object table,
page map, and, crucially, the relocation fixups — so that 32-bit
absolute addresses (string pointers, jump tables, globals) read
correctly and can be cross-referenced.

    from le_loader import LE
    le = LE("Trash-it-original/G.EXE")
    le.va_read(0x90852, 16)     # -> b'SPR\\%s.SPR\x00...'

Pair it with a disassembler (capstone, CS_ARCH_X86 / CS_MODE_32) over
`le.objects[0]["mem"]` based at `le.objects[0]["base"]`.
"""
import struct, sys

class LE:
    def __init__(self, path):
        self.raw = open(path, 'rb').read()
        d = self.raw
        # find LE header
        off = struct.unpack_from('<I', d, 0x3c)[0]
        if d[off:off+2] != b'LE':
            raise SystemExit('no LE header at e_lfanew')
        self.h = off
        g = lambda o: struct.unpack_from('<I', d, off+o)[0]
        gw = lambda o: struct.unpack_from('<H', d, off+o)[0]
        self.mpages    = g(0x14)
        self.startobj  = g(0x18)
        self.eip       = g(0x1c)
        self.stackobj  = g(0x20)
        self.esp       = g(0x24)
        self.pagesize  = g(0x28)
        self.lastpage  = g(0x2c)   # LE: bytes on last page
        self.fixupsize = g(0x30)
        self.objtab    = g(0x40)
        self.objcnt    = g(0x44)
        self.objmap    = g(0x48)
        self.itermap   = g(0x4c)
        self.fpagetab  = g(0x68)
        self.frectab   = g(0x6c)
        self.datapage  = g(0x80)   # file-relative
        self.objects = []
        for i in range(self.objcnt):
            o = off + self.objtab + i*24
            size, base, flags, pmap, msize, _r = struct.unpack_from('<6I', d, o)
            self.objects.append(dict(idx=i+1, size=size, base=base, flags=flags,
                                     pmap=pmap, msize=msize))
        # page map: LE = 4 bytes, 24-bit big-endian page number + flags byte
        self.pagemap = []
        for i in range(self.mpages):
            b = d[off+self.objmap + i*4: off+self.objmap + i*4 + 4]
            num = (b[0] << 16) | (b[1] << 8) | b[2]
            self.pagemap.append((num, b[3]))
        self._build()

    def _page_file_off(self, entry_index):
        """entry_index is 0-based index into page map."""
        num, flags = self.pagemap[entry_index]
        return self.datapage + (num - 1) * self.pagesize, flags

    def _build(self):
        # flat image per object, contiguous virtual space
        self.mem = {}   # obj idx -> bytearray
        for o in self.objects:
            buf = bytearray(((o['size'] + 0xfff) // 0x1000) * 0x1000)
            for k in range(o['msize']):
                ei = o['pmap'] - 1 + k
                fo, flags = self._page_file_off(ei)
                n = self.pagesize
                if ei == self.mpages - 1 and self.lastpage:
                    n = self.lastpage
                chunk = self.raw[fo:fo+n]
                buf[k*self.pagesize: k*self.pagesize + len(chunk)] = chunk
            o['mem'] = buf
            self.mem[o['idx']] = buf
        self.fixups = self._fixups()

    def _fixups(self):
        d, off = self.raw, self.h
        n = self.mpages
        ptab = off + self.fpagetab
        offs = [struct.unpack_from('<I', d, ptab + i*4)[0] for i in range(n+1)]
        applied = 0
        recs = []
        for pi in range(n):
            start, end = off + self.frectab + offs[pi], off + self.frectab + offs[pi+1]
            p = start
            # which object owns this page (page map index pi)
            owner = None
            for o in self.objects:
                if o['pmap'] - 1 <= pi < o['pmap'] - 1 + o['msize']:
                    owner = o; break
            page_in_obj = pi - (owner['pmap'] - 1) if owner else 0
            while p < end:
                src = d[p]; flags = d[p+1]; p += 2
                srclist = bool(src & 0x20)
                stype = src & 0x0f
                if srclist:
                    cnt = d[p]; p += 1
                    srcoffs = None
                else:
                    srcoffs = [struct.unpack_from('<h', d, p)[0]]; p += 2
                    cnt = 1
                ttype = flags & 3
                if ttype == 0:      # internal
                    if flags & 0x40:
                        obj = struct.unpack_from('<H', d, p)[0]; p += 2
                    else:
                        obj = d[p]; p += 1
                    if stype == 2:  # 16-bit selector only, no offset
                        trg = 0
                    elif flags & 0x10:
                        trg = struct.unpack_from('<I', d, p)[0]; p += 4
                    else:
                        trg = struct.unpack_from('<H', d, p)[0]; p += 2
                    target = self.objects[obj-1]['base'] + trg
                else:
                    # imported / entry-table: skip fields
                    if flags & 0x40: p += 2
                    else: p += 1
                    if ttype in (1,):
                        p += 1 if (flags & 0x80) else (4 if (flags & 0x10) else 2)
                    elif ttype == 2:
                        p += 4 if (flags & 0x10) else 2
                    elif ttype == 3:
                        p += 4 if (flags & 0x10) else 2
                    if flags & 0x04:
                        p += 4 if (flags & 0x20) else 2
                    target = None
                if srclist:
                    srcoffs = []
                    for _ in range(cnt):
                        srcoffs.append(struct.unpack_from('<h', d, p)[0]); p += 2
                if flags & 0x04 and ttype == 0:
                    p += 4 if (flags & 0x20) else 2
                if target is None or owner is None:
                    continue
                for so in srcoffs:
                    pos = page_in_obj * self.pagesize + so
                    if stype == 7 and 0 <= pos <= len(owner['mem']) - 4:
                        struct.pack_into('<I', owner['mem'], pos, target & 0xffffffff)
                        applied += 1
                    recs.append((owner['idx'], pos, stype, target))
        self.nfix = applied
        return recs

    def va_read(self, va, n):
        for o in self.objects:
            if o['base'] <= va < o['base'] + len(o['mem']):
                p = va - o['base']
                return bytes(o['mem'][p:p+n])
        return b''

if __name__ == '__main__':
    le = LE(sys.argv[1])
    print(f'pages={le.mpages} pagesize={le.pagesize} lastpage={le.lastpage} '
          f'datapage=0x{le.datapage:x} objcnt={le.objcnt}')
    print(f'entry: obj{le.startobj} eip=0x{le.eip:x} -> VA 0x{le.objects[le.startobj-1]["base"]+le.eip:x}')
    for o in le.objects:
        print(f'  obj{o["idx"]}: base=0x{o["base"]:08x} vsize=0x{o["size"]:x} '
              f'flags=0x{o["flags"]:x} pages={o["msize"]}')
    seq = all(le.pagemap[i][0] == i+1 for i in range(le.mpages))
    print('page map sequential:', seq)
    print('fixups applied (off32):', le.nfix, 'records:', len(le.fixups))
