"""core/dedup_store.py — Persistent perceptual-hash dedup store for Rems-Dl.

Every image that gets downloaded is hashed once and its signature is saved
to a small SQLite database (database/dedup.sqlite3, next to the other files
DatabaseManager already manages). Every NEW image is checked against
everything stored so far before it's kept, so duplicates (including
re-uploads/re-encodes across different boorus) get caught even across
separate download sessions.

Detection logic:
  - phash / dhash / ahash / whash (structural perceptual hashing)
  - global color histogram + 4x4 grid color histograms
A pair only counts as a duplicate if structural hashes AND color profiles
are both sufficiently similar.

Performance & Stability:
  - Pure Python + Pillow: zero heavy scientific dependencies required (no scipy/pywt/numpy),
    meaning instant startup and lightweight RAM footprint (< 2MB).
  - Optional imagehash interoperability: gracefully uses external imagehash if available.
  - Thread-safe SQLite handling with WAL mode and in-memory phash index.
  - Auto-prunes ghost records if an original file was deleted from disk so redownload works.
"""

import json
import math
import os
import sqlite3
import sys
import threading
import time
from dataclasses import dataclass
from typing import List, Optional

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

MAX_DIM = 512
HASH_SIZE = 16
GRID = 4
COLOR_BINS = 24

THRESHOLDS = {
    "phash": 12,
    "dhash": 10,
    "ahash": 12,
    "whash": 12,
}
COLOR_SIM_THRESHOLD = 0.80
LOCAL_COLOR_SIM_THRESHOLD = 0.75
PREFILTER_MARGIN = THRESHOLDS["phash"]


# --- Pure-Python Perceptual Hash Implementation --------------------------

class PureHash:
    """Lightweight 64/256-bit perceptual image hash with zero external dependencies."""
    __slots__ = ("value", "bits")

    def __init__(self, value: int, bits: int = 256):
        self.value = int(value)
        self.bits = bits

    def __sub__(self, other) -> int:
        if isinstance(other, PureHash):
            diff = self.value ^ other.value
        elif isinstance(other, int):
            diff = self.value ^ other
        elif isinstance(other, str):
            diff = self.value ^ int(other, 16)
        else:
            diff = self.value ^ int(str(other), 16)
        return diff.bit_count()

    def __str__(self) -> str:
        hex_len = (self.bits + 3) // 4
        return f"{self.value:0{hex_len}x}"

    def __repr__(self) -> str:
        return f"PureHash({str(self)})"

    def __int__(self) -> int:
        return self.value

    def __eq__(self, other) -> bool:
        if isinstance(other, PureHash):
            return self.value == other.value
        return str(self) == str(other)

    def __hash__(self) -> int:
        return hash(self.value)

    def __len__(self) -> int:
        return self.bits


# Precomputed 16x32 DCT-II basis matrix for 256-bit pHash
_DCT_M16 = [
    [math.cos(math.pi * (2 * n + 1) * k / 64.0) for n in range(32)]
    for k in range(16)
]


