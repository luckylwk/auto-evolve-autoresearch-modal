"""
Local drop-in replacement for `uv run train.py`.
Dispatches training to Modal and prints stdout in the same format.

Usage: uv run modal_runner.py
"""

import sys

import modal


def main():
    with open("train.py") as f:
        train_py = f.read()
    with open("prepare.py") as f:
        prepare_py = f.read()

    fn = modal.Function.from_name("autoresearch", "run_training")
    result = fn.remote(train_py, prepare_py)

    # Print stdout (same format as local `uv run train.py`)
    print(result["stdout"], end="")
    if result["stderr"]:
        print(result["stderr"], file=sys.stderr, end="")

    sys.exit(result["returncode"])


if __name__ == "__main__":
    main()
