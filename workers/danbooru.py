import os, re
import asyncio
import aiohttp
from workers import BaseWorker


class DanbooruWorker(BaseWorker):
    def __init__(self, tag, amount, rating, exclusions, net_config):
        super().__init__("dan", "Danbooru", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.rating = rating
        self.exclusions = exclusions

        self.api_tag = self.original_tag
        if self.rating:
            self.api_tag = f"{self.original_tag} {self.rating}".strip()

        self.rating_map = {"g": "Safe", "s": "Sensitive", "q": "Questionable", "e": "NSFW"}
        self.dan_login = os.getenv("DANBOORU_LOGIN", "")
        self.dan_api_key = os.getenv("DANBOORU_API_KEY", "")
        self._auth = aiohttp.BasicAuth(self.dan_login, self.dan_api_key) if (self.dan_login and self.dan_api_key) else None
        self.video_exts = {"mp4", "webm"}

        FORMAT_WORDS = {"video", "image"}
        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-') and t not in FORMAT_WORDS)
        self.safe_tag = re.sub(r'[\\/*?:"<>|]', "", clean_tag)
        self.tag_dir = os.path.join(self.site_root, self.safe_tag)
        os.makedirs(self.tag_dir, exist_ok=True)

    def get_tags(self):
        return [self.original_tag]

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def _log_auth_status(self):
        # ponytail: one cheap call so the log states the real tier —
        # Member accounts keep the 2-tag cap, so "authenticated" alone misleads
        try:
            async with self.session.get(
                    "https://danbooru.donmai.us/profile.json",
                    auth=self._auth,
                    timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    self.log(f"Authenticated as {self.dan_login}")
                    return
                prof = await resp.json()
                name = prof.get("name", self.dan_login)
                tier = prof.get("level_string", "")
                if tier.lower() == "member":
                    self.log(f"Authenticated as {name} ({tier} — 2-tag search limit still applies; higher tiers raise it)")
                elif tier:
                    self.log(f"Authenticated as {name} ({tier})")
                else:
                    self.log(f"Authenticated as {name}")
        except Exception:
            self.log(f"Authenticated as {self.dan_login}")

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.original_tag}'" + (f" (rating: {self.rating_map.get(self.rating.split(':')[-1], '')})" if self.rating else ""))
        if self._auth:
            await self._log_auth_status()

        collected_count = 0
        page = 1

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            try:
                self.log(f"Scanning API... (Page {page})")
                limit_val = min(200, self.amount - collected_count if self.amount > 0 else 200)

                resp = await self.session.get("https://danbooru.donmai.us/posts.json", params={"tags": self.api_tag, "page": page, "limit": limit_val}, auth=self._auth)
                if resp.status in [403, 429]:
                    self.log(f"ERROR {resp.status}. Change proxy.")
                    break
                if resp.status == 401 and self._auth:
                    self.log("Auth failed — check your Danbooru username/API key in Options.")
                    break
                if resp.status == 422:
                    n = len(self.original_tag.split())
                    if self._auth:
                        self.log(f"ERROR 422: query exceeds your account's tag limit — your query has {n} tags. Reduce tags and retry.")
                    else:
                        self.log(f"ERROR 422: Danbooru allows max 2 search tags without login (rating excluded) — your query has {n}. Add your login + API key in Options, or reduce tags.")
                    break
                resp.raise_for_status()

                posts = await resp.json()
                if not isinstance(posts, list):
                    break

                if not posts:
                    if page == 1:
                        self.log(f"ZERO images found for '{self.api_tag}'.")
                    else:
                        self.log("End of database reached.")
                    break

            except Exception as e:
                err_str = str(e)
                if "403" in err_str:
                    self.log("ERROR 403: Cloudflare/ISP block. You need a proxy.")
                else:
                    self.log(f"API Error: {e}")
                await asyncio.sleep(5)
                continue

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

                url = post.get("file_url") or post.get("large_file_url")
                if not url:
                    continue

                ext = (post.get("file_ext") or "").lower()
                if ext in ["mp4", "webm", "zip"] and "-video" in self.exclusions:
                    continue
                if ext in ["jpg", "jpeg", "png", "webp"] and "-image" in self.exclusions:
                    continue
                if ext == "gif" and "-gif" in self.exclusions:
                    continue
                if ext not in ["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm"]:
                    continue

                filename = f"{post.get('id')}.{ext}"
                is_video = ext in self.video_exts
                rating_label = self.rating_map.get(post_rating, "Unknown")
                rating_dir = os.path.join(self.tag_dir, rating_label, "video" if is_video else "images")
                os.makedirs(rating_dir, exist_ok=True)
                filepath = os.path.join(rating_dir, filename)

                tags_raw = post.get("tag_string", "")
                tags_list = [t.strip() for t in tags_raw.split() if t.strip()]

                artists = [t.strip() for t in post.get("tag_string_artist", "").split() if t.strip()]
                characters = [t.strip() for t in post.get("tag_string_character", "").split() if t.strip()]
                copyrights = [t.strip() for t in post.get("tag_string_copyright", "").split() if t.strip()]
                metadata_tags = [t.strip() for t in post.get("tag_string_meta", "").split() if t.strip()]

                artist_set = set(artists)
                char_set = set(characters)
                copy_set = set(copyrights)
                meta_set = set(metadata_tags)
                tags_list = [t for t in tags_list if t not in artist_set and t not in char_set and t not in copy_set and t not in meta_set]

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

def worker_danbooru(tag, amount, rating, exclusions, net_config):
    worker = DanbooruWorker(tag, amount, rating, exclusions, net_config)
    worker.run()
