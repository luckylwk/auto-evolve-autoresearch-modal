/**
 * Status dashboard: composes state from baseline, best, hypotheses, and history.
 */
import type { MetricSnapshot, ExperimentEntry, HypothesesFile } from "@/lib/schemas.js";
import { readBaseline, readBest, readHypotheses, readHistory } from "@/lib/store.js";

export interface StatusData {
  baseline: MetricSnapshot | null;
  best: MetricSnapshot | null;
  improvement: number | null;
  hypotheses: {
    batch: number;
    total: number;
    pending: number;
    succeeded: number;
    failed: number;
    crashed: number;
  } | null;
  recentHistory: ExperimentEntry[];
  totalExperiments: number;
}

export async function getStatus(cwd?: string): Promise<StatusData> {
  const [baseline, best, hypothesesFile, history] = await Promise.all([
    readBaseline(cwd),
    readBest(cwd),
    readHypotheses(cwd),
    readHistory(cwd),
  ]);

  return {
    baseline,
    best,
    improvement: baseline && best ? best.metric - baseline.metric : null,
    hypotheses: summarizeHypotheses(hypothesesFile),
    recentHistory: history.slice(-10),
    totalExperiments: history.length,
  };
}

function summarizeHypotheses(file: HypothesesFile | null) {
  if (!file) return null;
  const h = file.hypotheses;
  return {
    batch: file.batch,
    total: h.length,
    pending: h.filter((x) => x.status === "pending" || x.status === "in_progress").length,
    succeeded: h.filter((x) => x.status === "success").length,
    failed: h.filter((x) => x.status === "failed").length,
    crashed: h.filter((x) => x.status === "crash").length,
  };
}

export function formatStatus(data: StatusData, metricName = "metric"): string {
  const lines: string[] = [];

  lines.push(`Metric: ${metricName}`);
  if (data.baseline) {
    lines.push(`  Baseline: ${data.baseline.metric}`);
  } else {
    lines.push("  No baseline recorded");
  }
  if (data.best) {
    lines.push(`  Best:     ${data.best.metric}`);
  }
  if (data.improvement !== null) {
    const sign = data.improvement >= 0 ? "+" : "";
    lines.push(`  Improvement: ${sign}${data.improvement}`);
  }

  lines.push("");
  if (data.hypotheses) {
    lines.push(`Hypotheses (batch ${data.hypotheses.batch}):`);
    lines.push(
      `  Pending: ${data.hypotheses.pending}  Succeeded: ${data.hypotheses.succeeded}  Failed: ${data.hypotheses.failed}  Crashed: ${data.hypotheses.crashed}`,
    );
  } else {
    lines.push("No hypotheses generated");
  }

  lines.push("");
  if (data.recentHistory.length > 0) {
    lines.push(`Recent experiments (last ${data.recentHistory.length}):`);
    for (let i = 0; i < data.recentHistory.length; i++) {
      const e = data.recentHistory[i];
      const delta = e.delta !== null ? (e.delta >= 0 ? `+${e.delta}` : `${e.delta}`) : "N/A";
      lines.push(`  #${i + 1}  ${e.status.padEnd(8)}  ${delta.padEnd(6)}  ${e.title}`);
    }
  } else {
    lines.push("No experiments run");
  }

  lines.push("");
  lines.push(`Total experiments: ${data.totalExperiments}`);

  return lines.join("\n");
}
