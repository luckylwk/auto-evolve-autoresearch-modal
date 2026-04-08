/**
 * Core hypothesis generation logic.
 *
 * Builds a prompt with project context, shells out to the agent CLI,
 * then reads and validates the hypotheses.json the agent wrote.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ProgramConfig, Config, ExperimentEntry } from "@/lib/schemas.js";
import { HypothesesFile } from "@/lib/schemas.js";
import { runAgent } from "@/lib/agent.js";
import {
  getLastN,
  readBaseline,
  readBest,
  readHypotheses,
  writeHypotheses,
  hypothesesFile,
  llmCallsDir,
} from "@/lib/store.js";

export interface HypothesizeOk {
  status: "ok";
  batch: number;
  count: number;
  durationSeconds: number;
}

export interface HypothesizeError {
  type: string;
  message: string;
}

export function isError(r: HypothesizeOk | HypothesizeError): r is HypothesizeError {
  return "type" in r;
}

const SIMPLICITY_BIAS_TEXT = `# Simplicity bias

Prefer the simplest possible changes. Rank single-file, small-diff hypotheses higher than multi-file refactors. Only propose complex changes if all simpler options are clearly exhausted. A one-line fix at priority 8 beats a 50-line refactor at priority 8.`;

function formatHistory(entries: ExperimentEntry[]): string {
  if (entries.length === 0) return "No experiments run yet.";
  const header = "| # | Title | Status | Delta | Description |";
  const sep = "|---|-------|--------|-------|-------------|";
  const rows = entries.map(
    (e, i) => `| ${i + 1} | ${e.title} | ${e.status} | ${e.delta ?? "-"} | ${e.description} |`,
  );
  return [header, sep, ...rows].join("\n");
}

/** Build the assembled hypothesize prompt. Exported for --dry-run. */
export async function buildHypothesizePrompt(
  program: ProgramConfig,
  config: Config,
  cwd: string,
): Promise<{ prompt: string; batchNumber: number }> {
  const baseline = await readBaseline(cwd);
  const best = (await readBest(cwd)) ?? baseline;
  const existing = await readHypotheses(cwd);
  const batchNumber = existing ? existing.batch + 1 : 1;
  const history = await getLastN(5, cwd);

  const scope = program.scope.map((s) => `- ${s}`).join("\n");
  const constraints = program.constraints.length
    ? program.constraints.map((c) => `- ${c}`).join("\n")
    : "(none)";
  const simplicityBlock = config.simplicityBias ? SIMPLICITY_BIAS_TEXT : "";
  const generatedAt = new Date().toISOString();

  const prompt = `You are an autonomous research agent generating experiment hypotheses.
Your sole job: analyze the project and write a structured JSON file of hypotheses to ${hypothesesFile()}, then stop.

# Objective

${program.objective}

# Project context

${program.context || "(none)"}

# Files in scope (only propose changes to these)

${scope}

# Constraints (hypotheses must not violate these)

${constraints}

# Metric

- **Name**: ${program.metric.name}
- **Direction**: ${program.metric.direction.replace(/_/g, " ")}
- **Baseline**: ${baseline?.metric ?? "?"}
- **Current best**: ${best?.metric ?? "?"}

# Past experiment results

${formatHistory(history)}

${simplicityBlock}

# Your task

Generate exactly ${config.maxHypothesesPerBatch} hypotheses ranked by priority (10 = highest).
Each hypothesis should propose a specific, testable code change that could improve the metric.

Write the file ${hypothesesFile()} with this exact JSON structure:

\`\`\`json
{
  "batch": ${batchNumber},
  "generatedAt": "${generatedAt}",
  "hypotheses": [
    {
      "id": "kebab-case-short-id",
      "title": "Short descriptive name",
      "rationale": "Why this should improve the metric",
      "risk": "low | medium | high",
      "expectedImpact": "small | medium | large",
      "changes": "Specific description of the planned code changes",
      "priority": 1,
      "status": "pending"
    }
  ]
}
\`\`\`

# Rules

1. Write ONLY the file ${hypothesesFile()} — do not modify any other files.
2. Each hypothesis id must be unique, lowercase, kebab-case, max 40 characters.
3. All hypotheses must have status "pending".
4. Priority 10 = most promising, 1 = least. No duplicate priorities if possible.
5. Rationale must reference the metric and explain the expected causal mechanism.
6. Changes must be specific enough that a coding agent can implement them without ambiguity.
7. Do not propose changes outside the scope files listed above.
8. If past experiments are shown, learn from failures — do not re-propose failed approaches.
9. After writing the file, exit immediately.
`;

  return { prompt, batchNumber };
}

export async function runHypothesize(
  program: ProgramConfig,
  config: Config,
  timeout: number,
  cwd: string,
): Promise<HypothesizeOk | HypothesizeError> {
  // 1. Check baseline exists
  const baseline = await readBaseline(cwd);
  if (!baseline)
    return { type: "no_baseline", message: "No baseline. Run 'auto-evolve baseline' first." };

  // 2. Build prompt
  const { prompt, batchNumber } = await buildHypothesizePrompt(program, config, cwd);

  // 3. Log prompt if enabled
  if (config.logLlmCalls) {
    try {
      const dir = join(cwd, llmCallsDir());
      await mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(join(dir, `${ts}-hypothesize.md`), prompt);
    } catch {
      // Best-effort logging
    }
  }

  // 4. Run agent
  const result = await runAgent(prompt, config.agentCommand, timeout, cwd);

  if (result.timedOut)
    return { type: "agent_timeout", message: `Agent timed out after ${timeout}s.` };

  if (result.exitCode !== 0)
    return { type: "agent_crash", message: `Agent exited with code ${result.exitCode}.` };

  // 5. Read and validate output
  const raw = await readHypotheses(cwd);

  if (!raw) {
    // Distinguish missing file from invalid JSON
    let detail = `Agent did not write ${hypothesesFile()}.`;
    try {
      const content = await readFile(join(cwd, hypothesesFile()), "utf-8");
      const parsed = JSON.parse(content);
      const validation = HypothesesFile.safeParse(parsed);
      if (!validation.success) {
        detail = `Agent wrote hypotheses.json but validation failed: ${validation.error.issues.map((i) => i.message).join(", ")}`;
      }
    } catch {
      // File doesn't exist or isn't valid JSON
    }
    return { type: raw === null ? "no_file_written" : "invalid_output", message: detail };
  }

  // 6. Post-process: normalize agent output
  const patched = {
    batch: batchNumber,
    generatedAt: new Date().toISOString(),
    hypotheses: raw.hypotheses.slice(0, config.maxHypothesesPerBatch).map((h) => ({
      ...h,
      status: "pending" as const,
    })),
  };
  await writeHypotheses(patched, cwd);

  return {
    status: "ok",
    batch: batchNumber,
    count: patched.hypotheses.length,
    durationSeconds: result.durationSeconds,
  };
}
