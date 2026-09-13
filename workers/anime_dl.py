import os
import asyncio
from curl_cffi import requests as curl_requests
from core.shared import BaseDownloader, MASTER_FOLDER, add_to_gallery, send_tags, write_image_metadata, save_history, build_tagd

API = "https://api.anime-pictures.net/api/v3"
PER_PAGE = 80

class AnimeDlWorker(BaseDownloader):
    def __init__(self, tag, amount, net_config):
        super().__init__("anime_dl", "AnimePictures", amount, net_config)
        self.tag = tag.strip().lower()
        self.tag_slug = self.tag.replace(" ", "_")
        self.tag_dir = os.path.join(self.site_root, self.tag_slug)
        os.makedirs(self.tag_dir, exist_ok=True)
        
        self.curl_session = None

    async def _async_download_file(self, url, filepath, filename, tags_list, artists, file_size=0, characters=None, copyrights=None, metadata_tags=None, outfits=None, groups=None, hair=None, eyes=None):
        if self.stop_event.is_set():
            self.enqueued_count -= 1
            return False

        for attempt in range(self.dl_retries):
            try:
                self.log(f"Downloading {filename} (attempt {attempt + 1}/{self.dl_retries})...")
                # ponytail: flat 600s cap; switch to streaming + stall detection if bigger files crawl
                resp = await asyncio.to_thread(
                    self.curl_session.get, 
                    url, 
                    timeout=600, 
                    headers={"Referer": "https://anime-pictures.net/"}
                )
                if resp.status_code != 200 or len(resp.content) <= 1000:
                    raise Exception(f"HTTP {resp.status_code} or file too small")
                
                with open(filepath, "wb") as f:
                    f.write(resp.content)

                if self.stop_event.is_set():
                    if os.path.exists(filepath): os.remove(filepath)
                    self.enqueued_count -= 1
                    return False

                self.downloaded_count += 1
                self.downloaded_bytes += len(resp.content)
                self.dl_history.add(filename)
                save_history(self.site_root, self.dl_history)

                if self.is_scanning and self.amount > 0:
                    target_total = max(self.amount, self.enqueued_count)
                else:
                    target_total = max(self.enqueued_count, self.downloaded_count)

                pct = int((self.downloaded_count / target_total) * 100) if target_total > 0 else 0

                rel_path = os.path.relpath(filepath, MASTER_FOLDER)
                top_tags = ", ".join(tags_list[:5]) if tags_list else "No tags"
                tagd = build_tagd(artists, characters, copyrights, metadata_tags, outfits, groups, hair, eyes, tags_list)

                self.log(f"[SUCCESS] Downloaded {filename} ({self.downloaded_count}/{target_total}) [{pct}%] |PATH| {rel_path} |TAGS| {top_tags} |TAGD| {tagd}")

                # ponytail: metadata must land before gallery publish, else thumbs read a half-written file
                write_image_metadata(filepath, tags_list, artists, self.name, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                add_to_gallery(self.name, filename, rel_path, tags_list, artists, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                send_tags(self.name, filename, tags_list, artists, rel_path, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                return True

            except Exception as e:
                if self.stop_event.is_set():
                    self.enqueued_count -= 1
                    break
                if attempt < self.dl_retries - 1: 
                    await asyncio.sleep(2)
                else: 
                    self.enqueued_count -= 1
                    self.failed_count += 1
                    err_msg = str(e).strip()
                    if not err_msg: err_msg = "Download failed"
                    self.log(f"[FAILED] {filename}: {err_msg}")
        return False

    def _fetch_child_tags(self):
        """Resolve this tag's id, then return its child sub-tags."""
        r = self.curl_session.get(f"{API}/tags", params={"tag": self.tag, "lang": "en"}, timeout=20)
        if r.status_code != 200:
            return []
        hits = [t for t in r.json().get("tags", []) if isinstance(t, dict) and str(t.get("tag", "")).lower() == self.tag]
        if not hits:
            return []
        r2 = self.curl_session.get(f"{API}/tags/{hits[0]['id']}/children", params={"lang": "en"}, timeout=20)
        if r2.status_code != 200:
            return []
        kind = {1: "character", 4: "artist", 5: "copyright", 7: "metadata"}
        return [{"name": t["tag"], "count": t.get("num_pub", t.get("num", 0)),
                 "kind": kind.get(t.get("type"), "tag")}
                for t in r2.json().get("tags", [])
                if isinstance(t, dict) and t.get("tag")]

    async def scraper_task(self):
        self.log(f"Initializing worker for tag: '{self.tag}'")
        
        # Init curl session
        s = curl_requests.Session()
        s.impersonate = "chrome131"
        if self.net_config.get("use_proxy"):
            p = self.net_config.get("proxy_url", "")
            s.proxies = {"http": p, "https": p}
        s.cookies.set("time_zone", "UTC", domain=".anime-pictures.net")
        s.cookies.set("sitelang", "en", domain=".anime-pictures.net")
        self.curl_session = s

        # ponytail: list child sub-tags once so the user can search them
        # standalone — same pattern as the zerochan worker
        try:
            kids = await asyncio.to_thread(self._fetch_child_tags)
            for k in kids:
                self.log(f"🔖 Sub-tag: '{k['name']}' — {k['count']} entries "
                         f"(search '{k['name']}' to download)")
        except Exception as e:
            self.log(f"Sub-tag listing skipped: {e}")

        need = self.amount or 200
        collected = 0
        page = 0

        while collected < need and not self.stop_event.is_set():
            params = {"page": page, "limit": PER_PAGE, "search_tag": self.tag, "lang": "en"}
            try:
                r = await asyncio.to_thread(self.curl_session.get, f"{API}/posts", params=params, timeout=30)
                if r.status_code != 200:
                    self.log(f"API Error: HTTP {r.status_code}")
                    break
                data = r.json()
            except Exception as e:
                self.log(f"API Exception: {e}")
                break
                
            posts = data.get("posts", [])
            total_found = data.get("posts_count", 0)
            
            if page == 0 and total_found > 0:
                self.log(f"Total valid items found: {total_found}")
                if self.amount > 0 and total_found < self.amount:
                    self.log(f"⚠️ Notice: You requested {self.amount} images, but only {total_found} exist for '{self.tag}'.")
            
            if not posts:
                self.log("No more posts found.")
                break

            sem = asyncio.Semaphore(6)

            async def fetch_detail(pid):
                async with sem:
                    if self.stop_event.is_set():
                        return None
                    try:
                        resp = await asyncio.to_thread(
                            self.curl_session.get, f"{API}/posts/{pid}",
                            params={"lang": "en"}, timeout=30)
                        if resp.status_code != 200:
                            return None
                        return resp.json()
                    except Exception as e:
                        self.log(f"Failed to get details for post {pid}: {e}")
                        return None

            async def fetch_one(pid):
                return pid, await fetch_detail(pid)

            pending = {asyncio.create_task(fetch_one(p["id"]))
                       for p in posts
                       if isinstance(p, dict) and p.get("id") is not None}
            try:
                while pending and not self.stop_event.is_set() and collected < need:
                    done, pending = await asyncio.wait(
                        pending, return_when=asyncio.FIRST_COMPLETED)
                    for fut in done:
                        if fut.cancelled():
                            continue
                        try:
                            post_id, detail = fut.result()
                        except Exception as e:
                            self.log(f"Detail task failed: {e}")
                            continue
                        if not detail:
                            continue

                    file_url = detail.get("file_url", "")
                    if not file_url: continue

                    dl_url = f"https://api.anime-pictures.net/pictures/download_image/{file_url}"
                    ext = file_url.rsplit(".", 1)[-1]
                    filename = f"{self.tag_slug}_{post_id}.{ext}"
                    filepath = os.path.join(self.tag_dir, filename)

                    raw_tags = detail.get("tags", [])
                    artists, characters, copyrights, metadata_tags, general = [], [], [], [], []
                    for t in raw_tags:
                        tag_info = t.get("tag", {}) if isinstance(t, dict) else {}
                        tag_name = tag_info.get("tag", "")
                        tag_type = tag_info.get("type", 0)
                        if not tag_name: continue
                        if tag_type == 4: artists.append(tag_name)
                        elif tag_type == 1: characters.append(tag_name)
                        elif tag_type == 5: copyrights.append(tag_name)
                        elif tag_type == 7: metadata_tags.append(tag_name)
                        else: general.append(tag_name)

                    if await self.enqueue_download(dl_url, filepath, filename, general, artists, characters, copyrights, metadata_tags):
                        collected += 1
            finally:
                for t in pending:
                    if not t.done():
                        t.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)

            if collected >= need or not posts: break
            page += 1
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

def worker_anime_dl(tag, amount, net_config):
    AnimeDlWorker(tag, amount, net_config).run()
