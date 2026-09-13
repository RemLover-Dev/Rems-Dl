import json as _json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import asyncio
import urllib.parse
from html.parser import HTMLParser

from curl_cffi import requests as curl_requests

from core.shared import (
    BaseDownloader,
    MASTER_FOLDER,
    add_to_gallery,
    send_tags,
    write_image_metadata,
    save_history,
)
from core.gallery_dl_interop import ensure_zerochan_page_html

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class _ZerochanSubtagParser(HTMLParser):
    """Parse sub-tag browser boxes from a Zerochan tag page.

    Targets ``<section class="carousel thumbs"><ul><li>`` entries:
        <li><a href="/Reze+%28Default+Outfit%29" title="235 entries">
        <div class="thumb" data-src="..."></div>
        <p class="outfit">Default Outfit</p></a><i>235</i></li>
    """

    def __init__(self):
        super().__init__()
        self.subtags = []
        self._in_carousel = False
        self._current = None
        self._in_name = False
        self._in_count = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "section" and "carousel" in attrs_dict.get("class", "").split():
            self._in_carousel = True
            return
        if not self._in_carousel:
            return
        if tag == "li":
            self._current = {"name": "", "short": "", "url": "",
                             "count": 0, "thumb": "", "kind": ""}
        elif tag == "a" and self._current is not None and not self._current["url"]:
            href = attrs_dict.get("href", "")
            if href.startswith("/"):
                self._current["url"] = "https://www.zerochan.net" + href
                self._current["name"] = urllib.parse.unquote_plus(
                    href.rsplit("/", 1)[-1])
            title = attrs_dict.get("title", "")
            m = re.search(r"(\d+)", title)
            if m:
                self._current["count"] = int(m.group(1))
        elif tag == "div" and self._current is not None:
            if "thumb" in attrs_dict.get("class", "").split():
                self._current["thumb"] = attrs_dict.get("data-src", "")
        elif tag == "p" and self._current is not None:
            self._current["kind"] = attrs_dict.get("class", "")
            self._in_name = True
        elif tag == "i" and self._current is not None:
            self._in_count = True

    def handle_data(self, data):
        if self._current is None:
            return
        if self._in_name:
            self._current["short"] += data.strip()
        elif self._in_count:
            m = re.search(r"(\d+)", data)
            if m:
                self._current["count"] = int(m.group(1))

    def handle_endtag(self, tag):
        if tag == "section" and self._in_carousel:
            self._in_carousel = False
        if not self._in_carousel and tag != "li":
            self._in_name = self._in_count = False
            return
        if tag == "p":
            self._in_name = False
        elif tag == "i":
            self._in_count = False
        elif tag == "li" and self._current is not None:
            if self._current["url"]:
                self.subtags.append(self._current)
            self._current = None
            self._in_name = self._in_count = False


def parse_zerochan_subtags(html):
    """Extract sub-tag boxes from raw Zerochan tag-page HTML.

    Returns a list of dicts:
        [{"name": "Reze (Default Outfit)", "short": "Default Outfit",
          "url": "https://www.zerochan.net/Reze+%28Default+Outfit%29",
          "count": 235, "thumb": "https://...", "kind": "outfit"}, ...]
    """
    parser = _ZerochanSubtagParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.subtags


class _ZerochanTagParser(HTMLParser):
    """Parse categorized tags from Zerochan post HTML."""

    def __init__(self):
        super().__init__()
        self.tags = []
        self._in_tag_list = False
        self._current_tag = None

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == "ul" and attrs_dict.get("id") == "tags":
            self._in_tag_list = True
            return

        if self._in_tag_list and tag == "li":
            classes = attrs_dict.get("class", "").split()
            data_tag = attrs_dict.get("data-tag", "")

            if data_tag and classes:
                category = classes[0]
                primary = "primary" in classes
                favorite = "fav" in classes
                self._current_tag = {
                    "tag": data_tag,
                    "category": category,
                    "primary": primary,
                    "favorite": favorite,
                }

    def handle_endtag(self, tag):
        if tag == "ul" and self._in_tag_list:
            self._in_tag_list = False
        if tag == "li" and self._current_tag is not None:
            self.tags.append(self._current_tag)
            self._current_tag = None


