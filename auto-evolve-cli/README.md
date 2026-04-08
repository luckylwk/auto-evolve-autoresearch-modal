# Auto-Evolve

Autonomous experiment CLI — hypothesis-driven improvement loops on any codebase.

The human writes `program.md`. The agent writes the code. The CLI orchestrates the loop.

## Install

```bash
just build    # compiles src/index.ts -> dist/index.js
bun link      # registers `auto-evolve` as a global command
```

After this, `auto-evolve` is available from any directory.

## Quick Start

### 1. Initialize

```bash
cd /path/to/your/project    # must be a git repo
auto-evolve init
```

This creates:

- `.auto-evolve/config.json` — default configuration
- `.auto-evolve/llm-calls/` — directory for saved agent prompts
- `program.md` — **template you must edit** before continuing (skipped if file already exists)
- `experiments/` — directory for per-experiment artifacts
- Appends auto-evolve entries to `.gitignore`
- Creates a new git branch `autoloop/<date>` from current HEAD

Use `--name <tag>` for a custom branch name: `auto-evolve init --name my-experiment`
Use `--force` to reinitialize an existing project.

### 2. Edit program.md

The generated `program.md` is a template with placeholder comments. **You must fill in every required section before running baseline.** Here is the template with an example of what to write:

```markdown
# Program

## Objective

Minimize val_bpb for a 5-minute training run.

## Metric

- **Name**: val_bpb
- **Direction**: lower_is_better
- **Extract command**: grep "^val_bpb:" run.log | tail -1 | awk '{print $2}'

## Eval Command

uv run train.py

## Scope

- train.py
- src/model.py

## Constraints

- Do not modify prepare.py
- Do not install new packages

## Context

The model is a GPT variant with 50M params. Training runs for a fixed
5-minute wall-clock budget. Everything in train.py is fair game.

## Timeout

300
```

**Section reference:**

| Section          | Required | What to write                                                                                                                                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**    | Yes      | One sentence: what metric are you optimizing?                                                                                                                                                         |
| **Metric**       | Yes      | Three `**Key**: value` pairs. **Name**: metric id. **Direction**: `lower_is_better` or `higher_is_better`. **Extract command**: shell command that reads `run.log` and prints ONLY a number to stdout |
| **Eval Command** | Yes      | Shell command to run one experiment. stdout+stderr are automatically captured to `run.log` — do NOT add `> run.log` yourself                                                                          |
| **Scope**        | Yes      | Bullet list of files/globs the agent may modify. One per line                                                                                                                                         |
| **Constraints**  | No       | Bullet list of rules the agent must not violate                                                                                                                                                       |
| **Context**      | No       | Free-form domain knowledge, architecture details, hints                                                                                                                                               |
| **Timeout**      | No       | Max seconds for eval command (default: 300). Hard kill at 2x this value                                                                                                                               |

### 3. Establish baseline

```bash
auto-evolve baseline
```

Runs your eval command once on the unmodified code, extracts the metric via your extract command, and saves the result. Creates:

- `.auto-evolve/baseline.json` — `{metric, commit, timestamp}`
- `.auto-evolve/best.json` — initially same as baseline
- `.auto-evolve/history.jsonl` — first entry
- `results.tsv` — header + baseline row

Use `--force` to re-run if a baseline already exists.
Use `--timeout <seconds>` to override the timeout from program.md.

### 4. Run the loop

```bash
auto-evolve loop --max-experiments 20
```

Each iteration of the loop:

1. **Hypothesize** — agent analyzes the project and writes ranked hypotheses to `.auto-evolve/hypotheses.json` (skipped if pending hypotheses remain)
2. **Implement** — agent picks the highest-priority pending hypothesis and modifies files in scope
3. **Commit** — CLI runs `git add -A && git commit` with the hypothesis title
4. **Eval** — runs your eval command, captures stdout+stderr to `run.log`
5. **Extract** — runs your extract command against `run.log` to get the metric
6. **Decide** — if improved vs. current best: keep commit + update `.auto-evolve/best.json`. If not: `git revert`
7. **Log** — appends to `history.jsonl` and `results.tsv`, archives artifacts to `experiments/<id>/`

The loop stops when: `--max-experiments` reached, `--max-failures` consecutive failures reached, or Ctrl+C.

## What the loop produces

| Output                         | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| Git commits                    | One per kept experiment. Reverted experiments leave no trace      |
| `.auto-evolve/history.jsonl`   | Append-only log of every experiment (kept, reverted, crashed)     |
| `.auto-evolve/baseline.json`   | Original metric snapshot                                          |
| `.auto-evolve/best.json`       | Current best metric snapshot                                      |
| `.auto-evolve/hypotheses.json` | Current hypothesis batch with per-hypothesis status               |
| `results.tsv`                  | Tab-separated summary: commit, metric, delta, status, description |
| `experiments/<id>/`            | Per-experiment: prompt.md, patch.diff, run.log                    |
| `run.log`                      | Output from the most recent eval command                          |

## Commands

| Command                                | Description                                                       |
| -------------------------------------- | ----------------------------------------------------------------- |
| `auto-evolve init`                     | Create `.auto-evolve/`, `program.md` template, config, git branch |
| `auto-evolve baseline`                 | Run eval command once and record the starting metric              |
| `auto-evolve loop`                     | Run the autonomous experiment loop                                |
| `auto-evolve status`                   | Print dashboard: baseline, best, improvement, hypothesis stats    |
| `auto-evolve report`                   | Generate a human-readable markdown report                         |
| `auto-evolve config view`              | Print current config as JSON                                      |
| `auto-evolve config get <key>`         | Print a single config value                                       |
| `auto-evolve config set <key> <value>` | Update a config value                                             |

### Loop flags

| Flag                        | Default         | Description                               |
| --------------------------- | --------------- | ----------------------------------------- |
| `--max-experiments <n>`     | 50              | Stop after N experiments                  |
| `--timeout <seconds>`       | from program.md | Override timeout per experiment           |
| `--max-failures <n>`        | 10              | Stop after N consecutive failures         |
| `--rehypothesize-every <n>` | 5               | Regenerate hypotheses every N experiments |

## Configuration

Stored in `.auto-evolve/config.json`. Precedence: CLI flags > env vars > config file > defaults.

| Field                    | Default                    | Env var            | Description                                     |
| ------------------------ | -------------------------- | ------------------ | ----------------------------------------------- |
| `stateDir`               | `.auto-evolve`             |                    | State directory name                            |
| `agentCommand`           | `claude`                   |                    | CLI agent to invoke (`claude`, `codex`, etc.)   |
| `model`                  | `claude-sonnet-4-20250514` | `AUTOLOOP_MODEL`   | Model passed to the agent                       |
| `maxHypothesesPerBatch`  | `8`                        |                    | Hypotheses generated per batch                  |
| `timeoutSeconds`         | `300`                      | `AUTOLOOP_TIMEOUT` | Default timeout per experiment                  |
| `branchPrefix`           | `autoloop`                 |                    | Git branch prefix used by init                  |
| `autoRehypothesizeEvery` | `5`                        |                    | Regenerate hypotheses every N experiments       |
| `maxConsecutiveFailures` | `10`                       |                    | Stop loop after N consecutive failures          |
| `simplicityBias`         | `true`                     |                    | Prefer simpler changes in hypothesis generation |
| `logLlmCalls`            | `true`                     |                    | Save agent prompts to `.auto-evolve/llm-calls/` |

## Development

```bash
just dev -- init          # run any command in dev mode (no build needed)
just build                # compile to dist/index.js
just test                 # run all tests (vitest)
just check                # lint + format-check + typecheck + test
```
