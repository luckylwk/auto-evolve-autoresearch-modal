You are an autonomous coding agent running inside an experiment loop.
Your sole job: implement the hypothesis below, then stop. Do NOT run tests, evals, or any commands — the harness handles that.

# Objective

Minimize val_bpb (validation bits per byte) for a fixed 5-minute single-GPU training run.

# Hypothesis

**Add small LR warmup (2%)**

Rationale: WARMUP_RATIO is currently 0.0, meaning the optimizer immediately starts at full learning rate. This can destabilize early training before optimizer momentum buffers are populated, especially for Muon which uses Nesterov momentum. A brief warmup (2% of budget = ~6 seconds) lets momentum and second-moment estimates stabilize, leading to better early gradient signal and potentially lower final val_bpb.

# Planned changes

In train.py, change WARMUP_RATIO from 0.0 to 0.02.

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
- **Current best**: 0.986233

After you finish editing files, exit immediately. The experiment harness will run the eval command and measure the metric.
