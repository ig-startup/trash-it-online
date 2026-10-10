#!/bin/sh
# Decompile F.EXE, the front end, with every name we have, into one
# greppable C file — the same pipeline as scripts/ghidra/run.sh for G.EXE,
# reusing its Java scripts, with F.EXE's own symbol map.
#
#   scripts/ghidra/fexe/run.sh <work dir>      # writes <work dir>/decomp.c
#
# Then, to refresh the generated names (Miles wrappers, empty hooks):
#
#   python3 scripts/ghidra/fexe/symbols.py strings <work dir>/decomp.c
#
# and run again. The work dir must not sit under a directory whose name
# starts with a dot (analyzeHeadless refuses). About two minutes.
set -e

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$REPO/scripts/ghidra/fexe"
WORK=${1:?usage: run.sh <work dir>}
GHIDRA=${GHIDRA:-$HOME/.local/opt/ghidra}
export JAVA_HOME=${JAVA_HOME:-$HOME/.local/opt/jdk-21/Contents/Home}
EXE="$REPO/Trash-it-original/F.EXE"

mkdir -p "$WORK"
rm -rf "$WORK/proj"
mkdir -p "$WORK/proj"

python3 "$REPO/scripts/formats/export_flat.py" "$EXE" "$WORK/flat.bin"
python3 "$HERE/symbols.py" entries > "$WORK/entries.txt"
python3 "$HERE/symbols.py" table > "$WORK/symbols.tsv"

"$GHIDRA/support/analyzeHeadless" "$WORK/proj" front \
    -import "$WORK/flat.bin" \
    -processor x86:LE:32:default \
    -loader BinaryLoader -loader-baseAddr 0x10000 \
    -scriptPath "$REPO/scripts/ghidra" \
    -preScript MarkFunctions.java "$WORK/entries.txt" \
    -preScript ApplySymbols.java "$WORK/symbols.tsv" \
    -postScript DumpDecomp.java "$WORK/decomp.c" \
    > "$WORK/ghidra.log" 2>&1

grep -E "MarkFunctions:|ApplySymbols:|DumpDecomp:" "$WORK/ghidra.log"
python3 "$HERE/symbols.py" coverage "$WORK/decomp.c" 0