def _compute_phash_pure(img: Image.Image) -> PureHash:
    gray = img.convert('L').resize((32, 32), Image.Resampling.BILINEAR)
    pixels = list(gray.tobytes())
    T = [[0.0] * 32 for _ in range(16)]
    for k in range(16):
        m_row = _DCT_M16[k]
        for col in range(32):
            s = 0.0
            for n in range(32):
                s += m_row[n] * pixels[n * 32 + col]
            T[k][col] = s
    coeffs = []
    for k in range(16):
        t_row = T[k]
        for l in range(16):
            m_col = _DCT_M16[l]
            s = 0.0
            for col in range(32):
                s += t_row[col] * m_col[col]
            coeffs.append(s)
    # Exclude DC term (0,0) for median threshold
    ac = coeffs[1:]
    sorted_ac = sorted(ac)
    med = sorted_ac[len(sorted_ac) // 2]
    h = 0
    for i, c in enumerate(coeffs):
        if c > med:
            h |= (1 << i)
    return PureHash(h, bits=256)


def _compute_dhash_pure(img: Image.Image) -> PureHash:
    gray = img.convert('L').resize((17, 16), Image.Resampling.BILINEAR)
    pixels = list(gray.tobytes())
    h = 0
    for r in range(16):
        row = r * 17
        for c in range(16):
            if pixels[row + c] > pixels[row + c + 1]:
                h |= (1 << (r * 16 + c))
    return PureHash(h, bits=256)


def _compute_ahash_pure(img: Image.Image) -> PureHash:
    gray = img.convert('L').resize((16, 16), Image.Resampling.BILINEAR)
    pixels = list(gray.tobytes())
    avg = sum(pixels) / 256.0
    h = 0
    for i, p in enumerate(pixels):
        if p > avg:
            h |= (1 << i)
    return PureHash(h, bits=256)


def _compute_whash_pure(img: Image.Image) -> PureHash:
    gray = img.convert('L').resize((16, 16), Image.Resampling.BILINEAR)
    pixels = [float(p) for p in gray.tobytes()]
    med = sorted(pixels)[128]
    val = 0
    for i, p in enumerate(pixels):
        if p > med:
            val |= (1 << i)
    return PureHash(val, bits=256)


# Try importing external imagehash if available, else fallback cleanly
_USE_EXTERNAL_IMAGEHASH = False
try:
    import imagehash
    # Test if it actually functions without missing scipy/pywt
    _test_img = Image.new('L', (16, 16))
    imagehash.dhash(_test_img, hash_size=16)
    _USE_EXTERNAL_IMAGEHASH = True
except Exception:
    _USE_EXTERNAL_IMAGEHASH = False


@dataclass
class Signature:
    phash: PureHash
    dhash: PureHash
    ahash: PureHash
    whash: PureHash
    color_hist: List[float]
    grid_hists: List[List[float]]


@dataclass
class DedupResult:
    is_duplicate: bool
    filepath: str
    matched_path: Optional[str] = None
    matched_site: Optional[str] = None
    matched_post_id: Optional[str] = None


# --- color histogram / correlation helpers --------------------------------

def _color_histogram(img: Image.Image, bins: int = COLOR_BINS) -> List[float]:
    thumb = img.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)
    hist: List[float] = []
    for channel in thumb.split():
        h = channel.histogram()
        step = 256 // bins
        rebinned = [sum(h[i:i + step]) for i in range(0, 256, step)]
        # 3-point kernel smoothing to avoid quantization noise at bin boundaries
        smoothed = [0.0] * bins
        for i in range(bins):
            left = rebinned[i - 1] if i > 0 else rebinned[i]
            center = rebinned[i]
            right = rebinned[i + 1] if i < bins - 1 else rebinned[i]
            smoothed[i] = 0.2 * left + 0.6 * center + 0.2 * right
        total = sum(smoothed) or 1.0
        hist.extend([v / total for v in smoothed])
    return hist


def _grid_histograms(img: Image.Image, grid: int = GRID) -> List[List[float]]:
    thumb = img.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)
    w, h = thumb.size
    cw, ch = w // grid, h // grid
    hists = []
    for gy in range(grid):
        for gx in range(grid):
            box = (gx * cw, gy * ch, (gx + 1) * cw, (gy + 1) * ch)
            hists.append(_color_histogram(thumb.crop(box)))
    return hists


