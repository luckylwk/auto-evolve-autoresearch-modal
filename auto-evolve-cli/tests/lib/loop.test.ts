import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runLoop, type IterationSummary } from "@/lib/loop.js";
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

function makeHypotheses(count: number, startId = 1) {
  return {
    batch: 1,
    generatedAt: new Date().toISOString(),
    hypotheses: Array.from({ length: count }, (_, i) => ({
      id: `hyp-${startId + i}`,
      title: `Hypothesis ${startId + i}`,
      rationale: "Testing",
      risk: "low",
      expectedImpact: "small",
      changes: "Modify src/data.txt",
      priority: 5,
      status: "pending",
    })),
  };
}

async function makeScript(cwd: string, name: string, body: string): Promise<string> {
  const path = join(cwd, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function setupTestProject(
  agentBody: string,
  evalBody: string,
  configOverrides: Record<string, unknown> = {},
  hypothesesCount = 0,
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "auto-evolve-loop-test-"));

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
    JSON.stringify(Config.parse({ agentCommand: agentScript, ...configOverrides }), null, 2),
  );
  await writeFile(
    join(cwd, ".auto-evolve/baseline.json"),
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  await writeFile(
    join(cwd, ".auto-evolve/best.json"),
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  if (hypothesesCount > 0) {
    await writeFile(
      join(cwd, ".auto-evolve/hypotheses.json"),
      JSON.stringify(makeHypotheses(hypothesesCount)),
    );
  }
  await writeFile(
    join(cwd, "results.tsv"),
    "commit\tmetric\tdelta\tstatus\thypothesis\tdescription\n",
  );

  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  return cwd;
}

describe("runLoop", () => {
  let cwd: string;

  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it("happy path — 3 experiments all kept", async () => {
    // Agent appends unique content; eval reads a counter to produce decreasing metrics
    const agentBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
if [ ! -f "$COUNTER_FILE" ]; then echo "0" > "$COUNTER_FILE"; fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
echo "run-$COUNT" >> src/data.txt
`;
    // Each run produces a lower metric: 0.4, 0.3, 0.2 (all better than baseline 0.5, lower_is_better)
    const evalBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
COUNT=$(cat "$COUNTER_FILE")
# awk to compute 0.5 - COUNT * 0.1
METRIC=$(awk "BEGIN {printf \\"%.1f\\", 0.5 - $COUNT * 0.1}")
echo "metric: $METRIC"
`;
    cwd = await setupTestProject(agentBody, evalBody, {}, 3);
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxConsecutiveFailures: 10,
    });

    const result = await runLoop({
      maxExperiments: 3,
      program,
      config,
      timeout: 10,
      cwd,
    });

    expect(result.stopReason).toBe("max_experiments");
    expect(result.kept).toBe(3);
    expect(result.experimentsRun).toBe(3);
    expect(result.reverted).toBe(0);
    expect(result.errors).toBe(0);
  }, 30000);

  it("consecutive failure stop", async () => {
    cwd = await setupTestProject(
      'echo "run-$(date +%s%N)" >> src/data.txt',
      'echo "metric: 0.9"', // always worse than baseline 0.5
      {},
      5,
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxConsecutiveFailures: 2,
    });

    const result = await runLoop({
      maxExperiments: 10,
      program,
      config,
      timeout: 10,
      cwd,
    });

    expect(result.stopReason).toBe("consecutive_failures");
    expect(result.experimentsRun).toBe(2);
    expect(result.reverted).toBe(2);
    expect(result.kept).toBe(0);
  }, 30000);

  it("auto-re-hypothesize when queue is empty", async () => {
    // Agent script: if prompt contains "generating experiment hypotheses" → write hypotheses.json
    // (that phrase only appears in the hypothesize template, not implement)
    const agentBody = `
PROMPT="$2"
if echo "$PROMPT" | grep -q "generating experiment hypotheses"; then
  COUNTER_FILE="$PWD/.auto-evolve/hyp-batch"
  if [ ! -f "$COUNTER_FILE" ]; then echo "1" > "$COUNTER_FILE"; else
    C=$(cat "$COUNTER_FILE"); echo "$((C + 1))" > "$COUNTER_FILE"; fi
  BATCH=$(cat "$COUNTER_FILE")
  cat > .auto-evolve/hypotheses.json << HYPS
{"batch":$BATCH,"generatedAt":"2026-01-01T00:00:00.000Z","hypotheses":[
  {"id":"hyp-b$BATCH-1","title":"Batch $BATCH hyp 1","rationale":"r","risk":"low","expectedImpact":"small","changes":"c","priority":5,"status":"pending"},
  {"id":"hyp-b$BATCH-2","title":"Batch $BATCH hyp 2","rationale":"r","risk":"low","expectedImpact":"small","changes":"c","priority":5,"status":"pending"}
]}
HYPS
else
  COUNTER_FILE="$PWD/.auto-evolve/counter"
  if [ ! -f "$COUNTER_FILE" ]; then echo "0" > "$COUNTER_FILE"; fi
  COUNT=$(cat "$COUNTER_FILE")
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$COUNTER_FILE"
  echo "run-$COUNT" >> src/data.txt
fi
`;
    const evalBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
COUNT=$(cat "$COUNTER_FILE")
METRIC=$(awk "BEGIN {printf \\"%.1f\\", 0.5 - $COUNT * 0.1}")
echo "metric: $METRIC"
`;
    cwd = await setupTestProject(agentBody, evalBody, { autoRehypothesizeEvery: 2 }, 2);
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      autoRehypothesizeEvery: 2,
      maxConsecutiveFailures: 10,
    });

    const result = await runLoop({
      maxExperiments: 4,
      program,
      config,
      timeout: 10,
      cwd,
    });

    expect(result.experimentsRun).toBe(4);
    expect(result.stopReason).toBe("max_experiments");
  }, 60000);

  it("hypothesize failure stops loop", async () => {
    // No pre-written hypotheses, agent always fails
    cwd = await setupTestProject("exit 1", 'echo "metric: 0.3"', {}, 0);
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
    });

    const result = await runLoop({
      maxExperiments: 5,
      program,
      config,
      timeout: 10,
      cwd,
    });

    expect(result.stopReason).toBe("hypothesize_failed");
    expect(result.experimentsRun).toBe(0);
  }, 15000);

  it("AbortSignal stops loop", async () => {
    cwd = await setupTestProject(
      'echo "run-$(date +%s%N)" >> src/data.txt',
      'echo "metric: 0.1"',
      {},
      5,
    );
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxConsecutiveFailures: 10,
    });

    const ac = new AbortController();

    const result = await runLoop({
      maxExperiments: 5,
      program,
      config,
      timeout: 10,
      cwd,
      signal: ac.signal,
      onIterationComplete: () => {
        ac.abort();
      },
    });

    expect(result.stopReason).toBe("aborted");
    expect(result.experimentsRun).toBe(1);
  }, 15000);

  it("mixed results reset consecutive failures", async () => {
    // Stateful agent: counter-based. Odd runs improve (decreasing metric), even runs worsen.
    // Pattern: kept, reverted, kept, reverted — consecutive failures never reach 2.
    const agentBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
if [ ! -f "$COUNTER_FILE" ]; then echo "0" > "$COUNTER_FILE"; fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
echo "run-$COUNT" >> src/data.txt
`;
    // Odd runs: strictly decreasing (0.4, 0.3). Even runs: 0.9 (always worse).
    const evalBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
COUNT=$(cat "$COUNTER_FILE")
ODD=$((COUNT % 2))
if [ "$ODD" -eq 1 ]; then
  # Odd runs: keep improving. 0.4 for run 1, 0.3 for run 3, etc.
  GOOD_RUN=$(( (COUNT + 1) / 2 ))
  METRIC=$(awk "BEGIN {printf \\"%.1f\\", 0.5 - $GOOD_RUN * 0.1}")
  echo "metric: $METRIC"
else
  echo "metric: 0.9"
fi
`;
    cwd = await setupTestProject(agentBody, evalBody, { maxConsecutiveFailures: 2 }, 4);
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxConsecutiveFailures: 2,
    });

    const result = await runLoop({
      maxExperiments: 4,
      program,
      config,
      timeout: 10,
      cwd,
    });

    // Pattern: kept, reverted, kept, reverted — consecutive failures reset on each kept
    expect(result.stopReason).toBe("max_experiments");
    expect(result.experimentsRun).toBe(4);
    expect(result.kept).toBe(2);
    expect(result.reverted).toBe(2);
  }, 30000);

  it("onIterationComplete called with correct data", async () => {
    const agentBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
if [ ! -f "$COUNTER_FILE" ]; then echo "0" > "$COUNTER_FILE"; fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
echo "run-$COUNT" >> src/data.txt
`;
    const evalBody = `
COUNTER_FILE="$PWD/.auto-evolve/counter"
COUNT=$(cat "$COUNTER_FILE")
METRIC=$(awk "BEGIN {printf \\"%.1f\\", 0.5 - $COUNT * 0.1}")
echo "metric: $METRIC"
`;
    cwd = await setupTestProject(agentBody, evalBody, {}, 2);
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      maxConsecutiveFailures: 10,
    });

    const summaries: IterationSummary[] = [];

    const result = await runLoop({
      maxExperiments: 2,
      program,
      config,
      timeout: 10,
      cwd,
      onIterationComplete: (s) => summaries.push(s),
    });

    expect(summaries).toHaveLength(2);
    expect(summaries[0].iteration).toBe(1);
    expect(summaries[1].iteration).toBe(2);
    expect(summaries[0].status).toBe("kept");
    expect(summaries[1].status).toBe("kept");
    expect(summaries[0].metric).toBe(0.4);
    expect(summaries[1].metric).toBe(0.3);
    expect(summaries[0].consecutiveFailures).toBe(0);
    expect(result.kept).toBe(2);
  }, 30000);
});
