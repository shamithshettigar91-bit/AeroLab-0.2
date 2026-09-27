#!/usr/bin/env python3
"""Record the regression baseline: the designs that define the learning path.

    python tools/record_baseline.py

Writes experiments/EXP-BASELINE-<physics version>.json. Commit your code first,
so the baseline points at a clean Git commit.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dashboard"))
import aerolab_runner as runner  # noqa: E402
import experiments as ex  # noqa: E402

B = ["nose_ogive", "payload_sci", "avionics"]
H = ["nose_ogive", "payload_heavy", "avionics"]
S = ["nose_ogive", "payload_sci", "srm_needle"]
THR = [{"from": 3000, "to": 20000, "throttle": 0.45}]
CASES = [
    ("Starter, no fins", [*B, "tank_m", "eng_sparrow"], None, None),
    ("Starter, small fins", [*B, "tank_m", "eng_sparrow"], "fins_s", None),
    ("Starter, large fins", [*B, "tank_m", "eng_sparrow"], "fins_l", None),
    ("Tank S, small fins", [*B, "tank_s", "eng_sparrow"], "fins_s", None),
    ("Heavy payload, tank M", [*H, "tank_m", "eng_sparrow"], "fins_s", None),
    ("Heavy payload, tank L", [*H, "tank_l", "eng_sparrow"], "fins_s", None),
    ("Heron, full throttle", [*B, "tank_l", "eng_heron"], "fins_s", None),
    ("Heron, 45% from 3 to 20 km", [*B, "tank_l", "eng_heron"], "fins_s", THR),
    ("Solid, no fins", S, None, None),
    ("Solid, small fins", S, "fins_s", None),
    ("Solid, large fins", S, "fins_l", None),
]

runs, labels = [], []
for label, stack, fins, plan in CASES:
    r = {"design": {"stack": stack, "fins": fins}, "stopAtApogee": True, "telemetry": True}
    if plan:
        r["throttlePlan"] = plan
    runs.append(r); labels.append(label)

model = runner.call({"cmd": "parts"})["model"]
m = ex.record(f"{model['physics']} balance baseline", "Regression baseline", runs, labels, runner.fly(runs), model,
              "The tested learning path from PROJECT_REPORT section 7. Reproduce after any physics change.")
m["experimentId"] = "EXP-BASELINE-" + model["physics"].replace(" ", "-")
m["manifestSha256"] = ex.sha256(ex._canon({k: v for k, v in m.items() if k != "manifestSha256"}))
if m["code"]["gitDirty"]:
    print("Warning: simulation code has uncommitted changes.")
path = ex.save(m)
print(f"Saved {path.name}")
for r in m["runs"]:
    print(f"  {r['runId']}  {r['label']:<28} {r['outcome']:<18} {r['apogee_m'] / 1000:8.1f} km")
