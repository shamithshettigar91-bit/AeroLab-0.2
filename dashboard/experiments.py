"""AeroLab experiment manifests: record a batch of flights, then reproduce it.

A manifest stores everything needed to rerun an experiment exactly:
the flight requests (designs and flight plans), the physics model versions,
the code version (Git commit plus a hash of the simulation core), the runtime,
and a fingerprint of every result. Reproducing reruns the stored requests
against the current code and compares fingerprints.

No Streamlit import here, so tools/reproduce.py can use it from the terminal.
"""
from __future__ import annotations

import hashlib
import json
import platform
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import aerolab_runner as runner

SCHEMA = "aerolab.experiment/1"
EXP_DIR = runner.ROOT / "experiments"
TOLERANCE = 1e-6  # relative, for "matches within tolerance"


# ---------- fingerprints ----------
def _canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(text: str | bytes) -> str:
    if isinstance(text, str):
        text = text.encode("utf-8")
    return hashlib.sha256(text).hexdigest()


def result_digest(result: dict) -> dict:
    """The comparable part of a flight result, plus its hash.

    Telemetry is hashed rather than stored, so manifests stay small but any
    change anywhere in the flight history is still detected.
    """
    core = {
        "success": result.get("success"),
        "apogee": result.get("apogee"),
        "max": result.get("max"),
        "loss": result.get("loss"),
        "failure": result.get("failure"),
        "events": result.get("events"),
        "error": result.get("error"),
        "telemetrySha256": sha256(_canon(result.get("telemetry") or [])),
    }
    return {"summary": core, "sha256": sha256(_canon(core))}


# Telemetry channels recorded by AeroModel 0.1. V0.2 added channels (stage,
# apoapsis, periapsis...) without changing these, so an old experiment can be
# checked for exact reproduction by projecting today's telemetry onto them.
V01_CHANNELS = ("t", "alt", "speed", "g", "q", "mass", "mach", "thrust", "fuel", "down")


def legacy_digest(result: dict) -> str:
    """Hash in the V0.1.1 manifest format: telemetry limited to the V0.1 channels."""
    tele = [{k: s[k] for k in V01_CHANNELS if k in s} for s in (result.get("telemetry") or [])]
    core = {k: result.get(k) for k in ("success", "apogee", "max", "loss", "failure", "events", "error")}
    core = {"success": core["success"], "apogee": core["apogee"], "max": core["max"], "loss": core["loss"],
            "failure": core["failure"], "events": core["events"], "error": core["error"],
            "telemetrySha256": sha256(_canon(tele))}
    return sha256(_canon(core))


