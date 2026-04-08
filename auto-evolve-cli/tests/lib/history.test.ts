import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { appendExperiment, readHistory, getLastN } from "@/lib/store.js";
import type { ExperimentEntry } from "@/lib/schemas.js";

function makeEntry(overrides: Partial<ExperimentEntry> = {}): ExperimentEntry {
  return {
    id: "h001",
    timestamp: "2026-04-04T12:00:00Z",
    hypothesis: "increase-lr",
    title: "Increase learning rate",
    baselineMetric: 0.9979,
    resultMetric: 0.9932,
    delta: -0.0047,
    status: "kept",
    commitSha: "a1b2c3d",
    durationSeconds: 287,
    description: "Increased LR from 0.01 to 0.04",
    ...overrides,
  };
}

describe("history", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-history-test-"));
    await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("appendExperiment", () => {
    it("appends a JSONL line to history file", async () => {
      const entry = makeEntry();
      await appendExperiment(entry, cwd);

      const content = await readFile(join(cwd, ".auto-evolve/history.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).id).toBe("h001");
    });

    it("appends multiple entries", async () => {
      await appendExperiment(makeEntry({ id: "baseline" }), cwd);
      await appendExperiment(makeEntry({ id: "h001" }), cwd);
      await appendExperiment(makeEntry({ id: "h002" }), cwd);

      const content = await readFile(join(cwd, ".auto-evolve/history.jsonl"), "utf-8");
      expect(content.trim().split("\n")).toHaveLength(3);
    });
  });

  describe("readHistory", () => {
    it("returns empty array when file does not exist", async () => {
      const entries = await readHistory(cwd);
      expect(entries).toEqual([]);
    });

    it("reads all entries from history file", async () => {
      await appendExperiment(makeEntry({ id: "baseline", status: "baseline" }), cwd);
      await appendExperiment(makeEntry({ id: "h001" }), cwd);

      const entries = await readHistory(cwd);
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe("baseline");
      expect(entries[1].id).toBe("h001");
    });

    it("skips malformed lines gracefully", async () => {
      const { appendFile } = await import("fs/promises");
      const historyPath = join(cwd, ".auto-evolve/history.jsonl");
      await appendFile(historyPath, JSON.stringify(makeEntry({ id: "h001" })) + "\n");
      await appendFile(historyPath, "this is not json\n");
      await appendFile(historyPath, JSON.stringify(makeEntry({ id: "h002" })) + "\n");

      const entries = await readHistory(cwd);
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe("h001");
      expect(entries[1].id).toBe("h002");
    });
  });

  describe("getLastN", () => {
    it("returns last N entries", async () => {
      for (let i = 1; i <= 5; i++) {
        await appendExperiment(makeEntry({ id: `h${String(i).padStart(3, "0")}` }), cwd);
      }

      const last2 = await getLastN(2, cwd);
      expect(last2).toHaveLength(2);
      expect(last2[0].id).toBe("h004");
      expect(last2[1].id).toBe("h005");
    });

    it("returns all entries when N exceeds total", async () => {
      await appendExperiment(makeEntry(), cwd);
      const entries = await getLastN(100, cwd);
      expect(entries).toHaveLength(1);
    });
  });
});
