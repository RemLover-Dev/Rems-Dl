import os
import re
import sys
import threading
import json
import time
import asyncio
import hashlib
import aiohttp
from PIL import Image, PngImagePlugin


def _app_base_dir():
    # Frozen (PyInstaller) builds: keep all user data next to the exe,
    # not inside the read-only _MEIPASS bundle.
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE_DIR = _app_base_dir()
APP_NAME = "Rems Dl"
DOWNLOAD_DIR_NAME = "Rems Dl"
LEGACY_DOWNLOAD_DIR_NAME = "Rem God"
MASTER_FOLDER = os.path.join(BASE_DIR, DOWNLOAD_DIR_NAME)
# Auto-migrate legacy "Rem God" download folder to "Rems Dl" (one-time, safe).
if os.path.isdir(os.path.join(BASE_DIR, LEGACY_DOWNLOAD_DIR_NAME)) and not os.path.isdir(MASTER_FOLDER):
    try:
        os.rename(os.path.join(BASE_DIR, LEGACY_DOWNLOAD_DIR_NAME), MASTER_FOLDER)
    except Exception:
        pass
HISTORY_LOCK = threading.Lock()
STOP_EVENTS = {}

SAFE_TAGS_DB = []
WAIFU_TAGS_DB = []
WAIFU_TAG_MAP = {}

def get_session(site, net_config):
    """Legacy sync helper – kept for Flask tag-suggestion endpoints."""
    import requests as _requests
    session = _requests.Session()
    if net_config.get("use_proxy"):
        p = net_config.get("proxy_url")
        session.proxies = {"http": p, "https": p}
    else:
        session.proxies = {"http": "", "https": "", "no_proxy": "*"}
    session.verify = net_config.get("verify_tls", False)
    return session

# --- LOGGING & TAG SYSTEM ---
def default_logger(worker_name, msg): print(f"[{worker_name.upper()}] {msg}")
log_callback = default_logger
def log_msg(worker_name, msg): log_callback(worker_name, msg)

def default_tag_handler(worker_name, filename, tags_list, artist_list, filepath=None, characters=None, copyrights=None, metadata_tags=None): pass
tag_callback = default_tag_handler
TAG_CATEGORIES = ["artist", "character", "copyright", "metadata", "tag"]

SITE_CANONICAL = {
    "dan": "danbooru", "danbooru": "danbooru",
    "eshuushuu": "eshuushuu", "e-shuushuu": "eshuushuu",
    "gelbooru": "gelbooru", "gsbooru": "gsbooru",
    "konachan": "konachan", "kona": "konachan", "yande": "yande", "yande.re": "yande",
    "sankaku": "sankaku", "safebooru": "safebooru", "safe": "safebooru", "rule34": "rule34",
    "pinterest": "pinterest", "pixiv": "pixiv",
    "zero": "zerochan", "zerochan": "zerochan",
    "neko": "nekos.life", "nekos.life": "nekos.life",
    "nekos.best": "nekos.best", "nekosapi": "nekosapi", "nekosia": "nekosia",
    "waifu": "waifu.im", "waifu.im": "waifu.im",
    "anime_dl": "anime_dl", "animepictures": "anime_dl",
}

def normalize_site(site):
    return SITE_CANONICAL.get(site.lower().strip(), site.lower().strip())

def categorize_tag(tag):
    """Determine the category of a tag based on common booru prefix patterns."""
    tag_lower = tag.lower().strip()
    for cat in TAG_CATEGORIES:
        prefix = cat + ":"
        if tag_lower.startswith(prefix):
            return cat
    return "tag"

def sort_tags_by_category(tags_dict):
    """Sort a tags dict by category order. Returns new ordered dict."""
    from collections import OrderedDict
    result = OrderedDict()
    for cat in TAG_CATEGORIES:
        if cat in tags_dict and tags_dict[cat]:
            result[cat] = sorted(tags_dict[cat])
    return result

