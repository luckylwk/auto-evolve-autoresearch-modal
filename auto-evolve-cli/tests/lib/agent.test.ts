import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runAgent } from "@/lib/agent.js";

describe("runAgent", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "auto-evolve-agent-test-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /** Create a temp script that ignores args and runs the given body. */
  async function makeScript(name: string, body: string): Promise<string> {
    const path = join(cwd, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("runs agent successfully", async () => {
    const script = await makeScript("agent.sh", 'echo "done"');
    const result = await runAgent("test prompt", script, 10, cwd);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("returns non-zero exit code on failure", async () => {
    const script = await makeScript("agent.sh", "exit 1");
    const result = await runAgent("unused", script, 10, cwd);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("kills agent on timeout", async () => {
    const script = await makeScript("agent.sh", "sleep 60");
    const result = await runAgent("unused", script, 1, cwd);
    expect(result.timedOut).toBe(true);
  }, 10000);

  it("tracks duration", async () => {
    const script = await makeScript("agent.sh", "true");
    const result = await runAgent("test", script, 10, cwd);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
  });
});
