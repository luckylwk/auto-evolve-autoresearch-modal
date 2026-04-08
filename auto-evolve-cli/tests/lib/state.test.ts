import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readBaseline, writeBaseline, readBest, writeBest } from "@/lib/store.js";
import type { MetricSnapshot } from "@/lib/schemas.js";

const SNAPSHOT: MetricSnapshot = {
  metric: 0.9979,
  commit: "a1b2c3d",
  timestamp: "2026-04-04T12:00:00Z",
};

describe("state", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-state-test-"));
    await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("baseline", () => {
    it("returns null when no baseline exists", async () => {
      expect(await readBaseline(cwd)).toBeNull();
    });

    it("writes and reads baseline", async () => {
      await writeBaseline(SNAPSHOT, cwd);
      const result = await readBaseline(cwd);
      expect(result).toEqual(SNAPSHOT);
    });
  });

  describe("best", () => {
    it("returns null when no best exists", async () => {
      expect(await readBest(cwd)).toBeNull();
    });

    it("writes and reads best", async () => {
      await writeBest(SNAPSHOT, cwd);
      const result = await readBest(cwd);
      expect(result).toEqual(SNAPSHOT);
    });

    it("overwrites previous best", async () => {
      await writeBest(SNAPSHOT, cwd);
      const updated: MetricSnapshot = {
        metric: 0.95,
        commit: "f3a9c2e",
        timestamp: "2026-04-04T13:00:00Z",
      };
      await writeBest(updated, cwd);

      const result = await readBest(cwd);
      expect(result!.metric).toBe(0.95);
      expect(result!.commit).toBe("f3a9c2e");
    });
  });
});
