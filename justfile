# Auto-Evolve monorepo

cli_dir := "auto-evolve-cli"
modal_dir := "autoresearch-modal"

# List available recipes
default:
    @just --list

# --- Top-level shortcuts ---

# Install all dependencies (parallel)
install:
    just cli-install & just modal-install & wait

# Run all checks (lint + format + typecheck + test)
check:
    just cli-check & just modal-format-check & wait

# --- auto-evolve-cli ---

# Install CLI dependencies
cli-install:
    cd {{ cli_dir }} && bun install

# Build CLI
cli-build:
    cd {{ cli_dir }} && just build

# Install CLI globally (build + bun link)
cli-link:
    cd {{ cli_dir }} && just install

# Run CLI tests
cli-test:
    cd {{ cli_dir }} && just test

# Run CLI tests in watch mode
cli-test-watch:
    cd {{ cli_dir }} && just test-watch

# Lint CLI
cli-lint:
    cd {{ cli_dir }} && just lint

# Lint CLI with auto-fix
cli-lint-fix:
    cd {{ cli_dir }} && just lint-fix

# Format CLI code
cli-format:
    cd {{ cli_dir }} && just format

# Check CLI formatting
cli-format-check:
    cd {{ cli_dir }} && just format-check

# Type-check CLI
cli-typecheck:
    cd {{ cli_dir }} && just typecheck

# Run full CLI quality check (lint + format + typecheck + test)
cli-check:
    cd {{ cli_dir }} && just check

# Run CLI in dev mode (pass args after --)
cli-dev *args:
    cd {{ cli_dir }} && just dev {{ args }}

# --- autoresearch-modal ---

# Install Modal project dependencies
modal-install:
    cd {{ modal_dir }} && just install

# Deploy Modal app
modal-deploy:
    cd {{ modal_dir }} && just deploy

# Run training on Modal H100
modal-train:
    cd {{ modal_dir }} && just train

# Format Modal project code
modal-format:
    cd {{ modal_dir }} && just format

# Check Modal project formatting
modal-format-check:
    cd {{ modal_dir }} && just format-check

# Prepare data (download + tokenizer)
modal-prepare *args:
    cd {{ modal_dir }} && just prepare {{ args }}
