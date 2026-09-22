"""core/dedup_store.py — Persistent perceptual-hash dedup store for Rems-Dl.

Every image that gets downloaded is hashed once and its signature is saved
to a small SQLite database (database/dedup.sqlite3, next to the other files
DatabaseManager already manages). Every NEW image is checked against
everything stored so far before it's kept, so duplicates (including
re-uploads/re-encodes across different boorus) get caught even across
separate download sessions.

Detection logic (same as the standalone tester, folded in here):
  - phash / dhash / ahash / whash (structural, mostly color-blind)
  - a global color histogram
  - a 4x4 GRID of local color histograms, so a small recolored region
    (different outfit color, palette-swap edit, etc.) isn't missed just
    because it's a small fraction of the whole image
A pair only counts as a duplicate if structure AND global color AND the
worst-case grid cell are all similar enough.

Performance at scale: comparing against a large store naively would mean
one full comparison (hashes + 16 histogram correlations) per stored image.
Instead, `phash` is kept as an integer in memory and used as a cheap
prefilter (bit-difference is ~microseconds) - the expensive grid-histogram
check only runs on the handful of candidates that already look structurally
close. This keeps `check_and_add()` fast even as the store grows into the
thousands.

Typical usage inside a worker, right after a file is downloaded:

    from core.dedup_store import get_store

    store = get_store()
    result = store.check_and_add(filepath, site="danbooru", post_id=post_id)
    if result.is_duplicate:
        os.remove(filepath)   # or skip / log / whatever fits the worker
        print(f"skipped duplicate of {result.matched_path}")
"""

import json
import os
import sqlite3
import sys
import threading
import time
from dataclasses import dataclass
from typing import List, Optional

import imagehash
from PIL import Image

# --- paths, following the same convention as core/database.py -------------

def _app_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


DATABASE_DIR = os.path.join(_app_base_dir(), "database")
DEDUP_DB_FILE = os.path.join(DATABASE_DIR, "dedup.sqlite3")


# --- hashing config (tuned so palette-swaps/recolors are NOT duplicates,
#     while resizes/recompressions/minor crops ARE) -------------------------

MAX_DIM = 512    # downscale before hashing - hashes only look at coarse structure
HASH_SIZE = 16
GRID = 4
COLOR_BINS = 24

THRESHOLDS = {
    "phash": 12,
    "dhash": 10,
    "ahash": 12,
    "whash": 12,
}
COLOR_SIM_THRESHOLD = 0.90
LOCAL_COLOR_SIM_THRESHOLD = 0.85

# how loose the in-memory phash prefilter is allowed to be before we bother
# doing the full (structural + color) comparison. Kept equal to the phash
# threshold itself - anything further apart can never pass anyway.
PREFILTER_MARGIN = THRESHOLDS["phash"]


@dataclass
class Signature:
    phash: imagehash.ImageHash
    dhash: imagehash.ImageHash
    ahash: imagehash.ImageHash
    whash: imagehash.ImageHash
    color_hist: List[float]
    grid_hists: List[List[float]]


@dataclass
class DedupResult:
    is_duplicate: bool
    filepath: str
    matched_path: Optional[str] = None
    matched_site: Optional[str] = None
    matched_post_id: Optional[str] = None


# --- hashing / comparison (self-contained, no external file dependency) ---

def _color_histogram(img: Image.Image, bins: int = COLOR_BINS) -> List[float]:
    img = img.convert("RGB").resize((256, 256))
    hist: List[float] = []
    for channel in img.split():
        h = channel.histogram()
        step = 256 // bins
        rebinned = [sum(h[i:i + step]) for i in range(0, 256, step)]
        total = sum(rebinned) or 1
        rebinned = [v / total for v in rebinned]
        hist.extend(rebinned)
    return hist


def _grid_histograms(img: Image.Image, grid: int = GRID) -> List[List[float]]:
    img = img.convert("RGB").resize((256, 256))
    w, h = img.size
    cw, ch = w // grid, h // grid
    hists = []
    for gy in range(grid):
        for gx in range(grid):
            box = (gx * cw, gy * ch, (gx + 1) * cw, (gy + 1) * ch)
            hists.append(_color_histogram(img.crop(box)))
    return hists


