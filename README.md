# Auto-Evolve

Autonomous experiment loops for AI research. The human writes `program.md`, the AI agent writes code, the CLI orchestrates hypothesis-driven improvement cycles.

## Structure

| Package | Description | Stack |
|---------|-------------|-------|
| [auto-evolve-cli](./auto-evolve-cli/) | CLI that orchestrates autonomous experiment loops | TypeScript, Bun, Commander.js |
| [autoresearch-modal](./autoresearch-modal/) | LLM pretraining on Modal H100s (based on [Karpathy's autoresearch](https://github.com/karpathy/autoresearch)) | Python, uv, Modal, PyTorch |

## Prerequisites

- [just](https://github.com/casey/just) - command runner
- [Bun](https://bun.sh) - JS runtime (auto-evolve-cli)
- [uv](https://docs.astral.sh/uv/) - Python package manager (autoresearch-modal)
- [Modal](https://modal.com) account - GPU training (`modal setup` for one-time auth)

## Quick Start

```bash
# Install everything
just install

# --- auto-evolve-cli ---
just cli-build              # compile
just cli-link               # build + register global `auto-evolve` command
just cli-check              # lint + format + typecheck + test
just cli-dev -- init        # run in dev mode without building

# --- autoresearch-modal ---
modal setup                 # one-time Modal auth
just modal-deploy           # deploy Modal app
just modal-train            # run training on H100 (~5 min, ~$0.33)
just modal-prepare          # download data + train tokenizer
```

See [auto-evolve-cli/README.md](./auto-evolve-cli/README.md) and [autoresearch-modal/README.md](./autoresearch-modal/README.md) for full docs.

## How It Works

1. **Initialize** - `auto-evolve init` creates config, `program.md` template, and a git branch
2. **Define** - edit `program.md` with objective, metric, eval command, and scope
3. **Baseline** - `auto-evolve baseline` runs eval once to record starting metric
4. **Loop** - `auto-evolve loop` autonomously hypothesizes, implements, evaluates, and keeps or reverts

The `autoresearch-modal` package is a ready-made target: it uses auto-evolve to autonomously optimize a GPT training script on Modal H100s.

## All Commands

Run `just` at the root to see all available recipes:

```
install             # Install all dependencies
check               # Run all checks (lint + format + typecheck + test)

cli-install         # Install CLI dependencies
cli-build           # Build CLI
cli-link            # Install CLI globally (build + bun link)
cli-test            # Run CLI tests
cli-test-watch      # Run CLI tests in watch mode
cli-lint            # Lint CLI
cli-lint-fix        # Lint CLI with auto-fix
cli-format          # Format CLI code
cli-format-check    # Check CLI formatting
cli-typecheck       # Type-check CLI
cli-check           # Run full CLI quality check
cli-dev             # Run CLI in dev mode (pass args after --)

modal-install       # Install Modal project dependencies
modal-deploy        # Deploy Modal app
modal-train         # Run training on Modal H100
modal-format        # Format Modal project code
modal-format-check  # Check Modal project formatting
modal-prepare       # Prepare data (download + tokenizer)
```
