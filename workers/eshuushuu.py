import os, re, asyncio, json
from core.shared import BaseDownloader

class EShuushuuWorker(BaseDownloader):
    def __init__(self, tag, amount, exclusions, user_id, net_config):
        super().__init__("eshuushuu", "e-shuushuu", amount, net_config)
        self.original_tag = tag.strip()
        self.exclusions = exclusions
        self.user_id = user_id.strip() if user_id else ""
        
        if self.user_id and not self.user_id.isdigit():
            resolved = self._resolve_user_id(self.user_id)
            if resolved:
                self.user_id = resolved
                self.log(f"Resolved username to user_id={resolved}")
            else:
                self.log(f"Could not resolve username '{self.user_id}' from DB")
                
        self.tag_id = ""
        if self.original_tag:
            if self.original_tag.isdigit():
                self.tag_id = self.original_tag
            else:
                self.tag_id = self._resolve_tag_id(self.original_tag)
                
        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-'))
        self.safe_tag = re.sub(r'[\\/*?"<>|]', "", clean_tag or "all")
        self.tag_dir = os.path.join(self.site_root, self.safe_tag or "all")
        os.makedirs(self.tag_dir, exist_ok=True)

    def _resolve_tag_id(self, tag_name):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database", "eshuushuu_tags.json")
        if os.path.exists(db_path):
            try:
                with open(db_path, encoding="utf-8") as f:
                    tags = json.load(f)
                for t in tags:
                    if t["title"].lower() == tag_name.lower():
                        return str(t["tag_id"])
            except Exception: pass
        return ""

    def _resolve_user_id(self, username):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database", "eshuushuu_users.json")
        if not os.path.exists(db_path): return ""
        target = username.lower().strip()
        try:
            with open(db_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line: continue
                    try:
                        u = json.loads(line)
                        if u.get("username","").lower() == target:
                            return str(u.get("user_id", ""))
                    except json.JSONDecodeError: continue
        except Exception: pass
        return ""

    async def scraper_task(self):
        label = f"user_id:{self.user_id}" if self.user_id else f"'{self.original_tag}'"
        if self.original_tag and self.user_id:
            label = f"'{self.original_tag}' + user_id:{self.user_id}"
        self.log(f"Scanning e-shuushuu for: {label}")

        collected = 0
        page = 1
        
        import requests
        req_session = requests.Session()
        if self.net_config.get("use_proxy"):
            p = self.net_config.get("proxy_url")
            req_session.proxies = {"http": p, "https": p}
        req_session.verify = self.net_config.get("verify_tls", False)

        while not self.stop_event.is_set() and (self.amount == 0 or collected < self.amount):
            try:
                params = []
                if self.tag_id: params.append(f"tags={self.tag_id}")
                elif self.original_tag: params.append(f"tags={self.original_tag.replace(' ', '+')}")
                if self.user_id: params.append(f"user_id={self.user_id}")
                params.append(f"page={page}")
                search_url = f"https://e-shuushuu.net/search?{'&'.join(params)}"

                resp = await asyncio.to_thread(req_session.get, search_url, timeout=15)
                if resp.status_code in (403, 429):
                    self.log(f"Blocked ({resp.status_code}).")
                    break
                resp.raise_for_status()
                html = resp.text
                final_url = str(resp.url)

                if '/search' not in final_url:
                    self.log(f"Tag '{self.original_tag}' doesn't exist (redirected to homepage).")
                    break

                thumb_ids = re.findall(r'/thumbs/\d{4}-\d{2}-\d{2}-(\d+)\.webp', html)
                seen = set()
                thumb_ids = [x for x in thumb_ids if not (x in seen or seen.add(x))]
                if not thumb_ids:
                    if page == 1: self.log("Zero results.")
                    else: self.log("End of results.")
                    break

            except Exception as e:
                self.log(f"Search page {page} error: {e}")
                await asyncio.sleep(5)
                continue

            for img_id in thumb_ids:
                if self.stop_event.is_set() or (self.amount > 0 and collected >= self.amount): break
                try:
                    post_url = f"https://e-shuushuu.net/images/{img_id}"
                    resp = await asyncio.to_thread(req_session.get, post_url, timeout=15)
                    resp.raise_for_status()
                    ph = resp.text

                    m = re.search(r'image:\{(.*?)user:\{', ph, re.DOTALL)
                    if not m: continue
                    raw = m.group(1)

                    filename = self._g(raw, 'filename')
                    ext = self._g(raw, 'ext')
                    if not filename or not ext: continue

                    cdn_url = f"https://cdn.e-shuushuu.net/fullsize/{filename}.{ext}"
                    username = self._g(ph, 'username')
                    if not username:
                        um = re.search(r'username:"([^"]+)"', ph)
                        if um: username = um.group(1)

                    if ext in ("mp4", "webm", "zip") and "-video" in self.exclusions: continue
                    if ext in ("jpg", "jpeg", "png", "webp") and "-image" in self.exclusions: continue
                    if ext == "gif" and "-gif" in self.exclusions: continue

                    tags_raw = re.findall(r'\{tag_id:\d+,title:"([^"]+)",type:(\d+),', ph)
                    artists, characters, copyrights, general = [], [], [], []
                    for title, ttype in tags_raw:
                        if ttype == "3": artists.append(title)
                        elif ttype == "4": characters.append(title)
                        elif ttype == "2": copyrights.append(title)
                        else: general.append(title)

                    out_name = f"{img_id}.{ext}"

                    if self.user_id and username:
                        user_dir = re.sub(r'[\\/*?"<>|]', "_", username)
                        base = self.tag_dir if self.original_tag else self.site_root
                        download_dir = os.path.join(base, user_dir)
                    else:
                        download_dir = self.tag_dir
                    os.makedirs(download_dir, exist_ok=True)
                    filepath = os.path.join(download_dir, out_name)

                    if await self.enqueue_download(cdn_url, filepath, out_name, general, artists, characters, copyrights, []):
                        collected += 1

                except Exception as e:
                    self.log(f"Image {img_id} error: {e}")
                    continue

            page += 1
            if not self.stop_event.is_set() and (self.amount == 0 or collected < self.amount):
                await asyncio.sleep(self.anti_ban_pause)

        qsize = self.download_queue.qsize() if self.download_queue else collected
        if qsize == 0: self.log("No new images.")
        else: self.log(f"Enqueued {qsize} items. Completing downloads...")

    def _g(self, raw, key):
        m = re.search(rf'{key}:"([^"]+)"', raw)
        return m.group(1) if m else ""

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))
        self.log("--- Worker Terminated ---")

def worker_eshuushuu(tag, amount, exclusions, user_id, net_config):
    EShuushuuWorker(tag, amount, exclusions, user_id, net_config).run()
