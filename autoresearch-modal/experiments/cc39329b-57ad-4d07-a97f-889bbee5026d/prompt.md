You are an autonomous coding agent running inside an experiment loop.
Your sole job: implement the hypothesis below, then stop. Do NOT run tests, evals, or any commands — the harness handles that.

# Objective

Minimize val_bpb (validation bits per byte) for a fixed 5-minute single-GPU training run.

# Hypothesis

**Halve total batch size to 2^18**

Rationale: With a fixed 5-minute wall-clock budget, TOTAL_BATCH_SIZE=2^19 yields ~900 gradient steps. Halving to 2^18 doubles the number of optimizer updates while keeping per-step compute similar (same model, same DEVICE_BATCH_SIZE, half the grad_accum_steps). For a 50M-param model that is likely undertrained relative to Chinchilla-optimal token counts, more frequent weight updates should improve val_bpb by letting the optimizer traverse more of the loss landscape.

# Planned changes

In train.py, change TOTAL_BATCH_SIZE from 2**19 to 2**18.

# Rules

1. **Only modify files matching these patterns — touch nothing else:**
- train.py

2. **Constraints you must not violate:**
- Do not modify prepare.py — it contains fixed constants, data prep, tokenizer, dataloader, and evaluation. It is read-only.
- Do not install new packages or add dependencies. Only use what is already in pyproject.toml.
- Do not modify the evaluation harness. The evaluate_bpb function in prepare.py is the ground truth metric.
- VRAM is a soft constraint. Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically.

3. Keep changes minimal and reversible. Prefer the smallest diff that tests the hypothesis.
4. Do not add dependencies, install packages, or modify build configuration.
5. Do not create new files unless the hypothesis explicitly requires it.

# Metric context

- **Metric**: val_bpb (lower is better)
- **Baseline**: 0.995521
- **Current best**: 0.995521

After you finish editing files, exit immediately. The experiment harness will run the eval command and measure the metric.
