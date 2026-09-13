import os
import asyncio
from core.shared import BaseDownloader

class NekosiaWorker(BaseDownloader):
    def __init__(self, tag, amount, rating, net_config):
        super().__init__("nekosia", "Nekosia", amount, net_config)
        self.tag = tag.strip().lower() if tag else "catgirl"
        toks = self.tag.split()
        non_dash = [t for t in toks if not t.startswith('-')]
        self.category = non_dash[0] if non_dash else "catgirl"
        self.additional = non_dash[1:]
        self.blacklisted = [t[1:] for t in toks if t.startswith('-') and len(t) > 1]
        self.rating = rating or "safe"
        self.rating_label = {"safe": "Safe", "sensitive": "Sensitive"}.get(self.rating.lower(), "Safe")
        self.api_base = "https://api.nekosia.cat/api/v1/images"
        self.tag_dir = os.path.join(self.site_root, self.tag)
        self.rating_dir = os.path.join(self.tag_dir, self.rating_label)
        os.makedirs(self.rating_dir, exist_ok=True)

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: {self.tag}")
        self.log(f"Rating: {self.rating}")

        need = self.amount or 200
        collected = 0
        batch_size = 50
        # ponytail: one category per request — several tags go through the
        # "nothing" category with every tag as additionalTags (docs' mechanism)
        if self.additional:
            endpoint_cat = "nothing"
            wanted = [self.category] + self.additional
        else:
            endpoint_cat = self.category
            wanted = []
        seen_ids = set()
        dead_rounds = 0

        while collected < need and not self.stop_event.is_set():
            # ponytail: nekosia.cat returns an empty array for count=1; always ask for >=2
            params = {"count": max(2, min(batch_size, need - collected))}
            if self.rating:
                params["rating"] = self.rating
            if wanted:
                params["additionalTags"] = ",".join(wanted)
            if self.blacklisted:
                params["blacklistedTags"] = ",".join(self.blacklisted)

            try:
                # The endpoint is /api/v1/images/{category/tag}
                async with self.session.get(f"{self.api_base}/{endpoint_cat}", params=params) as resp:
                    if resp.status in (403, 429):
                        self.log(f"API BAN ({resp.status}).")
                        break
                    if resp.status == 400:
                        self.log(f"Tag '{self.tag}' not found or invalid criteria.")
                        break
                    resp.raise_for_status()
                    data = await resp.json()

                images = data.get("images", [])
                if not images:
                    self.log("No new images to download.")
                    break
                # ponytail: additionalTags only ranks — enforce the AND
                # ourselves and stop when the API starts repeating images
                fresh = [im for im in images if im.get("id") not in seen_ids]
                seen_ids.update(im.get("id") for im in images)
                if not fresh:
                    dead_rounds += 1
                    if dead_rounds >= 3:
                        self.log("No more new images matching all tags.")
                        break
                    continue
                dead_rounds = 0
            except Exception as e:
                self.log(f"API error: {e}")
                break

            for img in fresh:
                if self.stop_event.is_set() or collected >= need: break

                if wanted:
                    img_tags = [(t or "").lower() for t in (img.get("tags") or [])]
                    if not all(w in img_tags for w in wanted):
                        continue
                
                # Try getting the original image URL, fallback to compressed
                img_data = img.get("image", {})
                url_data = img_data.get("original") or img_data.get("compressed")
                if not url_data: continue
                url = url_data.get("url")
                if not url: continue
                
                img_id = img.get("id", "unknown")
                ext = url_data.get("extension", "jpg")
                filename = f"{img_id}.{ext}"
                filepath = os.path.join(self.rating_dir, filename)
                
                tags = img.get("tags", [])
                attr = img.get("attribution", {})
                artist_name = attr.get("artist", {}).get("username")
                artists = [artist_name] if artist_name else []
                copyright_str = attr.get("copyright", "")
                copyrights = [copyright_str] if copyright_str else []
                
                if await self.enqueue_download(url, filepath, filename, tags, artists, copyrights=copyrights):
                    collected += 1

            if collected >= need or not images: break
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

def worker_nekosia(tag, amount, rating, net_config):
    NekosiaWorker(tag, amount, rating, net_config).run()
