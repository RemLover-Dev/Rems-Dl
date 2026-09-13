import os
import re
import asyncio
import html as html_lib
import subprocess
import hashlib
from urllib.parse import urlencode

try:
    from workers import BaseWorker
except ImportError:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from workers import BaseWorker

from core.shared import (
    save_history,
    write_image_metadata,
    add_to_gallery,
    send_tags,
    build_tagd,
    MASTER_FOLDER,
)


class CloudflareError(Exception):
    pass


POSTS_URL = "https://gsbooru.org/posts"
GSBOORU_REFERER = "https://gsbooru.org"


def _gsbooru_curl(url, out_path=None, timeout=60):
    """Fetch via curl exactly like the site owner's workaround: Referer set,
    redirects followed. Returns the subprocess.CompletedProcess (stdout holds
    the body unless out_path is given, in which case it's written to disk)."""
    cmd = ["curl", "-s", "-L", "--max-time", str(timeout),
           "-H", f"Referer: {GSBOORU_REFERER}"]
    if out_path:
        cmd += ["-o", out_path]
    cmd += [url]
    return subprocess.run(cmd, capture_output=True, timeout=timeout + 30)

ARTICLE_RE = re.compile(
    r'<article class="post_item"[^>]*>\s*'
    r'<a href="/posts/view/(\d+)">\s*'
    r'<img[^>]*title="([^"]*)"',
    re.S
)

# Prefer the original (/files/images/); samples are 850px downscale-reuploads
FILE_ORIG_RE = re.compile(r'href="(/files/images/[^"]+)"')
FILE_ANY_RE = re.compile(r'href="(/files/(?:images|samples)/[^"]+)"')

TITLE_TAIL_RE = re.compile(
    r'\bscore:\s*\S+\s+rating:\s*(\S+)\s*$'
)


def _parse_view_tags(view_html):
    """Parse categorized tags from gsbooru view page HTML.
    Returns (artists, characters, copyrights, metadata_tags, general)."""
    artists = []
    characters = []
    copyrights = []
    metadata_tags = []
    general = []

    sections = re.split(
        r'<strong class="detail_header">',
        view_html
    )

    for section in sections[1:]:
        header_end = section.find('</strong>')
        if header_end == -1:
            continue
        header = section[:header_end].strip()

        tag_names = re.findall(
            r'class="tag_string"[^>]*>\s*([^<]+?)\s*</a>',
            section[header_end:]
        )
        tag_names = [t.strip() for t in tag_names if t.strip()]

        if header == "Artist":
            artists.extend(tag_names)
        elif header == "Character":
            characters.extend(tag_names)
        elif header == "Copyright":
            copyrights.extend(tag_names)
        elif header == "Meta":
            metadata_tags.extend(tag_names)
        elif header == "General":
            general.extend(tag_names)

    return artists, characters, copyrights, metadata_tags, general