def parse_zerochan_tags(html):
    """Extract categorized tags from raw Zerochan post HTML.

    Returns a list of dicts:
        [{"tag": "Mavuika", "category": "character", "primary": True, "favorite": False}, ...]

    The category comes from the actual CSS class on the <li>, so new
    categories added by Zerochan are handled automatically.
    """
    parser = _ZerochanTagParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.tags


def _derive_img_url(item):
    keys = ["full", "large", "file_url", "source", "src", "url", "image"]
    for k in keys:
        v = item.get(k)
        if v:
            return v
    thumb = item.get("thumb", "")
    if thumb:
        no_thumb = thumb.replace(".thumb.", ".")
        if no_thumb != thumb:
            return no_thumb
    post_id = item.get("id")
    if post_id:
        return f"https://static.zerochan.net/.full.{post_id}.jpg"
    return None


_CF_MARKERS = ("just a moment", "cf-challenge", "attention required",
               "checking your browser", "cf_chl")


# Windows forbids the characters below (plus control chars) in file/dir
# names. NOTE: ':' must be included — Zerochan tags/filenames contain it
# (e.g. "Rem (Re:Zero)", "Uma.Musume:.Pretty.Derby.full.x.png") and it
# crashes os.makedirs/os.replace with WinError 267/87.
_UNSAFE_PATH_CHARS_RE = re.compile('[<>:"/\\\\|?*\\x00-\\x1f]')


def _sanitize_path_part(name, fallback="misc"):
    """Make a tag/filename safe for Windows + POSIX filesystems."""
    try:
        cleaned = _UNSAFE_PATH_CHARS_RE.sub("", str(name or ""))
        # Windows also dislikes trailing dots/spaces
        cleaned = cleaned.strip().rstrip(". ")
        return cleaned or fallback
    except Exception:
        return fallback


def _looks_like_cf_challenge(status_code, text):
    if status_code in (403, 503):
        lowered = (text or "")[:4000].lower()
        return any(m in lowered for m in _CF_MARKERS)
    return False


_POST_ID_RE = re.compile(r'href="/(\d+)(?:\?[^"]*)?"')
_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE)
_STATIC_FILE_RE = re.compile(
    r'https?://static\.zerochan\.net/[^\s"\'<>]+?\.(?:jpg|jpeg|png|webp|gif|mp4|webm)(?:\?[^\s"\'<>]*)?',
    re.IGNORECASE)


def _extract_post_ids(search_html):
    """Return ordered unique post IDs found on a Zerochan listing page."""
    seen = set()
    ordered = []
    try:
        for m in _POST_ID_RE.finditer(search_html or ""):
            pid = m.group(1)
            if pid not in seen:
                seen.add(pid)
                ordered.append(pid)
    except Exception:
        pass
    return ordered


def _extract_full_image(post_html):
    """Best-effort full-resolution image URL from a Zerochan post page."""
    if not post_html:
        return None
    try:
        m = _OG_IMAGE_RE.search(post_html)
        if m:
            url = m.group(1).strip()
            if url.startswith("//"):
                url = "https:" + url
            if "static.zerochan.net" in url:
                return url
    except Exception:
        pass
    try:
        for m in _STATIC_FILE_RE.finditer(post_html):
            url = m.group(0)
            if ".thumb." in url:
                continue
            if "preview" in url.lower() and "full" not in url.lower():
                continue
            return url
    except Exception:
        pass
    return None


class _DummyAsyncSession:
    """Minimal stand-in so BaseDownloader.run_async_loop teardown is a no-op."""
    closed = True

    async def close(self):
        return None


def _ensure_gallery_dl_patch(log=None):
    """Enable ``page-html`` on the user's installed gallery-dl copy.

    Implemented in :mod:`core.gallery_dl_interop` as a runtime patch of the
    user's own install (never ships GPL code, never touches frozen builds).
    Best-effort: never raises. Returns True when page-html is supported.
    """
    try:
        return bool(ensure_zerochan_page_html(log=log))
    except Exception:
        return False


