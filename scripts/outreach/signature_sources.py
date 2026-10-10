"""Shared by the two signature render scripts: where the signature HTML comes from.

By default the source is the ORIGINAL_LAWRENCE / ORIGINAL_ROVERTO strings in
convex/outreach/signatures.ts, i.e. exactly what the "original" signature mode
sends (badge-free since 2026-10-10). Pass a file path to render a different
version, for example a new design from Lawrence.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SIGNATURES_TS = ROOT / "convex" / "outreach" / "signatures.ts"
CONST = {"lawrence": "ORIGINAL_LAWRENCE", "roverto": "ORIGINAL_ROVERTO"}


def fragment(key: str, path: "pathlib.Path | None") -> str:
    if path is not None:
        return path.expanduser().read_text(encoding="utf-8")
    src = SIGNATURES_TS.read_text(encoding="utf-8")
    m = re.search(r'export const %s = ("(?:[^"\\]|\\.)*");' % CONST[key], src)
    if not m:
        raise SystemExit(f"{CONST[key]} not found in {SIGNATURES_TS}")
    return json.loads(m.group(1))


def launch(p, executable: "str | None"):
    """Chrome if installed, else Playwright's Chromium, else an explicit binary."""
    if executable:
        return p.chromium.launch(executable_path=executable)
    try:
        return p.chromium.launch(channel="chrome")
    except Exception:
        return p.chromium.launch()
