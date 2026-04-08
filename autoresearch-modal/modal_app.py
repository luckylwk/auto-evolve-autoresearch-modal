"""
Modal app for autoresearch GPU training.

Deploy:  modal deploy modal_app.py
Test:    python modal_runner.py
"""

import modal

app = modal.App("autoresearch")

# Persistent volumes for caching data and HF hub downloads
data_volume = modal.Volume.from_name("autoresearch-cache", create_if_missing=True)
hf_cache_volume = modal.Volume.from_name("autoresearch-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.11.0",
        extra_index_url="https://download.pytorch.org/whl/cu128",
    )
    .pip_install(
        "kernels>=0.12.3",
        "rustbpe>=0.1.0",
        "tiktoken>=0.12.0",
        "numpy>=2.4.4",
        "pandas>=3.0.2",
        "pyarrow>=23.0.0",
        "requests>=2.33.1",
        "matplotlib>=3.10.8",
    )
)

VOLUMES = {
    "/root/.cache/autoresearch": data_volume,
    "/root/.cache/huggingface": hf_cache_volume,
}
WORKDIR = "/tmp/autoresearch"


def _write_sources(train_py: str, prepare_py: str):
    """Write source files to the working directory."""
    import os

    os.makedirs(WORKDIR, exist_ok=True)
    with open(f"{WORKDIR}/train.py", "w") as f:
        f.write(train_py)
    with open(f"{WORKDIR}/prepare.py", "w") as f:
        f.write(prepare_py)


def _parse_metrics(stdout: str) -> dict:
    """Parse key=value metrics from training stdout."""
    metric_keys = {
        "val_bpb",
        "training_seconds",
        "total_seconds",
        "peak_vram_mb",
        "mfu_percent",
        "total_tokens_M",
        "num_steps",
        "num_params_M",
        "depth",
    }
    metrics = {}
    for line in stdout.split("\n"):
        if ":" in line:
            key = line.split(":")[0].strip()
            if key in metric_keys:
                val = line.split(":", 1)[1].strip()
                try:
                    metrics[key] = float(val)
                except ValueError:
                    metrics[key] = val
    return metrics


@app.function(
    image=image,
    gpu="H100",
    timeout=600,
    volumes=VOLUMES,
)
def run_training(train_py: str, prepare_py: str) -> dict:
    """Run a single training experiment on a GPU. Returns metrics + stdout/stderr."""
    import os
    import subprocess

    _write_sources(train_py, prepare_py)

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}

    # Prepare data (idempotent — skips if already cached in volume)
    prep = subprocess.run(
        ["python", f"{WORKDIR}/prepare.py", "--num-shards", "10"],
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
    )
    if prep.returncode != 0:
        data_volume.commit()
        return {
            "metrics": {},
            "stdout": prep.stdout,
            "stderr": f"prepare.py failed:\n{prep.stderr}",
            "returncode": prep.returncode,
        }
    data_volume.commit()

    # Train
    result = subprocess.run(
        ["python", f"{WORKDIR}/train.py"],
        capture_output=True,
        text=True,
        timeout=540,
        env=env,
        cwd=WORKDIR,
    )

    return {
        "metrics": _parse_metrics(result.stdout),
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }
