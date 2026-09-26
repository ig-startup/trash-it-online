// Dump every function Ghidra found as C, into one greppable file.
//
// Reading this binary a function at a time in assembly is the slow part of
// the reverse engineering; the point of running Ghidra headless is to get
// the whole thing in readable form once and then search it. One file rather
// than one per function is deliberate — the questions are of the form "who
// compares anything against a percentage", and that is a grep.
//
// Each function is preceded by a comment with its name and entry address,
// so a hit can be traced back to the addresses used in
// scripts/formats/README.md.
//
//   analyzeHeadless <proj> <name> -process <file> \
//       -scriptPath scripts/ghidra -postScript DumpDecomp.java <out.c>
//
//@category TrashIt

import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.PrintWriter;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

public class DumpDecomp extends GhidraScript {

    private static final int TIMEOUT_SECONDS = 60;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "/tmp/decomp.c";

        DecompInterface decomp = new DecompInterface();
        if (!decomp.openProgram(currentProgram)) {
            println("DumpDecomp: could not open program: " + decomp.getLastMessage());
            return;
        }

        int total = 0;
        int done = 0;
        try (PrintWriter out = new PrintWriter(new BufferedWriter(new FileWriter(outPath)))) {
            out.println("// " + currentProgram.getName()
                    + " — decompiled by Ghidra, addresses are virtual addresses");
            FunctionIterator functions =
                    currentProgram.getFunctionManager().getFunctions(true);
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function f = functions.next();
                total++;
                out.println();
                out.println("// ==== " + f.getName() + " @ " + f.getEntryPoint());
                DecompileResults res = decomp.decompileFunction(f, TIMEOUT_SECONDS, monitor);
                if (res.decompileCompleted() && res.getDecompiledFunction() != null) {
                    out.println(res.getDecompiledFunction().getC());
                    done++;
                } else {
                    out.println("// decompilation failed: " + res.getErrorMessage());
                }
            }
        } finally {
            decomp.dispose();
        }

        println("DumpDecomp: " + done + " of " + total + " functions -> " + outPath);
    }
}
