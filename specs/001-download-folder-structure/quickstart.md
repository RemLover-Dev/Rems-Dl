# Quickstart: Validate Folder Structure

## Prerequisites

- Python 3.10+, deps installed (`pip install -r requirements.txt`)
- No network needed except for live-download scenarios

## 1. Static checks (no network)

```bash
python3 -m py_compile core/shared.py workers/*.py
python3 -m pytest test/ -q
python3 -c "
from core.shared import rating_subdir, MULTI_TAG_SEP
import tempfile, os
tmp = tempfile.mkdtemp()
d = rating_subdir(os.path.join(tmp, 'Gelbooru', 'rem'), 'Safe')
assert d.endswith(os.path.join('rem', 'Safe')) and os.path.isdir(d)
assert MULTI_TAG_SEP.join(sorted(['ram', 'rem'])) == 'ram+rem'
print('LAYOUT_OK')"
```

Expected: compile clean, pytest passes, `LAYOUT_OK`.

## 2. Live smoke test (one worker, e.g. Safebooru)

```bash
python Rems_Dl.py
# search tag "rem", download 5, then re-run the same search
```

Expected (per spec SC-001…SC-004):

- Files land in `Rems Dl/Safebooru/rem/Safe/` with nothing nested inside.
- Re-run adds zero files and zero folders (`download_history.json` hit).
- Gallery tab shows all 5 without rescan errors; old `.../images/` paths
  (if any) still open.

## 3. Contract check for any touched worker

- Destination built via `rating_subdir()` (or a documented signal split).
- Multi-tag folder (if supported) = `+`-joined `sorted(tags)`.
- See [contracts/layout.md](./contracts/layout.md) and
  [data-model.md](./data-model.md) for the full rules.
