# Data Model: Dedup Deletion Sync

No schema migration. Two existing entities gain lifecycle rules; one new
store method (behavior, not data).

## DedupRecord (table `image_hashes` in `database/dedup.sqlite3`)

| Field | Type | Notes (existing) |
|-------|------|------------------|
| id | INTEGER PK | phash prefilter index key |
| filepath | TEXT NOT NULL | **absolute** path of the stored file (verified against live rows) |
| site | TEXT | source site name |
| post_id | TEXT | upstream post id when available |
| phash, dhash, ahash, whash | TEXT | perceptual hashes |
| color_hist, grid_hists | TEXT (JSON) | color signatures for full comparison |
| added_at | REAL | epoch seconds |

**Identity**: one row per stored file path (delete matches `filepath` exactly).

**Lifecycle** (all transitions idempotent, FR-008):

```
(downloaded) ──check_and_add──▶ EXISTS ──┬─ in-app delete ──────────▶ REMOVED (best-effort;
                                          │                             on failure: REMAINS +
                                          │                             dedup_warning=true →
                                          │                             later sweep)
                                          ├─ Refresh finds file missing ─▶ REMOVED  (FR-004)
                                          └─ startup sweep finds missing ─▶ REMOVED (FR-009)

EXISTS rows whose file still exists MUST survive every sweep (FR-005).
Same-content rows at other paths are independent (spec US1 scenario 3).
```

**Validation rules**:
- Removal only when `os.path.isfile(filepath)` is false (FR-002) or the file
  was just deleted in-app (FR-001).
- In-memory `_phash_index` must drop removed ids in the same operation
  (handled inside store methods).
- Videos/zips: no rows ever created (`_DEDUP_SKIP_EXTS`).

## GalleryImage (entries in `database/gallery.json`)

Existing fields unchanged: `id`, `filename`, `filepath` (relative to
`MASTER_FOLDER`), `site`, `tags`, `favourite`, `downloaded_at`.

**Lifecycle additions**:
- Refresh (rescan endpoint) now prunes entries whose joined absolute path
  fails `isfile` — previously only the startup thread did this.
- Startup prune behavior unchanged.
- In-app delete already pops the entry; unchanged.

## New store behavior (not an entity)

`DedupStore.remove_missing_files() -> int`
- Input: none (operates on all rows)
- Effect: delete rows with missing files, pop phash index, return count
- Callers: rescan endpoint (sync, count in response), `startup_rescan()`
  (background thread, log line only)

## Response payload shapes (contract detail — see contracts/)

- delete endpoints: existing `{success}` + optional `dedup_warning: bool`
- rescan endpoint: existing `{success, added, fixed}` + `removed_entries: int` +
  `removed_records: int`
