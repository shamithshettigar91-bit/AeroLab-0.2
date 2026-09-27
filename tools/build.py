#!/usr/bin/env python3
"""Build AeroLab into one self-contained index.html.
Usage (from the project root):  python3 tools/build.py

The sources are inlined unchanged. Their Node exports sit behind
`if (typeof module !== 'undefined')`, which is false in a browser.
"""
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "src"
parts = {
    "/*__ACORN__*/": root / "vendor" / "acorn.js",
    "/*__CORE__*/": src / "core.js",
    "/*__FC__*/": src / "flight_computer.js",
    "/*__PROGRAMS__*/": src / "programs.js",
    "/*__UI__*/": src / "ui.js",
}
# Syntax-check every source with Node first, so a typo never reaches the page.
if shutil.which("node"):
    for path in parts.values():
        r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f"Syntax error in {path.name}:\n{r.stderr.strip()}")
out = (src / "template.html").read_text(encoding="utf-8")
for marker, path in parts.items():
    code = path.read_text(encoding="utf-8")
    if "</script" in code.lower():
        raise SystemExit(f"{path.name} contains '</script', which would end the inline script early")
    if marker not in out:
        raise SystemExit(f"template.html is missing the {marker} placeholder")
    out = out.replace(marker, code)
(root / "index.html").write_text(out, encoding="utf-8")
print(f"Built index.html ({len(out):,} bytes)")
