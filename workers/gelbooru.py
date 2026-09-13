import os, re
import asyncio
from workers import BaseWorker
from core.shared import load_tag_cache, save_tag_cache, TAG_TYPE_MAP


class GelbooruWorker(BaseWorker):
    def __init__(self, tag, amount, rating, exclusions, net_config):
        super().__init__("gelbooru", "Gelbooru", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.rating = rating
        self.exclusions = exclusions

        dan_to_gel_rating = {"rating:g": "rating:general", "rating:s": "rating:sensitive", "rating:q": "rating:questionable", "rating:e": "rating:explicit"}
        self.api_tag = self.original_tag
        if self.rating:
            api_rating = dan_to_gel_rating.get(self.rating, self.rating)
            self.api_tag = f"{self.original_tag} {api_rating}".strip()

        self.rating_code_map = {"g": "general", "s": "sensitive", "q": "questionable", "e": "explicit"}
        self.rating_label_map = {"general": "Safe", "sensitive": "Sensitive", "questionable": "Questionable", "explicit": "NSFW"}
        self.rating_display = ""
        if self.rating:
            self.rating_display = self.rating_label_map.get(self.rating_code_map.get(self.rating.split(":")[-1], ""), "")

        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-'))
        self.safe_tag_name = re.sub(r'[\\/*?:"<>|]', "", clean_tag)
        self.tag_dir = os.path.join(self.site_root, self.safe_tag_name)
        os.makedirs(self.tag_dir, exist_ok=True)

        self.tag_cache = load_tag_cache("gelbooru")

    def get_tags(self):
        return [self.original_tag]

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def _fetch_tag_types(self, tag_names):
        api_key = os.getenv("GELBOORU_API_KEY", "")
        user_id = os.getenv("GELBOORU_USER_ID", "")
        uncached = [t for t in tag_names if t not in self.tag_cache]
        if not uncached:
            return
        sem = asyncio.Semaphore(4)
        async def query_one(tag_name):
            async with sem:
                params = {"page": "dapi", "s": "tag", "q": "index", "name": tag_name, "json": 1, "limit": 50}
                if api_key and user_id:
                    params["api_key"] = api_key
                    params["user_id"] = user_id
                try:
                    resp = await self.session.get("https://gelbooru.com/index.php", params=params)
                    if resp.status == 200:
                        data = await resp.json()
                        tags = data.get("tag", [])
                        # ponytail: only trust the exact tag, never a near miss
                        match = next((t for t in tags if str(t.get("name", "")).lower() == tag_name.lower()), None)
                        if match:
                            t = match
                            self.tag_cache[tag_name] = TAG_TYPE_MAP.get(t.get("type", 0), "tag")
                        else:
                            self.tag_cache[tag_name] = "tag"
                    else:
                        self.tag_cache[tag_name] = "tag"
                except Exception:
                    self.tag_cache[tag_name] = "tag"
                await asyncio.sleep(0.2)
        await asyncio.gather(*[query_one(t) for t in uncached])
        save_tag_cache(self.tag_cache, "gelbooru")

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
        self.log(f"Initializing worker for tag: '{self.original_tag}'" + (f" (rating: {self.rating_display})" if self.rating_display else ""))
        api_key = os.getenv("GELBOORU_API_KEY", "")
        user_id = os.getenv("GELBOORU_USER_ID", "")

        collected_count = 0
        pid = 0

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            try:
                self.log(f"Scanning API... (Page {pid})")
                limit_val = min(100, self.amount - collected_count if self.amount > 0 else 100)
                params = {"page": "dapi", "s": "post", "q": "index", "tags": self.api_tag, "pid": pid, "limit": limit_val, "json": 1}
                if api_key and user_id:
                    params["api_key"] = api_key
                    params["user_id"] = user_id

                resp = await self.session.get("https://gelbooru.com/index.php", params=params)
                if resp.status == 401:
                    self.log("ERROR 401: Unauthorized! Enter API Key in Options.")
                    break
                elif resp.status in [403, 429]:
                    self.log(f"ERROR {resp.status}. Change proxy or slow down.")
                    break

                resp.raise_for_status()
                data = await resp.json()
                posts = data.get("post", [])

                if not posts:
                    if pid == 0: self.log(f"ZERO images found for '{self.original_tag}'.")
                    else: self.log("End of database reached.")
                    break

            except Exception as e:
                self.log(f"API Error: {e}")
                await asyncio.sleep(5)
                continue

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

            had_valid = False
            for post in posts:
                if self.stop_event.is_set() or (self.amount > 0 and collected_count >= self.amount): break
                if not isinstance(post, dict): continue

                post_rating = post.get("rating", "")
                if self.rating:
                    filter_code = self.rating.split(":")[-1]
                    if post_rating != self.rating_code_map.get(filter_code, filter_code): continue

                file_url = post.get("file_url", "")
                if not file_url: continue

                ext = file_url.split('.')[-1].lower()
                if ext in ["mp4", "webm", "zip"] and "-video" in self.exclusions: continue
                if ext in ["jpg", "jpeg", "png", "webp"] and "-image" in self.exclusions: continue
                if ext == "gif" and "-gif" in self.exclusions: continue

                filename = file_url.split('/')[-1].split('?')[0]
                rating_label = self.rating_label_map.get(post_rating, "Unknown")

                raw_tags = [t.strip() for t in post.get("tags", "").split() if t.strip()]
                tags_list, artists, characters, copyrights, metadata_tags = self._categorize_tags(raw_tags)

                rating_dir = os.path.join(self.tag_dir, rating_label, "images")
                os.makedirs(rating_dir, exist_ok=True)
                filepath = os.path.join(rating_dir, filename)

                if await self.enqueue_download(file_url, filepath, filename, tags_list, artists, characters, copyrights, metadata_tags):
                    collected_count += 1
                    had_valid = True

            pid += 1
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

def worker_gelbooru(tag, amount, rating, exclusions, net_config):
    worker = GelbooruWorker(tag, amount, rating, exclusions, net_config)
    worker.run()
