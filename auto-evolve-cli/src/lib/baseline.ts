/**
 * Core baseline logic shared between the command and tests.
 *
 * Separated from the command handler so it can be tested without process.exit.
 */
import { writeFile } from "fs/promises";
import { join } from "path";
import type { ProgramConfig } from "@/lib/schemas.js";
import { getHeadSha } from "@/lib/git.js";
import {
  readBaseline,
  writeBaseline,
  writeBest,
  appendExperiment,
  RESULTS_TSV,
} from "@/lib/store.js";
import { runEvalCommand, extractMetric, tailRunLog } from "@/lib/runner.js";

const TSV_HEADER = "commit\tmetric\tdelta\tstatus\thypothesis\tdescription\n";

export interface BaselineResult {
  status: "ok" | "already_exists";
  metric?: number;
}

export interface BaselineError {
  type: "timeout" | "eval_failed" | "extract_failed";
  message: string;
  tail?: string;
}

export async function runBaseline(
  program: ProgramConfig,
  timeout: number,
  cwd: string,
  force = false,
): Promise<BaselineResult | BaselineError> {
  if (!force) {
    const existing = await readBaseline(cwd);
    if (existing) return { status: "already_exists" };
  }

  const result = await runEvalCommand(program.evalCommand, timeout, cwd);

  if (result.timedOut) {
    return {
      type: "timeout",
      message: `Eval command timed out after ${result.durationSeconds}s.`,
      tail: await tailRunLog(20, cwd),
    };
  }

  if (result.exitCode !== 0) {
    return {
      type: "eval_failed",
      message: `Eval command failed with exit code ${result.exitCode}.`,
      tail: await tailRunLog(20, cwd),
    };
  }

  let metric: number;
  try {
    metric = await extractMetric(program.metric.extractCommand, cwd);
  } catch (err) {
    return {
      type: "extract_failed",
      message: `Failed to extract metric: ${(err as Error).message}`,
    };
  }

  const commit = getHeadSha(cwd);
  const timestamp = new Date().toISOString();
  const snapshot = { metric, commit, timestamp };

  await writeBaseline(snapshot, cwd);
  await writeBest(snapshot, cwd);

  await appendExperiment(
    {
      id: "baseline",
      timestamp,
      hypothesis: "baseline",
      title: "Initial baseline",
      baselineMetric: metric,
      resultMetric: metric,
      delta: 0,
      status: "baseline",
      commitSha: commit,
      durationSeconds: result.durationSeconds,
      description: "Unmodified starting point",
    },
    cwd,
  );

  const tsvRow = `${commit}\t${metric}\t-\tbaseline\t-\tinitial baseline\n`;
  await writeFile(join(cwd, RESULTS_TSV), TSV_HEADER + tsvRow);

  return { status: "ok", metric };
}

function isError(result: BaselineResult | BaselineError): result is BaselineError {
  return "type" in result;
}

export { isError };
