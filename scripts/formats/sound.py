"""
Trash It's sound: the sample banks, the music, and the sound scripts.

Three kinds of file, all read by the Miles Sound System (MSS 3.x) that
G.EXE and F.EXE link (README.md, "Sound"):

  SFX/SBANK.0, FSFX/SBANK.0   sample banks — a directory of (offset, size)
                              pairs, each pointing at a whole RIFF WAVE
                              file (plain PCM). SFX/ is the game's, FSFX/
                              the front end's (F.EXE).
  SFX/0A.WVL                  a Miles *wave library* — the instruments the
                              Miles wave synthesizer plays the music with
                              (32-byte entries: bank, patch, root key,
                              offset, size, format, flags, rate).
  SFX/0?.XMI                  the music, one file per section letter;
                              IFF: FORM XDIR / CAT XMID / FORM XMID
                              (TIMB, EVNT). Each file holds 3 sequences.

and the sound *scripts*, which are not in any file: G.EXE carries a table
of 154 of them (VA 0x95f9c); a sound id is an index into it, and a script
says which bank sample to play, at what rate, and how to move its pan and
pitch while it plays.

    python3 sound.py list    <file>             what is in it
    python3 sound.py export  <file> <out dir>   every sample → .wav,
                                                every XMI sequence → .mid
    python3 sound.py scripts <G.EXE>            the 154 sound scripts
    python3 sound.py xmi     <file.XMI>         the XMI events, as text

Pure stdlib (le_loader.py, next to this file, maps G.EXE for `scripts`).
"""
import os
import struct
import sys

# ── RIFF WAVE ───────────────────────────────────────────────────────────────


def parse_wav(w):
    """A RIFF WAVE image → dict(fmt, channels, rate, bits, data, name, ...)."""
    if w[:4] != b'RIFF' or w[8:12] != b'WAVE':
        raise ValueError('not a RIFF WAVE')
    out = {'riff_size': struct.unpack_from('<I', w, 4)[0] + 8, 'name': '',
           'software': '', 'date': '', 'smpl_loops': [], 'chunks': []}
    p = 12
    while p + 8 <= len(w):
        cid, cl = struct.unpack_from('<4sI', w, p)
        body = w[p + 8:p + 8 + cl]
        out['chunks'].append(cid.decode('latin-1'))
        if cid == b'fmt ':
            (out['fmt'], out['channels'], out['rate'], _, out['align'],
             out['bits']) = struct.unpack_from('<HHIIHH', body)
        elif cid == b'data':
            out['data'] = body
        elif cid == b'LIST' and body[:4] == b'INFO':
            q = 4
            while q + 8 <= len(body):
                sid, sl = struct.unpack_from('<4sI', body, q)
                s = body[q + 8:q + 8 + sl].split(b'\0')[0].decode('latin-1')
                key = {b'INAM': 'name', b'ISFT': 'software',
                       b'ICRD': 'date'}.get(sid)
                if key:
                    out[key] = s
                q += 8 + sl + (sl & 1)
        elif cid == b'smpl' and len(body) >= 36:
            n = struct.unpack_from('<I', body, 28)[0]
            for i in range(n):
                if 36 + 24 * (i + 1) <= len(body):
                    _, _, a, b, _, _ = struct.unpack_from('<6I', body,
                                                          36 + 24 * i)
                    out['smpl_loops'].append((a, b))
        p += 8 + cl + (cl & 1)
    return out


def write_wav(path, pcm, rate, bits, channels=1):
    """Plain PCM WAVE: 8-bit unsigned or 16-bit signed little-endian."""
    align = channels * bits // 8
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE')
        f.write(b'fmt ' + struct.pack('<IHHIIHH', 16, 1, channels, rate,
                                      rate * align, align, bits))
        f.write(b'data' + struct.pack('<I', len(pcm)) + pcm)
        if len(pcm) & 1:
            f.write(b'\0')


# ── SBANK.0 ─────────────────────────────────────────────────────────────────
#
# The directory is 0x800 bytes (256 slots) of { u32 offset, u32 size },
# offsets from the start of the file. G.EXE's reader (VA 0x16262) walks it
# until a slot's size has a zero low word and turns each offset into a
# pointer (table 0xce7bc); the pointer goes straight to
# AIL_set_sample_file, so every entry is a complete .WAV file image.


