/**
 * `auto-evolve baseline` — establish the starting metric before experiments.
 *
 * Thin wrapper around lib/baseline.ts core logic, adding CLI output and exit codes.
 */
import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { parseProgram } from "@/lib/program-parser.js";
import { runBaseline, isError } from "@/lib/baseline.js";
import { STATE_DIR } from "@/lib/store.js";

export function createBaselineCommand(): Command {
  return new Command("baseline")
    .description("Establish the starting metric before experiments")
    .option("--timeout <seconds>", "Override timeout from program.md", parseInt)
    .option("--force", "Re-run baseline even if one exists")
    .action(async (opts: { timeout?: number; force?: boolean }) => {
      const cwd = process.cwd();

      if (!existsSync(join(cwd, STATE_DIR))) {
        console.error("Not initialized. Run 'auto-evolve init' first.");
        process.exit(1);
      }

      const program = await parseProgram(cwd);
      const timeout = opts.timeout && !Number.isNaN(opts.timeout) ? opts.timeout : program.timeout;

      console.log(`Running eval command: ${program.evalCommand}`);
      console.log(`Timeout: ${timeout}s (kill at ${timeout * 2}s)`);

      const result = await runBaseline(program, timeout, cwd, opts.force);

      if (isError(result)) {
        console.error(result.message);
        if (result.tail) console.error(`Last lines of run.log:\n${result.tail}`);
        process.exit(1);
      }

      if (result.status === "already_exists") {
        console.log("Baseline already recorded. Use --force to re-run.");
        return;
      }

      console.log(`Baseline: ${program.metric.name} = ${result.metric}`);
    });
}
