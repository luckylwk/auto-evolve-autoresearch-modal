You are an autonomous coding agent running inside an experiment loop.
Your sole job: implement the hypothesis below, then stop. Do NOT run tests, evals, or any commands — the harness handles that.

# Objective

Minimize val_bpb (validation bits per byte) for a fixed 5-minute single-GPU training run.

# Hypothesis

**Increase Muon matrix LR from 0.04 to 0.06**

Rationale: The Muon optimizer handles all 2D matrix parameters (attention projections, MLP layers). With only 5 minutes of training, a higher matrix learning rate could accelerate convergence. The current LR 0.04 was likely tuned at a different scale; the dmodel_lr_scale correction only applies to AdamW groups. A 50% increase is moderate and within typical Muon LR ranges. If the model is undertrained, faster matrix updates should lower val_bpb.

# Planned changes

In train.py, change MATRIX_LR from 0.04 to 0.06.

# Rules

1. **Only modify files matching these patterns — touch nothing else:**
- You may modify `train.py` to optimize for val_bpb.

2. **Constraints you must not violate:**
- ❌ Do NOT touch or modify `prepare.py` — it contains fixed constants, data prep, tokenizer, dataloader, and evaluation. It is read-only.
- ❌ Do NOT install new packages or add dependencies. Only use what is already in pyproject.toml.
- ❌ Do NOT modify the evaluation harness. The evaluate_bpb function in prepare.py is the ground truth metric.
- VRAM is a soft constraint. Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically.

3. Keep changes minimal and reversible. Prefer the smallest diff that tests the hypothesis.
4. Do not add dependencies, install packages, or modify build configuration.
5. Do not create new files unless the hypothesis explicitly requires it.

# Metric context

- **Metric**: val_bpb (lower is better)
- **Baseline**: 0.995521
- **Current best**: 0.984317

After you finish editing files, exit immediately. The experiment harness will run the eval command and measure the metric.
