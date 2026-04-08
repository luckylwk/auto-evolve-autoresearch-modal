/**
 * End-to-end integration test for the full loop lifecycle.
 * Uses a dual-mode agent that handles both hypothesize and experiment calls.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runLoop } from "@/lib/loop.js";
import { readHistory, readBest, readHypotheses } from "@/lib/store.js";
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

// Agent script: detects mode from prompt, handles both hypothesize and experiment.
// For experiments, writes a unique file change. Uses a counter to generate unique hypothesis IDs.
const AGENT_SCRIPT = [
  "#!/bin/sh",
  'PROMPT="$2"',
  'CF=".auto-evolve/agent-counter"',
  'if [ ! -f "$CF" ]; then echo "0" > "$CF"; fi',
  'N=$(cat "$CF")',
  "N=$((N + 1))",
  'echo "$N" > "$CF"',
  'case "$PROMPT" in',
  '  *"generating experiment hypotheses"*|*"Write the file .auto-evolve/hypotheses.json"*)',
  "    cat > .auto-evolve/hypotheses.json << 'EOF'",
  '{"batch":1,"generatedAt":"2026-01-01T00:00:00.000Z","hypotheses":[',
  '{"id":"h-1","title":"H1","rationale":"R","risk":"low","expectedImpact":"small","changes":"C","priority":8,"status":"pending"},',
  '{"id":"h-2","title":"H2","rationale":"R","risk":"low","expectedImpact":"small","changes":"C","priority":5,"status":"pending"},',
  '{"id":"h-3","title":"H3","rationale":"R","risk":"low","expectedImpact":"small","changes":"C","priority":3,"status":"pending"}',
  "]}",
  "EOF",
  "    exit 0 ;;",
  "esac",
  'echo "change-$N" > src/data.txt',
  "exit 0",
].join("\n");

// Eval: uses a decrementing metric so each experiment is progressively better.
// Reads counter and computes 0.5 - 0.02 * counter.
const EVAL_SCRIPT = [
  "#!/bin/sh",
  "N=$(cat .auto-evolve/agent-counter 2>/dev/null || echo 0)",
  "# Compute metric: starts at 0.48, decreases by 0.02 each time",
  'echo "metric: 0.$(printf "%02d" $((48 - N * 2)))"',
].join("\n");

async function setupProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "auto-evolve-loop-int-"));

  spawnSync("git", ["init", "-b", "main"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });

  await mkdir(join(cwd, ".auto-evolve"), { recursive: true });
  await mkdir(join(cwd, "src"), { recursive: true });

  const agentPath = join(cwd, "agent.sh");
  await writeFile(agentPath, AGENT_SCRIPT);
  await chmod(agentPath, 0o755);

  await writeFile(join(cwd, "eval.sh"), EVAL_SCRIPT);
  await chmod(join(cwd, "eval.sh"), 0o755);

  await writeFile(join(cwd, "src/data.txt"), "original\n");
  await writeFile(join(cwd, ".gitignore"), ".auto-evolve/\nrun.log\nresults.tsv\nexperiments/\n");
  await writeFile(join(cwd, "program.md"), PROGRAM_MD);
  await writeFile(
    join(cwd, ".auto-evolve/config.json"),
    JSON.stringify(Config.parse({ agentCommand: agentPath, autoRehypothesizeEvery: 3 }), null, 2),
  );
  await writeFile(
    join(cwd, ".auto-evolve/baseline.json"),
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  await writeFile(
    join(cwd, ".auto-evolve/best.json"),
    JSON.stringify({ metric: 0.5, commit: "abc", timestamp: new Date().toISOString() }),
  );
  await writeFile(
    join(cwd, "results.tsv"),
    "commit\tmetric\tdelta\tstatus\thypothesis\tdescription\n",
  );

  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  return cwd;
}

describe("loop integration", () => {
  let cwd: string;

  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it("runs full lifecycle: hypothesize, run experiments, re-hypothesize", async () => {
    cwd = await setupProject();
    const program = parseProgramContent(PROGRAM_MD);
    const config = Config.parse({
      agentCommand: join(cwd, "agent.sh"),
      autoRehypothesizeEvery: 3,
      maxConsecutiveFailures: 10,
    });

    const statuses: string[] = [];
    const result = await runLoop({
      maxExperiments: 6,
      program,
      config,
      timeout: 10,
      cwd,
      onIterationComplete: (s) => statuses.push(s.status),
    });

    expect(result.experimentsRun).toBe(6);
    expect(result.stopReason).toBe("max_experiments");
    expect(statuses).toHaveLength(6);

    // History should have all 6 entries
    const history = await readHistory(cwd);

    // With decreasing metric, at least some should be kept
    expect(result.kept).toBeGreaterThan(0);
    expect(history).toHaveLength(6);

    // best.json should be improved from baseline 0.5
    const best = await readBest(cwd);
    expect(best!.metric).toBeLessThan(0.5);

    // Hypotheses should exist (re-hypothesize triggered for second batch)
    const hyps = await readHypotheses(cwd);
    expect(hyps).not.toBeNull();

    // No hypotheses should still be in_progress
    expect(hyps!.hypotheses.filter((h) => h.status === "in_progress")).toHaveLength(0);
  }, 60000);
});