def flatten_tags(tags_dict):
    """Flatten a tags dict into a single sorted list (for search/filter)."""
    result = []
    for cat in TAG_CATEGORIES:
        if cat in tags_dict:
            result.extend(tags_dict[cat])
    return result

def tags_dict_from_lists(tags_list, artists=None, characters=None, copyrights=None, metadata_tags=None):
    """Build a categorized tags dict from flat lists."""
    result = {"artist": [], "character": [], "copyright": [], "metadata": [], "tag": []}
    if artists:
        result["artist"] = [a.strip() for a in artists if a.strip()]
    if characters:
        result["character"] = [c.strip() for c in characters if c.strip()]
    if copyrights:
        result["copyright"] = [c.strip() for c in copyrights if c.strip()]
    if metadata_tags:
        result["metadata"] = [m.strip() for m in metadata_tags if m.strip()]
    if tags_list:
        result["tag"] = [t.strip() for t in tags_list if t.strip()]
    return sort_tags_by_category(result)

def send_tags(worker_name, filename, tags_list, artist_list=None, filepath=None, characters=None, copyrights=None, metadata_tags=None):
    if artist_list is None: artist_list = []
    tag_callback(worker_name, filename, tags_list, artist_list, filepath, characters, copyrights, metadata_tags)

def default_emit(event, data): pass
emit_callback = default_emit
def socketio_emit(event, data): emit_callback(event, data)

GALLERY_FILE = os.path.join(BASE_DIR, "database", "gallery.json")
TAG_CACHE_DIR = os.path.join(BASE_DIR, "database", "tag_caches")
TAG_TYPE_MAP = {0: "tag", 1: "artist", 3: "copyright", 4: "character", 5: "metadata"}

