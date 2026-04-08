/**
 * `auto-evolve loop` — run the autonomous experiment loop.
 *
 * Thin wrapper around lib/loop.ts with CLI options, progress output, and Ctrl+C.
 */
import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { parseProgram } from "@/lib/program-parser.js";
import { resolveConfig } from "@/lib/config.js";
import { runLoop, type IterationSummary } from "@/lib/loop.js";
import { STATE_DIR } from "@/lib/store.js";

export function createLoopCommand(): Command {
  return new Command("loop")
    .description("Run the autonomous experiment loop")
    .option("--max-experiments <n>", "Stop after N experiments (default: 50)", parseInt)
    .option("--timeout <seconds>", "Override timeout from program.md", parseInt)
    .option("--max-failures <n>", "Override maxConsecutiveFailures from config", parseInt)
    .option("--rehypothesize-every <n>", "Override autoRehypothesizeEvery from config", parseInt)
    .action(
      async (opts: {
        maxExperiments?: number;
        timeout?: number;
        maxFailures?: number;
        rehypothesizeEvery?: number;
      }) => {
        const cwd = process.cwd();

        if (!existsSync(join(cwd, STATE_DIR))) {
          console.error("Not initialized. Run 'auto-evolve init' first.");
          process.exit(1);
        }

        const program = await parseProgram(cwd);
        const configOverrides: Record<string, unknown> = {};
        if (opts.maxFailures) configOverrides.maxConsecutiveFailures = opts.maxFailures;
        if (opts.rehypothesizeEvery)
          configOverrides.autoRehypothesizeEvery = opts.rehypothesizeEvery;
        const config = await resolveConfig(configOverrides, cwd);
        const timeout =
          opts.timeout && !Number.isNaN(opts.timeout) ? opts.timeout : program.timeout;
        const maxExperiments =
          opts.maxExperiments && !Number.isNaN(opts.maxExperiments) ? opts.maxExperiments : 50;

        // Ctrl+C handling
        const controller = new AbortController();
        let interrupted = false;
        process.on("SIGINT", () => {
          if (interrupted) process.exit(130);
          interrupted = true;
          console.log("\nGracefully stopping after current experiment...");
          controller.abort();
        });

        console.log(`Starting autonomous loop (max ${maxExperiments} experiments)`);
        console.log(`Agent: ${config.agentCommand} | Timeout: ${timeout}s`);

        const onIterationComplete = (s: IterationSummary) => {
          const icon = s.status === "kept" ? "✓" : s.status === "reverted" ? "✗" : "!";
          const metricStr = s.metric !== null ? ` (metric: ${s.metric}, Δ: ${s.delta})` : "";
          console.log(
            `[${s.iteration}/${maxExperiments}] ${icon} ${s.status} "${s.hypothesisTitle}"${metricStr}`,
          );
        };

        const result = await runLoop({
          maxExperiments,
          program,
          config,
          timeout,
          cwd,
          onIterationComplete,
          signal: controller.signal,
        });

        console.log(
          `\nLoop complete: ${result.kept} kept, ${result.reverted} reverted, ${result.errors} errors. Reason: ${result.stopReason}`,
        );

        if (result.stopReason === "hypothesize_failed" || result.stopReason === "no_hypotheses") {
          process.exit(1);
        }
      },
    );
}