def read_sbank(path):
    d = open(path, 'rb').read()
    out = []
    for i in range(0x800 // 8):
        off, size = struct.unpack_from('<II', d, i * 8)
        if size & 0xffff == 0:          # the game's own end test
            break
        w = parse_wav(d[off:off + size])
        w.update(index=i, offset=off, size=size, kind='sbank')
        out.append(w)
    return out


# ── .WVL — Miles wave library ───────────────────────────────────────────────
#
# Fixed 32-byte entries from offset 0, ended by bank = -1 (the remaining
# slots up to the first sample are -1 too):
#   s32 bank, s32 patch, s32 root_key, u32 offset, u32 size,
#   s32 format (DIG_F_*: 0 mono 8, 1 mono 16, 2 stereo 8, 3 stereo 16),
#   u32 flags (DIG_PCM_SIGN 1, DIG_PCM_ORDER 2), s32 playback_rate
# This is the WAVE_ENTRY that AIL_create_wave_synthesizer takes.


def read_wvl(path):
    d = open(path, 'rb').read()
    out = []
    p = 0
    while p + 32 <= len(d):
        bank, patch, root, off, size, fmt, flags, rate = \
            struct.unpack_from('<iiiIIiIi', d, p)
        if bank == -1:
            break
        bits = 16 if fmt in (1, 3) else 8
        ch = 2 if fmt in (2, 3) else 1
        pcm = d[off:off + size]
        if bits == 8 and flags & 1:      # signed 8-bit → unsigned for WAV
            pcm = bytes((b + 128) & 0xff for b in pcm)
        if bits == 16 and not flags & 1:  # unsigned 16 → signed
            a = [((x + 0x8000) & 0xffff) for x in
                 struct.unpack('<%dH' % (len(pcm) // 2), pcm)]
            pcm = struct.pack('<%dH' % len(a), *a)
        out.append({'index': len(out), 'bank': bank, 'patch': patch,
                    'root_key': root, 'offset': off, 'size': size,
                    'dig_format': fmt, 'flags': flags, 'rate': rate,
                    'bits': bits, 'channels': ch, 'data': pcm, 'name': '',
                    'kind': 'wvl'})
        p += 32
    return out


# ── .XMI — Miles extended MIDI ──────────────────────────────────────────────


def _iff(d, p, end):
    """Big-endian IFF chunks in d[p:end] → [(id, body_start, body_end)]."""
    out = []
    while p + 8 <= end:
        cid = d[p:p + 4].decode('latin-1')
        n = struct.unpack_from('>I', d, p + 4)[0]
        out.append((cid, p + 8, p + 8 + n))
        p += 8 + n + (n & 1)
    return out


def read_xmi(path_or_bytes):
    """→ list of sequences: {'timbres': [(patch, bank)], 'evnt': bytes}."""
    d = path_or_bytes if isinstance(path_or_bytes, bytes) else \
        open(path_or_bytes, 'rb').read()
    seqs = []
    declared = None
    for cid, a, b in _iff(d, 0, len(d)):
        if cid == 'FORM' and d[a:a + 4] == b'XDIR':
            for sid, sa, sb in _iff(d, a + 4, b):
                if sid == 'INFO':
                    declared = struct.unpack_from('<H', d, sa)[0]
        elif cid == 'CAT ' and d[a:a + 4] == b'XMID':
            for fid, fa, fb in _iff(d, a + 4, b):
                if fid != 'FORM' or d[fa:fa + 4] != b'XMID':
                    continue
                seq = {'timbres': [], 'evnt': b''}
                for sid, sa, sb in _iff(d, fa + 4, fb):
                    if sid == 'TIMB':
                        n = struct.unpack_from('<H', d, sa)[0]
                        seq['timbres'] = [(d[sa + 2 + 2 * i],
                                           d[sa + 3 + 2 * i])
                                          for i in range(n)]
                    elif sid == 'EVNT':
                        seq['evnt'] = d[sa:sb]
                    elif sid == 'RBRN':
                        n = struct.unpack_from('<H', d, sa)[0]
                        seq['branches'] = [struct.unpack_from(
                            '<HI', d, sa + 2 + 6 * i) for i in range(n)]
                seqs.append(seq)
    if declared is not None and declared != len(seqs):
        raise ValueError('XDIR says %d sequences, found %d'
                         % (declared, len(seqs)))
    return seqs


def _vlq_read(d, p):
    v = 0
    while True:
        b = d[p]
        p += 1
        v = (v << 7) | (b & 0x7f)
        if not b & 0x80:
            return v, p


def _vlq(v):
    out = [v & 0x7f]
    v >>= 7
    while v:
        out.append(0x80 | (v & 0x7f))
        v >>= 7
    return bytes(reversed(out))


# XMIDI controllers with a meaning of their own (AIL 3 documentation).
XMI_CC = {0x6e: 'channel lock', 0x6f: 'channel lock protect',
          0x70: 'voice protect', 0x71: 'timbre protect',
          0x72: 'patch bank select', 0x73: 'indirect controller prefix',
          0x74: 'FOR loop (count, 0 = forever)', 0x75: 'NEXT/BREAK loop',
          0x76: 'clear beat/bar count', 0x77: 'callback trigger',
          0x78: 'sequence branch index'}


def xmi_events(evnt):
    """EVNT → [(tick, kind, payload)] in absolute 1/120 s ticks.

    XMIDI differs from SMF in two ways: the delay before an event is a run
    of bytes < 0x80 that are *summed* (not a VLQ), and a note-on carries
    its own duration (a VLQ after the velocity) instead of a note-off.
    There is no running status.
    """
    out = []
    t = 0
    p = 0
    n = len(evnt)
    while p < n:
        b = evnt[p]
        if b < 0x80:
            t += b
            p += 1
            continue
        st = b
        hi = st & 0xf0
        if st == 0xff:
            typ = evnt[p + 1]
            ln, q = _vlq_read(evnt, p + 2)
            out.append((t, 'meta', (typ, evnt[q:q + ln])))
            p = q + ln
            if typ == 0x2f:
                break
        elif st in (0xf0, 0xf7):
            ln, q = _vlq_read(evnt, p + 1)
            out.append((t, 'sysex', (st, evnt[q:q + ln])))
            p = q + ln
        elif hi == 0x90:
            key, vel = evnt[p + 1], evnt[p + 2]
            dur, p = _vlq_read(evnt, p + 3)
            out.append((t, 'note', (st & 15, key, vel, dur)))
        elif hi in (0xc0, 0xd0):
            out.append((t, 'ev', bytes(evnt[p:p + 2])))
            p += 2
        else:                           # 0x80 0xa0 0xb0 0xe0
            out.append((t, 'ev', bytes(evnt[p:p + 3])))
            p += 3
    return out


def xmi_to_midi(seq):
    """One XMI sequence → a type-0 Standard MIDI File (bytes).

    Division 60 at 500000 us/quarter = 120 ticks a second, the XMIDI
    clock, so ticks copy over unchanged. The XMI's own tempo events
    (FF 51) describe how it was authored; Miles plays at the fixed 120 Hz
    regardless, so they are dropped (kept as text). Note durations become
    note-offs. XMIDI controllers (FOR/NEXT loops 116/117, bank select
    114 …) are written as they are; a plain MIDI player ignores them.
    """
    ev = []                             # (tick, order, bytes)
    order = 0
    for t, kind, x in xmi_events(seq['evnt']):
        order += 1
        if kind == 'note':
            ch, key, vel, dur = x
            ev.append((t, order, bytes((0x90 | ch, key, vel))))
            ev.append((t + dur, -1, bytes((0x80 | ch, key, 0))))
        elif kind == 'ev':
            ev.append((t, order, x))
        elif kind == 'meta':
            typ, data = x
            if typ == 0x2f:
                continue
            if typ == 0x51:
                txt = ('XMI tempo %d' % int.from_bytes(data, 'big')).encode()
                ev.append((t, order, b'\xff\x01' + _vlq(len(txt)) + txt))
                continue
            ev.append((t, order, b'\xff' + bytes((typ,)) + _vlq(len(data))
                       + data))
        elif kind == 'sysex':
            st, data = x
            ev.append((t, order, bytes((st,)) + _vlq(len(data)) + data))
    # note-offs before note-ons at the same tick
    ev.sort(key=lambda e: (e[0], e[1]))
    trk = bytearray(b'\x00\xff\x51\x03' + (500000).to_bytes(3, 'big'))
    last = 0
    for t, _, b in ev:
        trk += _vlq(t - last) + b
        last = t
    trk += b'\x00\xff\x2f\x00'
    return (b'MThd' + struct.pack('>IHHH', 6, 0, 1, 60) +
            b'MTrk' + struct.pack('>I', len(trk)) + bytes(trk))


def describe_xmi(seq):
    evs = xmi_events(seq['evnt'])
    end = max((t + (x[3] if k == 'note' else 0)) for t, k, x in evs) \
        if evs else 0
    chans = sorted({x[0] for t, k, x in evs if k == 'note'})
    notes = sum(1 for e in evs if e[1] == 'note')
    loops = [(t, x[1], x[2]) for t, k, x in evs
             if k == 'ev' and x[0] & 0xf0 == 0xb0 and x[1] in (0x74, 0x75)]
    tempos = [int.from_bytes(x[1], 'big') for t, k, x in evs
              if k == 'meta' and x[0] == 0x51]
    return {'ticks': end, 'seconds': end / 120.0, 'notes': notes,
            'channels': [c + 1 for c in chans], 'loops': loops,
            'tempos': tempos}


# ── the sound scripts in G.EXE ──────────────────────────────────────────────
#
# A sound id indexes the pointer table at VA 0x95f9c (154 entries; the
# game is handed the table by load_sound_bank, VA 0x2e8cb). A script is
# little-endian 16-bit words: first a priority, then opcodes, run by the
# interpreter at VA 0x1631c through the handler table at VA 0x9641c.
# Every op advances the script; the ones marked "yield" end the voice's
# turn for this 60 Hz tick. Lengths below are in words, opcode included.

SCRIPT_TABLE = 0x95f9c
SCRIPT_COUNT = 154
LOOP_TABLE = 0x96204        # per bank sample: (s32 start, s32 end) bytes
OPS = {
    0: ('play', 5, 'sample, rate (-1 = file rate), -, -'),
    1: ('stop_sample', 1, ''),
    2: ('wait', 2, 'ticks  (yield)'),
    3: ('rate', 2, 'Hz'),
    4: ('lr', 3, 'left, right  (pan weights)'),
    5: ('pan_sweep', 6, 'phase, step(sign = direction), min, max, ticks'),
    6: ('pitch_slide', 4, 'step Hz, steps, every n ticks'),
    7: ('vibrato', 3, 'depth Hz, period ticks'),
    8: ('pitch_slide_off', 1, ''),
    9: ('vibrato_off', 1, ''),
    10: ('end', 1, '(yield, frees the voice)'),
    11: ('sound', 2, 'start another sound id'),
    12: ('nop', 1, ''),
    13: ('nop', 1, ''),
    14: ('skip', 6, '(five words ignored)'),
    15: ('lr_wobble', 7, 'Lmin, Lmax, Rmin, Rmax, Lstep, Rstep'),
    16: ('lr_wobble_off', 1, ''),
    17: ('play_rand', 7, 'sample, rate, -, -, rate_mask, -  '
                         '(rate + (random & mask))'),
    18: ('rate_jitter', 3, 'mask, every n ticks'),
    19: ('rate_jitter_off', 1, ''),
    20: ('wait_rand', 3, 'ticks, mask  (yield; ticks + (random & mask))'),
}


def read_scripts(exe_path):
    """→ [{'id', 'va', 'priority', 'ops': [(va, op, name, args)]}],
    plus the loop table, from G.EXE."""
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    from le_loader import LE
    le = LE(exe_path)

    def w(va):
        return struct.unpack('<h', le.va_read(va, 2))[0]

    ptrs = struct.unpack('<%dI' % SCRIPT_COUNT,
                         le.va_read(SCRIPT_TABLE, 4 * SCRIPT_COUNT))
    scripts = []
    for sid, va in enumerate(ptrs):
        s = {'id': sid, 'va': va, 'priority': w(va), 'ops': []}
        p = va + 2
        for _ in range(200):
            op = w(p)
            if op not in OPS:
                s['ops'].append((p, op, '?', []))
                break
            name, n, _ = OPS[op]
            args = [w(p + 2 * i) for i in range(1, n)]
            s['ops'].append((p, op, name, args))
            p += 2 * n
            if op == 10:
                break
        scripts.append(s)
    raw = le.va_read(LOOP_TABLE, 8 * 67)
    loops = {i: struct.unpack_from('<ii', raw, 8 * i) for i in range(67)
             if struct.unpack_from('<ii', raw, 8 * i) != (0, 0)}
    return scripts, loops


def script_text(s):
    parts = []
    for va, op, name, args in s['ops']:
        if op == 0:
            parts.append('play %d @%s' % (args[0],
                                          'file' if args[1] == -1 else args[1]))
        elif op == 17:
            parts.append('play %d @%d+rnd&%d' % (args[0], args[1], args[4]))
        elif op == 10:
            parts.append('end')
        else:
            parts.append(name + ('(' + ','.join(map(str, args)) + ')'
                                 if args else ''))
    return '; '.join(parts)


# ── the command line ────────────────────────────────────────────────────────


def _kind(path):
    b = os.path.basename(path).upper()
    if b.endswith('.XMI'):
        return 'xmi'
    if b.endswith('.WVL'):
        return 'wvl'
    if b.startswith('SBANK'):
        return 'sbank'
    if b.endswith('.EXE'):
        return 'exe'
    raise SystemExit('unknown file kind: ' + path)


def _samples(path):
    return read_sbank(path) if _kind(path) == 'sbank' else read_wvl(path)


def cmd_list(path):
    k = _kind(path)
    if k == 'xmi':
        seqs = read_xmi(path)
        print('%s: %d sequences' % (path, len(seqs)))
        for i, s in enumerate(seqs):
            dsc = describe_xmi(s)
            print('  seq %d  %6.1f s  %4d notes  channels %s  timbres %s'
                  % (i, dsc['seconds'], dsc['notes'], dsc['channels'],
                     ['%d/%d' % (pt, bk) for pt, bk in s['timbres']]))
            if dsc['loops'] or dsc['tempos']:
                print('          loops %s  tempo events %s'
                      % (dsc['loops'], sorted(set(dsc['tempos']))))
        return
    if k == 'exe':
        return cmd_scripts(path)
    ss = _samples(path)
    total = 0
    print('%s: %d samples' % (path, len(ss)))
    for s in ss:
        n = len(s['data']) // (s['bits'] // 8) // s['channels']
        total += n / s['rate']
        extra = ''
        if k == 'wvl':
            extra = 'bank %d patch %d root %d fmt %d flags %d' % (
                s['bank'], s['patch'], s['root_key'], s['dig_format'],
                s['flags'])
        else:
            extra = ' '.join(x for x in (s['name'], s['date'],
                                         'smpl%s' % s['smpl_loops']
                                         if s['smpl_loops'] else '') if x)
        print('  %3d  @%#08x %7d B  %5d Hz %2d-bit %s  %6.3f s  %s'
              % (s['index'], s['offset'], s['size'], s['rate'], s['bits'],
                 'mono' if s['channels'] == 1 else 'stereo',
                 n / s['rate'], extra))
    print('  total %.1f s' % total)


def cmd_export(path, out):
    os.makedirs(out, exist_ok=True)
    base = os.path.basename(path).replace('.', '_')
    k = _kind(path)
    if k == 'xmi':
        for i, s in enumerate(read_xmi(path)):
            fn = os.path.join(out, '%s_seq%d.mid' % (base, i))
            open(fn, 'wb').write(xmi_to_midi(s))
            print(fn)
        return
    for s in _samples(path):
        tag = ('_' + s['name'].split('.')[0]) if s['name'] else ''
        fn = os.path.join(out, '%s_%03d%s.wav' % (base, s['index'], tag))
        write_wav(fn, s['data'], s['rate'], s['bits'], s['channels'])
        print(fn)


def cmd_scripts(exe):
    scripts, loops = read_scripts(exe)
    print('sound scripts (G.EXE VA %#x), priority then ops; '
          'sample = SFX/SBANK.0 entry' % SCRIPT_TABLE)
    for s in scripts:
        print('  %#04x %3d  @%#x  pri %5d  %s' % (s['id'], s['id'], s['va'],
                                                s['priority'],
                                                script_text(s)))
    print('looped samples (AIL_set_sample_loop_block, bytes into data):')
    for i, (a, b) in sorted(loops.items()):
        print('  sample %d  %d..%d' % (i, a, b))


def cmd_xmi(path):
    for i, s in enumerate(read_xmi(path)):
        print('== sequence %d  timbres %s' % (i, s['timbres']))
        for t, k, x in xmi_events(s['evnt']):
            if k == 'note':
                print('%6d  ch%-2d note %3d vel %3d dur %d' % (t, x[0] + 1,
                                                              x[1], x[2], x[3]))
            elif k == 'ev':
                st = x[0]
                desc = ''
                if st & 0xf0 == 0xb0:
                    desc = XMI_CC.get(x[1], '')
                print('%6d  ch%-2d %s %s' % (t, (st & 15) + 1, x.hex(), desc))
            else:
                print('%6d  %s %s' % (t, k, x))


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    cmd = argv[1]
    if cmd == 'list':
        cmd_list(argv[2])
    elif cmd == 'export' and len(argv) >= 4:
        cmd_export(argv[2], argv[3])
    elif cmd == 'scripts':
        cmd_scripts(argv[2])
    elif cmd == 'xmi':
        cmd_xmi(argv[2])
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
