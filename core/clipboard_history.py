"""Best-effort push of clipboard entries into history tools already running.

Detects active tools per copy (PATH / process / DBus only — no config writes)
and pushes the same bytes. Failures never raise to the caller; paste path is
untouched. Klipper is intentionally not a target: it watches the Wayland
selection itself and stores real images natively — a DBus text placeholder
here would only pollute its history.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

# ponytail: hard per-subprocess budget — copy feedback waits ≤1s total (SC-004)
TIMEOUT = 1.0


@dataclass(frozen=True)
class HistoryTarget:
    kind: str      # cliphist | copyq
    mode: str      # image_bytes
    how: str       # short label for tests/debug


def _cliphist_running() -> bool:
    if not shutil.which("cliphist"):
        return False
    # watcher process: wl-paste --watch ... cliphist store
    try:
        r = subprocess.run(
            ["pgrep", "-af", "cliphist"],
            capture_output=True, text=True, timeout=0.5,
        )
        for line in (r.stdout or "").splitlines():
            if "pgrep" in line:
                continue
            if "cliphist" in line and ("wl-paste" in line or " store" in line or line.rstrip().endswith("cliphist store")):
                return True
    except Exception:
        pass
    # cliphist DB usable (no watcher required for store)
    cache = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    db = os.path.join(cache, "cliphist", "db")
    if not os.path.isfile(db):
        return False
    try:
        r = subprocess.run(
            ["cliphist", "list"],
            capture_output=True, timeout=TIMEOUT,
        )
        return r.returncode == 0
    except Exception:
        return False


def _copyq_running() -> bool:
    if not shutil.which("copyq"):
        return False
    try:
        r = subprocess.run(["pgrep", "-x", "copyq"], capture_output=True, timeout=0.5)
        return r.returncode == 0
    except Exception:
        return False


def detect_running_history_tools() -> list:
    """No side effects; safe when tools missing. Image-capable targets first."""
    targets: list = []
    if _cliphist_running():
        targets.append(HistoryTarget("cliphist", "image_bytes", "stdin store"))
    if _copyq_running():
        targets.append(HistoryTarget("copyq", "image_bytes", "copyq add"))
    return targets


def _push_cliphist(data: bytes, mime: str) -> bool:
    if not shutil.which("cliphist"):
        return False
    try:
        p = subprocess.Popen(
            ["cliphist", "store"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            p.communicate(data, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            return False
        return p.returncode == 0
    except Exception:
        return False


def _push_copyq(data: bytes, mime: str) -> bool:
    if not shutil.which("copyq"):
        return False
    try:
        p = subprocess.Popen(
            ["copyq", "add", "-"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            p.communicate(data, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            return False
        return p.returncode == 0
    except Exception:
        return False


def push_history(data: bytes, mime: str, targets: list) -> str:
    """Best-effort push. Returns 'pushed' iff ≥1 target succeeded, else 'skipped'.

    Empty targets → 'skipped' (endpoint maps no-detect to 'unsupported').
    Never raises (FR-004).
    """
    if not targets:
        return "skipped"
    ok = False
    for t in targets:
        try:
            if t.kind == "cliphist":
                ok = _push_cliphist(data, mime) or ok
            elif t.kind == "copyq":
                ok = _push_copyq(data, mime) or ok
        except Exception:
            continue
    return "pushed" if ok else "skipped"
