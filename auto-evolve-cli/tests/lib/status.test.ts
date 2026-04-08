import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { formatStatus, getStatus, type StatusData } from "@/lib/status.js";

// --- formatStatus unit tests (no filesystem) ---

describe("formatStatus", () => {
  it("renders full dashboard with all data", () => {
    const data: StatusData = {
      baseline: { metric: 0.5, commit: "abc123", timestamp: "2026-01-01T00:00:00.000Z" },
      best: { metric: 0.35, commit: "def456", timestamp: "2026-01-02T00:00:00.000Z" },
      improvement: -0.15,
      hypotheses: { batch: 2, total: 10, pending: 3, succeeded: 5, failed: 2, crashed: 0 },
      recentHistory: [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          hypothesis: "h1",
          title: "Optimize hot path",
          baselineMetric: 0.5,
          resultMetric: 0.45,
          delta: -0.05,
          status: "kept",
          commitSha: "aaa",
          durationSeconds: 60,
          description: "desc",
        },
        {
          id: "2",
          timestamp: "2026-01-01T01:00:00.000Z",
          hypothesis: "h2",
          title: "Increase batch size",
          baselineMetric: 0.5,
          resultMetric: 0.52,
          delta: 0.02,
          status: "reverted",
          commitSha: "bbb",
          durationSeconds: 45,
          description: "desc",
        },
      ],
      totalExperiments: 12,
    };

    const out = formatStatus(data, "test_metric");
    expect(out).toContain("Metric: test_metric");
    expect(out).toContain("Baseline: 0.5");
    expect(out).toContain("Best:     0.35");
    expect(out).toContain("Improvement: -0.15");
    expect(out).toContain("Hypotheses (batch 2):");
    expect(out).toContain("Pending: 3");
    expect(out).toContain("Succeeded: 5");
    expect(out).toContain("Optimize hot path");
    expect(out).toContain("Increase batch size");
    expect(out).toContain("Total experiments: 12");
  });

  it("shows 'No baseline recorded' when baseline is null", () => {
    const data: StatusData = {
      baseline: null,
      best: null,
      improvement: null,
      hypotheses: null,
      recentHistory: [],
      totalExperiments: 0,
    };
    const out = formatStatus(data);
    expect(out).toContain("No baseline recorded");
  });

  it("shows 'No hypotheses generated' when hypotheses is null", () => {
    const data: StatusData = {
      baseline: { metric: 1.0, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" },
      best: null,
      improvement: null,
      hypotheses: null,
      recentHistory: [],
      totalExperiments: 0,
    };
    const out = formatStatus(data);
    expect(out).toContain("No hypotheses generated");
  });

  it("shows 'No experiments run' when history is empty", () => {
    const data: StatusData = {
      baseline: { metric: 1.0, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" },
      best: null,
      improvement: null,
      hypotheses: { batch: 1, total: 3, pending: 3, succeeded: 0, failed: 0, crashed: 0 },
      recentHistory: [],
      totalExperiments: 0,
    };
    const out = formatStatus(data);
    expect(out).toContain("No experiments run");
  });
});

// --- getStatus integration tests (tmpdir with state files) ---

describe("getStatus", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-status-test-"));
    await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads baseline + best + hypotheses + history correctly", async () => {
    await writeFile(
      join(cwd, ".auto-evolve/baseline.json"),
      JSON.stringify({ metric: 0.5, commit: "abc", timestamp: "2026-01-01T00:00:00.000Z" }),
    );
    await writeFile(
      join(cwd, ".auto-evolve/best.json"),
      JSON.stringify({ metric: 0.4, commit: "def", timestamp: "2026-01-02T00:00:00.000Z" }),
    );
    await writeFile(
      join(cwd, ".auto-evolve/hypotheses.json"),
      JSON.stringify({
        batch: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        hypotheses: [
          {
            id: "h1",
            title: "Test",
            rationale: "r",
            risk: "low",
            expectedImpact: "small",
            changes: "c",
            priority: 5,
            status: "success",
          },
          {
            id: "h2",
            title: "Test2",
            rationale: "r",
            risk: "low",
            expectedImpact: "small",
            changes: "c",
            priority: 3,
            status: "pending",
          },
        ],
      }),
    );
    await writeFile(
      join(cwd, ".auto-evolve/history.jsonl"),
      JSON.stringify({
        id: "e1",
        timestamp: "2026-01-01T00:00:00.000Z",
        hypothesis: "h1",
        title: "Test experiment",
        baselineMetric: 0.5,
        resultMetric: 0.4,
        delta: -0.1,
        status: "kept",
        commitSha: "abc",
        durationSeconds: 30,
        description: "desc",
      }) + "\n",
    );

    const status = await getStatus(cwd);
    expect(status.baseline?.metric).toBe(0.5);
    expect(status.best?.metric).toBe(0.4);
    expect(status.improvement).toBeCloseTo(-0.1);
    expect(status.hypotheses?.total).toBe(2);
    expect(status.hypotheses?.succeeded).toBe(1);
    expect(status.hypotheses?.pending).toBe(1);
    expect(status.recentHistory).toHaveLength(1);
    expect(status.totalExperiments).toBe(1);
  });

  it("handles missing files gracefully", async () => {
    const status = await getStatus(cwd);
    expect(status.baseline).toBeNull();
    expect(status.best).toBeNull();
    expect(status.improvement).toBeNull();
    expect(status.hypotheses).toBeNull();
    expect(status.recentHistory).toHaveLength(0);
    expect(status.totalExperiments).toBe(0);
  });
});
