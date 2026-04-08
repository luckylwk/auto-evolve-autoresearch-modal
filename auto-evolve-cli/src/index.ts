#!/usr/bin/env bun
/**
 * Auto-evolve CLI entry point.
 *
 * Registers all subcommands and parses argv. Each command is defined in
 * its own file under src/commands/ and follows the Commander factory pattern.
 */
import { Command } from "commander";
import { createInitCommand } from "@/commands/init.js";
import { createBaselineCommand } from "@/commands/baseline.js";
import { createLoopCommand } from "@/commands/loop.js";
import { createStatusCommand } from "@/commands/status.js";
import { createReportCommand } from "@/commands/report.js";
import { createConfigCommand } from "@/commands/config.js";

import packageJson from "../package.json";

const program = new Command()
  .name("auto-evolve")
  .description(
    "Autonomous experiment CLI — hypothesis-driven improvement loops on any codebase.\n\nThe human programs program.md. The agent programs the code. The CLI orchestrates the loop.",
  )
  .version(packageJson.version ?? "0.0.0");

program.addCommand(createInitCommand());
program.addCommand(createBaselineCommand());
program.addCommand(createLoopCommand());
program.addCommand(createStatusCommand());
program.addCommand(createReportCommand());
program.addCommand(createConfigCommand());

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
