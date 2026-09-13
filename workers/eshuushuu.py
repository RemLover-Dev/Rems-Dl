import os, re, asyncio, json
import requests
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
                
        self.tag_names = [t for t in self.original_tag.split() if not t.startswith('-')]
        self.tag_ids, self.unknown_tags = self._resolve_many(self.tag_names)
        self.tag_id = ",".join(self.tag_ids)

        clean_tag = " ".join(t for t in self.original_tag.split() if not t.startswith('-'))
        self.safe_tag = re.sub(r'[\\/*?"<>|]', "", clean_tag or "all")
        self.tag_dir = os.path.join(self.site_root, self.safe_tag or "all")
        os.makedirs(self.tag_dir, exist_ok=True)

    def _resolve_many(self, tokens):
        # ponytail: titles contain spaces ("long hair") — greedy longest
        # match left-to-right so multi-word tags survive whitespace splitting
        ids, unknown, cache = [], [], {}
        i = 0
        while i < len(tokens):
            if tokens[i].isdigit():
                ids.append(tokens[i])
                i += 1
                continue
            hit = None
            for j in range(len(tokens), i, -1):
                cand = " ".join(tokens[i:j])
                key = cand.lower()
                if key not in cache:
                    cache[key] = self._resolve_tag_id(cand)
                if cache[key]:
                    hit = cache[key]
                    i = j
                    break
            if hit:
                ids.append(hit)
            else:
                unknown.append(tokens[i])
                i += 1
        return ids, unknown

    def _http_session(self):
        s = requests.Session()
        if self.net_config.get("use_proxy"):
            p = self.net_config.get("proxy_url")
            s.proxies = {"http": p, "https": p}
        s.verify = self.net_config.get("verify_tls", False)
        return s

    def _resolve_tag_id(self, tag_name):
        # ponytail: exclusions/underscores are input syntax, not tag titles
        name = " ".join(t for t in tag_name.replace("_", " ").split()
                        if not t.startswith('-')).strip()
        if not name:
            return ""
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database", "eshuushuu_tags.json")
        if os.path.exists(db_path):
            try:
                with open(db_path, encoding="utf-8") as f:
                    tags = json.load(f)
                for t in tags:
                    if t["title"].lower() == name.lower():
                        return str(t["tag_id"])
            except Exception: pass
        # local DB is absent — resolve live or not at all. A raw-text
        # tags= query is silently ignored by the site (serves the
        # homepage feed), so never fall back to one.
        return self._resolve_tag_id_online(name)

    def _resolve_tag_id_online(self, name, _depth=0):
        try:
            resp = self._http_session().get(
                "https://e-shuushuu.net/api/v1/tags",
                params={"search": name}, timeout=15)
            if resp.status_code != 200:
                return ""
            payload = resp.json()
            tags = payload.get("tags", []) if isinstance(payload, dict) else []
            exact = [t for t in tags if isinstance(t, dict)
                     and str(t.get("title", "")).lower() == name.lower()]
            if not exact:
                return ""
            canon = [t for t in exact if not t.get("is_alias")]
            if canon:
                canon.sort(key=lambda t: t.get("usage_count") or 0, reverse=True)
                tid = canon[0].get("tag_id")
                return str(tid) if tid else ""
            if _depth == 0:
                target = exact[0].get("alias_of_name") or ""
                if target:
                    return self._resolve_tag_id_online(target, _depth + 1)
        except Exception:
            pass
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

        if self.original_tag and (self.unknown_tags or not self.tag_id):
            bad = ", ".join(f"'{t}'" for t in self.unknown_tags) or f"'{self.original_tag}'"
            self.log(f"Unknown tag(s) {bad} — not downloading anything.")
            return

        collected = 0
        page = 1

        req_session = self._http_session()

        while not self.stop_event.is_set() and (self.amount == 0 or collected < self.amount):
            try:
                params = []
                if self.tag_id: params.append(f"tags={self.tag_id}")
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
        # ponytail: stopped runs wind down late — never paint summaries over the next run
        if self.stop_event.is_set():
            return
        if qsize == 0: self.log("No new images to download.")
        else: self.log(f"Enqueued {qsize} items. Completing downloads...")

    def _g(self, raw, key):
        m = re.search(rf'{key}:"([^"]+)"', raw)
        return m.group(1) if m else ""

    def run(self):
        asyncio.run(self.run_async_loop(self.scraper_task))
        if self.stop_event.is_set():
            self.log("--- Worker Terminated ---")

def worker_eshuushuu(tag, amount, exclusions, user_id, net_config):
    EShuushuuWorker(tag, amount, exclusions, user_id, net_config).run()
