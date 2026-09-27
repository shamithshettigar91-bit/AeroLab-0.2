#!/usr/bin/env python3
"""Reproduce a saved AeroLab experiment from the terminal.

    python tools/reproduce.py experiments/EXP-20260927-140000-ab12.json
    python tools/reproduce.py --all

Exit code 0 when every experiment reproduces (exactly or within tolerance), 1 otherwise.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dashboard"))
import experiments as ex  # noqa: E402


def main(argv):
    if not argv:
        print(__doc__); return 2
    paths = [e["path"] for e in ex.list_saved()] if argv[0] == "--all" else [Path(a) for a in argv]
    if not paths:
        print("No experiments found in experiments/."); return 0
    ok = True
    for p in paths:
        m = ex.load(p)
        r = ex.reproduce(m)
        c = r["counts"]
        flag = "" if r["verdict"] != "not reproduced" else "  <-- FAILED"
        print(f"{m['experimentId']}  {m['name']}: {r['verdict']} "
              f"({c['identical']} identical, {c['within tolerance']} within tolerance, {c['different']} different){flag}")
        if r["codeChanged"]:
            print("    note: simulation core changed since recording")
        for row in r["rows"]:
            if row["status"] == "different":
                print(f"    {row['runId']} {row['label']}: apogee {row['apogee_recorded_m']:.1f} m -> {row['apogee_now_m']:.1f} m")
        ok &= r["verdict"] != "not reproduced"
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
