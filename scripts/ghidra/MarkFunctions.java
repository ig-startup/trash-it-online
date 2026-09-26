// Seed a raw-binary import with the function entry points we already know.
//
// The image is loaded as a flat binary (see export_flat.py), so Ghidra has
// no symbols, no sections and no idea which bytes are code — auto-analysis
// alone finds close to nothing. It does not have to guess: a capstone sweep
// already gives every direct call target in the image, and the game's own
// object-class registry gives 47 constructors. This script reads that list,
// disassembles at each address and declares a function there, which is
// enough for auto-analysis and the decompiler to take over.
//
// The address file is one hex virtual address per line, no prefix.
//
//   analyzeHeadless <proj> <name> -import flat.bin \
//       -processor x86:LE:32:default \
//       -loader BinaryLoader -loader-baseAddr 0x10000 \
//       -scriptPath scripts/ghidra \
//       -preScript MarkFunctions.java entries.txt
//
//@category TrashIt

import java.io.BufferedReader;
import java.io.FileReader;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;

public class MarkFunctions extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("MarkFunctions: need a path to the address list");
            return;
        }

        int seen = 0;
        int made = 0;
        try (BufferedReader in = new BufferedReader(new FileReader(args[0]))) {
            String line;
            while ((line = in.readLine()) != null && !monitor.isCancelled()) {
                line = line.trim();
                if (line.isEmpty()) {
                    continue;
                }
                seen++;
                Address at = toAddr(Long.parseLong(line, 16));
                if (getInstructionAt(at) == null) {
                    disassemble(at);
                }
                if (getFunctionAt(at) == null && createFunction(at, null) != null) {
                    made++;
                }
            }
        }
        println("MarkFunctions: " + made + " functions created from " + seen + " addresses");
    }
}