def _hist_corr(h1: List[float], h2: List[float]) -> float:
    n = len(h1)
    if n == 0:
        return 1.0
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
            rgb = rgb.resize(new_size, Image.Resampling.BILINEAR)

        if _USE_EXTERNAL_IMAGEHASH:
            try:
                p = imagehash.phash(rgb, hash_size=HASH_SIZE)
                d = imagehash.dhash(rgb, hash_size=HASH_SIZE)
                a = imagehash.average_hash(rgb, hash_size=HASH_SIZE)
                w = imagehash.whash(rgb, hash_size=HASH_SIZE if (HASH_SIZE & (HASH_SIZE - 1)) == 0 else 8)
                return Signature(
                    phash=PureHash(int(str(p), 16), bits=HASH_SIZE*HASH_SIZE),
                    dhash=PureHash(int(str(d), 16), bits=HASH_SIZE*HASH_SIZE),
                    ahash=PureHash(int(str(a), 16), bits=HASH_SIZE*HASH_SIZE),
                    whash=PureHash(int(str(w), 16), bits=HASH_SIZE*HASH_SIZE),
                    color_hist=_color_histogram(rgb),
                    grid_hists=_grid_histograms(rgb),
                )
            except Exception:
                pass

        return Signature(
            phash=_compute_phash_pure(rgb),
            dhash=_compute_dhash_pure(rgb),
            ahash=_compute_ahash_pure(rgb),
            whash=_compute_whash_pure(rgb),
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

def _hash_to_str(h) -> str:
    return str(h)


def _hash_from_str(s: str, bits: int = 256) -> PureHash:
    s = str(s).strip()
    return PureHash(int(s, 16) if s else 0, bits=bits or len(s) * 4)


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

    Maintains a fast in-memory phash index for microsecond candidate prefiltering,
    and safely purges ghost records if an original file was removed by the user.
    """

    def __init__(self, db_path: str = DEDUP_DB_FILE):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30.0)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()
        self._phash_index = self._load_phash_index()  # {id: int}

    def _init_schema(self):
        with self._lock:
            try:
                self._conn.execute("PRAGMA journal_mode = WAL;")
                self._conn.execute("PRAGMA synchronous = NORMAL;")
            except Exception:
                pass
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
        with self._lock:
            cur = self._conn.execute("SELECT id, phash FROM image_hashes")
            index = {}
            for row in cur.fetchall():
                try:
                    index[row["id"]] = int(str(row["phash"]), 16)
                except Exception:
                    pass
            return index

    def _candidate_ids(self, phash) -> List[int]:
        target = int(phash) if isinstance(phash, PureHash) else int(str(phash), 16)
        with self._lock:
            items = list(self._phash_index.items())
        out = []
        for row_id, ph in items:
            if (target ^ ph).bit_count() <= PREFILTER_MARGIN:
                out.append(row_id)
        return out

    def _prune_ids(self, ids: List[int]):
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        with self._lock:
            try:
                self._conn.execute(f"DELETE FROM image_hashes WHERE id IN ({placeholders})", ids)
                self._conn.commit()
                for i in ids:
                    self._phash_index.pop(i, None)
            except Exception as e:
                print(f"[DEDUP] Error pruning stale IDs: {e}")

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

        stale_ids = []
        matched_row = None
        for row in rows:
            candidate_sig = _row_to_sig(row)
            if _is_full_duplicate(sig, candidate_sig):
                matched_fp = row["filepath"]
                if os.path.exists(matched_fp):
                    matched_row = row
                    break
                else:
                    # Previous download was deleted from disk: remove ghost record
                    stale_ids.append(row["id"])

        if stale_ids:
            self._prune_ids(stale_ids)

        return matched_row

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
        Compute signature, check against existing database, and add if not a duplicate.
        Returns a DedupResult indicating whether it was skipped.
        """
        try:
            sig = compute_signature(filepath)
        except Exception as e:
            # Unreadable or corrupted image: don't block
            return DedupResult(is_duplicate=False, filepath=filepath)

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
            try:
                cur = self._conn.execute("SELECT id FROM image_hashes WHERE filepath = ?", (filepath,))
                ids = [r["id"] for r in cur.fetchall()]
                if ids:
                    self._conn.execute("DELETE FROM image_hashes WHERE filepath = ?", (filepath,))
                    self._conn.commit()
                    for i in ids:
                        self._phash_index.pop(i, None)
            except Exception as e:
                print(f"[DEDUP] Error removing filepath: {e}")

    def remove_missing_files(self) -> int:
        """Delete records whose file no longer exists on disk. Returns count removed."""
        with self._lock:
            rows = self._conn.execute("SELECT id, filepath FROM image_hashes").fetchall()
        # stat outside the lock
        missing = [r["id"] for r in rows if not os.path.isfile(r["filepath"])]
        if not missing:
            return 0
        with self._lock:
            for start in range(0, len(missing), 500):
                batch = missing[start:start + 500]
                placeholders = ",".join("?" * len(batch))
                self._conn.execute(f"DELETE FROM image_hashes WHERE id IN ({placeholders})", batch)
            self._conn.commit()
            for i in missing:
                self._phash_index.pop(i, None)
        return len(missing)

    def count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) AS c FROM image_hashes").fetchone()["c"]

    def clear(self):
        with self._lock:
            self._conn.execute("DELETE FROM image_hashes")
            self._conn.commit()
            self._phash_index = {}

    def close(self):
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass


# --- module-level singleton ------------------------------------------------

_store_lock = threading.Lock()
_store_instance: Optional[DedupStore] = None


def get_store() -> DedupStore:
    global _store_instance
    with _store_lock:
        if _store_instance is None:
            _store_instance = DedupStore()
        return _store_instance
