import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  readHypotheses,
  writeHypotheses,
  updateHypothesisStatus,
  getNextPending,
} from "@/lib/store.js";
import type { HypothesesFile, Hypothesis } from "@/lib/schemas.js";

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "increase-lr",
    title: "Increase learning rate",
    rationale: "May speed convergence.",
    risk: "low",
    expectedImpact: "medium",
    changes: "train.py — modify lr",
    priority: 8,
    status: "pending",
    ...overrides,
  };
}

function makeFile(hypotheses: Hypothesis[]): HypothesesFile {
  return {
    batch: 1,
    generatedAt: "2026-04-04T12:00:00Z",
    hypotheses,
  };
}

describe("hypotheses-store", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-hyp-test-"));
    await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("readHypotheses", () => {
    it("returns null when file does not exist", async () => {
      expect(await readHypotheses(cwd)).toBeNull();
    });

    it("reads and validates hypotheses file", async () => {
      const file = makeFile([makeHypothesis()]);
      await writeHypotheses(file, cwd);

      const result = await readHypotheses(cwd);
      expect(result!.batch).toBe(1);
      expect(result!.hypotheses).toHaveLength(1);
      expect(result!.hypotheses[0].id).toBe("increase-lr");
    });
  });

  describe("writeHypotheses", () => {
    it("writes formatted JSON file", async () => {
      const file = makeFile([makeHypothesis()]);
      await writeHypotheses(file, cwd);

      const { readFile } = await import("fs/promises");
      const content = await readFile(join(cwd, ".auto-evolve/hypotheses.json"), "utf-8");
      expect(content).toContain('"batch": 1');
      expect(content).toContain('"increase-lr"');
    });
  });

  describe("updateHypothesisStatus", () => {
    it("updates status of a specific hypothesis", async () => {
      const file = makeFile([
        makeHypothesis({ id: "h1", status: "pending" }),
        makeHypothesis({ id: "h2", status: "pending" }),
      ]);
      await writeHypotheses(file, cwd);

      await updateHypothesisStatus("h1", "success", cwd);

      const result = await readHypotheses(cwd);
      expect(result!.hypotheses.find((h) => h.id === "h1")!.status).toBe("success");
      expect(result!.hypotheses.find((h) => h.id === "h2")!.status).toBe("pending");
    });

    it("throws when hypothesis not found", async () => {
      const file = makeFile([makeHypothesis({ id: "h1" })]);
      await writeHypotheses(file, cwd);

      await expect(updateHypothesisStatus("nonexistent", "failed", cwd)).rejects.toThrow(
        "not found",
      );
    });

    it("throws when no hypotheses.json exists", async () => {
      await expect(updateHypothesisStatus("h1", "failed", cwd)).rejects.toThrow("No hypotheses");
    });
  });

  describe("getNextPending", () => {
    it("returns null when no file exists", async () => {
      expect(await getNextPending(cwd)).toBeNull();
    });

    it("returns highest priority pending hypothesis", async () => {
      const file = makeFile([
        makeHypothesis({ id: "low", priority: 3, status: "pending" }),
        makeHypothesis({ id: "high", priority: 9, status: "pending" }),
        makeHypothesis({ id: "mid", priority: 6, status: "pending" }),
      ]);
      await writeHypotheses(file, cwd);

      const next = await getNextPending(cwd);
      expect(next!.id).toBe("high");
      expect(next!.priority).toBe(9);
    });

    it("skips non-pending hypotheses", async () => {
      const file = makeFile([
        makeHypothesis({ id: "done", priority: 10, status: "success" }),
        makeHypothesis({ id: "pending", priority: 5, status: "pending" }),
      ]);
      await writeHypotheses(file, cwd);

      const next = await getNextPending(cwd);
      expect(next!.id).toBe("pending");
    });

    it("returns null when all are completed", async () => {
      const file = makeFile([
        makeHypothesis({ id: "h1", status: "success" }),
        makeHypothesis({ id: "h2", status: "failed" }),
      ]);
      await writeHypotheses(file, cwd);

      expect(await getNextPending(cwd)).toBeNull();
    });
  });
});
