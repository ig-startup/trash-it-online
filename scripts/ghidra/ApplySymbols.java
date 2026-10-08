// Name the flat G.EXE import from the symbol map.
//
// Reads the tab-separated table `symbols.py table` writes — address, kind,
// name, comment — and for each line:
//
//   f  makes sure there is a function at the address (disassembling first
//      if need be), names it, and puts the comment on top of it, so the
//      decompiled C reads `jack_fly_to_flag(...)` instead of
//      `FUN_0002a2fe(...)`;
//   d  puts a label with that name on the address, so globals and tables
//      show as `players`, `anim_slots` and `tpl_flag_a34ec`.
//
//   analyzeHeadless <proj> <name> -import flat.bin ... \
//       -preScript MarkFunctions.java entries.txt \
//       -preScript ApplySymbols.java symbols.tsv
//
//@category TrashIt

import java.io.BufferedReader;
import java.io.FileReader;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;

public class ApplySymbols extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("ApplySymbols: need a path to the symbol table");
            return;
        }

        int functions = 0;
        int labels = 0;
        int failed = 0;
        try (BufferedReader in = new BufferedReader(new FileReader(args[0]))) {
            String line;
            while ((line = in.readLine()) != null && !monitor.isCancelled()) {
                String[] f = line.split("\t", 4);
                if (f.length < 3) {
                    continue;
                }
                Address at = toAddr(Long.parseLong(f[0], 16));
                String name = f[2];
                String comment = f.length > 3 ? f[3] : "";
                try {
                    if (f[1].equals("f")) {
                        if (getInstructionAt(at) == null) {
                            disassemble(at);
                        }
                        Function fn = getFunctionAt(at);
                        if (fn == null) {
                            fn = createFunction(at, name);
                        }
                        if (fn == null) {
                            failed++;
                            continue;
                        }
                        fn.setName(name, SourceType.USER_DEFINED);
                        if (!comment.isEmpty()) {
                            fn.setComment(comment);
                        }
                        functions++;
                    } else {
                        Symbol s = createLabel(at, name, true, SourceType.USER_DEFINED);
                        if (s == null) {
                            failed++;
                            continue;
                        }
                        if (!comment.isEmpty()) {
                            setEOLComment(at, comment);
                        }
                        labels++;
                    }
                } catch (Exception e) {
                    println("ApplySymbols: " + f[0] + " " + name + ": " + e.getMessage());
                    failed++;
                }
            }
        }
        println("ApplySymbols: " + functions + " functions, " + labels
                + " labels named, " + failed + " failed");
    }
}
