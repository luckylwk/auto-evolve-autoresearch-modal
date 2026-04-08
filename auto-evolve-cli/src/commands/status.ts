/**
 * `auto-evolve status` — print experiment loop dashboard.
 */
import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { STATE_DIR } from "@/lib/store.js";
import { getStatus, formatStatus } from "@/lib/status.js";
import { parseProgram } from "@/lib/program-parser.js";

export function createStatusCommand(): Command {
  return new Command("status").description("Print experiment loop dashboard").action(async () => {
    const cwd = process.cwd();

    if (!existsSync(join(cwd, STATE_DIR))) {
      console.error("Not initialized. Run 'auto-evolve init' first.");
      process.exit(1);
    }

    let metricName = "metric";
    try {
      const program = await parseProgram(cwd);
      metricName = program.metric.name;
    } catch {
      // Fall back to generic name
    }

    const data = await getStatus(cwd);
    console.log(formatStatus(data, metricName));
  });
}
