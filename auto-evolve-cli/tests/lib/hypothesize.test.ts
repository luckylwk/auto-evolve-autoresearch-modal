import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "fs";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runHypothesize, buildHypothesizePrompt, isError } from "@/lib/hypothesize.js";
import { readHypotheses, appendExperiment } from "@/lib/store.js";
import { parseProgramContent } from "@/lib/program-parser.js";
import { Config } from "@/lib/schemas.js";

const PROGRAM_MD = `# Program
## Objective
Minimize test metric.
## Metric
- **Name**: test_metric
- **Direction**: lower_is_better
- **Extract command**: echo 1
## Eval Command
echo ok
## Scope
- src/
## Constraints
- Do not modify tests/
## Context
Some domain knowledge here.
## Timeout
10
`;

/** Create a shell script that writes valid hypotheses.json. */
function validHypothesesScript(batch: number, count: number): string {
  const hypotheses = Array.from({ length: count }, (_, i) => ({
    id: `hyp-${i + 1}`,
    title: `Hypothesis ${i + 1}`,
    rationale: "Should improve metric",
    risk: "low",
    expectedImpact: "small",
    changes: `Change file ${i + 1}`,
    priority: count - i,
    status: "pending",
  }));
  const json = JSON.stringify({ batch, generatedAt: new Date().toISOString(), hypotheses });
  return `cat > .auto-evolve/hypotheses.json << 'JSONEOF'\n${json}\nJSONEOF`;
}

async function makeScript(cwd: string, name: string, body: string): Promise<string> {
  const path = join(cwd, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function setupTestProject(agentBody: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "auto-evolve-hypothesize-test-"));

  spawnSync("git", ["init", "-b", "main"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });

  await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  await mkdir(join(cwd, "src"), { recursive: true });

  const agentScript = await makeScript(cwd, "agent.sh", agentBody);
  await writeFile(join(cwd, ".gitignore"), ".auto-evolve/\nrun.log\nresults.tsv\n");
  await writeFile(join(cwd, "program.md"), PROGRAM_MD);
  await writeFile(
    join(cwd, ".auto-evolve/config.json"),
    JSON.stringify(Config.parse({ agentCommand: agentScript }), null, 2),
  );
  await writeFile(
    join(cwd, ".auto-evolve/baseline.json"),
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  await writeFile(
    join(cwd, ".auto-evolve/best.json"),
    JSON.stringify({ metric: 0.4, commit: "def", timestamp: new Date().toISOString() }),
  );

  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  return cwd;
}

describe("runHypothesize", () => {
  let cwd: string;

  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it("generates valid hypotheses (happy path)", async () => {
    cwd = await setupTestProject(validHypothesesScript(1, 3));
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.status).toBe("ok");
      expect(result.batch).toBe(1);
      expect(result.count).toBe(3);
    }

    const hyps = await readHypotheses(cwd);
    expect(hyps).not.toBeNull();
    expect(hyps!.batch).toBe(1);
    expect(hyps!.hypotheses).toHaveLength(3);
    expect(hyps!.hypotheses.every((h) => h.status === "pending")).toBe(true);
  });

  it("increments batch number from previous", async () => {
    cwd = await setupTestProject(validHypothesesScript(99, 2));
    // Write existing hypotheses with batch 3
    await writeFile(
      join(cwd, ".auto-evolve/hypotheses.json"),
      JSON.stringify({
        batch: 3,
        generatedAt: new Date().toISOString(),
        hypotheses: [],
      }),
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.batch).toBe(4); // previous batch 3 + 1
    }

    const hyps = await readHypotheses(cwd);
    expect(hyps!.batch).toBe(4); // post-processed to correct batch
  });

  it("clamps hypothesis count to maxHypothesesPerBatch", async () => {
    cwd = await setupTestProject(validHypothesesScript(1, 5));
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxHypothesesPerBatch: 3,
    });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.count).toBe(3);
    }

    const hyps = await readHypotheses(cwd);
    expect(hyps!.hypotheses).toHaveLength(3);
  });

  it("forces all statuses to pending", async () => {
    // Agent writes non-pending statuses
    const badJson = JSON.stringify({
      batch: 1,
      generatedAt: new Date().toISOString(),
      hypotheses: [
        {
          id: "h1",
          title: "H1",
          rationale: "R",
          risk: "low",
          expectedImpact: "small",
          changes: "C",
          priority: 5,
          status: "in_progress",
        },
        {
          id: "h2",
          title: "H2",
          rationale: "R",
          risk: "low",
          expectedImpact: "small",
          changes: "C",
          priority: 3,
          status: "success",
        },
      ],
    });
    cwd = await setupTestProject(
      `cat > .auto-evolve/hypotheses.json << 'JSONEOF'\n${badJson}\nJSONEOF`,
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    const hyps = await readHypotheses(cwd);
    expect(hyps!.hypotheses.every((h) => h.status === "pending")).toBe(true);
  });

  it("returns error on agent timeout", async () => {
    cwd = await setupTestProject("sleep 60");
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 1, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("agent_timeout");
    }
  }, 15000);

  it("returns error on agent crash", async () => {
    cwd = await setupTestProject("exit 1");
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("agent_crash");
    }
  });

  it("returns error when agent writes no file", async () => {
    cwd = await setupTestProject('echo "oops"');
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("no_file_written");
    }
  });

  it("returns error when agent writes invalid JSON", async () => {
    cwd = await setupTestProject('echo "{broken" > .auto-evolve/hypotheses.json');
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("no_file_written");
    }
  });

  it("returns error when no baseline exists", async () => {
    cwd = await setupTestProject(validHypothesesScript(1, 2));
    await rm(join(cwd, ".auto-evolve/baseline.json"));
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runHypothesize(program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("no_baseline");
    }
  });

  it("includes experiment history in prompt", async () => {
    cwd = await setupTestProject(validHypothesesScript(1, 1));
    // Add history entries
    await appendExperiment(
      {
        id: "exp-1",
        timestamp: new Date().toISOString(),
        hypothesis: "h1",
        title: "Past experiment",
        baselineMetric: 0.5,
        resultMetric: 0.45,
        delta: -0.05,
        status: "kept",
        commitSha: "abc123",
        durationSeconds: 10,
        description: "Improved slightly",
      },
      cwd,
    );

    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });
    const { prompt } = await buildHypothesizePrompt(program, config, cwd);

    expect(prompt).toContain("Past experiment");
    expect(prompt).toContain("kept");
    expect(prompt).toContain("Improved slightly");
  });

  it("logs prompt to llm-calls when enabled", async () => {
    cwd = await setupTestProject(validHypothesesScript(1, 1));
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      logLlmCalls: true,
    });

    await runHypothesize(program, config, 10, cwd);

    const llmDir = join(cwd, ".auto-evolve/llm-calls");
    expect(existsSync(llmDir)).toBe(true);
    const entries = readdirSync(llmDir);
    expect(entries.some((f: string) => f.endsWith("-hypothesize.md"))).toBe(true);
  });
});
