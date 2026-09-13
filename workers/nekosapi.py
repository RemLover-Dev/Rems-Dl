import os
import asyncio
from core.shared import BaseDownloader

class NekosApiWorker(BaseDownloader):
    def __init__(self, tags, amount, rating, net_config):
        super().__init__("nekosapi", "NekosAPI", amount, net_config)
        self.tags = [t.strip() for t in tags.split(",") if t.strip()]
        self.exclusions = []
        for t in self.tags[:]:
            if t.startswith("-"):
                self.exclusions.append(t[1:])
                self.tags.remove(t)
        if not self.tags:
            self.tags = ["kemonomimi"]
        self.rating = rating or "safe"
        self.rating_label = {"safe": "Safe", "suggestive": "Sensitive", "borderline": "Questionable", "explicit": "NSFW"}.get(self.rating.lower(), "Safe")
        self.api_base = "https://api.nekosapi.com/v4"
        self.tag_dir = os.path.join(self.site_root, "_".join(self.tags))
        self.rating_dir = os.path.join(self.tag_dir, self.rating_label)
        os.makedirs(self.rating_dir, exist_ok=True)

    def _validate_rating(self):
        valid = {"safe", "suggestive", "borderline", "explicit"}
        if self.rating.lower() not in valid:
            self.rating = "safe"

    async def scraper_task(self):
        self._validate_rating()
        self.log(f"Initializing worker for tags: {self.tags}")
        self.log(f"Rating: {self.rating}")

        need = self.amount or 200
        collected = 0
        offset = 0
        batch_size = 50

        while collected < need and not self.stop_event.is_set():
            params = {"limit": min(batch_size, need - collected), "offset": offset}
            if self.tags: params["tags"] = ",".join(self.tags)
            if self.exclusions: params["without_tags"] = ",".join(self.exclusions)
            params["rating"] = self.rating

            try:
                async with self.session.get(f"{self.api_base}/images", params=params) as resp:
                    if resp.status in (403, 429):
                        self.log(f"API BAN ({resp.status}). Change VPN node.")
                        break
                    resp.raise_for_status()
                    data = await resp.json()

                images = data.get("items", [])
                if not images:
                    self.log("No new images to download.")
                    break
            except Exception as e:
                self.log(f"API error: {e}")
                break

            for img in images:
                if self.stop_event.is_set() or collected >= need: break
                url = img.get("url")
                if not url: continue
                img_id = img.get("id", "unknown")
                ext = url.rsplit(".", 1)[-1].split("?")[0]
                if ext.lower() not in {"jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"}:
                    ext = "jpg"
                filename = f"{img_id}.{ext}"
                filepath = os.path.join(self.rating_dir, filename)
                tag_list = self.tags + [t for t in img.get("tags", []) if t]
                artist_name = img.get("artist_name")
                artists = [artist_name] if artist_name else []
                if await self.enqueue_download(url, filepath, filename, tag_list, artists):
                    collected += 1

            if collected >= need or not images: break
            offset += len(images)
            if not self.stop_event.is_set():
                await asyncio.sleep(self.anti_ban_pause)

        # ponytail: stopped runs wind down late — never paint summaries over the next run
        if self.stop_event.is_set():
            return
        if collected:
            self.log(f"Enqueued {collected} item{'s' if collected != 1 else ''}.")

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))
        if self.stop_event.is_set():
            self.log("--- Worker Terminated ---")

def worker_nekosapi(tags, amount, rating, net_config):
    NekosApiWorker(tags, amount, rating, net_config).run()
