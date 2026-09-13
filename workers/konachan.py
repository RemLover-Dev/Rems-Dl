import os, re, hashlib
import asyncio
from workers import BaseWorker
from core.shared import load_tag_cache, save_tag_cache, TAG_TYPE_MAP


class KonachanWorker(BaseWorker):
    def __init__(self, tag, amount, rating, exclusions, net_config):
        super().__init__("kona", "Konachan", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.rating = rating
        self.exclusions = exclusions
        self.tag_cache = load_tag_cache("konachan")

        self.api_tag = self.original_tag
        if self.rating:
            self.api_tag = f"{self.original_tag} {self.rating}".strip()

        self.rating_map = {"s": "Safe", "q": "Questionable", "e": "NSFW"}

        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-'))
        self.safe_tag = re.sub(r'[\\/*?:"<>|]', "", clean_tag)
        self.tag_dir = os.path.join(self.site_root, self.safe_tag)
        os.makedirs(self.tag_dir, exist_ok=True)

    def get_tags(self):
        return [self.original_tag]

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def _fetch_tag_types(self, tag_names):
        uncached = [t for t in tag_names if t not in self.tag_cache]
        if not uncached:
            return
        sem = asyncio.Semaphore(4)
        async def query_one(tag_name):
            async with sem:
                try:
                    resp = await self.session.get(
                        "https://konachan.com/tag.json",
                        params={"name": tag_name, "order": "count", "limit": 50}
                    )
                    if resp.status == 200:
                        tags = await resp.json()
                        # ponytail: scan every row for the exact tag
                        match = next((t for t in tags if str(t.get("name", "")).lower() == tag_name.lower()), None)
                        if match:
                            self.tag_cache[tag_name] = TAG_TYPE_MAP.get(match.get("type", 0), "tag")
                        else:
                            self.tag_cache[tag_name] = "tag"
                    else:
                        self.tag_cache[tag_name] = "tag"
                except Exception:
                    self.tag_cache[tag_name] = "tag"
                await asyncio.sleep(0.2)
        await asyncio.gather(*[query_one(t) for t in uncached])
        save_tag_cache(self.tag_cache, "konachan")

    def _categorize_tags(self, tag_names):
        artists, characters, copyrights, metadata_tags, general = [], [], [], [], []
        for t in tag_names:
            cat = self.tag_cache.get(t, "tag")
            if cat == "artist": artists.append(t)
            elif cat == "character": characters.append(t)
            elif cat == "copyright": copyrights.append(t)
            elif cat == "metadata": metadata_tags.append(t)
            else: general.append(t)
        return general, artists, characters, copyrights, metadata_tags

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.original_tag}'" + (f" (rating: {self.rating_map.get(self.rating.split(":")[-1], "")})" if self.rating else ""))

        auth = {}
        kona_user = os.getenv("KONACHAN_USERNAME", "")
        kona_pass = os.getenv("KONACHAN_PASSWORD", "")
        if kona_user and kona_pass:
            pw_hash = hashlib.sha1(f"So-I-Heard-You-Like-Mupkids-?--{kona_pass}--".encode()).hexdigest()
            auth = {"login": kona_user, "password_hash": pw_hash}
            self.log(f"Authenticating as '{kona_user}' (needed for questionable/explicit).")
        else:
            self.log("No Konachan credentials loaded - running as anonymous (safe content only).")

        collected_count = 0
        page = 1

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            try:
                self.log(f"Scanning API... (Page {page})")
                limit_val = min(100, self.amount - collected_count if self.amount > 0 else 100)

                resp = await self.session.get("https://konachan.com/post.json", params={"tags": self.api_tag, "page": page, "limit": limit_val, **auth})
                if resp.status in [403, 429]:
                    self.log(f"ERROR {resp.status}. Change proxy.")
                    break
                resp.raise_for_status()

                text_resp = (await resp.text()).strip()
                if not text_resp or text_resp == "[]" or text_resp == "null":
                    if page == 1:
                        self.log(f"ZERO images found for '{self.api_tag}'.")
                        if self.rating and self.rating.split(":")[-1] in ("q", "e"):
                            if auth:
                                self.log("Authenticated, got 0 non-safe posts. Check 'Show explicit content' is enabled in your konachan.com profile settings.")
                            else:
                                self.log("No Konachan credentials configured (Options tab) - non-safe content needs a logged-in account.")
                    break

                raw_data = await resp.json()
                if isinstance(raw_data, dict):
                    if "success" in raw_data and not raw_data["success"]:
                        self.log(f"API Alert: {raw_data.get('message', 'Unknown Error')}")
                        break
                    posts = [raw_data]
                elif isinstance(raw_data, list):
                    posts = raw_data
                else:
                    break

                if not posts:
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

            all_tags = set()
            for post in posts:
                if isinstance(post, dict):
                    for t in post.get("tags", "").split():
                        all_tags.add(t.strip())
            if all_tags:
                uncached_count = len([t for t in all_tags if t not in self.tag_cache])
                if uncached_count:
                    self.log(f"Categorizing {len(all_tags)} tags ({uncached_count} uncached)...")
                    await self._fetch_tag_types(all_tags)

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
                rating_label = self.rating_map.get(post_rating, "Unknown")
                rating_dir = os.path.join(self.tag_dir, rating_label, "images")
                os.makedirs(rating_dir, exist_ok=True)
                filepath = os.path.join(rating_dir, filename)

                tags_raw = post.get("tags", "")
                tags_list = [t.strip() for t in tags_raw.split() if t.strip()]
                tags_list, artists, characters, copyrights, metadata_tags = self._categorize_tags(tags_list)

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

def worker_konachan(tag, amount, rating, exclusions, net_config):
    worker = KonachanWorker(tag, amount, rating, exclusions, net_config)
    worker.run()
