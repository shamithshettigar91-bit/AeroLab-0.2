"""Reproducibility tests. Run from the project root:  python tests/test_experiments.py"""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dashboard"))
import aerolab_runner as runner  # noqa: E402
import experiments as ex  # noqa: E402

BASE = ["nose_ogive", "payload_sci", "avionics"]
RUNS = [
    {"design": {"stack": [*BASE, "tank_m", "eng_sparrow"], "fins": "fins_s"}, "stopAtApogee": True, "telemetry": True},
    {"design": {"stack": [*BASE, "tank_m", "eng_sparrow"], "fins": None}, "stopAtApogee": True, "telemetry": True},
    {"design": {"stack": [*BASE, "tank_l", "eng_heron"], "fins": "fins_s"}, "stopAtApogee": True, "telemetry": True,
     "throttlePlan": [{"from": 3000, "to": 20000, "throttle": 0.45}]},
]
LABELS = ["small fins", "no fins", "Heron throttled"]
passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1; print(f"  pass  {name}")
    else:
        failed += 1; print(f"  FAIL  {name} {detail}")


print("\nExperiment manifests")
model = runner.call({"cmd": "parts"})["model"]
results = runner.fly(RUNS)
m = ex.record("test", "unit test", RUNS, LABELS, results, model)
check("manifest has schema and id", m["schema"] == ex.SCHEMA and m["experimentId"].startswith("EXP-"))
check("outcomes recorded", [r["outcome"] for r in m["runs"]] == ["Success", "Failed: breakup", "Success"],
      [r["outcome"] for r in m["runs"]])
check("core hash recorded", len(m["code"]["coreSha256"]) == 64)

tmp = Path(tempfile.mkdtemp())
try:
    p = ex.save(m, tmp)
    check("save writes a file", p.exists())
    try:
        ex.save(m, tmp); check("save refuses to overwrite", False)
    except FileExistsError:
        check("save refuses to overwrite", True)
    loaded = ex.load(p)
    check("load round-trips", loaded == m)
    r = ex.reproduce(loaded)
    check("reproduces exactly", r["verdict"] == "reproduced exactly", r["counts"])
    check("no code change detected", not r["codeChanged"])

    tampered = ex.load(p)
    tampered["runs"][0]["resultSha256"] = "0" * 64
    tampered["runs"][0]["apogee_m"] *= 1.01
    r = ex.reproduce(tampered)
    check("a changed result is caught", r["verdict"] == "not reproduced" and r["counts"]["different"] == 1, r["counts"])

    tampered = ex.load(p)
    tampered["runs"][0]["resultSha256"] = "0" * 64
    r = ex.reproduce(tampered)
    check("tiny difference counts as within tolerance", r["verdict"] == "reproduced within tolerance", r["counts"])
finally:
    shutil.rmtree(tmp)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
