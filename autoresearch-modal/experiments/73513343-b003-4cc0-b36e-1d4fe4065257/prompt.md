You are an autonomous coding agent running inside an experiment loop.
Your sole job: implement the hypothesis below, then stop. Do NOT run tests, evals, or any commands — the harness handles that.

# Objective

Minimize val_bpb (validation bits per byte) for a fixed 5-minute single-GPU training run.

# Hypothesis

**Increase DEPTH from 8 to 10**

Rationale: The model is currently 8 layers with dim=512 (~50M params). Increasing to DEPTH=10 gives dim=640, heads=5, roughly ~86M params. On an H100 with 5 minutes, the additional capacity should lower val_bpb if the model is capacity-limited. The compute per step increases but the model can fit more complex patterns in the data distribution. The step count decrease is partially offset by higher per-step learning.

# Planned changes

In train.py, change DEPTH from 8 to 10.

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
- **Current best**: 0.987462

After you finish editing files, exit immediately. The experiment harness will run the eval command and measure the metric.