# ---------- code version ----------
def code_version() -> dict:
    fc = runner.CORE.parent / "flight_computer.js"
    acorn = runner.CORE.parent.parent / "vendor" / "acorn.js"
    info = {"coreSha256": sha256(runner.CORE.read_bytes()),
            "runnerSha256": sha256(runner.RUNNER.read_bytes()),
            # flight programs also depend on the flight computer and its parser (since V0.2)
            "flightComputerSha256": sha256(fc.read_bytes() + acorn.read_bytes()) if fc.exists() else None,
            "gitCommit": None, "gitTag": None, "gitDirty": None}
    try:
        def git(*a):
            return subprocess.run(["git", *a], cwd=runner.ROOT, capture_output=True, text=True, timeout=10)
        head = git("rev-parse", "HEAD")
        if head.returncode == 0:
            info["gitCommit"] = head.stdout.strip()
            tag = git("describe", "--tags", "--always")
            info["gitTag"] = tag.stdout.strip() if tag.returncode == 0 else None
            dirty = git("status", "--porcelain", "--", "src", "tools")
            info["gitDirty"] = bool(dirty.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return info


def runtime() -> dict:
    return {"node": runner.node_version(), "python": sys.version.split()[0],
            "platform": platform.platform()}


# ---------- create / save / load ----------
def new_id() -> str:
    return "EXP-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)


def record(name: str, kind: str, runs: list[dict], labels: list[str], results: list[dict],
           model: dict, notes: str = "") -> dict:
    """Build a manifest from requests and the results they produced."""
    entries = []
    for i, (req, lab, res) in enumerate(zip(runs, labels, results)):
        req = {**req, "telemetry": True}  # fingerprints always cover telemetry
        d = result_digest(res)
        s = d["summary"]
        entries.append({
            "runId": f"R{i + 1:03d}",
            "label": lab,
            "request": req,
            "requestSha256": sha256(_canon(req)),
            "outcome": ("Success" if s["success"] else
                        ("Failed: " + s["failure"]["kind"]) if s["failure"] else
                        ("Invalid design" if s["error"] else "Fell short")),
            "apogee_m": s["apogee"],
            "maxQ_Pa": (s["max"] or {}).get("q"),
            "maxG": (s["max"] or {}).get("g"),
            "resultSha256": d["sha256"],
        })
    manifest = {
        "schema": SCHEMA,
        "experimentId": new_id(),
        "name": name or kind,
        "kind": kind,
        "notes": notes,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model,
        "code": code_version(),
        "runtime": runtime(),
        "runs": entries,
    }
    manifest["manifestSha256"] = sha256(_canon({k: v for k, v in manifest.items() if k != "manifestSha256"}))
    return manifest


def save(manifest: dict, folder: Path = EXP_DIR) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{manifest['experimentId']}.json"
    if path.exists():
        raise FileExistsError(f"{path.name} already exists. Experiments are never overwritten.")
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load(path: Path | str) -> dict:
    m = json.loads(Path(path).read_text(encoding="utf-8"))
    check_schema(m)
    return m


def check_schema(m: dict) -> None:
    if m.get("schema") != SCHEMA:
        raise ValueError(f"Not an AeroLab experiment (expected schema {SCHEMA}).")


def list_saved(folder: Path = EXP_DIR) -> list[dict]:
    out = []
    for p in sorted(folder.glob("EXP-*.json"), reverse=True):
        try:
            m = load(p)
            out.append({"path": p, "id": m["experimentId"], "name": m["name"], "kind": m["kind"],
                        "createdAt": m["createdAt"], "runs": len(m["runs"])})
        except (ValueError, json.JSONDecodeError, KeyError):
            continue
    return out


# ---------- reproduce ----------
def reproduce(manifest: dict) -> dict:
    """Rerun every stored request against the current code and compare."""
    check_schema(manifest)
    now_code = code_version()
    results = runner.fly([r["request"] for r in manifest["runs"]])
    now_model = runner.call({"cmd": "parts"})["model"]
    rows, counts = [], {"identical": 0, "within tolerance": 0, "different": 0}
    for entry, res in zip(manifest["runs"], results):
        d = result_digest(res)
        s = d["summary"]
        if d["sha256"] == entry["resultSha256"] or legacy_digest(res) == entry["resultSha256"]:
            status = "identical"  # the legacy form matches experiments recorded before V0.2
        else:
            a0, a1 = entry["apogee_m"] or 0.0, s["apogee"] or 0.0
            same_outcome = bool(s["success"]) == (entry["outcome"] == "Success")
            rel = abs(a1 - a0) / max(abs(a0), 1.0)
            status = "within tolerance" if same_outcome and rel <= TOLERANCE else "different"
        counts[status] += 1
        rows.append({"runId": entry["runId"], "label": entry["label"], "status": status,
                     "apogee_recorded_m": entry["apogee_m"], "apogee_now_m": s["apogee"],
                     "outcome_recorded": entry["outcome"],
                     "success_now": s["success"]})
    code_changed = now_code["coreSha256"] != manifest["code"]["coreSha256"]
    if manifest["code"].get("flightComputerSha256") is not None:  # absent in manifests before V0.2
        code_changed = code_changed or now_code["flightComputerSha256"] != manifest["code"]["flightComputerSha256"]
    model_changed = now_model != manifest["model"]
    verdict = ("reproduced exactly" if counts["identical"] == len(rows) else
               "reproduced within tolerance" if counts["different"] == 0 else "not reproduced")
    return {"verdict": verdict, "counts": counts, "rows": rows,
            "codeChanged": code_changed, "modelChanged": model_changed,
            "codeNow": now_code, "modelNow": now_model, "runtimeNow": runtime()}
