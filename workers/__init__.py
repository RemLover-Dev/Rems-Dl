from abc import ABC, abstractmethod
from core.shared import BaseDownloader

__all__ = ["BaseWorker", "BaseDownloader"]


class BaseWorker(BaseDownloader, ABC):
    """Abstract base class for all site-specific scrapers.

    Inherits download-engine capabilities from BaseDownloader and adds
    abstract interface methods that every worker must implement.

    Required overrides:
      - fetch_posts()      : async – scrape API and enqueue downloads
      - download_image()   : async – download a single image (uses BaseDownloader internals)
      - get_tags()         : sync  – return tag list for the current query
      - scraper_task()     : async – core scraping logic (inherited from BaseDownloader pattern)
      - run()              : sync  – synchronous entry point
    """

    def __init__(self, name, site_folder, amount, net_config):
        super().__init__(name, site_folder, amount, net_config)

    @abstractmethod
    async def fetch_posts(self):
        """Scrape API and enqueue images for download. Must be async."""
        ...

    @abstractmethod
    async def download_image(self, url, filepath, filename, tags_list, artists=None):
        """Download a single image. Wraps BaseDownloader.enqueue_download."""
        ...

    @abstractmethod
    def get_tags(self):
        """Return the list of tags for the current query. Synchronous."""
        ...

    @abstractmethod
    async def scraper_task(self):
        """Core scraping logic. Must be an async coroutine."""
        ...

    @abstractmethod
    def run(self):
        """Synchronous entry point. Typically calls asyncio.run(...)."""
        ...

    @staticmethod
    def clean_tag(tag: str) -> str:
        """Remove filesystem-unsafe characters from a tag string."""
        import re
        cleaned = " ".join(t for t in tag.split() if not t.startswith('-'))
        return re.sub(r'[\\/*?:"<>|]', "", cleaned)
