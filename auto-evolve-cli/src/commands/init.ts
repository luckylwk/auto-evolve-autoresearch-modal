/**
 * `auto-evolve init` — bootstrap a project for autonomous experimentation.
 *
 * Creates .auto-evolve/ directory structure, writes default config and program.md
 * template, updates .gitignore, and checks out a new experiment branch.
 */
import { Command } from "commander";
import { existsSync } from "fs";
import { mkdir, writeFile, readFile, appendFile } from "fs/promises";
import { join } from "path";
import { Config } from "@/lib/schemas.js";
import {
  STATE_DIR,
  configFile,
  llmCallsDir,
  EXPERIMENTS_DIR,
  gitignoreEntries,
  PROGRAM_MD,
} from "@/lib/store.js";
import { createBranch, GitError } from "@/lib/git.js";

const PROGRAM_MD_TEMPLATE = `# Program

## Objective
<!-- One sentence: what are you optimizing? -->
<!-- e.g., "Minimize val_bpb for a 5-minute training run" -->

## Metric
- **Name**: <!-- metric identifier, e.g. val_bpb, pass_rate, p95_latency_ms -->
- **Direction**: <!-- lower_is_better | higher_is_better -->
- **Extract command**: <!-- shell command that prints ONLY the metric value to stdout -->
  <!-- e.g., grep "^val_bpb:" run.log | tail -1 | awk '{print $2}' -->

## Eval Command
<!-- Shell command to run one experiment. stdout+stderr redirected to run.log automatically. -->
<!-- e.g., uv run train.py -->

## Scope
<!-- Files/directories the agent is allowed to modify. One per line, globs supported. -->
- <!-- src/model.py -->

## Constraints
<!-- Rules the agent must NOT violate. One per line. -->
- <!-- Do not modify tests/ -->
- <!-- Do not install new packages -->

## Context
<!-- Optional. Domain knowledge, papers, prior results, hints. -->

## Timeout
300
`;

/** Generate a date-based tag like "apr04" for branch naming. */
function generateDateSlug(): string {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}${day}`;
}

/** Append auto-evolve entries to .gitignore, skipping any already present. */
async function appendGitignoreEntries(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const existingLines = existing.split("\n").map((line) => line.trim());
  const entries = gitignoreEntries();
  const missing = entries.filter((entry) => !existingLines.includes(entry));
  if (missing.length === 0) return;

  const suffix = existing.endsWith("\n") || existing === "" ? "" : "\n";
  await appendFile(gitignorePath, `${suffix}${missing.join("\n")}\n`);
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize a new auto-evolve experiment project")
    .option("--name <tag>", "Experiment branch name tag (default: date slug)")
    .option("--force", "Reinitialize even if .auto-evolve/ exists")
    .action(async (opts: { name?: string; force?: boolean }) => {
      const cwd = process.cwd();
      const stateDir = join(cwd, STATE_DIR);

      if (!opts.force && existsSync(stateDir)) {
        console.error("Already initialized. Use --force to reinitialize.");
        process.exit(1);
      }

      // Create directories
      await Promise.all([
        mkdir(join(cwd, llmCallsDir()), { recursive: true }),
        mkdir(join(cwd, EXPERIMENTS_DIR), { recursive: true }),
      ]);

      // Write default config
      const defaultConfig = Config.parse({});
      await writeFile(join(cwd, configFile()), JSON.stringify(defaultConfig, null, 2) + "\n");

      // Write program.md template (skip if exists unless --force)
      const programPath = join(cwd, PROGRAM_MD);
      if (opts.force || !existsSync(programPath)) {
        await writeFile(programPath, PROGRAM_MD_TEMPLATE);
      }

      // Update .gitignore
      await appendGitignoreEntries(cwd);

      // Create git branch
      const tag = opts.name ?? generateDateSlug();
      const branchName = `${defaultConfig.branchPrefix}/${tag}`;
      try {
        createBranch(branchName, cwd);
      } catch (err) {
        const msg = err instanceof GitError ? err.stderr : (err as Error).message;
        console.error(`Failed to create branch '${branchName}': ${msg}`);
        process.exit(1);
      }

      console.log(`Initialized auto-evolve project on branch ${branchName}`);
      console.log(`Edit ${PROGRAM_MD} to define your experiment, then run: auto-evolve baseline`);
    });
}
