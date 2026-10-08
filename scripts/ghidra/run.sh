#!/bin/sh
# Decompile G.EXE with every name we have, into one greppable C file.
#
#   scripts/ghidra/run.sh <work dir>      # writes <work dir>/decomp.c
#
# Needs Ghidra and a JDK (see scripts/formats/README.md, "Reading G.EXE in
# Ghidra"); GHIDRA and JAVA_HOME default to where they were installed here.
# The work dir must not sit under a directory whose name starts with a
# dot — analyzeHeadless refuses such paths. About two minutes.
set -e

REPO=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${1:?usage: run.sh <work dir>}
GHIDRA=${GHIDRA:-$HOME/.local/opt/ghidra}
export JAVA_HOME=${JAVA_HOME:-$HOME/.local/opt/jdk-21/Contents/Home}
EXE="$REPO/Trash-it-original/G.EXE"

mkdir -p "$WORK"
rm -rf "$WORK/proj"
mkdir -p "$WORK/proj"

python3 "$REPO/scripts/formats/export_flat.py" "$EXE" "$WORK/flat.bin"
python3 "$REPO/scripts/ghidra/symbols.py" entries > "$WORK/entries.txt"
python3 "$REPO/scripts/ghidra/symbols.py" table > "$WORK/symbols.tsv"

"$GHIDRA/support/analyzeHeadless" "$WORK/proj" trashit \
    -import "$WORK/flat.bin" \
    -processor x86:LE:32:default \
    -loader BinaryLoader -loader-baseAddr 0x10000 \
    -scriptPath "$REPO/scripts/ghidra" \
    -preScript MarkFunctions.java "$WORK/entries.txt" \
    -preScript ApplySymbols.java "$WORK/symbols.tsv" \
    -postScript DumpDecomp.java "$WORK/decomp.c" \
    > "$WORK/ghidra.log" 2>&1

grep -E "MarkFunctions:|ApplySymbols:|DumpDecomp:" "$WORK/ghidra.log"
python3 "$REPO/scripts/ghidra/symbols.py" coverage "$WORK/decomp.c" 0
