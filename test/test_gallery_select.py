import io
import os
from unittest.mock import patch

import pytest

# Rems_Dl's load_dotenv() pollutes os.environ, which SettingsManager reads for
# its defaults — snapshot and restore so test_settings stays isolated.
_ENV_KEYS = [
    "API_TIMEOUT", "RETRY_WAIT", "ANTI_BAN_PAUSE", "DOWNLOAD_RETRIES",
    "USE_PROXY", "PROXY_URL", "VERIFY_TLS",
]
_env_before = {k: os.environ.get(k) for k in _ENV_KEYS}

import Rems_Dl  # noqa: E402

for _k, _v in _env_before.items():
    if _v is None:
        os.environ.pop(_k, None)
    else:
        os.environ[_k] = _v

from core import shared  # noqa: E402

H = {"User-Agent": "RemsDlDesktopApp/1.0"}


@pytest.fixture
def client():
    Rems_Dl.app.config["TESTING"] = True
    with Rems_Dl.app.test_client() as c:
        yield c


@pytest.fixture
def lib(tmp_path, monkeypatch):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "one.png").write_bytes(b"x")
    (tmp_path / "two.png").write_bytes(b"y")
    monkeypatch.setattr(Rems_Dl, "MASTER_FOLDER", str(tmp_path))
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    return tmp_path


class _FakeStdin:
    def __init__(self):
        self.buf = b""

    def write(self, b):
        self.buf += b

    def close(self):
        pass


class _FakeProc:
    def __init__(self, *a, **k):
        self.stdin = _FakeStdin()
        self.returncode = 0

    def wait(self, timeout=None):
        return 0


def test_clipboard_multi_uri(client, lib):
    captured = {}

    def fake_popen(*a, **k):
        p = _FakeProc()
        captured["stdin"] = p.stdin
        return p

    with patch("shutil.which", return_value="/usr/bin/wl-copy"), \
         patch("subprocess.Popen", side_effect=fake_popen):
        r = client.post(
            "/api/clipboard?uri=1",
            data="a/one.png\ntwo.png",
            headers=H,
        )
    assert r.status_code == 200
    expected = (
        f"file://{lib}/a/one.png\r\n"
        f"file://{lib}/two.png\r\n"
    ).encode()
    assert captured["stdin"].buf == expected


def test_clipboard_single_uri_regression(client, lib):
    captured = {}

    def fake_popen(*a, **k):
        p = _FakeProc()
        captured["stdin"] = p.stdin
        return p

    with patch("shutil.which", return_value="/usr/bin/wl-copy"), \
         patch("subprocess.Popen", side_effect=fake_popen):
        r = client.post("/api/clipboard?uri=1", data="two.png", headers=H)
    assert r.status_code == 200
    assert captured["stdin"].buf == f"file://{lib}/two.png\r\n".encode()


def test_clipboard_uri_traversal_forbidden(client, lib):
    with patch("shutil.which", return_value="/usr/bin/wl-copy"), \
         patch("subprocess.Popen") as popen:
        r = client.post("/api/clipboard?uri=1", data="../etc/passwd", headers=H)
    assert r.status_code == 403
    popen.assert_not_called()


def test_clipboard_uri_missing_404(client, lib):
    with patch("shutil.which", return_value="/usr/bin/wl-copy"), \
         patch("subprocess.Popen") as popen:
        r = client.post("/api/clipboard?uri=1", data="nope.png", headers=H)
    assert r.status_code == 404
    popen.assert_not_called()


def test_favourite_single_toggle(client, monkeypatch):
    gal = {"images": [{"id": "aaa", "filename": "1.png", "filepath": "1.png", "favourite": False}]}
    monkeypatch.setattr(shared, "load_gallery", lambda: gal)
    monkeypatch.setattr(shared, "save_gallery", lambda d: None)

    r = client.post("/api/gallery/favourite", json={"id": "aaa"}, headers=H)
    assert r.status_code == 200
    assert r.get_json() == {"success": True, "favourite": True}
    r = client.post("/api/gallery/favourite", json={"id": "aaa"}, headers=H)
    assert r.get_json()["favourite"] is False
