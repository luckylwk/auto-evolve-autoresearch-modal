/**
 * Core autonomous loop — composes hypothesize + experiment in a while loop.
 * No console output; uses onIterationComplete callback for reporting.
 */
import type { ProgramConfig, Config } from "@/lib/schemas.js";
import { runExperiment, isError } from "@/lib/experiment.js";
import { runHypothesize, isError as isHypError } from "@/lib/hypothesize.js";
import { getNextPending } from "@/lib/store.js";

export interface LoopOptions {
  maxExperiments: number;
  program: ProgramConfig;
  config: Config;
  timeout: number;
  cwd: string;
  onIterationComplete?: (summary: IterationSummary) => void;
  signal?: AbortSignal;
}

export interface IterationSummary {
  iteration: number;
  hypothesisTitle: string;
  status: "kept" | "reverted" | "error";
  metric: number | null;
  delta: number | null;
  consecutiveFailures: number;
}

export interface LoopResult {
  experimentsRun: number;
  kept: number;
  reverted: number;
  errors: number;
  stopReason:
    | "max_experiments"
    | "consecutive_failures"
    | "hypothesize_failed"
    | "no_hypotheses"
    | "aborted";
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const { maxExperiments, program, config, timeout, cwd, onIterationComplete, signal } = opts;

  let consecutiveFailures = 0;
  let experimentsRun = 0;
  let experimentsSinceLastHypothesize = 0;
  let kept = 0;
  let reverted = 0;
  let errors = 0;

  const counters = () => ({ experimentsRun, kept, reverted, errors });

  while (experimentsRun < maxExperiments) {
    if (signal?.aborted) return { stopReason: "aborted", ...counters() };

    // Ensure hypotheses exist
    if ((await getNextPending(cwd)) === null) {
      const hypResult = await runHypothesize(program, config, timeout, cwd);
      if (isHypError(hypResult)) return { stopReason: "hypothesize_failed", ...counters() };
      experimentsSinceLastHypothesize = 0;
      if ((await getNextPending(cwd)) === null)
        return { stopReason: "no_hypotheses", ...counters() };
    }

    // Run experiment
    const result = await runExperiment(undefined, program, config, timeout, cwd);
    experimentsRun++;
    experimentsSinceLastHypothesize++;

    if (isError(result)) {
      consecutiveFailures++;
      errors++;
      onIterationComplete?.({
        iteration: experimentsRun,
        hypothesisTitle: "?",
        status: "error",
        metric: null,
        delta: null,
        consecutiveFailures,
      });
    } else if (result.status === "reverted") {
      consecutiveFailures++;
      reverted++;
      onIterationComplete?.({
        iteration: experimentsRun,
        hypothesisTitle: result.hypothesis,
        status: "reverted",
        metric: result.metric,
        delta: result.delta,
        consecutiveFailures,
      });
    } else {
      consecutiveFailures = 0;
      kept++;
      onIterationComplete?.({
        iteration: experimentsRun,
        hypothesisTitle: result.hypothesis,
        status: "kept",
        metric: result.metric,
        delta: result.delta,
        consecutiveFailures: 0,
      });
    }

    // Stop on consecutive failures
    if (consecutiveFailures >= config.maxConsecutiveFailures)
      return { stopReason: "consecutive_failures", ...counters() };

    // Re-hypothesize when queue empty and enough experiments since last batch
    if (
      experimentsSinceLastHypothesize >= config.autoRehypothesizeEvery &&
      (await getNextPending(cwd)) === null
    ) {
      await runHypothesize(program, config, timeout, cwd);
      experimentsSinceLastHypothesize = 0;
    }
  }

  return { stopReason: "max_experiments", ...counters() };
}
