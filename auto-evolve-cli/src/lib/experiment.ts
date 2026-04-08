/**
 * Core experiment orchestration.
 *
 * Runs one hypothesis: build prompt → call agent → eval → measure → keep/revert.
 * Separated from the command handler so it can be tested without process.exit.
 */
import { appendFile, mkdir, writeFile, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { ProgramConfig, Config } from "@/lib/schemas.js";
import { runAgent } from "@/lib/agent.js";
import { runEvalCommand, extractMetric, tailRunLog } from "@/lib/runner.js";
import { getHeadSha, commitAll, revertToCommit, isWorkingTreeClean, savePatch } from "@/lib/git.js";
import {
  getNextPending,
  readHypotheses,
  updateHypothesisStatus,
  readBaseline,
  readBest,
  writeBest,
  appendExperiment,
  EXPERIMENTS_DIR,
  RESULTS_TSV,
  RUN_LOG,
} from "@/lib/store.js";

export interface ExperimentOk {
  status: "kept" | "reverted";
  metric: number;
  delta: number;
  commitSha: string | null;
  hypothesis: string;
}

export interface ExperimentFail {
  type: string;
  message: string;
  tail?: string;
}

export function isError(r: ExperimentOk | ExperimentFail): r is ExperimentFail {
  return "type" in r;
}

export async function runExperiment(
  hypothesisId: string | undefined,
  program: ProgramConfig,
  config: Config,
  timeout: number,
  cwd: string,
): Promise<ExperimentOk | ExperimentFail> {
  // 1. Read baseline + best
  const baseline = await readBaseline(cwd);
  if (!baseline)
    return { type: "no_baseline", message: "No baseline. Run 'auto-evolve baseline' first." };

  const best = (await readBest(cwd)) ?? baseline;

  // 2. Select hypothesis
  let hypothesis;
  if (hypothesisId) {
    const file = await readHypotheses(cwd);
    hypothesis = file?.hypotheses.find((h) => h.id === hypothesisId);
    if (!hypothesis)
      return { type: "not_found", message: `Hypothesis '${hypothesisId}' not found.` };
    if (hypothesis.status !== "pending")
      return {
        type: "not_found",
        message: `Hypothesis '${hypothesisId}' is ${hypothesis.status}, not pending.`,
      };
  } else {
    hypothesis = await getNextPending(cwd);
    if (!hypothesis)
      return {
        type: "no_hypotheses",
        message: "No pending hypotheses. Run 'auto-evolve hypothesize' first.",
      };
  }

  // 3. Mark in_progress, snapshot HEAD
  const experimentId = crypto.randomUUID();
  const startTime = Date.now();
  const startSha = getHeadSha(cwd);
  await updateHypothesisStatus(hypothesis.id, "in_progress", cwd);

  // 4. Build prompt
  const scope = program.scope.map((s) => `- ${s}`).join("\n");
  const constraints = program.constraints.length
    ? program.constraints.map((c) => `- ${c}`).join("\n")
    : "(none)";
  const prompt = `You are an autonomous coding agent running inside an experiment loop.
Your sole job: implement the hypothesis below, then stop. Do NOT run tests, evals, or any commands — the harness handles that.

# Objective

${program.objective}

# Hypothesis

**${hypothesis.title}**

Rationale: ${hypothesis.rationale}

# Planned changes

${hypothesis.changes}

# Rules

1. **Only modify files matching these patterns — touch nothing else:**
${scope}

2. **Constraints you must not violate:**
${constraints}

3. Keep changes minimal and reversible. Prefer the smallest diff that tests the hypothesis.
4. Do not add dependencies, install packages, or modify build configuration.
5. Do not create new files unless the hypothesis explicitly requires it.

# Metric context

- **Metric**: ${program.metric.name} (${program.metric.direction.replace(/_/g, " ")})
- **Baseline**: ${baseline.metric}
- **Current best**: ${best.metric}

After you finish editing files, exit immediately. The experiment harness will run the eval command and measure the metric.
`;

  // Helper: revert git safely
  const revert = () => {
    try {
      revertToCommit(startSha, cwd);
    } catch {
      // Don't mask original error
    }
  };

  // Helper: finalize and return error
  const fail = async (
    type: string,
    message: string,
    historyStatus: "crash" | "timeout",
    resultMetric: number | null = null,
    shouldRevert = false,
  ): Promise<ExperimentFail> => {
    await archiveArtifacts(experimentId, prompt, startSha, cwd);
    if (shouldRevert) revert();
    await updateHypothesisStatus(hypothesis.id, "crash", cwd);
    const delta = resultMetric !== null ? resultMetric - baseline.metric : null;
    await finalize(
      experimentId,
      hypothesis.id,
      hypothesis.title,
      baseline.metric,
      resultMetric,
      delta,
      historyStatus,
      null,
      startTime,
      cwd,
      message,
    );
    const tail = await tailRunLog(20, cwd);
    return { type, message, tail };
  };

  // 5. Run agent
  const agentResult = await runAgent(prompt, config.agentCommand, timeout, cwd);

  if (agentResult.timedOut)
    return fail("agent_timeout", `Agent timed out after ${timeout}s.`, "timeout", null, true);

  if (agentResult.exitCode !== 0 && isWorkingTreeClean(cwd))
    return fail("agent_crash", `Agent exited ${agentResult.exitCode} with no changes.`, "crash");

  // 6. Commit changes
  let commitSha: string;
  try {
    commitSha = commitAll(`auto-evolve: ${hypothesis.id} — ${hypothesis.title}`, cwd);
  } catch {
    return fail("no_changes", "Agent made no changes.", "crash");
  }

  // 7. Run eval
  const evalResult = await runEvalCommand(program.evalCommand, timeout, cwd);

  if (evalResult.timedOut)
    return fail("eval_timeout", `Eval timed out after ${timeout}s.`, "timeout", null, true);
  if (evalResult.exitCode !== 0)
    return fail(
      "eval_failed",
      `Eval failed with exit code ${evalResult.exitCode}.`,
      "crash",
      null,
      true,
    );

  // 8. Extract metric
  let resultMetric: number;
  try {
    resultMetric = await extractMetric(program.metric.extractCommand, cwd);
  } catch (err) {
    return fail(
      "extract_failed",
      `Metric extraction failed: ${(err as Error).message}`,
      "crash",
      null,
      true,
    );
  }

  // 9. Compare
  const delta = resultMetric - baseline.metric;
  const improved =
    program.metric.direction === "lower_is_better"
      ? resultMetric < best.metric
      : resultMetric > best.metric;

  if (improved) {
    await archiveArtifacts(experimentId, prompt, startSha, cwd);
    const timestamp = new Date().toISOString();
    await writeBest({ metric: resultMetric, commit: commitSha, timestamp }, cwd);
    await updateHypothesisStatus(hypothesis.id, "success", cwd);
    await finalize(
      experimentId,
      hypothesis.id,
      hypothesis.title,
      baseline.metric,
      resultMetric,
      delta,
      "kept",
      commitSha,
      startTime,
      cwd,
      `Improved ${program.metric.name}: ${baseline.metric} → ${resultMetric}`,
    );
    return { status: "kept", metric: resultMetric, delta, commitSha, hypothesis: hypothesis.title };
  }

  await archiveArtifacts(experimentId, prompt, startSha, cwd);
  revert();
  await updateHypothesisStatus(hypothesis.id, "failed", cwd);
  await finalize(
    experimentId,
    hypothesis.id,
    hypothesis.title,
    baseline.metric,
    resultMetric,
    delta,
    "reverted",
    null,
    startTime,
    cwd,
    `No improvement: ${baseline.metric} → ${resultMetric}`,
  );
  return {
    status: "reverted",
    metric: resultMetric,
    delta,
    commitSha: null,
    hypothesis: hypothesis.title,
  };
}

/** Save prompt, patch, and run.log to experiments/<id>/. Failures are non-fatal. */
async function archiveArtifacts(
  id: string,
  prompt: string,
  startSha: string,
  cwd: string,
): Promise<void> {
  try {
    const dir = join(cwd, EXPERIMENTS_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), prompt);
    const runLogPath = join(cwd, RUN_LOG);
    if (existsSync(runLogPath)) await copyFile(runLogPath, join(dir, "run.log"));
    try {
      await savePatch(startSha, join(dir, "patch.diff"), cwd);
    } catch {
      // No diff if agent made no changes or was reverted
    }
  } catch {
    // Archival is best-effort — don't fail the experiment
  }
}

/** Append history entry + TSV row. */
async function finalize(
  id: string,
  hypothesisId: string,
  title: string,
  baselineMetric: number,
  resultMetric: number | null,
  delta: number | null,
  status: "kept" | "reverted" | "crash" | "timeout",
  commitSha: string | null,
  startTime: number,
  cwd: string,
  description: string,
): Promise<void> {
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);

  await appendExperiment(
    {
      id,
      timestamp: new Date().toISOString(),
      hypothesis: hypothesisId,
      title,
      baselineMetric,
      resultMetric,
      delta,
      status,
      commitSha,
      durationSeconds,
      description,
    },
    cwd,
  );

  const metricStr = resultMetric !== null ? String(resultMetric) : "-";
  const deltaStr = delta !== null ? String(delta) : "-";
  await appendFile(
    join(cwd, RESULTS_TSV),
    `${commitSha ?? "-"}\t${metricStr}\t${deltaStr}\t${status}\t${hypothesisId}\t${description}\n`,
  );
}