def _hist_corr(h1: List[float], h2: List[float]) -> float:
    n = len(h1)
    m1 = sum(h1) / n
    m2 = sum(h2) / n
    num = sum((a - m1) * (b - m2) for a, b in zip(h1, h2))
    d1 = sum((a - m1) ** 2 for a in h1) ** 0.5
    d2 = sum((b - m2) ** 2 for b in h2) ** 0.5
    if d1 == 0 or d2 == 0:
        return 1.0 if d1 == d2 else 0.0
    return num / (d1 * d2)


def compute_signature(path: str) -> Signature:
    with Image.open(path) as img:
        img.load()
        rgb = img.convert("RGB")
        if max(rgb.size) > MAX_DIM:
            scale = MAX_DIM / max(rgb.size)
            new_size = (max(1, int(rgb.width * scale)), max(1, int(rgb.height * scale)))
            rgb = rgb.resize(new_size, Image.BILINEAR)
        return Signature(
            phash=imagehash.phash(rgb, hash_size=HASH_SIZE),
            dhash=imagehash.dhash(rgb, hash_size=HASH_SIZE),
            ahash=imagehash.average_hash(rgb, hash_size=HASH_SIZE),
            whash=imagehash.whash(rgb, hash_size=HASH_SIZE if (HASH_SIZE & (HASH_SIZE - 1)) == 0 else 8),
            color_hist=_color_histogram(rgb),
            grid_hists=_grid_histograms(rgb),
        )


def _is_full_duplicate(sig_a: Signature, sig_b: Signature) -> bool:
    if (sig_a.phash - sig_b.phash) > THRESHOLDS["phash"]:
        return False
    if (sig_a.dhash - sig_b.dhash) > THRESHOLDS["dhash"]:
        return False
    if (sig_a.ahash - sig_b.ahash) > THRESHOLDS["ahash"]:
        return False
    if (sig_a.whash - sig_b.whash) > THRESHOLDS["whash"]:
        return False
    if _hist_corr(sig_a.color_hist, sig_b.color_hist) < COLOR_SIM_THRESHOLD:
        return False
    local_sims = [_hist_corr(a, b) for a, b in zip(sig_a.grid_hists, sig_b.grid_hists)]
    if local_sims and min(local_sims) < LOCAL_COLOR_SIM_THRESHOLD:
        return False
    return True


# --- (de)serialization helpers for storing a Signature in SQLite ----------

def _hash_to_str(h: imagehash.ImageHash) -> str:
    return str(h)


def _hash_from_str(s: str) -> imagehash.ImageHash:
    return imagehash.hex_to_hash(s)


def _sig_to_row(sig: Signature) -> dict:
    return {
        "phash": _hash_to_str(sig.phash),
        "dhash": _hash_to_str(sig.dhash),
        "ahash": _hash_to_str(sig.ahash),
        "whash": _hash_to_str(sig.whash),
        "color_hist": json.dumps(sig.color_hist),
        "grid_hists": json.dumps(sig.grid_hists),
    }


def _row_to_sig(row: sqlite3.Row) -> Signature:
    return Signature(
        phash=_hash_from_str(row["phash"]),
        dhash=_hash_from_str(row["dhash"]),
        ahash=_hash_from_str(row["ahash"]),
        whash=_hash_from_str(row["whash"]),
        color_hist=json.loads(row["color_hist"]),
        grid_hists=json.loads(row["grid_hists"]),
    )


# --- store -------------------------------------------------------------