class ZerochanWorker(BaseDownloader):
    """Zerochan downloader: gallery-dl primary + curl_cffi fallback.

    Enumeration engine 1 is gallery-dl (with ``-u``/``-p`` login using the
    Zerochan credentials from Settings, plus automatic runtime enablement of
    ``page-html``/``?json`` support via :mod:`core.gallery_dl_interop`).
    Engine 2 is the built-in Zerochan ``?json`` API over curl_cffi
    (chrome131). File downloads always use curl_cffi.

    NOTE: intentionally does NOT use aiohttp anywhere in this worker —
    Cloudflare's "Under Attack" mode fingerprints TLS/JA3, which aiohttp
    cannot impersonate.
    """

    def __init__(self, tag, amount, net_config):
        super().__init__("zero", "Zerochan", amount, net_config)
        self.original_tag = (tag or "").strip()
        self.original_tag_lower = self.original_tag.lower()

        clean_tag = " ".join(t for t in self.original_tag_lower.split() if not t.startswith('-'))
        self.safe_tag = _sanitize_path_part(clean_tag, fallback="misc")
        self.tag_dir = os.path.join(self.site_root, self.safe_tag)
        try:
            os.makedirs(self.tag_dir, exist_ok=True)
        except OSError:
            # Paranoia: never let a weird tag kill the worker thread silently.
            self.safe_tag = "misc"
            self.tag_dir = os.path.join(self.site_root, self.safe_tag)
            os.makedirs(self.tag_dir, exist_ok=True)
        tag_parts = [urllib.parse.quote_plus(p.strip()) for p in self.original_tag.split(',') if p.strip()]
        self.encoded_tag = ','.join(tag_parts) or urllib.parse.quote_plus(self.original_tag)

        self._zerochan_user = (net_config.get("zerochan_login", "") or "").strip()
        self._zerochan_pass = (net_config.get("zerochan_password", "") or "").strip()
        # Final fallback: server .env (covers stale page / direct socket calls).
        if not self._zerochan_user:
            self._zerochan_user = (os.getenv("ZEROCHAN_LOGIN", "")
                                   or os.getenv("ZEROCHAN_USERNAME", "")).strip()
        if not self._zerochan_pass:
            self._zerochan_pass = os.getenv("ZEROCHAN_PASSWORD", "").strip()

        self.curl_session = None
        self.proxy = None

        if not (self._zerochan_user and self._zerochan_pass):
            self.log("For more access, please set your Zerochan Login in the Settings tab.")

        self.log(f"Configured: tag='{self.original_tag}' encoded='{self.encoded_tag}' "
                 f"amount={amount} (curl_cffi/chrome131)")

    # --- session factory (overrides aiohttp) ---
    def _ensure_curl_session(self):
        if self.curl_session is not None:
            return self.curl_session
        s = curl_requests.Session(impersonate="chrome131")
        if self.net_config.get("use_proxy"):
            p = self.net_config.get("proxy_url", "")
            if p:
                s.proxies = {"http": p, "https": p}
                self.proxy = p
        if not self.proxy:
            self.proxy = (os.environ.get("https_proxy") or os.environ.get("http_proxy")
                          or os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY"))
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.zerochan.net/",
        })
        self.curl_session = s
        return s

    async def _create_session(self):
        """Override: create curl_cffi session instead of aiohttp."""
        self._ensure_curl_session()
        if not getattr(self, "proxy", None):
            self.proxy = None
        return _DummyAsyncSession()

    def _verify_flag(self):
        return bool(self.net_config.get("verify_tls", False))

    def _blocking_get(self, url, headers=None, timeout=30, allow_redirects=True):
        session = self._ensure_curl_session()
        kwargs = {"headers": headers or {}, "timeout": timeout,
                  "allow_redirects": allow_redirects, "verify": self._verify_flag()}
        return session.get(url, **kwargs)

    async def _curl_get_text(self, url, headers=None, timeout=30):
        resp = await asyncio.to_thread(self._blocking_get, url, headers, timeout, True)
        status = int(getattr(resp, "status_code", 0) or 0)
        try:
            text = resp.text or ""
        except Exception:
            try:
                text = resp.content.decode("utf-8", errors="ignore")
            except Exception:
                text = ""
        return status, text, resp

    async def _try_login(self):
        """Best-effort Zerochan login via curl_cffi. Never raises."""
        if not (self._zerochan_user and self._zerochan_pass):
            return False
        try:
            self.log("Authenticating with Zerochan...")
            status, text, resp = await self._curl_get_text(
                "https://www.zerochan.net/login", timeout=30)
            token = None
            try:
                m = re.search(r'name=["\'](?:csrf[_-]?token|token)["\'][^>]*value=["\']([^"\']+)["\']',
                              text or "", re.IGNORECASE)
                if m:
                    token = m.group(1)
            except Exception:
                token = None
            # Field set mirrors the proven gallery-dl login (ref/name/password/login).
            payload = {"ref": "/", "name": self._zerochan_user,
                       "password": self._zerochan_pass, "login": "Login"}
            if token:
                payload["csrf_token"] = token
            session = self._ensure_curl_session()
            r = await asyncio.to_thread(
                session.post, "https://www.zerochan.net/login",
                data=payload, timeout=30, allow_redirects=True,
                headers={"Referer": "https://www.zerochan.net/login",
                         "Origin": "https://www.zerochan.net"},
                verify=self._verify_flag())
            body = ""
            try:
                body = (r.text or "")[:4000].lower()
            except Exception:
                pass
            ok = (int(getattr(r, "status_code", 0) or 0) in (200, 302)
                  and (self._zerochan_user.lower() in body or "logout" in body))
            if ok:
                self.log("Zerochan login looks successful.")
            else:
                self.log("Zerochan login uncertain — continuing (anonymous limits may apply).")
            return bool(ok)
        except Exception as e:
            self.log(f"Zerochan login failed ({e}) — continuing anonymously.")
            return False

    # --- ENGINE 1: gallery-dl subprocess (proven with -u/-p login) ---
    _gallery_dl_cmd = None  # cached launcher: [python, -m, gallery_dl] or [binary]

    def _gallery_dl_launcher(self):
        """Resolve how to invoke gallery-dl, preferring the current interpreter.

        ``sys.executable -m gallery_dl`` guarantees the extractor copy we
        patched (venv vs system interpreter mixes break the bare binary).
        """
        if ZerochanWorker._gallery_dl_cmd is not None:
            return ZerochanWorker._gallery_dl_cmd
        launcher = None
        try:
            probe = subprocess.run(
                [sys.executable, "-m", "gallery_dl", "--version"],
                capture_output=True, text=True, timeout=60)
            if probe.returncode == 0:
                launcher = [sys.executable, "-m", "gallery_dl"]
        except Exception:
            launcher = None
        if launcher is None and shutil.which("gallery-dl"):
            launcher = ["gallery-dl"]
        ZerochanWorker._gallery_dl_cmd = launcher
        return launcher

    def _gallery_dl_enumerate(self, tag, page=1, page_size=10):
        """Fetch one page of posts via gallery-dl. Returns (posts, engine_ok).

        posts: list of dicts (id, file_url, page_html, tags, ...).
        engine_ok: False when gallery-dl itself is broken/missing (caller
        should switch engines); True when it ran (even with 0 posts = EOD).
        """
        username = self._zerochan_user
        password = self._zerochan_pass

        launcher = self._gallery_dl_launcher()
        if launcher is None:
            self.log("gallery-dl not found (no python module, no binary on PATH).")
            return [], False

        base_cmd = list(launcher)
        if username and password:
            base_cmd.extend(["-u", username, "-p", password])
        else:
            # No creds: best-effort browser cookies. If Chrome is absent
            # gallery-dl errors out and we fall back to the built-in API.
            base_cmd.extend(["--cookies-from-browser", "chrome"])

        if self.net_config.get("use_proxy"):
            base_cmd.extend(["--proxy", self.net_config["proxy_url"]])

        base_cmd.extend([
            "-j",
            "-o", "extractor.zerochan.metadata=true",
            "-o", "extractor.zerochan.page-html=true",
        ])

        start = (page - 1) * page_size + 1
        end = page * page_size
        cmd = base_cmd + [
            "--range", f"{start}-{end}",
            f"https://www.zerochan.net/{tag}",
        ]

        proc = None
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            watchdog = threading.Timer(600, proc.kill)
            watchdog.start()
            try:
                stdout, stderr = proc.communicate(timeout=580)
            finally:
                watchdog.cancel()

            if proc.returncode != 0:
                err_tail = (stderr or "").strip().splitlines()[-1:] or [""]
                self.log(f"gallery-dl page {page} exited ({proc.returncode}): "
                         f"{err_tail[0][:220]}")
                fatal_markers = ("no such option", "not recognized", "no module",
                                 "cookies-from-browser", "authentication", "cloudflare",
                                 "429", "403", "blocked")
                if any(m in (stderr or "").lower() for m in fatal_markers):
                    return [], False
                return [], True

            try:
                data = _json.loads(stdout or "[]")
            except Exception as e:
                self.log(f"gallery-dl page {page}: bad JSON ({e}).")
                return [], True

            posts = []
            seen = set()
            for msg in data:
                if not isinstance(msg, list) or len(msg) < 2:
                    continue
                msg_type = msg[0]
                if msg_type == 3 and len(msg) >= 3:
                    kwdict = msg[2] if isinstance(msg[2], dict) else {}
                elif msg_type == 2 and isinstance(msg[1], dict):
                    kwdict = msg[1]
                else:
                    continue
                pid = kwdict.get("id")
                if pid is None or pid in seen:
                    continue
                seen.add(pid)
                posts.append(kwdict)

            self.log(f"Page {page}: {len(posts)} posts (gallery-dl)")
            return posts, True

        except FileNotFoundError:
            self.log("gallery-dl binary not found on PATH.")
            return [], False
        except Exception as e:
            if proc is not None and proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            self.log(f"gallery-dl page {page} failed: {e}")
            return [], False

    # --- ENGINE 2: built-in Zerochan ?json API via curl_cffi ---
    async def _curl_json_enumerate(self, page=1, per_page=200):
        """List posts via https://www.zerochan.net/{tag}?json=1&l=N&p=M.

        Same endpoint family the patched gallery-dl extractor uses.
        Returns (posts, engine_ok); each post has id/full/tags?. `next`
        truthiness decides pagination.
        """
        params = {"json": "1", "l": per_page, "p": page}
        try:
            session = self._ensure_curl_session()
            qs = urllib.parse.urlencode(params)
            url = f"https://www.zerochan.net/{self.encoded_tag}?{qs}"

            def _do():
                return session.get(url, timeout=30, allow_redirects=True,
                                   headers={"Referer": "https://www.zerochan.net/",
                                            "Accept": "application/json"},
                                   verify=self._verify_flag())

            resp = await asyncio.to_thread(_do)
            status = int(getattr(resp, "status_code", 0) or 0)
            raw = getattr(resp, "content", b"") or b""
            if _looks_like_cf_challenge(status, raw.decode("utf-8", "ignore")):
                self.log(f"Cloudflare challenge on JSON page {page} (HTTP {status}).")
                return [], False
            if status != 200 or not raw:
                self.log(f"JSON listing page {page} failed: HTTP {status}.")
                return [], True
            try:
                text = raw.decode("utf-8", "ignore")
                # Strip ad-script inserts like the patched extractor does
                if "window.adsbygoogle" in text:
                    text = "{" + text[text.find('"items":'):]
                data = _json.loads(text)
            except Exception as e:
                self.log(f"JSON listing page {page}: bad JSON ({e}).")
                return [], True
            items = data.get("items", []) if isinstance(data, dict) else []
            has_next = bool(isinstance(data, dict) and data.get("next"))
            self.log(f"Page {page}: {len(items)} posts (built-in JSON API)")
            return items, has_next
        except Exception as e:
            self.log(f"JSON listing page {page} failed: {e}")
            return [], False

    async def _curl_post_detail(self, pid):
        """Fetch https://www.zerochan.net/{pid}?json -> dict (best-effort)."""
        try:
            session = self._ensure_curl_session()
            url = f"https://www.zerochan.net/{pid}?json"

            def _do():
                return session.get(url, timeout=30, allow_redirects=True,
                                   headers={"Referer": "https://www.zerochan.net/",
                                            "Accept": "application/json"},
                                   verify=self._verify_flag())

            resp = await asyncio.to_thread(_do)
            status = int(getattr(resp, "status_code", 0) or 0)
            if status != 200:
                return {}
            try:
                return _json.loads((getattr(resp, "content", b"") or b"").decode("utf-8", "ignore")) or {}
            except Exception:
                return {}
        except Exception:
            return {}

    async def _probe_static_url(self, pid):
        """Return the first existing static.zerochan.net full URL for a post id."""
        session = self._ensure_curl_session()

        def _probe(url):
            try:
                return session.get(
                    url, timeout=15, allow_redirects=True,
                    headers={"Referer": "https://www.zerochan.net/",
                             "Range": "bytes=0-0"},
                    verify=self._verify_flag())
            except Exception:
                return None

        for ext in ("jpg", "png", "webp", "gif"):
            cand = f"https://static.zerochan.net/.full.{pid}.{ext}"
            try:
                resp = await asyncio.to_thread(_probe, cand)
                if resp is None:
                    continue
                status = int(getattr(resp, "status_code", 0) or 0)
                if status in (200, 206):
                    ctype = ""
                    try:
                        ctype = str(resp.headers.get("content-type", "")).lower()
                    except Exception:
                        ctype = ""
                    if "html" not in ctype:
                        return cand
            except Exception:
                continue
            if self.stop_event.is_set():
                break
        return None

    @staticmethod
    def _split_category_tags(raw_tags):
        """Split ['Category:Name', ...] into (general, artists, chars, copyrights, meta)."""
        general, artists, characters, copyrights, metadata_tags = [], [], [], [], []
        for entry in raw_tags or []:
            try:
                text = str(entry).strip()
                if not text:
                    continue
                if ":" not in text:
                    general.append(text)
                    continue
                cat, _, name = text.partition(":")
                name = name.strip()
                if not name:
                    continue
                c = cat.strip().lower()
                if c in ("mangaka", "artist"):
                    artists.append(name)
                elif c in ("character",):
                    characters.append(name)
                elif c in ("game", "series", "copyright"):
                    copyrights.append(name)
                elif c in ("meta", "metadata"):
                    metadata_tags.append(name)
                else:
                    general.append(name)
            except Exception:
                continue
        return general, artists, characters, copyrights, metadata_tags

    async def _enqueue_post_dict(self, post):
        """Normalize a gallery-dl OR ?json post dict and enqueue. Returns bool."""
        try:
            pid = post.get("id")
            img_url = post.get("file_url") or post.get("full")
            if not img_url:
                img_url = _derive_img_url(post)
            if not img_url and pid is not None:
                # Static fallback chain (same idea as patched extractor _urls):
                # probe which extension actually exists with a 1-byte request.
                img_url = await self._probe_static_url(pid)
            if not img_url:
                self.log(f"No image URL found for post {pid}, skipping.")
                return False

            page_html = post.get("page_html", "") or ""
            if page_html:
                categorized = parse_zerochan_tags(page_html)
                artists = [t["tag"] for t in categorized if t["category"] in ("mangaka",)]
                characters = [t["tag"] for t in categorized if t["category"] in ("character",)]
                copyrights = [t["tag"] for t in categorized if t["category"] in ("game",)]
                metadata_tags = [t["tag"] for t in categorized if t["category"] in ("meta",)]
                tags_list = [t["tag"] for t in categorized
                             if t["category"] in ("theme", "source", "vtuber", "outfit",
                                                  "series", "group", "studio")]
            else:
                tags_raw = post.get("tags", [])
                if tags_raw and isinstance(tags_raw, list) and any(":" in str(t) for t in tags_raw):
                    tags_list, artists, characters, copyrights, metadata_tags = \
                        self._split_category_tags(tags_raw)
                elif isinstance(tags_raw, str):
                    tags_list = [t.strip() for t in tags_raw.replace(",", " ").split() if t.strip()]
                    artists, characters, copyrights, metadata_tags = [], [], [], []
                else:
                    tags_list = [str(t).strip() for t in (tags_raw or []) if str(t).strip()]
                    artists, characters, copyrights, metadata_tags = [], [], [], []

            filename = urllib.parse.unquote(img_url.split('?')[0].split('/')[-1])
            if not filename or '.' not in filename:
                filename = f"zerochan_{pid}.jpg"
            # ':' and other reserved chars break Windows renames (WinError 87)
            filename = _sanitize_path_part(filename, fallback=f"zerochan_{pid}.jpg")
            filepath = os.path.join(self.tag_dir, filename)

            return await self.enqueue_download(
                img_url, filepath, filename, tags_list,
                artists=artists, characters=characters,
                copyrights=copyrights, metadata_tags=metadata_tags)
        except Exception as e:
            self.log(f"Error processing post {post.get('id', '?')}: {e}")
            return False

    # --- queue (overrides aiohttp HEAD size lookup) ---
    async def enqueue_download(self, url, filepath, filename, tags_list, artists=None,
                               characters=None, copyrights=None, metadata_tags=None):
        if artists is None:
            artists = []
        try:
            if filename in self.dl_history or filename in self.queued_items \
                    or os.path.exists(filepath):
                return False
        except Exception:
            pass
        # Skip HEAD entirely: Zerochan + Cloudflare often blocks HEAD, and the
        # size is only used for progress stats. Record 0 and continue.
        file_size = 0
        try:
            self.total_bytes += file_size
            self.queued_items.add(filename)
            self.download_queue.put_nowait(
                (url, filepath, filename, tags_list, artists, file_size,
                 characters, copyrights, metadata_tags))
            self.enqueued_count += 1
            return True
        except Exception as e:
            self.log(f"Enqueue failed for {filename}: {e}")
            return False

    # --- downloader (overrides aiohttp streaming) ---
    async def _async_download_file(self, url, filepath, filename, tags_list, artists,
                                   file_size=0, characters=None, copyrights=None,
                                   metadata_tags=None):
        if artists is None:
            artists = []
        if self.stop_event.is_set():
            self.enqueued_count -= 1
            return False

        part_path = filepath + ".part"
        for attempt in range(self.dl_retries):
            try:
                if self.stop_event.is_set():
                    break
                self.log(f"Downloading {filename} (attempt {attempt + 1}/{self.dl_retries})...")

                def _do_download():
                    session = self._ensure_curl_session()
                    return session.get(
                        url, timeout=600, allow_redirects=True,
                        headers={"Referer": "https://www.zerochan.net/"},
                        verify=self._verify_flag())

                resp = await asyncio.to_thread(_do_download)
                status = int(getattr(resp, "status_code", 0) or 0)
                content = getattr(resp, "content", b"") or b""
                if status != 200 or len(content) <= 1000:
                    raise Exception(f"HTTP {status} or file too small ({len(content)} bytes)")
                # Cloudflare sometimes returns an HTML challenge with 200
                ctype = ""
                try:
                    ctype = str(resp.headers.get("content-type", "")).lower()
                except Exception:
                    ctype = ""
                if "text/html" in ctype and b"Just a moment" in content[:8192]:
                    raise Exception("Cloudflare challenge (HTTP 200 with JS check) — retrying")

                with open(part_path, 'wb') as f:
                    f.write(content)
                downloaded = len(content)

                if self.stop_event.is_set():
                    if os.path.exists(part_path):
                        os.remove(part_path)
                    self.enqueued_count -= 1
                    return False

                os.replace(part_path, filepath)

                self.downloaded_count += 1
                self.downloaded_bytes += downloaded
                self.dl_history.add(filename)
                save_history(self.site_root, self.dl_history)

                if self.is_scanning and self.amount > 0:
                    target_total = max(self.amount, self.enqueued_count)
                else:
                    target_total = max(self.enqueued_count, self.downloaded_count)

                pct = int((self.downloaded_count / target_total) * 100) if target_total > 0 else 0

                rel_path = os.path.relpath(filepath, MASTER_FOLDER)
                top_tags = ", ".join(tags_list[:5]) if tags_list else "No tags"

                write_image_metadata(filepath, tags_list, artists, self.name,
                                     characters, copyrights, metadata_tags)
                add_to_gallery(self.name, filename, rel_path, tags_list, artists,
                               characters, copyrights, metadata_tags)
                self.log(f"[SUCCESS] Downloaded {filename} ({self.downloaded_count}/{target_total}) [{pct}%] |PATH| {rel_path} |TAGS| {top_tags}")
                send_tags(self.name, filename, tags_list, artists, rel_path,
                          characters, copyrights, metadata_tags)
                return True

            except Exception as e:
                try:
                    if os.path.exists(part_path):
                        os.remove(part_path)
                except Exception:
                    pass
                if self.stop_event.is_set():
                    self.enqueued_count -= 1
                    break
                if attempt < self.dl_retries - 1:
                    await asyncio.sleep(2)
                else:
                    self.enqueued_count -= 1
                    err_msg = str(e).strip() or "HTTP error / File deleted from server"
                    self.log(f"[FAILED] {filename}: {err_msg}")
                    self.failed_count += 1
                    try:
                        if os.path.exists(filepath):
                            os.remove(filepath)
                    except Exception:
                        pass
        return False

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.original_tag}'")
        self._ensure_curl_session()
        await self._try_login()
        await asyncio.to_thread(_ensure_gallery_dl_patch, self.log)

        collected_count = 0
        page = 1
        MAX_PAGES = 50
        PAGE_SIZE = 10
        use_gallery_dl = True
        # Fixed JSON page size so ?p= pagination never overlaps/skips.
        json_per_page = max(24, min(200, self.amount if self.amount > 0 else 200))

        while page <= MAX_PAGES:
            if self.stop_event.is_set():
                break
            if self.amount > 0 and collected_count >= self.amount:
                break

            posts = []
            if use_gallery_dl:
                posts, engine_ok = await asyncio.to_thread(
                    self._gallery_dl_enumerate, self.encoded_tag, page, PAGE_SIZE)
                if not engine_ok:
                    use_gallery_dl = False
                    if page == 1 and not posts:
                        self.log("gallery-dl engine unavailable — "
                                 "switching to built-in Zerochan JSON API.")
                    else:
                        self.log("gallery-dl engine failed — "
                                 "switching to built-in Zerochan JSON API.")
                elif not posts:
                    if page == 1:
                        self.log(f"No posts found for '{self.original_tag}'. "
                                 "Check the tag spelling.")
                    else:
                        self.log("No more posts available from gallery-dl.")
                    break

            if not use_gallery_dl:
                items, has_next = await self._curl_json_enumerate(page=page, per_page=json_per_page)
                if not items:
                    if page == 1:
                        self.log(f"No posts found for '{self.original_tag}'. "
                                 "Check the tag spelling.")
                    else:
                        self.log("No more posts available.")
                    break
                # Enrich each item with its ?json detail (exact file URL).
                posts = []
                for item in items:
                    if self.stop_event.is_set():
                        break
                    if self.amount > 0 and collected_count + len(posts) >= self.amount:
                        break
                    pid = item.get("id") if isinstance(item, dict) else None
                    if pid is None:
                        continue
                    detail = await self._curl_post_detail(pid)
                    merged = dict(item) if isinstance(item, dict) else {"id": pid}
                    if detail:
                        merged.update(detail)
                    posts.append(merged)
                    await asyncio.sleep(min(self.anti_ban_pause, 1.0))
                if not has_next and page > 1:
                    pass  # last page flag; loop exits naturally when items run out

            if not posts:
                self.log("No more posts available.")
                break

            enqueued_this_page = 0
            for post in posts:
                if self.stop_event.is_set():
                    break
                if self.amount > 0 and collected_count >= self.amount:
                    break
                if await self._enqueue_post_dict(post):
                    collected_count += 1
                    enqueued_this_page += 1
                await asyncio.sleep(self.anti_ban_pause)

            self.log(f"Page {page}: enqueued {enqueued_this_page} new images "
                     f"(total: {collected_count})")
            page += 1
            if not self.stop_event.is_set() and (self.amount <= 0 or collected_count < self.amount):
                await asyncio.sleep(self.anti_ban_pause)

        actual = collected_count + (self.download_queue.qsize() if self.download_queue else 0)
        if actual == 0:
            self.log("No new images to download.")
        else:
            self.log(f"Finished scanning. Enqueued {actual} item"
                     f"{'s' if actual != 1 else ''}. "
                     "Completing downloads in the background...")

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))
        self.log("--- Worker Terminated ---")


def worker_zerochan(tag, amount, net_config):
    worker = ZerochanWorker(tag, amount, net_config)
    worker.run()
