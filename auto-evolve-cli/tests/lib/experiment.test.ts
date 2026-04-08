import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runExperiment, isError } from "@/lib/experiment.js";
import { readBest, readHistory, readHypotheses } from "@/lib/store.js";
import { getHeadSha } from "@/lib/git.js";
import { parseProgramContent } from "@/lib/program-parser.js";
import { Config } from "@/lib/schemas.js";

const PROGRAM_MD = `# Program
## Objective
Minimize test metric.
## Metric
- **Name**: test_metric
- **Direction**: lower_is_better
- **Extract command**: grep "metric:" run.log | awk '{print $2}'
## Eval Command
sh eval.sh
## Scope
- src/
## Timeout
10
`;

function makeHypotheses(overrides: Record<string, unknown> = {}) {
  return {
    batch: 1,
    generatedAt: new Date().toISOString(),
    hypotheses: [
      {
        id: "hyp-1",
        title: "Test hypothesis",
        rationale: "Testing",
        risk: "low",
        expectedImpact: "small",
        changes: "Modify src/data.txt",
        priority: 5,
        status: "pending",
        ...overrides,
      },
    ],
  };
}

async function makeScript(cwd: string, name: string, body: string): Promise<string> {
  const path = join(cwd, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function setupTestProject(agentBody: string, evalBody: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "auto-evolve-experiment-test-"));

  spawnSync("git", ["init", "-b", "main"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });

  await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  await mkdir(join(cwd, "src"), { recursive: true });

  const agentScript = await makeScript(cwd, "agent.sh", agentBody);
  await makeScript(cwd, "eval.sh", evalBody);
  await writeFile(join(cwd, "src/data.txt"), "original\n");
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
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  await writeFile(join(cwd, ".auto-evolve/hypotheses.json"), JSON.stringify(makeHypotheses()));
  await writeFile(
    join(cwd, "results.tsv"),
    "commit\tmetric\tdelta\tstatus\thypothesis\tdescription\n",
  );

  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  return cwd;
}

describe("runExperiment", () => {
  let cwd: string;

  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it("keeps experiment when metric improves", async () => {
    cwd = await setupTestProject(
      'echo "modified" > src/data.txt', // agent writes a change
      'echo "metric: 0.3"', // eval returns better metric
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.status).toBe("kept");
      expect(result.metric).toBe(0.3);
      expect(result.delta).toBe(-0.2);
      expect(result.commitSha).toBeTruthy();
    }

    const best = await readBest(cwd);
    expect(best!.metric).toBe(0.3);

    const hyps = await readHypotheses(cwd);
    expect(hyps!.hypotheses[0].status).toBe("success");

    const history = await readHistory(cwd);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("kept");

    // Verify artifacts archived
    const expId = history[0].id;
    const artifactDir = join(cwd, "experiments", expId);
    expect(existsSync(artifactDir)).toBe(true);
    const promptContent = await readFile(join(artifactDir, "prompt.md"), "utf-8");
    expect(promptContent).toContain("Test hypothesis");
    expect(existsSync(join(artifactDir, "run.log"))).toBe(true);
    expect(existsSync(join(artifactDir, "patch.diff"))).toBe(true);
  });

  it("reverts experiment when metric worsens", async () => {
    cwd = await setupTestProject(
      'echo "modified" > src/data.txt',
      'echo "metric: 0.8"', // worse
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });
    const startSha = getHeadSha(cwd);

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.status).toBe("reverted");
      expect(result.commitSha).toBeNull();
    }

    expect(getHeadSha(cwd)).toBe(startSha);

    const best = await readBest(cwd);
    expect(best!.metric).toBe(0.5); // unchanged

    const hyps = await readHypotheses(cwd);
    expect(hyps!.hypotheses[0].status).toBe("failed");
  });

  it("handles agent crash with no changes", async () => {
    cwd = await setupTestProject("exit 1", 'echo "metric: 0.3"');
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("agent_crash");
    }

    const hyps = await readHypotheses(cwd);
    expect(hyps!.hypotheses[0].status).toBe("crash");

    const history = await readHistory(cwd);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("crash");
  });

  it("handles agent timeout", async () => {
    cwd = await setupTestProject("sleep 60", 'echo "metric: 0.3"');
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runExperiment(undefined, program, config, 1, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("agent_timeout");
    }

    const history = await readHistory(cwd);
    expect(history[0].status).toBe("timeout");
  }, 15000);

  it("handles eval failure", async () => {
    cwd = await setupTestProject(
      'echo "modified" > src/data.txt',
      "exit 1", // eval fails
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });
    const startSha = getHeadSha(cwd);

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("eval_failed");
    }

    expect(getHeadSha(cwd)).toBe(startSha); // reverted
  });

  it("returns error when no baseline exists", async () => {
    cwd = await setupTestProject('echo "x"', 'echo "metric: 0.3"');
    await rm(join(cwd, ".auto-evolve/baseline.json"));

    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("no_baseline");
    }
  });

  it("returns error when no pending hypotheses", async () => {
    cwd = await setupTestProject('echo "x"', 'echo "metric: 0.3"');
    await writeFile(
      join(cwd, ".auto-evolve/hypotheses.json"),
      JSON.stringify(makeHypotheses({ status: "success" })),
    );

    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    const result = await runExperiment(undefined, program, config, 10, cwd);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.type).toBe("no_hypotheses");
    }
  });

  it("selects specific hypothesis by ID", async () => {
    cwd = await setupTestProject('echo "modified" > src/data.txt', 'echo "metric: 0.3"');
    // Add a second hypothesis with higher priority
    const hyps = makeHypotheses();
    hyps.hypotheses.push({
      id: "hyp-2",
      title: "Second hypothesis",
      rationale: "Testing specific selection",
      risk: "low",
      expectedImpact: "small",
      changes: "Modify src/data.txt",
      priority: 10,
      status: "pending",
    });
    await writeFile(join(cwd, ".auto-evolve/hypotheses.json"), JSON.stringify(hyps));

    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({ agentCommand: join(cwd, "agent.sh") });

    // Select hyp-1 explicitly (lower priority) instead of hyp-2
    const result = await runExperiment("hyp-1", program, config, 10, cwd);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.hypothesis).toBe("Test hypothesis");
    }

    const hfile = await readHypotheses(cwd);
    expect(hfile!.hypotheses.find((h) => h.id === "hyp-1")!.status).toBe("success");
    expect(hfile!.hypotheses.find((h) => h.id === "hyp-2")!.status).toBe("pending");
  });
});
