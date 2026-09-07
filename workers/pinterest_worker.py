import os, re, json, random
import asyncio
from pathlib import Path
from workers import BaseWorker
import core.shared as shared


def _disable_brotli():
    """urllib3 advertises 'br' when brotlicffi is installed, but brotlicffi
    crashes decoding Pinterest's chunked brotli responses. Force gzip/deflate.
    ponytail: global patch to requests; harmless for other workers (aiohttp)."""
    import requests.sessions
    _orig = requests.sessions.default_headers
    if getattr(_orig, "_no_br", False):
        return
    def _no_br():
        h = _orig()
        h["Accept-Encoding"] = "gzip, deflate"
        return h
    _no_br._no_br = True
    requests.sessions.default_headers = _no_br


_disable_brotli()


class PinterestWorker(BaseWorker):
    def __init__(self, url_or_query, amount, is_search, net_config, min_w=0, min_h=0):
        super().__init__("pinterest", "Pinterest", amount, net_config)
        self.url_or_query = url_or_query
        self.is_search = is_search
        self.min_w = min_w
        self.min_h = min_h

        safe_name = re.sub(r'[\\/*?:"<>|]', "_", (url_or_query.strip().lower().replace("https://", "").replace("http://", "").replace("/", "_")[:60]))
        self.site_root = os.path.join(shared.MASTER_FOLDER, "Pinterest", safe_name)
        os.makedirs(self.site_root, exist_ok=True)
        self.tag_dir = self.site_root

    def get_tags(self):
        return [self.url_or_query]

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def _create_session(self):
        """Pinterest uses its own library, not aiohttp – return None."""
        self.proxy = None
        if self.net_config.get("use_proxy"):
            self.proxy = self.net_config.get("proxy_url")
        return None

    def _apply_proxy(self, session):
        if self.net_config.get("use_proxy"):
            session.proxies = {"http": self.net_config["proxy_url"], "https": self.net_config["proxy_url"]}
        else:
            session.proxies = {"http": "", "https": "", "no_proxy": "*"}

    async def scraper_task(self):
        self.log(f"Initializing Pinterest worker for: '{self.url_or_query[:80]}' ({'search' if self.is_search else 'url scrape'})")

        if self.net_config.get("use_proxy"):
            os.environ["HTTP_PROXY"] = self.net_config["proxy_url"]
            os.environ["HTTPS_PROXY"] = self.net_config["proxy_url"]
        else:
            os.environ.pop("HTTP_PROXY", None)
            os.environ.pop("HTTPS_PROXY", None)

        from pinterest_dl import PinterestDL
        from pinterest_dl.download import MediaDownloader

        client = PinterestDL.with_api(timeout=5, verbose=False, ensure_alt=True)

        cookies_path = self.net_config.get("pinterest_cookies", "")
        email = self.net_config.get("pinterest_email", "")
        password = self.net_config.get("pinterest_password", "")
        have_auth = False

        if cookies_path and os.path.exists(cookies_path):
            try:
                client.with_cookies_path(cookies_path)
                self.log("Loaded Pinterest cookies")
                have_auth = True
            except Exception as e:
                self.log(f"Cookie load error: {e}")

        if not have_auth and email and password:
            try:
                from pinterest_dl import PinterestDL as PDL
                from playwright.sync_api import BrowserType
                orig = BrowserType.launch
                def patched_launch(self, **kw):
                    if self.net_config.get("use_proxy") and self.net_config["proxy_url"]:
                        kw["proxy"] = {"server": self.net_config["proxy_url"]}
                    return orig(self, **kw)
                BrowserType.launch = patched_launch
                driver = PDL.with_browser(browser_type="chromium", headless=True, verbose=False).login(email, password)
                cookies = driver.get_cookies(after_sec=7)
                driver.close()
                client.with_cookies(cookies)
                if cookies_path:
                    try:
                        os.makedirs(os.path.dirname(cookies_path) or ".", exist_ok=True)
                        with open(cookies_path, "w") as f:
                            json.dump(cookies, f, indent=2)
                        self.log(f"Saved fresh cookies to {cookies_path}")
                    except Exception as e:
                        self.log(f"Could not save cookies: {e}")
                self.log("Logged in via browser and using fresh cookies")
                have_auth = True
            except ImportError:
                self.log("⚠️ Browser auth unavailable (install pinterest-dl[browser] and playwright)")
                self.log("Falling back to public content — downloads may be limited.")
            except Exception as e:
                self.log(f"⚠️ Pinterest login FAILED: {e}")
                self.log("Falling back to public content — downloads may be limited.")

        if not have_auth:
            self.log("No auth — public content only")

        existing = len([f for f in os.listdir(self.tag_dir) if re.match(r'^\d+\.[a-z]+$', f)])
        fetch_num = self.amount + existing

        seen_ids = set()
        collected = []

        def on_progress(media):
            if len(collected) >= self.amount:
                return
            if media.id in seen_ids:
                return
            ext = Path(media.src).suffix.lower() if media.src else ".jpg"
            if os.path.exists(os.path.join(self.tag_dir, f"{media.id}{ext}")):
                return
            seen_ids.add(media.id)
            collected.append(media)
            shared.socketio_emit("pinterest_progress", {
                "index": len(collected),
                "total": self.amount,
                "alt": media.alt or "",
                "id": media.id
            })

        try:
            if self.is_search:
                await asyncio.to_thread(client.search, query=self.url_or_query, num=fetch_num, min_resolution=(self.min_w, self.min_h), on_progress=on_progress)
            else:
                await asyncio.to_thread(client.scrape, url=self.url_or_query, num=fetch_num, min_resolution=(self.min_w, self.min_h), on_progress=on_progress)
        except Exception as e:
            self.log(f"Scrape error: {e}")
            self.log("--- Worker Terminated ---")
            return

        medias = collected[:self.amount]
        if not medias:
            self.log("No media found.")
            self.log("--- Worker Terminated ---")
            return

        self.log(f"Collected {len(medias)} media items. Starting download...")

        dl_retries = int(self.net_config.get("download_retries", 3))
        downloader = MediaDownloader(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            timeout=int(self.net_config.get("api_timeout", 10)),
            max_retries=dl_retries
        )
        self._apply_proxy(downloader.http_client.session)

        downloaded = 0
        for i, media in enumerate(medias):
            if self.stop_event.is_set():
                break

            try:
                path = await asyncio.to_thread(downloader.download, media, Path(self.site_root), download_streams=True)
                filename = os.path.basename(path)

                rel = os.path.relpath(str(path), shared.MASTER_FOLDER)
                tags = [media.alt] if media.alt else []
                artists = []
                shared.add_to_gallery(self.name, filename, rel, tags, artists)
                shared.send_tags(self.name, filename, tags, artists, rel)

                downloaded += 1
                self.log(f"[SUCCESS] Downloaded {filename} ({downloaded}/{self.amount}) |PATH| {rel} |TAGS| {', '.join(tags[:5])}")
            except Exception as e:
                self.log(f"[FAILED] {media.id}: {e}")

            await asyncio.sleep(random.uniform(0.5, 1.5))

        self.log(f"Downloaded {downloaded} items.")
        self.downloaded_count = downloaded
        self.failed_count = len(medias) - downloaded
        self.log("--- Worker Terminated ---")

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))

def worker_pinterest(url_or_query, amount, is_search, net_config, min_w=0, min_h=0):
    worker = PinterestWorker(url_or_query, amount, is_search, net_config, min_w, min_h)
    worker.run()
