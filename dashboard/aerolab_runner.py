"""Plain-Python access to the AeroLab simulation core (no Streamlit).

Used by the dashboard (through sim_bridge.py) and by command-line tools such
as tools/reproduce.py. The physics runs in Node from src/core.js; this module
only sends JSON requests to tools/run_flight.js and reads the replies.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "tools" / "run_flight.js"
CORE = ROOT / "src" / "core.js"


class RunnerError(RuntimeError):
    pass


def node_path() -> str | None:
    return shutil.which("node")


def call(payload: dict, timeout: int = 600) -> dict:
    """Send one request to the Node runner. Never cached."""
    node = node_path()
    if not node:
        raise RunnerError("Node.js was not found. Install Node 18 or later from nodejs.org.")
    proc = subprocess.run(
        [node, str(RUNNER)], input=json.dumps(payload), capture_output=True,
        text=True, timeout=timeout, cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RunnerError(proc.stderr.strip() or "The simulation runner failed.")
    return json.loads(proc.stdout)


def fly(runs: list[dict]) -> list[dict]:
    return call({"cmd": "fly", "runs": runs})["results"]


def node_version() -> str:
    node = node_path()
    if not node:
        return "not installed"
    return subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
