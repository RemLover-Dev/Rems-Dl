# Contract: Download Folder Layout

Convention every worker MUST follow when choosing a destination path.

```text
<MASTER_FOLDER>/<site>/<query>/<Rating>/<filename>
```

## Rules

1. `<query>` = sanitized single tag, or `MULTI_TAG_SEP`-joined
   `sorted(tags)` for multi-tag queries (`+`, see `core/shared.py`).
2. `<Rating>` = the worker's existing per-source rating label, created via
   `shared.rating_subdir(query_dir, rating_label)` — files directly inside.
3. Allowed third level ONLY for signal splits that already exist:
   danbooru `video/`, sankaku `books/`. No other nesting.
4. Special roots (`Pixiv/ranking/`, `Artists/`, category roots) stay as
   roots; rules 1–3 apply below them.
5. Never rename or move existing folders. New downloads use the new layout;
   old paths keep resolving through gallery history.
6. Dedup identity MUST hold across query folders (content hash), not just
   within one folder (filename).

## Helpers (`core/shared.py`)

- `MULTI_TAG_SEP = "+"`
- `rating_subdir(query_dir, rating_label) -> str` (makedirs included)
