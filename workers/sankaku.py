import os, re
import asyncio
from workers import BaseWorker


API_BASE = "https://sankakuapi.com"


class SankakuWorker(BaseWorker):
    def __init__(self, tag, amount, rating, exclusions, net_config):
        super().__init__("sankaku", "Sankaku", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.rating = rating
        self.exclusions = exclusions

        self.api_tag = self.original_tag
        if self.rating:
            self.api_tag = f"{self.original_tag} {self.rating}".strip()

        self.rating_map = {"s": "Safe", "q": "Questionable", "e": "NSFW"}

        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-'))
        # NOTE: ':' included — it is illegal on Windows (WinError 267/87).
        # Empty stays empty (downloads land directly in site_root, as before).
        self.safe_tag = re.sub(r'[\\/*?:"<>|]', "", clean_tag).strip()
        self.tag_dir = os.path.join(self.site_root, self.safe_tag)
        os.makedirs(self.tag_dir, exist_ok=True)

    async def _create_session(self):
        session = await super()._create_session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://www.sankakucomplex.com/",
        })

        access_token = os.getenv("SANKA_ACCESS_TOKEN")
        sanka_login = os.getenv("SANKA_LOGIN")
        sanka_password = os.getenv("SANKA_PASSWORD")

        if not access_token and sanka_login and sanka_password:
            for login_url in (f"{API_BASE}/auth/token", "https://login.sankakucomplex.com/auth/token"):
                try:
                    async with session.post(login_url, json={"login": sanka_login, "password": sanka_password}) as r:
                        if r.ok:
                            data = await r.json()
                            access_token = data.get("token") or data.get("access_token") or ""
                            if access_token:
                                self.log("Logged in via credentials")
                                break
                            self.log("Login response missing token")
                        else:
                            try:
                                err_body = await r.json()
                                err_msg = err_body.get('error', str(r.status))
                            except Exception:
                                err_msg = str(r.status)
                            self.log(f"Login at {login_url.split('/')[2]}: {err_msg}")
                except Exception as e:
                    self.log(f"Login error at {login_url.split('/')[2]}: {e}")

        if access_token:
            session.headers["Authorization"] = f"Bearer {access_token}"
        else:
            self.log("No auth token - API may reject requests")

        return session

    def get_tags(self):
        return [self.original_tag]

    async def enqueue_download(self, url, filepath, filename, tags_list, artists=None, characters=None, copyrights=None, metadata_tags=None):
        if artists is None: artists = []
        if filename in self.dl_history or filename in self.queued_items or os.path.exists(filepath):
            return False
        self.queued_items.add(filename)
        self.enqueued_count += 1
        # Download immediately — Sankaku signed URLs expire before queued download starts
        return await self._async_download_file(url, filepath, filename, tags_list, artists, 0)

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.original_tag}'" + (f" (rating: {self.rating_map.get(self.rating.split(":")[-1], "")})" if self.rating else ""))

        collected_count = 0
        page = 1

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            try:
                self.log(f"Scanning API... (Page {page})")
                limit_val = min(40, self.amount - collected_count if self.amount > 0 else 40)

                tag_list = [t.strip() for t in self.original_tag.split() if t.strip() and not t.startswith('-')]
                params = {"limit": limit_val, "page": page}
                if self.net_config.get("hide_pools", False):
                    params["hide_posts_in_books"] = "always"
                if self.rating:
                    rc = self.rating.split(":")[-1]
                    tag_list.append(f"rating:{rc}")

                if "-video" in self.exclusions and "-image" not in self.exclusions:
                    tag_list.append("file_type:image")
                elif "-image" in self.exclusions and "-video" not in self.exclusions:
                    tag_list.append("file_type:video")

                if tag_list:
                    params["tags"] = " ".join(tag_list)

                resp = await self.session.get(f"{API_BASE}/posts", params=params)
                if resp.status in [403, 429]:
                    try:
                        err = await resp.json()
                        self.log(f"API error: {err.get('error') or err.get('errors', [str(resp.status)])[0]}")
                    except Exception:
                        self.log(f"ERROR {resp.status}. Check proxy/credentials.")
                    break
                resp.raise_for_status()

                data = await resp.json()
                if isinstance(data, dict):
                    posts = data.get("data") or data.get("posts") or []
                elif isinstance(data, list):
                    posts = data
                else:
                    self.log(f"Unexpected response: {str(data)[:200]}")
                    break

                if not posts:
                    if page == 1:
                        self.log(f"ZERO images found for '{self.api_tag}'. Auth: {'yes' if self.session.headers.get('Authorization') else 'none'}")
                    break

            except Exception as e:
                err_str = str(e)
                if "403" in err_str:
                    self.log("ERROR 403: Access denied.")
                else:
                    self.log(f"API Error: {e}")
                await asyncio.sleep(5)
                continue

            await asyncio.sleep(0.25)

            had_valid = False
            for post in posts:
                if self.stop_event.is_set() or (self.amount > 0 and collected_count >= self.amount):
                    break
                if not isinstance(post, dict):
                    continue

                post_rating = post.get("rating", "")
                if self.rating:
                    filter_rating = self.rating.split(":")[-1]
                    if post_rating != filter_rating:
                        continue

                url = post.get("file_url")
                if not url:
                    continue

                ext = (post.get("file_ext") or "").lower()
                if ext not in ["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm"]:
                    continue
                if ext in ["mp4", "webm"] and "-video" in self.exclusions:
                    continue
                if ext in ["jpg", "jpeg", "png", "webp"] and "-image" in self.exclusions:
                    continue
                if ext == "gif" and "-gif" in self.exclusions:
                    continue

                filename = f"{post.get('id')}.{ext}"

                rating_label = self.rating_map.get(post_rating, "Unknown")
                subfolder = "books" if post.get("in_visible_pool") else "images"
                rating_dir = os.path.join(self.tag_dir, rating_label, subfolder)
                os.makedirs(rating_dir, exist_ok=True)
                filepath = os.path.join(rating_dir, filename)

                raw_tags = post.get("tags", [])
                if raw_tags and isinstance(raw_tags[0], dict):
                    artists = [t.get("name") for t in raw_tags if isinstance(t, dict) and t.get("type") == 1]
                    characters = [t.get("name") for t in raw_tags if isinstance(t, dict) and t.get("type") == 4]
                    copyrights = [t.get("name") for t in raw_tags if isinstance(t, dict) and t.get("type") == 3]
                    metadata_tags = [t.get("name") for t in raw_tags if isinstance(t, dict) and t.get("type") == 7]
                    tags_list = [t.get("name", "") for t in raw_tags if t.get("name") and t.get("type") in (0, None)]
                else:
                    tags_list = post.get("tag_names", [])
                    artists = []
                    characters = []
                    copyrights = []
                    metadata_tags = []

                if await self.enqueue_download(url, filepath, filename, tags_list, artists, characters, copyrights, metadata_tags):
                    collected_count += 1
                    had_valid = True

            page += 1
            if had_valid and not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
                await asyncio.sleep(self.anti_ban_pause)

        actual = self.enqueued_count
        # ponytail: stopped runs wind down late — never paint summaries over the next run
        if self.stop_event.is_set():
            return
        if actual == 0:
            self.log("No new images to download.")
        else:
            self.check_amount_warning(actual)

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))
        if self.stop_event.is_set():
            self.log("--- Worker Terminated ---")


def worker_sankaku(tag, amount, rating, exclusions, net_config):
    worker = SankakuWorker(tag, amount, rating, exclusions, net_config)
    worker.run()
