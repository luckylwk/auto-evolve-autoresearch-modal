# Program

## Objective

Minimize val_bpb (validation bits per byte) for a fixed 5-minute single-GPU training run.

## Metric

- **Name**: val_bpb
- **Direction**: lower_is_better
- **Extract command**: grep "^val_bpb:" run.log | tail -1 | awk '{print $2}'

## Eval Command

`uv run modal_runner.py`

## Scope

- You may modify `train.py` to optimize for val_bpb.

## Constraints

- ❌ Do NOT touch or modify `prepare.py` — it contains fixed constants, data prep, tokenizer, dataloader, and evaluation. It is read-only.
- ❌ Do NOT install new packages or add dependencies. Only use what is already in pyproject.toml.
- ❌ Do NOT modify the evaluation harness. The evaluate_bpb function in prepare.py is the ground truth metric.

- VRAM is a soft constraint. Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically.

## Context

Single-GPU LLM pretraining experiment. The training script runs for a fixed 5-minute wall-clock time budget (excluding startup/compilation). Everything is fair game: model architecture, optimizer, hyperparameters, batch size, model size.

The model is a GPT variant with: RoPE, RMSNorm, sliding window attention (SSSL pattern), value embeddings, per-layer residual/skip lambdas, logit soft-capping, and a combined Muon+AdamW optimizer. Key hyperparameters are module-level constants in train.py (DEPTH, ASPECT_RATIO, TOTAL_BATCH_SIZE, learning rates, etc.).

Primary model size knob is DEPTH (number of transformer layers). Model dimension = DEPTH * ASPECT_RATIO.

Simplicity criterion: all else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Removing something and getting equal or better results is a great outcome. Weigh complexity cost against improvement magnitude.

Key files for reference (read-only):
- `README.md` — repository context and design choices
- `prepare.py` — fixed constants (MAX_SEQ_LEN=2048, TIME_BUDGET=300, EVAL_TOKENS), tokenizer, dataloader, evaluate_bpb function

## Timeout

600
