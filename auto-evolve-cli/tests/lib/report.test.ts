import { describe, it, expect } from "vitest";
import { formatReport, type ReportData } from "@/lib/report.js";
import type { ProgramConfig } from "@/lib/schemas.js";

const program: ProgramConfig = {
  objective: "Minimize validation loss",
  metric: { name: "val_loss", direction: "lower_is_better", extractCommand: "echo 1" },
  evalCommand: "sh eval.sh",
  scope: ["src/model.py", "configs/*.yaml"],
  constraints: ["Do not modify tests/"],
  context: "",
  timeout: 300,
};

describe("formatReport", () => {
  it("generates full report with experiments", () => {
    const data: ReportData = {
      program,
      baseline: { metric: 0.5, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" },
      best: { metric: 0.35, commit: "def", timestamp: "2026-01-02T00:00:00.000Z" },
      history: [
        {
          id: "baseline",
          timestamp: "2026-01-01T00:00:00.000Z",
          hypothesis: "baseline",
          title: "Initial baseline",
          baselineMetric: 0.5,
          resultMetric: 0.5,
          delta: 0,
          status: "baseline",
          commitSha: "abc",
          durationSeconds: 10,
          description: "Starting point",
        },
        {
          id: "e1",
          timestamp: "2026-01-01T01:00:00.000Z",
          hypothesis: "h1",
          title: "Optimize LR",
          baselineMetric: 0.5,
          resultMetric: 0.42,
          delta: -0.08,
          status: "kept",
          commitSha: "gh1",
          durationSeconds: 30,
          description: "Improved",
        },
        {
          id: "e2",
          timestamp: "2026-01-01T02:00:00.000Z",
          hypothesis: "h2",
          title: "Bigger batch",
          baselineMetric: 0.5,
          resultMetric: 0.55,
          delta: 0.05,
          status: "reverted",
          commitSha: null,
          durationSeconds: 25,
          description: "No improvement",
        },
        {
          id: "e3",
          timestamp: "2026-01-01T03:00:00.000Z",
          hypothesis: "h3",
          title: "Add dropout",
          baselineMetric: 0.5,
          resultMetric: 0.35,
          delta: -0.15,
          status: "kept",
          commitSha: "gh3",
          durationSeconds: 35,
          description: "Big improvement",
        },
      ],
    };

    const report = formatReport(data);

    expect(report).toContain("# Experiment Report");
    expect(report).toContain("Minimize validation loss");
    expect(report).toContain("val_loss");
    expect(report).toContain("Baseline**: 0.5");
    expect(report).toContain("Best**: 0.35");
    expect(report).toContain("-0.15");
    expect(report).toContain("3 total (2 kept, 1 reverted, 0 crashed)");
    expect(report).toContain("67%");
    expect(report).toContain("## Top Improvements");
    expect(report).toContain("Add dropout");
    expect(report).toContain("## Experiment History");
    expect(report).toContain("Optimize LR");
  });

  it("handles empty history", () => {
    const data: ReportData = {
      program,
      baseline: { metric: 0.5, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" },
      best: { metric: 0.5, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" },
      history: [],
    };

    const report = formatReport(data);

    expect(report).toContain("# Experiment Report");
    expect(report).toContain("0 total");
    expect(report).not.toContain("## Top Improvements");
    expect(report).not.toContain("## Experiment History");
  });

  it("handles no baseline", () => {
    const data: ReportData = {
      program,
      baseline: null,
      best: null,
      history: [],
    };

    const report = formatReport(data);
    expect(report).toContain("# Experiment Report");
    expect(report).not.toContain("Baseline");
  });
});
