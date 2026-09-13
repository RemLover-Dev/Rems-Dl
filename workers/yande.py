import os, re
import asyncio
import xml.etree.ElementTree as ET
from workers import BaseWorker
import core.shared as shared


class YandeWorker(BaseWorker):
    def __init__(self, tag, amount, rating, net_config):
        super().__init__("yande", "Yande.re", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.rating = rating

        self.api_tag = self.original_tag
        if self.rating:
            self.api_tag = f"{self.original_tag} {self.rating}".strip()

        self.rating_map = {"s": "Safe", "q": "Questionable", "e": "NSFW"}

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

    async def _fetch_tag_types(self, tag_names):
        cache = shared.load_tag_cache("yande")
        uncached = [t for t in tag_names if t not in cache]
        if uncached:
            self.log(f"Fetching types for {len(uncached)} tags...")
            # ponytail: concurrent like gelbooru/safebooru — sequential
            # per-tag requests stalled every page
            sem = asyncio.Semaphore(4)
            async def query_one(tag_name):
                async with sem:
                    try:
                        resp = await self.session.get("https://yande.re/tag.xml", params={
                            "name": tag_name, "limit": 50
                        })
                        if resp.status != 200:
                            cache[tag_name] = 0
                        else:
                            text = await resp.text()
                            root = ET.fromstring(text)
                            # ponytail: name= matches substrings and the exact
                            # row can bury below row 1, so scan every row
                            cache[tag_name] = 0
                            for tag_el in root.findall("tag"):
                                if tag_el.get("name", "").lower() == tag_name.lower():
                                    cache[tag_name] = int(tag_el.get("type", 0))
                                    break
                    except Exception:
                        cache[tag_name] = 0
                    await asyncio.sleep(0.2)
            await asyncio.gather(*[query_one(t) for t in uncached])
            shared.save_tag_cache(cache, "yande")
        return cache

    def _categorize_tags(self, tag_names, cache):
        result = {"artist": [], "character": [], "copyright": [], "metadata": [], "tag": []}
        for t in tag_names:
            tag_type = cache.get(t, 0)
            category = shared.TAG_TYPE_MAP.get(tag_type, "tag")
            result[category].append(t)
        return result

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.original_tag}'" + (f" (rating: {self.rating_map.get(self.rating.split(":")[-1], "")})" if self.rating else ""))

        collected_count = 0
        page = 1

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            try:
                self.log(f"Scanning API... (Page {page})")
                limit_val = min(100, self.amount - collected_count if self.amount > 0 else 100)

                resp = await self.session.get("https://yande.re/post.json", params={"tags": self.api_tag, "page": page, "limit": limit_val})
                if resp.status in [403, 429]:
                    self.log(f"ERROR {resp.status}. Change proxy.")
                    break
                resp.raise_for_status()

                text_resp = (await resp.text()).strip()
                if not text_resp or text_resp == "[]":
                    if page == 1:
                        self.log(f"ZERO images found for '{self.api_tag}'.")
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

            all_tag_names = set()
            for post in posts:
                if not isinstance(post, dict):
                    continue
                tags_raw = post.get("tags", "")
                all_tag_names.update(t.strip() for t in tags_raw.split() if t.strip())

            cache = await self._fetch_tag_types(all_tag_names)

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
                if ext not in ["jpg", "jpeg", "png"]:
                    continue

                filename = f"{post.get('id')}.{ext}"
                rating_label = self.rating_map.get(post_rating, "Unknown")
                rating_dir = os.path.join(self.tag_dir, rating_label, "images")
                os.makedirs(rating_dir, exist_ok=True)
                filepath = os.path.join(rating_dir, filename)

                tags_raw = post.get("tags", "")
                tag_names = [t.strip() for t in tags_raw.split() if t.strip()]
                cats = self._categorize_tags(tag_names, cache)
                artists = cats["artist"]
                characters = cats["character"]
                copyrights = cats["copyright"]
                metadata_tags = cats["metadata"]
                tags_list = cats["tag"]

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

def worker_yande(tag, amount, rating, net_config):
    worker = YandeWorker(tag, amount, rating, net_config)
    worker.run()
