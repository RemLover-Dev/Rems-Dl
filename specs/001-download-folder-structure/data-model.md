# Data Model: Download Folder Structure

Filesystem-backed entities (no schema migration — layout convention only).

## Entities

### Query Folder

- **Path**: `<MASTER_FOLDER>/<site>/<query>/`
- **Fields**: folder name (sanitized single tag, or `+`-joined sorted tags),
  source site (parent dir), tag list (recorded in gallery store, not parsed
  from the name).
- **Validation**: name MUST NOT contain path separators or `..`; multi-tag
  names MUST be `MULTI_TAG_SEP`-joined `sorted(tags)`; MUST NOT collide with
  either constituent single-tag folder (`+` guarantees this).
- **Lifecycle**: created on first download of a query (`makedirs`,
  `exist_ok=True`); never renamed or moved by the app; re-runs reuse it
  (FR-006 idempotency).

### Rating Folder

- **Path**: `<query>/<Rating>/`
- **Fields**: rating label (existing per-source labels: Safe / Sensitive /
  Questionable / NSFW / General / R18 / R18G / Unknown), files directly
  inside (exception: danbooru `video/`, sankaku `books/` signal splits).
- **Validation**: one folder per rating per query; unfiltered and future
  multi-rating searches MUST separate ratings, never mix (FR-004, FR-005).
- **Lifecycle**: created via `rating_subdir()`; same reuse rules as query
  folder.

### Stored Item

- **Path**: `<Rating>/<filename>` (+ gallery record).
- **Fields**: file, recorded tags, recorded rating, source URL (all in
  `database/gallery.json` + `database/image_history.json`, keyed by
  filename); per-site filename set in `<site_root>/download_history.json`.
- **Validation**: dedup identity = filename ∈ history set (today) → content
  hash ∈ site-wide known-hash set (remaining work, research §4).
- **State transitions**: queued → downloading (`.part`) → stored → gallery
  record appended → history flushed (batched every 10 + final flush).

## Relationships

`Site 1—* Query Folder 1—* Rating Folder 1—* Stored Item`; gallery store is
a flat index over Stored Items (layout-agnostic, resolves by walk + path).