class GsbooruWorker(BaseWorker):

    async def _create_session(self):
        # gsbooru talks to the site via curl (see _get_text / _async_download_file),
        # which sets the Referer itself. The aiohttp session is only kept because
        # run_async_loop expects one; it is not used for network I/O.
        return await super()._create_session()

    def __init__(self, tag, amount, rating, exclusions, net_config):
        super().__init__("gsbooru", "Gsbooru", amount, net_config)

        self.original_tag = tag.strip().lower()
        self.rating = rating
        self.exclusions = exclusions

        # UI sends rating:g / rating:s / rating:q
        # Site has General, Sensitive, and Questionable.
        self.filter_code = self.rating.split(":")[-1] if self.rating else ""

        self.filter_word = {
            "g": "general",
            "s": "sensitive",
            "q": "questionable"
        }.get(self.filter_code, "")

        self.rating_label_map = {
            "general": "Safe",
            "sensitive": "Sensitive",
            "questionable": "Questionable",
            "explicit": "NSFW"
        }

        self.api_tag = self.original_tag

        clean_tag = " ".join(
            t for t in self.original_tag.split()
            if not t.startswith("-")
        )

        self.safe_tag_name = (
            re.sub(r'[\\/*?:"<>|]', "", clean_tag)
            or "all"
        )

        self.tag_dir = os.path.join(
            self.site_root,
            self.safe_tag_name
        )

        os.makedirs(self.tag_dir, exist_ok=True)

    def get_tags(self):
        return [self.original_tag]

    async def download_image(
        self,
        url,
        filepath,
        filename,
        tags_list,
        artists=None
    ):
        return await self.enqueue_download(
            url,
            filepath,
            filename,
            tags_list,
            artists or []
        )

    async def fetch_posts(self):
        await self.scraper_task()

    async def _get_text(self, url):
        # curl with the required Referer — mirrors the site owner's workaround.
        proc = await asyncio.to_thread(_gsbooru_curl, url, None, 60)
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", "replace")[:200]
            raise Exception(f"curl exit {proc.returncode}: {err}")
        text = proc.stdout.decode("utf-8", "replace")
        low = text[:4000].lower()
        if "just a moment" in low or "cf-mitigated" in low or "challenge-platform" in low:
            raise CloudflareError("HTTP 403: Cloudflare challenge page")
        return text

    async def enqueue_download(self, url, filepath, filename, tags_list, artists=None, characters=None, copyrights=None, metadata_tags=None, outfits=None, groups=None, hair=None, eyes=None):
        # gsbooru fetches files via curl too; skip the aiohttp HEAD request.
        if artists is None:
            artists = []
        if filename in self.dl_history or filename in self.queued_items or os.path.exists(filepath):
            return False
        self.queued_items.add(filename)
        self.download_queue.put_nowait((url, filepath, filename, tags_list, artists, 0, characters, copyrights, metadata_tags, outfits, groups, hair, eyes))
        self.enqueued_count += 1
        return True

    async def _async_download_file(self, url, filepath, filename, tags_list, artists, file_size=0, characters=None, copyrights=None, metadata_tags=None, outfits=None, groups=None, hair=None, eyes=None):
        if self.stop_event.is_set():
            self.enqueued_count -= 1
            return False

        part_path = filepath + ".part"
        for attempt in range(self.dl_retries):
            try:
                proc = await asyncio.to_thread(_gsbooru_curl, url, part_path, 300)
                if proc.returncode != 0:
                    raise Exception(
                        f"curl exit {proc.returncode}: "
                        f"{(proc.stderr or b'')[:200].decode('utf-8', 'replace')}"
                    )
                if not os.path.exists(part_path) or os.path.getsize(part_path) == 0:
                    raise Exception("empty download")

                # booru filenames embed their md5 (-<32hex>.ext); verify content
                # so a stale/recompressed variant is rejected, not saved as good
                m = re.search(r'-([0-9a-f]{32})\.[^.]+$', filename, re.I)
                if m:
                    h = hashlib.md5()
                    with open(part_path, 'rb') as f:
                        for chunk in iter(lambda: f.read(1 << 20), b''):
                            h.update(chunk)
                    if h.hexdigest() != m.group(1).lower():
                        os.remove(part_path)
                        raise Exception("md5 mismatch: server sent a different/degraded file")

                # publish under the real name only after full verification
                os.replace(part_path, filepath)

                self.downloaded_count += 1
                self.downloaded_bytes += os.path.getsize(filepath)
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

                write_image_metadata(filepath, tags_list, artists, self.name, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                add_to_gallery(self.name, filename, rel_path, tags_list, artists, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                self.log(
                    f"[SUCCESS] Downloaded {filename} "
                    f"({self.downloaded_count}/{target_total}) [{pct}%] "
                    f"|PATH| {rel_path} |TAGS| {top_tags} |TAGD| {tagd}"
                )
                send_tags(self.name, filename, tags_list, artists, rel_path, characters, copyrights, metadata_tags, outfits, groups, hair, eyes)
                return True

            except Exception as e:
                if os.path.exists(part_path):
                    os.remove(part_path)
                if self.stop_event.is_set():
                    self.enqueued_count -= 1
                    break
                if attempt < self.dl_retries - 1:
                    await asyncio.sleep(2)
                else:
                    self.enqueued_count -= 1
                    err_msg = str(e).strip() or "HTTP 404 / File Deleted from Server"
                    self.log(f"[FAILED] {filename}: {err_msg}")
                    self.failed_count += 1
                    if os.path.exists(filepath):
                        os.remove(filepath)
        return False

    async def scraper_task(self):

        self.log(
            f"Initializing worker for tag: '{self.api_tag}'"
            + (f" (rating: {self.rating_label_map.get(self.filter_word, '')})" if self.filter_word else "")
        )

        if self.stop_event.is_set():

            self.log(
                "BUG DIAGNOSTIC: stop_event was already set at start "
                "— a STOP signal reached this run."
            )

            return

        page = 1

        # Scan page by page until the requested number of UNIQUE
        # images has been downloaded.
        while (
            not self.stop_event.is_set()
            and (
                self.amount == 0
                or self.downloaded_count < self.amount
            )
        ):

            articles = None

            # Retry a page if something goes wrong.
            for attempt in range(4):

                try:
                    self.log(
                        f"Scanning posts... (Page {page})"
                    )

                    # First page intentionally has no page parameter.
                    #
                    # Later pages:
                    # ?page=N&rating=X&tags=...
                    #
                    # _get_text() automatically uses the session headers.
                    params = {}

                    if page > 1:
                        params["page"] = str(page)

                    if self.filter_code:
                        params["rating"] = self.filter_code

                    params["tags"] = self.api_tag

                    list_url = (
                        f"{POSTS_URL}?{urlencode(params)}"
                    )

                    list_html = await self._get_text(
                        list_url
                    )

                    articles = ARTICLE_RE.findall(
                        list_html
                    )

                    break

                except CloudflareError as e:

                    if attempt < 3:

                        self.log(
                            f"Cloudflare challenge on page {page}, "
                            f"retrying in {5 * (attempt + 1)}s..."
                        )

                        await asyncio.sleep(
                            15 * (attempt + 1)
                        )

                        continue

                    self.log(
                        f"{e}. "
                        f"The request included "
                        f"Referer: {GSBOORU_REFERER}"
                    )

                    break

                except Exception as e:

                    self.log(
                        f"Scrape Error: {e}"
                    )

                    await asyncio.sleep(5)

                    continue

            if articles is None:
                break

            if not articles:

                low = list_html[:2000].lower()

                if (
                    "challenge" in low
                    or "just a moment" in low
                ):

                    self.log(
                        "Cloudflare challenge served with HTTP 200. "
                        "Stopping pagination."
                    )

                    break

                if page == 1:

                    self.log(
                        f"ZERO images found for "
                        f"'{self.original_tag}'. "
                        f"Page head: {list_html[:150]}"
                    )

                else:

                    self.log(
                        "End of database reached."
                    )

                break

            page_enqueued = 0

            for post_id, title_attr in articles:

                if (
                    self.stop_event.is_set()
                    or (
                        self.amount > 0
                        and (
                            self.downloaded_count
                            + page_enqueued
                            >= self.amount
                        )
                    )
                ):
                    break

                title = html_lib.unescape(
                    title_attr
                )

                m = TITLE_TAIL_RE.search(title)

                rating_word = (
                    m.group(1)
                    if m
                    else ""
                )

                tags_part = (
                    title[:m.start()]
                    if m
                    else title
                )

                tags_list = [
                    t
                    for t in tags_part.split()
                    if t
                ]

                if (
                    self.filter_word
                    and rating_word != self.filter_word
                ):

                    continue

                try:

                    view_html = await self._get_text(
                        f"https://gsbooru.org/posts/view/{post_id}"
                    )

                except CloudflareError as e:

                    self.log(
                        f"{e}. Stopping."
                    )

                    return

                except Exception as e:

                    self.log(
                        f"[SKIP] #{post_id}: {e}"
                    )

                    continue

                fm = (
                    FILE_ORIG_RE.search(view_html)
                    or FILE_ANY_RE.search(view_html)
                )

                if not fm:

                    self.log(
                        f"[SKIP] #{post_id}: "
                        f"no file link on post page"
                    )

                    continue

                file_url = (
                    "https://gsbooru.org"
                    + fm.group(1)
                )

                ext = (
                    file_url
                    .split(".")[-1]
                    .lower()
                    .split("?")[0]
                )

                if (
                    ext in ["mp4", "webm", "zip"]
                    and "-video" in self.exclusions
                ):
                    continue

                if (
                    ext in ["jpg", "jpeg", "png", "webp"]
                    and "-image" in self.exclusions
                ):
                    continue

                if (
                    ext == "gif"
                    and "-gif" in self.exclusions
                ):
                    continue

                artists, characters, copyrights, metadata_tags, general = (
                    _parse_view_tags(view_html)
                )

                if not general:
                    general = tags_list

                filename = (
                    file_url
                    .split("/")[-1]
                    .split("?")[0]
                )

                rating_label = (
                    self.rating_label_map.get(
                        rating_word,
                        "Unknown"
                    )
                )

                rating_dir = os.path.join(
                    self.tag_dir,
                    rating_label,
                    "images"
                )

                os.makedirs(
                    rating_dir,
                    exist_ok=True
                )

                filepath = os.path.join(
                    rating_dir,
                    filename
                )

                if await self.enqueue_download(
                    file_url,
                    filepath,
                    filename,
                    general,
                    artists,
                    characters,
                    copyrights,
                    metadata_tags
                ):
                    page_enqueued += 1

            # Wait for this page's downloads and pHash
            # deduplication to finish.
            if page_enqueued:
                await self.download_queue.join()

            page += 1

            if (
                not self.stop_event.is_set()
                and (
                    self.amount == 0
                    or self.downloaded_count < self.amount
                )
            ):
                await asyncio.sleep(
                    self.anti_ban_pause
                )

        actual = self.enqueued_count

        # ponytail: stopped runs wind down late — never paint summaries over the next run
        if self.stop_event.is_set():
            return

        if actual == 0:

            self.log(
                "No new images to download."
            )

        else:

            self.check_amount_warning(
                actual
            )

    def run(self):
        asyncio.run(
            self.run_async_loop(
                self.scraper_task
            )
        )

        if self.stop_event.is_set():
            self.log(
                "--- Worker Terminated ---"
            )


def worker_gsbooru(
    tag,
    amount,
    rating,
    exclusions,
    net_config
):
    worker = GsbooruWorker(
        tag,
        amount,
        rating,
        exclusions,
        net_config
    )

    worker.run()
