import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readBaseline, readBest, readHistory } from "@/lib/store.js";
import { runBaseline, isError } from "@/lib/baseline.js";
import { parseProgramContent } from "@/lib/program-parser.js";
import { Config } from "@/lib/schemas.js";

async function setupTestProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "auto-evolve-baseline-test-"));

  spawnSync("git", ["init", "-b", "main"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });

  await mkdir(join(cwd, ".auto-evolve/llm-calls"), { recursive: true });
  await writeFile(
    join(cwd, ".auto-evolve/config.json"),
    JSON.stringify(Config.parse({}), null, 2) + "\n",
  );

  await writeFile(join(cwd, "eval.sh"), '#!/bin/sh\necho "metric: 0.42"\n');
  spawnSync("chmod", ["+x", join(cwd, "eval.sh")]);

  const programMd = `# Program

## Objective
Minimize test metric.

## Metric
- **Name**: test_metric
- **Direction**: lower_is_better
- **Extract command**: grep "metric:" run.log | awk '{print $2}'

## Eval Command
sh eval.sh

## Scope
- eval.sh

## Timeout
10
`;
  await writeFile(join(cwd, "program.md"), programMd);

  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  return cwd;
}

describe("baseline", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await setupTestProject();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("runs eval, extracts metric, and writes all state files", async () => {
    const programMd = await readFile(join(cwd, "program.md"), "utf-8");
    const program = parseProgramContent(programMd);
    const result = await runBaseline(program, 10, cwd);

    expect(isError(result)).toBe(false);
    expect((result as { status: string }).status).toBe("ok");

    const baseline = await readBaseline(cwd);
    expect(baseline!.metric).toBe(0.42);

    const best = await readBest(cwd);
    expect(best!.metric).toBe(0.42);

    const history = await readHistory(cwd);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("baseline");
    expect(history[0].resultMetric).toBe(0.42);

    const tsv = await readFile(join(cwd, "results.tsv"), "utf-8");
    expect(tsv).toContain("0.42");
    expect(tsv).toContain("baseline");
  });

  it("returns already_exists when baseline exists", async () => {
    const programMd = await readFile(join(cwd, "program.md"), "utf-8");
    const program = parseProgramContent(programMd);
    await runBaseline(program, 10, cwd);

    const result = await runBaseline(program, 10, cwd);
    expect((result as { status: string }).status).toBe("already_exists");
  });

  it("returns error on failed eval command", async () => {
    await writeFile(
      join(cwd, "program.md"),
      `# Program
## Objective
Test.
## Metric
- **Name**: x
- **Direction**: lower_is_better
- **Extract command**: echo 1
## Eval Command
exit 1
## Scope
- file.ts
`,
    );
    const programMd = await readFile(join(cwd, "program.md"), "utf-8");
    const program = parseProgramContent(programMd);
    const result = await runBaseline(program, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("eval_failed");
    }
  });
});
