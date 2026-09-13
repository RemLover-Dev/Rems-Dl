import os, re, random
import asyncio
from workers import BaseWorker
from rule34Py import rule34Py
from rule34Py.tag import TagType


class Rule34Worker(BaseWorker):
    def __init__(self, tag, amount, method, sort_type, sort_order, exclusions, net_config, exclude_ai=False):
        super().__init__("rule34", "Rule34", amount, net_config)
        self.original_tag = tag.strip().lower()
        self.exclude_ai = exclude_ai
        self.method = method
        self.sort_type = sort_type
        self.sort_order = sort_order
        self.exclusions = exclusions

        tag_list = [t.strip() for t in self.original_tag.split() if t.strip()]
        if len(tag_list) > 10:
            self.log("Warning: Max 10 tags allowed! Truncating your list...")
            tag_list = tag_list[:10]

        self.tag_list = tag_list
        TAGS = []
        if method == "or":
            if any(t.startswith('-') for t in tag_list):
                self.log("Error: Cannot use negative (-tag) in OR method.")
                self.log("Auto-switching to AND method...")
                TAGS.extend(tag_list)
            else:
                TAGS.append(" ~ ".join(tag_list))
        else:
            TAGS.extend(tag_list)

        if sort_order == "desc":
            TAGS.append(f"sort:{sort_type}")
        else:
            TAGS.append(f"sort:{sort_type}:{sort_order}")

        if exclusions:
            TAGS.extend(exclusions)

        self.api_tags = TAGS
        self.log(f"Final Payload sent to rule34Py: {TAGS}")

        clean_folder_name = " ".join([t for t in tag_list if not t.startswith('-')])
        self.safe_tag = re.sub(r'[\\/*?:"<>|~]', "", clean_folder_name).strip()
        if not self.safe_tag:
            self.safe_tag = "mixed_tags"
        self.tag_dir = os.path.join(self.site_root, self.safe_tag)
        os.makedirs(self.tag_dir, exist_ok=True)

    async def _create_session(self):
        session = await super()._create_session()
        client = rule34Py()
        api_key = os.getenv("RULE34_API_KEY", "")
        user_id_raw = os.getenv("RULE34_USER_ID", "0")
        user_id = int(user_id_raw) if user_id_raw.isdigit() else 0

        if api_key and user_id:
            client.api_key = api_key
            client.user_id = user_id
            self.log("API credentials loaded from .env")
        else:
            self.log("No API credentials found. Running in anonymous mode.")

        if self.net_config.get("use_proxy"):
            p = self.net_config.get("proxy_url")
            client.session.proxies = {"http": p, "https": p}
            client.session.verify = self.net_config.get("verify_tls", False)
        else:
            client.session.proxies = {"http": "", "https": "", "no_proxy": "*"}
            client.session.verify = False

        self.client = client
        return session

    def get_tags(self):
        return self.tag_list

    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        return await self.enqueue_download(url, filepath, filename, tags_list, artists or [])

    async def fetch_posts(self):
        await self.scraper_task()

    async def scraper_task(self):
        self.log("Initializing worker... [RULE34PY LIBRARY MODE]")

        collected_count = 0
        page = 0

        while not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
            self.log(f"Scanning via rule34Py... (Page {page})")
            chunk_limit = min(1000, self.amount - collected_count if self.amount > 0 else 100)
            results = None
            max_retries = 5

            for attempt in range(max_retries):
                try:
                    results = await asyncio.to_thread(self.client.search, self.api_tags, page_id=page, limit=chunk_limit, exclude_ai=self.exclude_ai)
                    break
                except TypeError as e:
                    if "string indices must be integers" in str(e):
                        results = []
                        break
                    else:
                        raise e
                except Exception as e:
                    error_msg = str(e)
                    if "timeout" in error_msg.lower() or "read timed out" in error_msg.lower():
                        self.log(f"Network Timeout (Attempt {attempt+1}/{max_retries}). Retrying in 3s...")
                        await asyncio.sleep(3)
                    else:
                        raise e

            if results is None:
                self.log("Failed to connect to Rule34 after 5 attempts. Check your VPN/Proxy.")
                break

            if not results:
                if page == 0:
                    self.log(f"ZERO images found for {self.api_tags}.")
                else:
                    self.log("End of database reached.")
                break

            had_valid = False
            for result in results:
                if self.stop_event.is_set() or (self.amount > 0 and collected_count >= self.amount):
                    break
                file_url = result.image
                if not file_url:
                    continue

                ext = file_url.split('.')[-1].lower()

                if ext in ["mp4", "webm", "zip"] and "-video" in self.exclusions:
                    continue
                if ext in ["jpg", "jpeg", "png", "webp"] and "-image" in self.exclusions:
                    continue
                if ext == "gif" and "-gif" in self.exclusions:
                    continue

                post_id = getattr(result, 'id', random.randint(1000, 99999))
                filename = f"{post_id}.{ext}"
                filepath = os.path.join(self.tag_dir, filename)

                tags_raw = getattr(result, 'tags', [])
                if isinstance(tags_raw, list):
                    artists = [t.tag for t in tags_raw if hasattr(t, 'type') and t.type == TagType.ARTIST]
                    characters = [t.tag for t in tags_raw if hasattr(t, 'type') and t.type == TagType.CHARACTER]
                    copyrights = [t.tag for t in tags_raw if hasattr(t, 'type') and t.type == TagType.COPYRIGHT]
                    metadata_tags = [t.tag for t in tags_raw if hasattr(t, 'type') and t.type == TagType.METADATA]
                    tags_list = [t.tag for t in tags_raw if hasattr(t, 'type') and t.type == TagType.TAG]
                elif isinstance(tags_raw, str):
                    tags_list = [t.strip() for t in tags_raw.split() if t.strip()]
                    artists = [t.replace("artist:", "", 1) for t in tags_list if t.startswith("artist:")]
                    tags_list = [t for t in tags_list if not t.startswith("artist:")]
                    characters = [t.replace("character:", "", 1) for t in tags_list if t.startswith("character:")]
                    tags_list = [t for t in tags_list if not t.startswith("character:")]
                    copyrights = [t.replace("copyright:", "", 1) for t in tags_list if t.startswith("copyright:")]
                    tags_list = [t for t in tags_list if not t.startswith("copyright:")]
                    metadata_tags = [t.replace("meta:", "", 1) for t in tags_list if t.startswith("meta:")]
                    tags_list = [t for t in tags_list if not t.startswith("meta:")]
                else:
                    tags_list = [str(t).strip() for t in tags_raw if str(t).strip()]
                    artists, characters, copyrights, metadata_tags = [], [], [], []

                if await self.enqueue_download(file_url, filepath, filename, tags_list, artists, characters, copyrights, metadata_tags):
                    collected_count += 1
                    had_valid = True

            page += 1
            if had_valid and not self.stop_event.is_set() and (self.amount == 0 or collected_count < self.amount):
                delay = random.uniform(self.anti_ban_pause, self.anti_ban_pause + 2.0)
                self.log(f"Anti-ban pause... ({delay:.1f}s)")
                await asyncio.sleep(delay)

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

def worker_rule34(tag, amount, method, sort_type, sort_order, exclusions, net_config, exclude_ai=False):
    worker = Rule34Worker(tag, amount, method, sort_type, sort_order, exclusions, net_config, exclude_ai)
    worker.run()
