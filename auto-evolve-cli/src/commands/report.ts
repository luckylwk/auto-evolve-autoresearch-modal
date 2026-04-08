/**
 * `auto-evolve report` — generate a human-readable experiment report.
 */
import { Command } from "commander";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { parseProgram } from "@/lib/program-parser.js";
import { gatherReportData, formatReport } from "@/lib/report.js";
import { STATE_DIR, RESULTS_MD } from "@/lib/store.js";

export function createReportCommand(): Command {
  return new Command("report")
    .description("Generate a final human-readable experiment report")
    .option("--output <path>", "Output file path (default: results.md)")
    .action(async (opts: { output?: string }) => {
      const cwd = process.cwd();

      if (!existsSync(join(cwd, STATE_DIR))) {
        console.error("Not initialized. Run 'auto-evolve init' first.");
        process.exit(1);
      }

      const program = await parseProgram(cwd);
      const data = await gatherReportData(program, cwd);
      const markdown = formatReport(data);

      const outPath = opts.output ?? join(cwd, RESULTS_MD);
      await writeFile(outPath, markdown);

      console.log(markdown);
      console.log(`\nReport written to ${outPath}`);
    });
}
