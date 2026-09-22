# Quickstart: Dedup Deletion Sync Validation

Run from repo root. Prerequisites: Python env with project deps
(`pip install -r requirements.txt`), existing `database/` writable.

> All HTTP calls need header `User-Agent: RemsDlDesktopApp/1.0` (loopback
> guard) — test client snippets below set it.

## Q1 — In-app delete removes the record (US1 / FR-001, SC-001)

```bash
python3 - <<'EOF'
import os, tempfile, shutil
from PIL import Image
from core.dedup_store import get_store

store = get_store()
tmp = tempfile.mkdtemp()
p = os.path.join(tmp, "qs_q1.jpg")
Image.new("RGB", (64, 64), (200, 30, 30)).save(p)

r = store.check_and_add(p, site="quickstart")
assert not r.is_duplicate, "fresh image must not be a duplicate"
assert store.remove_by_filepath(p) is None          # existing API
assert os.path.isfile(p)                           # store removal ≠ file removal
os.remove(p)
assert not any(row["filepath"] == p for row in
               store._conn.execute("SELECT filepath FROM image_hashes"))
print("Q1_OK: record removed")
# re-download simulation: same bytes at a new path must NOT match the removed record
p2 = os.path.join(tmp, "qs_q1_redownload.jpg")
Image.new("RGB", (64, 64), (200, 30, 30)).save(p2)
assert not store.check_and_add(p2, site="quickstart").is_duplicate, \
    "after removal, same content must download again"
print("Q1_REDOWNLOAD_OK")
shutil.rmtree(tmp)
EOF
```

Expected: `Q1_OK`, `Q1_REDOWNLOAD_OK` — proves removal unblocks re-storing.

Also hit the real endpoint via test client (requires a gallery entry for a
real file): response must include `dedup_warning` and the row count for that
absolute path must drop to 0.

## Q2 — Refresh: combined add + prune + record sweep (US2 / FR-003–005, SC-002, SC-004–005)

```bash
python3 - <<'EOF'
import os, json, hashlib, time
from PIL import Image
import Rems_Dl as appmod
from core.dedup_store import get_store

H = {"User-Agent": "RemsDlDesktopApp/1.0"}
c = appmod.app.test_client()
MF = appmod.shared.MASTER_FOLDER
store = get_store()

# fixture: new file to discover + existing gallery entry whose file we hide
site_dir = os.path.join(MF, "QuickstartSweep")
os.makedirs(site_dir, exist_ok=True)
new_abs = os.path.join(site_dir, f"qs_new_{int(time.time())}.jpg")
Image.new("RGB", (32, 32), (10, 120, 200)).save(new_abs)

gal = appmod.shared.load_gallery()
victim_abs = os.path.join(MF, "QuickstartSweep", "qs_victim.jpg")
Image.new("RGB", (32, 32), (9, 9, 9)).save(victim_abs)
store.check_and_add(victim_abs, site="quickstart")
gal["images"].append({
    "id": hashlib.sha256(b"qs_victim").hexdigest()[:12],
    "filename": "qs_victim.jpg", "filepath": "QuickstartSweep/qs_victim.jpg",
    "site": "quickstart", "tags": {"tag": ["quickstart"]},
    "favourite": False, "downloaded_at": ""})
appmod.shared.save_gallery(gal)
os.remove(victim_abs)                               # external delete

resp = c.post("/api/gallery/rescan", headers=H)
d = resp.get_json()
assert resp.status_code == 200 and d["success"]
assert d["added"] >= 1, d
assert d["removed_entries"] >= 1, d                 # FR-003
assert d["removed_records"] >= 1, d                 # FR-004/007
assert not os.path.exists(victim_abs)
assert not any(r["filepath"] == victim_abs for r in
               store._conn.execute("SELECT filepath FROM image_hashes"))
# victim's gallery entry pruned
gal = appmod.shared.load_gallery()
assert not any(i["filename"] == "qs_victim.jpg" for i in gal["images"])

d2 = c.post("/api/gallery/rescan", headers=H).get_json()
assert d2["removed_entries"] == 0 and d2["removed_records"] == 0, d2  # SC-004
print("Q2_OK", d, "second_run:", {k: d2[k] for k in ("removed_entries","removed_records")})
EOF
```

Expected: `Q2_OK` with non-zero removals on first run, zeros on second.

## Q3 — Startup sweep runs in background (US3 / FR-009, SC-006)

```bash
python3 - <<'EOF'
import time, threading, os
from PIL import Image
import Rems_Dl as appmod
from core.dedup_store import get_store

# plant an orphan record
abs_path = os.path.join(appmod.shared.MASTER_FOLDER, "QuickstartSweep", "qs_orphan.jpg")
os.makedirs(os.path.dirname(abs_path), exist_ok=True)
# record exists, file does not:
store = get_store()
# (add row directly only if file can be hashed — create then delete)
Image.new("RGB", (16, 16), (1, 2, 3)).save(abs_path)
store.check_and_add(abs_path, site="quickstart")
os.remove(abs_path)

t0 = time.perf_counter()
# simulate boot: startup_rescan body runs on a daemon thread, window path never joins it
th = threading.Thread(target=appmod.startup_rescan, daemon=True)
th.start()
while any(r["filepath"] == abs_path for r in
          store._conn.execute("SELECT filepath FROM image_hashes")):
    assert time.perf_counter() - t0 < 10, "sweep did not converge"
    time.sleep(0.05)
print(f"Q3_OK: orphan swept in background ({time.perf_counter()-t0:.2f}s, thread alive={th.is_alive()})")
EOF
```

Expected: `Q3_OK` — sweep converges from a background thread (SC-006: the
launch path never blocks on `th.join()`).

## Regression gate

```bash
python3 -m py_compile Rems_Dl.py core/dedup_store.py core/shared.py
python3 -m pytest test/ -q          # expect: 6 passed
```

Expected: compile clean, all pre-existing tests pass (FR-005: unchanged
behavior for present files).
