"""
Export the level music: the phrases of SFX/0A.WVL and the sequences of
an .XMI (docs/re/formats/sound.md).

The music is phrases, not notes: Miles' wave synthesizer plays a wave
library patch for each note, at the patch's own pitch when the key is
its root. So the patches go out as they are and each sequence as a note
list the clone schedules itself (client/src/audio/music.js):

    python3 scripts/export_music.py

Writes client/public/sounds/music_pN.wav and client/src/audio/music.json:
{patches: [{file, root}], tunes: [{notes: [[tick, patch, key, gain, dur]],
loop: [from, to], end}]}, ticks at XMIDI's 120 Hz, gain the note's
velocity times its channel's volume (controller 7), both of 127.

Only 0A.XMI: G.EXE loads "0a.WVL" for every section (audio_init 0x16cc7),
and this copy's 0A.WVL has the 8 patches 0A.XMI uses but not the 8-15
the other sections' tunes ask for — see the note.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import sound

ORIG = os.path.join(REPO, "Trash-it-original")
OUT_WAV = os.path.join(REPO, "client", "public", "sounds")
OUT_JSON = os.path.join(REPO, "client", "src", "audio", "music.json")
PREFIX = "sounds"
TUNE = "0A"

FOR, NEXT = 0x74, 0x75          # XMIDI loop controllers


def tune(seq):
    prog, vol = {}, {}
    notes, loop_from, loop_to, end = [], None, None, 0
    for t, kind, x in sound.xmi_events(seq["evnt"]):
        if kind == "ev" and x[0] & 0xf0 == 0xc0:
            prog[x[0] & 15] = x[1]
        elif kind == "ev" and x[0] & 0xf0 == 0xb0:
            if x[1] == 7:
                vol[x[0] & 15] = x[2]
            elif x[1] == FOR and loop_from is None:
                loop_from = t
            elif x[1] == NEXT:
                loop_to = t
        elif kind == "note":
            ch, key, vel, dur = x
            gain = round(vel * vol.get(ch, 127) / (127 * 127), 4)
            notes.append([t, prog.get(ch, 0), key, gain, dur])
        elif kind == "meta" and x[0] == 0x2f:
            end = t
    out = {"notes": notes, "end": end}
    if loop_from is not None and loop_to is not None:
        out["loop"] = [loop_from, loop_to]
    return out


def main():
    os.makedirs(OUT_WAV, exist_ok=True)
    patches = []
    for p in sound.read_wvl(os.path.join(ORIG, "SFX", "0A.WVL")):
        name = "music_p%d.wav" % p["patch"]
        sound.write_wav(os.path.join(OUT_WAV, name), p["data"], p["rate"],
                        p["bits"], p["channels"])
        patches.append({"file": "%s/%s" % (PREFIX, name),
                        "root": p["root_key"]})
    seqs = sound.read_xmi(os.path.join(ORIG, "SFX", TUNE + ".XMI"))
    tunes = [tune(s) for s in seqs]
    for t in tunes:
        missing = {n[1] for n in t["notes"]} - set(range(len(patches)))
        if missing:
            raise SystemExit("%s asks for patches %s" % (TUNE, sorted(missing)))
    with open(OUT_JSON, "w") as f:
        json.dump({"patches": patches, "tunes": tunes}, f,
                  separators=(",", ":"))
    print("%d patches → %s, %s's %d tunes → %s" % (
        len(patches), os.path.relpath(OUT_WAV, REPO), TUNE, len(tunes),
        os.path.relpath(OUT_JSON, REPO)))


if __name__ == "__main__":
    main()
