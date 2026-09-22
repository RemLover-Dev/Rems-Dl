# Contract: Gallery Cleanup Endpoints

Loopback-only JSON over the existing Flask app. All requests require the
desktop User-Agent (`RemsDlDesktopApp`) like every other route.

## POST /api/gallery/delete

Body: `{"id": "<gallery image id>"}` (unchanged)

Response `200`:
```json
{ "success": true, "dedup_warning": false }
```

- `dedup_warning` (**new, optional**): `true` when the file+gallery entry were
  deleted but the duplicate-detection record removal failed (FR-001 /
  clarified Q1=C). Absent or `false` = full success.
- `404` when id not found (unchanged).

## POST /api/gallery/delete_by_name

Body: `{"filename": "..."}` (unchanged)

Response `200`: same shape as `/api/gallery/delete` — `{success, dedup_warning}`.

## POST /api/gallery/rescan

Body: none (unchanged)

Response `200` (**extended**):
```json
{
  "success": true,
  "added": 3,
  "fixed": 1,
  "removed_entries": 2,
  "removed_records": 2
}
```

| Field | Meaning |
|-------|---------|
| added | new files discovered (existing behavior, FR-003) |
| fixed | existing entries backfilled (existing) |
| removed_entries | gallery entries pruned because file missing (**new**, FR-003) |
| removed_records | duplicate-detection records deleted because file missing (**new**, FR-004, FR-007) |

Single run performs discovery + both removals (clarified Q2=A).

## Internal: DedupStore.remove_missing_files()

```text
remove_missing_files() -> int
  snapshot (id, filepath) under lock
  stat each path (lock released)
  delete missing ids + pop phash index (lock held)
  return deleted count
```

Idempotent: second call on unchanged FS returns 0 (FR-008, SC-004).

## Internal: startup behavior

`startup_rescan()` (daemon thread, spawned at boot, never joined) appends a
`remove_missing_files()` call after its existing gallery prune; logs the
count. Must not move onto the pre-window critical path (FR-009, SC-006).

## Frontend consumption (`web/script.js`)

- Delete handlers (`/api/gallery/delete`, `/api/gallery/delete_by_name`):
  if `dedup_warning === true`, show `showToast` warning — duplicate-cleanup
  failed, will finish on next Refresh (Q1=C).
- `rescanGallery()`: refresh success message includes `removed_entries` /
  `removed_records` counts alongside `added` (FR-007).
