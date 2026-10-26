"""
Export the game's sound effects: the samples of SFX/SBANK.0 and the 154
sound scripts G.EXE plays them through (docs/re/formats/sound.md).

A sound id indexes the script table at VA 0x95f9c; a script is a priority
and a list of ops — play a bank sample at a rate, wait, slide the pitch,
start another sound — that the game steps once a logic tick
(`sound_tick` 0x162c7 → `voice_effects_update` 0x167e5). The clone runs
the same scripts (client/src/audio/sfx.js), so the samples go out as they
are and the scripts as data:

    python3 scripts/export_sounds.py

Writes client/public/sounds/sfx_NN.wav and client/src/audio/sounds.json:
{samples: [{file, rate, loop}], scripts: [{priority, ops: [[op, ...args]]}],
front: {samples, scripts}}, the op numbers those of formats/sound.py OPS,
rates as unsigned Hz. `front` is F.EXE's own set — FSFX/SBANK.0, written
as fsfx_NN.wav, and its 60 scripts — for the screens outside a level.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts", "formats"))

import sound

ORIG = os.path.join(REPO, "Trash-it-original")
OUT_WAV = os.path.join(REPO, "client", "public", "sounds")
OUT_JSON = os.path.join(REPO, "client", "src", "audio", "sounds.json")
PREFIX = "sounds"

# ops whose second word is a rate in Hz, stored as a u16 by the game
RATE_OPS = {0, 17}


def export_set(folder, exe, prefix):
    """One bank and the scripts that play it → {samples, scripts}."""
    bank = sound.read_sbank(os.path.join(ORIG, folder, "SBANK.0"))
    scripts, loops = sound.read_scripts(os.path.join(ORIG, exe))

    samples = []
    for s in bank:
        name = "%s_%02d.wav" % (prefix, s["index"])
        sound.write_wav(os.path.join(OUT_WAV, name), s["data"], s["rate"],
                        s["bits"], s["channels"])
        entry = {"file": "%s/%s" % (PREFIX, name), "rate": s["rate"]}
        if s["index"] in loops:
            # bytes into the data → seconds, for the browser's loop points
            a, b = loops[s["index"]]
            per = s["rate"] * s["bits"] // 8
            entry["loop"] = [round(a / per, 5), round(b / per, 5)]
        samples.append(entry)

    out_scripts = []
    for s in scripts:
        ops = []
        for _, op, _, args in s["ops"]:
            args = list(args)
            if op in RATE_OPS and args[1] != -1:
                args[1] &= 0xffff
            ops.append([op] + args)
        out_scripts.append({"priority": s["priority"], "ops": ops})
    return {"samples": samples, "scripts": out_scripts}


def main():
    os.makedirs(OUT_WAV, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    game = export_set("SFX", "G.EXE", "sfx")
    front = export_set("FSFX", "F.EXE", "fsfx")
    with open(OUT_JSON, "w") as f:
        json.dump(dict(game, front=front), f, separators=(",", ":"))
    for name, d in (("game", game), ("front", front)):
        print("%s: %d samples → %s, %d scripts → %s" % (
            name, len(d["samples"]), os.path.relpath(OUT_WAV, REPO),
            len(d["scripts"]), os.path.relpath(OUT_JSON, REPO)))


if __name__ == "__main__":
    main()
