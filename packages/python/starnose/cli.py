import os
import subprocess
import sys
import shutil
from pathlib import Path


def ensure_node():
    if not shutil.which("node"):
        print("starnose requires Node.js.")
        print("install: https://nodejs.org")
        sys.exit(1)


def _find_local_cli():
    """Walk up from this file to find the monorepo's built CLI entry point."""
    d = Path(__file__).resolve().parent
    for _ in range(6):
        candidate = d / "packages" / "cli" / "dist" / "index.js"
        if candidate.exists():
            return str(candidate)
        d = d.parent
    return None


def main():
    ensure_node()
    args = sys.argv[1:]
    local = _find_local_cli()
    if local:
        cmd = ["node", local] + args
    else:
        cmd = ["npx", "--yes", "starnose"] + args
    result = subprocess.run(cmd, env={**os.environ})
    sys.exit(result.returncode)