class DedupStore:
    """
    Thread-safe SQLite-backed store of image signatures.

    Keeps a lightweight in-memory (id -> phash int) index so that checking
    a new image against a large store doesn't require deserializing every
    row's full signature (color histograms especially) - only the handful
    of rows whose phash is already close get the full check.
    """

    def __init__(self, db_path: str = DEDUP_DB_FILE):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()
        self._phash_index = self._load_phash_index()  # {id: int}

    def _init_schema(self):
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS image_hashes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT NOT NULL,
                site TEXT,
                post_id TEXT,
                phash TEXT NOT NULL,
                dhash TEXT NOT NULL,
                ahash TEXT NOT NULL,
                whash TEXT NOT NULL,
                color_hist TEXT NOT NULL,
                grid_hists TEXT NOT NULL,
                added_at REAL NOT NULL
            )
        """)
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_site ON image_hashes(site)")
        self._conn.commit()

    def _load_phash_index(self):
        cur = self._conn.execute("SELECT id, phash FROM image_hashes")
        return {row["id"]: int(str(row["phash"]), 16) for row in cur.fetchall()}

    def _candidate_ids(self, phash: imagehash.ImageHash) -> List[int]:
        target = int(str(phash), 16)
        out = []
        with self._lock:
            index = self._phash_index
        for row_id, ph in index.items():
            # popcount of xor = hamming distance between the two hashes
            if bin(target ^ ph).count("1") <= PREFILTER_MARGIN:
                out.append(row_id)
        return out

    def find_duplicate(self, sig: Signature) -> Optional[sqlite3.Row]:
        candidate_ids = self._candidate_ids(sig.phash)
        if not candidate_ids:
            return None
        placeholders = ",".join("?" * len(candidate_ids))
        with self._lock:
            cur = self._conn.execute(
                f"SELECT * FROM image_hashes WHERE id IN ({placeholders})",
                candidate_ids,
            )
            rows = cur.fetchall()
        for row in rows:
            candidate_sig = _row_to_sig(row)
            if _is_full_duplicate(sig, candidate_sig):
                return row
        return None

    def add(self, filepath: str, sig: Signature, site: str = None, post_id: str = None) -> int:
        data = _sig_to_row(sig)
        with self._lock:
            cur = self._conn.execute(
                """INSERT INTO image_hashes
                   (filepath, site, post_id, phash, dhash, ahash, whash,
                    color_hist, grid_hists, added_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (filepath, site, post_id, data["phash"], data["dhash"],
                 data["ahash"], data["whash"], data["color_hist"],
                 data["grid_hists"], time.time()),
            )
            self._conn.commit()
            new_id = cur.lastrowid
            self._phash_index[new_id] = int(data["phash"], 16)
        return new_id

    def check_and_add(self, filepath: str, site: str = None, post_id: str = None) -> DedupResult:
        """
        Compute the signature for `filepath`, check it against everything
        stored so far, and - only if it's NOT a duplicate - add it to the
        store. Returns a DedupResult either way.
        """
        sig = compute_signature(filepath)
        match = self.find_duplicate(sig)
        if match is not None:
            return DedupResult(
                is_duplicate=True,
                filepath=filepath,
                matched_path=match["filepath"],
                matched_site=match["site"],
                matched_post_id=match["post_id"],
            )
        self.add(filepath, sig, site=site, post_id=post_id)
        return DedupResult(is_duplicate=False, filepath=filepath)

    def remove_by_filepath(self, filepath: str):
        with self._lock:
            cur = self._conn.execute("SELECT id FROM image_hashes WHERE filepath = ?", (filepath,))
            ids = [r["id"] for r in cur.fetchall()]
            self._conn.execute("DELETE FROM image_hashes WHERE filepath = ?", (filepath,))
            self._conn.commit()
            for i in ids:
                self._phash_index.pop(i, None)

    def count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) AS c FROM image_hashes").fetchone()["c"]

    def clear(self):
        with self._lock:
            self._conn.execute("DELETE FROM image_hashes")
            self._conn.commit()
            self._phash_index = {}

    def close(self):
        self._conn.close()


# --- module-level singleton, mirrors how DatabaseManager is used as a
#     static/shared class elsewhere in core/ -------------------------------

_store_lock = threading.Lock()
_store_instance: Optional[DedupStore] = None


def get_store() -> DedupStore:
    global _store_instance
    with _store_lock:
        if _store_instance is None:
            _store_instance = DedupStore()
        return _store_instance
