import pytest
from unittest.mock import patch

from core import clipboard_history as ch


def test_detect_empty_when_no_tools():
    with patch.object(ch, "_cliphist_running", return_value=False), \
         patch.object(ch, "_copyq_running", return_value=False):
        assert ch.detect_running_history_tools() == []


def test_push_empty_targets_no_throw():
    assert ch.push_history(b"x", "image/png", []) == "skipped"


def test_detect_cliphist_image_bytes():
    with patch.object(ch, "_cliphist_running", return_value=True), \
         patch.object(ch, "_copyq_running", return_value=False):
        targets = ch.detect_running_history_tools()
        assert len(targets) == 1
        assert targets[0].kind == "cliphist"
        assert targets[0].mode == "image_bytes"


def test_detect_never_targets_klipper():
    # Klipper watches the Wayland selection itself; a DBus text placeholder
    # here would pollute its history with "Rems-Dl image: ..." entries.
    with patch.object(ch, "_cliphist_running", return_value=True), \
         patch.object(ch, "_copyq_running", return_value=True):
        assert not any(t.kind == "klipper" for t in ch.detect_running_history_tools())


def test_push_cliphist_success_returns_pushed():
    with patch.object(ch, "_push_cliphist", return_value=True):
        targets = [ch.HistoryTarget("cliphist", "image_bytes", "stdin store")]
        assert ch.push_history(b"x", "image/png", targets) == "pushed"


def test_push_all_targets_fail_returns_skipped():
    with patch.object(ch, "_push_cliphist", return_value=False), \
         patch.object(ch, "_push_copyq", return_value=False):
        targets = [
            ch.HistoryTarget("cliphist", "image_bytes", "stdin store"),
            ch.HistoryTarget("copyq", "image_bytes", "copyq add"),
        ]
        assert ch.push_history(b"x", "image/png", targets) == "skipped"


def test_push_popen_oserror_returns_skipped():
    with patch.object(ch.subprocess, "Popen", side_effect=OSError("boom")), \
         patch.object(ch.shutil, "which", return_value="/usr/bin/cliphist"):
        targets = [ch.HistoryTarget("cliphist", "image_bytes", "stdin store")]
        assert ch.push_history(b"x", "image/png", targets) == "skipped"


def test_detect_no_config_file_writes():
    # FR-003/FR-009: probes only — never open config paths for write
    with patch.object(ch.shutil, "which", return_value=None), \
         patch("builtins.open", side_effect=AssertionError("config write")):
        assert ch.detect_running_history_tools() == []
