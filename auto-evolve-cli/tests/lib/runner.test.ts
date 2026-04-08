import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runEvalCommand, extractMetric, tailRunLog } from "@/lib/runner.js";

describe("runner", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-runner-test-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("runEvalCommand", () => {
    it("runs a command and writes output to run.log", async () => {
      const result = await runEvalCommand('echo "hello world"', 10, cwd);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);

      const log = await readFile(join(cwd, "run.log"), "utf-8");
      expect(log).toContain("hello world");
    });

    it("captures stderr to run.log", async () => {
      await runEvalCommand('echo "err" >&2', 10, cwd);
      const log = await readFile(join(cwd, "run.log"), "utf-8");
      expect(log).toContain("err");
    });

    it("returns non-zero exit code on failure", async () => {
      const result = await runEvalCommand("exit 42", 10, cwd);
      expect(result.exitCode).toBe(42);
    });

    it("kills process on timeout", async () => {
      // 1s timeout, 2x = 2s hard kill. Command sleeps 30s.
      const result = await runEvalCommand("sleep 30", 1, cwd);
      expect(result.timedOut).toBe(true);
    }, 10000);

    it("tracks duration", async () => {
      const result = await runEvalCommand("sleep 0.1", 10, cwd);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe("extractMetric", () => {
    it("extracts a numeric value from command output", async () => {
      await writeFile(join(cwd, "run.log"), "val_bpb: 0.9932\n");
      const value = await extractMetric("grep \"val_bpb\" run.log | awk '{print $2}'", cwd);
      expect(value).toBe(0.9932);
    });

    it("throws on non-numeric output", async () => {
      await writeFile(join(cwd, "run.log"), "no numbers here\n");
      await expect(extractMetric("cat run.log", cwd)).rejects.toThrow("not a number");
    });

    it("throws on non-zero exit code", async () => {
      await expect(extractMetric("exit 1", cwd)).rejects.toThrow("exited with code");
    });
  });

  describe("tailRunLog", () => {
    it("returns last N lines of run.log", async () => {
      await writeFile(join(cwd, "run.log"), "line1\nline2\nline3\nline4\n");
      const tail = await tailRunLog(2, cwd);
      expect(tail).toContain("line4");
    });

    it("returns fallback when no run.log exists", async () => {
      const tail = await tailRunLog(10, cwd);
      expect(tail).toContain("no run.log");
    });
  });
});