def load_tag_cache(site="gelbooru"):
    os.makedirs(TAG_CACHE_DIR, exist_ok=True)
    path = os.path.join(TAG_CACHE_DIR, f"{site}_tags.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_tag_cache(data, site="gelbooru"):
    os.makedirs(TAG_CACHE_DIR, exist_ok=True)
    path = os.path.join(TAG_CACHE_DIR, f"{site}_tags.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)

def load_gallery():
    if os.path.exists(GALLERY_FILE):
        try:
            with open(GALLERY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _migrate_gallery_tags(data)
            return data
        except Exception:
            return {"images": []}
    return {"images": []}

def _migrate_gallery_tags(data):
    """Convert old flat-list tags to categorized dicts and normalize site names in-place."""
    changed = False
    for img in data.get("images", []):
        tags = img.get("tags")
        if isinstance(tags, list):
            img["tags"] = tags_dict_from_lists(tags)
            changed = True
        site = img.get("site", "")
        canon = normalize_site(site)
        if canon != site:
            img["site"] = canon
            changed = True
    if changed:
        save_gallery(data)

def save_gallery(data):
    with open(GALLERY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def add_to_gallery(site, filename, filepath, tags_list, artists, characters=None, copyrights=None, metadata_tags=None):
    gallery = load_gallery()
    for img in gallery["images"]:
        if img["filename"] == filename:
            return
    tags_dict = tags_dict_from_lists(tags_list, artists, characters, copyrights, metadata_tags)
    gallery["images"].insert(0, {
        "id": hashlib.md5(f"{site}:{filename}".encode()).hexdigest()[:12],
        "filename": filename,
        "filepath": filepath,
        "site": normalize_site(site),
        "tags": dict(tags_dict),
        "favourite": False,
        "downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    })
    save_gallery(gallery)

def write_image_metadata(filepath, tags_list, artists, site, characters=None, copyrights=None, metadata_tags=None):
    ext = filepath.rsplit('.', 1)[-1].lower() if '.' in filepath else ''
    tags_dict = tags_dict_from_lists(tags_list, artists, characters, copyrights, metadata_tags)
    meta_lines = [f"site:{site}"]
    for cat in TAG_CATEGORIES:
        for t in tags_dict.get(cat, []):
            meta_lines.append(f"{cat}:{t}")
    meta_text = "\n".join(meta_lines)

    try:
        if ext in ('jpg', 'jpeg'):
            # inject a COM segment at byte level — saving through PIL here would
            # recompress the image (3MB originals were shrinking to ~1.4MB)
            payload = b"Rems_Dl\n" + meta_text.encode("utf-8")
            payload = payload[:65531]
            with open(filepath, "rb") as f:
                data = f.read()
            if not data.startswith(b"\xff\xd8"):
                return
            seg = b"\xff\xfe" + len(payload).to_bytes(2, "big") + payload
            tmp = filepath + ".meta"
            with open(tmp, "wb") as f:
                f.write(data[:2] + seg + data[2:])
            os.replace(tmp, filepath)
        elif ext == 'png':
            pnginfo = PngImagePlugin.PngInfo()
            pnginfo.add_text("Rems_Dl", meta_text)
            img = Image.open(filepath)
            img.save(filepath, pnginfo=pnginfo)  # lossless for PNG
        # webp/gif skipped: embedding would re-encode and lose quality
    except Exception as e:
        print(f"Metadata write error on {filepath}: {e}")

# --- HISTORY SYSTEM ---
def load_history(site_root):
    hist_path = os.path.join(site_root, "download_history.json")
    with HISTORY_LOCK:
        if os.path.exists(hist_path):
            try:
                with open(hist_path, "r", encoding="utf-8") as f: return set(json.load(f))
            except Exception: return set()
        return set()

def save_history(site_root, history_set):
    hist_path = os.path.join(site_root, "download_history.json")
    with HISTORY_LOCK:
        try:
            with open(hist_path, "w", encoding="utf-8") as f: json.dump(list(history_set), f, indent=4)
        except Exception as e: print(f"Error saving history: {e}")

def remove_gallery_files(paths):
    """Drop gallery entries whose file resolves to one of the given absolute paths."""
    targets = {os.path.normcase(os.path.normpath(p)) for p in paths}
    gal = load_gallery()
    kept = [img for img in gal["images"]
            if os.path.normcase(os.path.normpath(os.path.join(MASTER_FOLDER, img.get("filepath", "")))) not in targets]
    removed = len(gal["images"]) - len(kept)
    if removed:
        gal["images"] = kept
        save_gallery(gal)
    return removed


# ==========================================
# === OOP ASYNCIO ENGINE ===
# ==========================================
class BaseDownloader:
    def __init__(self, name, site_folder, amount, net_config):
        self.name = name
        self.site_folder = site_folder
        self.amount = max(0, int(amount))
        self.net_config = net_config

        self.stop_event = threading.Event()
        # Append, never replace: replacing orphans a still-running previous
        # worker of the same name (e.g. double START) — STOP then only
        # reaches the newest run and the older one downloads forever.
        # Finished workers remove their own event in run_async_loop's
        # finally block, so the list cannot grow unboundedly.
        STOP_EVENTS.setdefault(name, []).append(self.stop_event)

        self.anti_ban_pause = float(net_config.get("anti_ban_pause", 3.0))
        self.dl_retries = int(net_config.get("download_retries", 3))

        self.site_root = os.path.join(MASTER_FOLDER, site_folder)
        os.makedirs(self.site_root, exist_ok=True)
        self.dl_history = load_history(self.site_root)

        self.session = None  # created lazily in _create_session
        self.downloaded_count = 0
        self.failed_count = 0
        self.downloaded_bytes = 0
        self.total_bytes = 0
        self.total_to_download = 0
        self.download_queue = None
        self.is_scanning = False
        self.enqueued_count = 0
        self.queued_items = set()

    def check_amount_warning(self, total_found):
        """Helper to warn the user if they requested more images than were retrieved."""
        if total_found > 0:
            self.log(f"Total valid items found: {total_found}")
            if self.amount > 0 and total_found < self.amount:
                extra = f" ({self.failed_count} failed)" if self.failed_count else ""
                self.log(f"⚠️ Notice: You requested {self.amount} images, but only {total_found} were downloaded{extra}. The site may have blocked further pages, or downloads failed.")

    # --- aiohttp session factory (override in subclasses for curl_cffi etc.) ---
    async def _create_session(self):
        """Create and return an aiohttp.ClientSession with proxy and headers."""
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        headers = {
            "User-Agent": "Rems_Dl/5.0 (by RemLover on GitHub)",
            "Accept": "application/json",
        }
        proxy = None
        if self.net_config.get("use_proxy"):
            proxy = self.net_config.get("proxy_url")
        if not proxy:
            proxy = os.environ.get("https_proxy") or os.environ.get("http_proxy") or os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")

        connector = aiohttp.TCPConnector(
            ssl=False if not self.net_config.get("verify_tls", False) else None,
            limit=10,
        )
        session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers=headers,
            proxy=proxy,
        )
        self.proxy = proxy
        return session

    def log(self, msg): log_msg(self.name, msg)

    async def enqueue_download(self, url, filepath, filename, tags_list, artists=None, characters=None, copyrights=None, metadata_tags=None):
        if artists is None: artists = []
        
        if filename in self.dl_history or filename in self.queued_items or os.path.exists(filepath):
            return False
            
        file_size = 0
        try:
            async with self.session.head(url) as resp:
                file_size = int(resp.headers.get('Content-Length', 0))
        except Exception:
            pass
            
        self.total_bytes += file_size
        self.queued_items.add(filename)
        self.download_queue.put_nowait((url, filepath, filename, tags_list, artists, file_size, characters, copyrights, metadata_tags))
        self.enqueued_count += 1
        return True

    async def _async_download_file(self, url, filepath, filename, tags_list, artists, file_size=0, characters=None, copyrights=None, metadata_tags=None):
        if self.stop_event.is_set():
            self.enqueued_count -= 1
            return False

        part_path = filepath + ".part"
        for attempt in range(self.dl_retries):
            try:
                referer = self.session.headers.get("Referer") or url
                # ponytail: downloads need way more than the API's 30s total timeout
                # sock_read kills stalled/trickling connections fast; a bare
                # total timeout lets a dead stream hang for minutes looking
                # like the worker "stopped"
                async with self.session.get(url, headers={"Referer": referer}, timeout=aiohttp.ClientTimeout(total=300, connect=10, sock_read=30)) as resp:
                    resp.raise_for_status()
                    content_length = int(resp.headers.get('Content-Length', 0)) or file_size
                    if content_length and (content_length != file_size):
                        self.total_bytes += (content_length - file_size)

                    downloaded = 0
                    with open(part_path, 'wb') as f:
                        async for chunk in resp.content.iter_chunked(65536):
                            if self.stop_event.is_set(): break
                            f.write(chunk)
                            downloaded += len(chunk)

                    # ponytail: proxies can drop the tail silently; verify against
                    # Content-Length, or against the enqueue-time HEAD size when the
                    # response is content-encoded (CL then describes compressed bytes)
                    if not resp.headers.get('Content-Encoding') or file_size:
                        expected = int(resp.headers.get('Content-Length', 0)) or file_size
                        if expected and downloaded != expected:
                            raise Exception(f"Incomplete download: got {downloaded} of {expected} bytes")

                if self.stop_event.is_set():
                    if os.path.exists(part_path): os.remove(part_path)
                    self.enqueued_count -= 1
                    return False

                # booru filenames embed their md5 (-<32hex>.ext); a CDN serving a
                # stale recompressed variant passes size checks, so verify content
                m = re.search(r'-([0-9a-f]{32})\.[^.]+$', filename, re.I)
                if m:
                    h = hashlib.md5()
                    with open(part_path, 'rb') as f:
                        for chunk in iter(lambda: f.read(1 << 20), b''):
                            h.update(chunk)
                    if h.hexdigest() != m.group(1).lower():
                        os.remove(part_path)
                        raise Exception("md5 mismatch: server sent a different/degraded file")

                # publish under the real name only after full verification — a
                # killed app must never leave a truncated file posing as complete
                os.replace(part_path, filepath)

                self.downloaded_count += 1
                self.downloaded_bytes += downloaded
                self.dl_history.add(filename)
                save_history(self.site_root, self.dl_history)

                # درصدگیری بی‌نقص بر اساس Limit
                if self.is_scanning and self.amount > 0:
                    target_total = max(self.amount, self.enqueued_count)
                else:
                    target_total = max(self.enqueued_count, self.downloaded_count)
                    
                pct = int((self.downloaded_count / target_total) * 100) if target_total > 0 else 0
                
                rel_path = os.path.relpath(filepath, MASTER_FOLDER)
                top_tags = ", ".join(tags_list[:5]) if tags_list else "No tags"

                # ponytail: metadata + gallery publish BEFORE the SUCCESS log — the log card
                # requests its thumb instantly and would otherwise read a half-written file
                write_image_metadata(filepath, tags_list, artists, self.name, characters, copyrights, metadata_tags)
                add_to_gallery(self.name, filename, rel_path, tags_list, artists, characters, copyrights, metadata_tags)
                self.log(f"[SUCCESS] Downloaded {filename} ({self.downloaded_count}/{target_total}) [{pct}%] |PATH| {rel_path} |TAGS| {top_tags}")
                send_tags(self.name, filename, tags_list, artists, rel_path, characters, copyrights, metadata_tags)
                return True

            except Exception as e:
                if os.path.exists(part_path): os.remove(part_path)
                if self.stop_event.is_set():
                    self.enqueued_count -= 1
                    break
                if attempt < self.dl_retries - 1: 
                    await asyncio.sleep(2)
                else: 
                    self.enqueued_count -= 1
                    err_msg = str(e).strip()
                    if not err_msg: err_msg = "HTTP 404 / File Deleted from Server"
                    self.log(f"[FAILED] {filename}: {err_msg}")
                    self.failed_count += 1
                    if os.path.exists(filepath): os.remove(filepath)
        return False

    async def _download_worker(self):
        while not self.stop_event.is_set():
            if self.download_queue.empty():
                if not self.is_scanning: break
                await asyncio.sleep(0.5)
                continue
            item = await self.download_queue.get()
            try: await self._async_download_file(*item)
            finally: self.download_queue.task_done()

    async def run_async_loop(self, scraper_coroutine):
        try:
            self.session = await self._create_session()
            self.log(f"Proxy: {self.proxy or 'Direct'}")
            self.download_queue = asyncio.Queue()
            self.is_scanning = True

            num_workers = 2
            download_tasks = [asyncio.create_task(self._download_worker()) for _ in range(num_workers)]

            self.log("Phase 1: Gathering links from API... Please wait.")
            try: await scraper_coroutine()
            except Exception as e: self.log(f"Scraper Error: {e}")

            self.is_scanning = False
            # ponytail: always join the queue so in-flight downloads finish
            # before we check counts or cancel workers.  Previously we
            # skipped join() when total_to_download looked like 0 (qsize
            # doesn't count in-flight items), which cancelled workers mid-
            # download via BaseException — file landed on disk but gallery,
            # metadata, history, and SUCCESS log were never written.
            if not self.stop_event.is_set():
                await self.download_queue.join()
            for t in download_tasks: t.cancel()

            if self.downloaded_count > 0 and self.failed_count > 0:
                self.log(f"--- Task finished: {self.downloaded_count} downloaded successfully, {self.failed_count} failed to download! ---")
            elif self.downloaded_count > 0:
                self.log(f"--- All {self.downloaded_count} downloads completed successfully! ---")
            elif not self.stop_event.is_set():
                self.log("Task finished. No new images to download.")
        except Exception as critical_e:
            self.log(f"CRITICAL ERROR: {critical_e}")
        finally:
            if self.session and hasattr(self.session, 'closed') and not self.session.closed:
                await self.session.close()

        if self.name in STOP_EVENTS and self.stop_event in STOP_EVENTS[self.name]:
            STOP_EVENTS[self.name].remove(self.stop_event)
