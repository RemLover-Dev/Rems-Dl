import sys
import os

# Add the project root to the path so we can import the modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import Rems_Dl
    from core import database
    from core import shared
    import workers
    for m in ("pinterest_worker", "anime_dl", "zerochan", "sankaku", "konachan",
              "yande", "waifu_im", "nekos_life", "nekos_best", "safebooru",
              "rule34", "gelbooru", "gsbooru", "danbooru", "eshuushuu", "nekosia", "pixiv"):
        __import__(f"workers.{m}")
    print("All imports successful!")
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)