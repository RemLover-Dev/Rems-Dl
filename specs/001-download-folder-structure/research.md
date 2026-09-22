# Research: Download Folder Structure

All unknowns resolved by direct codebase inspection (no external research
needed — single-project Python codebase, all patterns internal).

## Decisions

### 1. One shared helper, not per-worker edits of sanitizers

- **Decision**: Add `rating_subdir(query_dir, rating_label)` + `MULTI_TAG_SEP`
  in `core/shared.py`; collapse only the constant `images/` level; keep each
  worker's existing tag sanitizer and folder names byte-identical.
- **Rationale**: Renaming existing tag folders would orphan gallery/history
  filepaths and trigger mass re-downloads into new folders. Sanitizers differ
  per worker (e.g. zerochan's strict control-char class vs rule34's `~`
  allowance) — unifying them churns 18 workers for zero user-visible gain.
- **Alternatives considered**: Full sanitizer unification (rejected — orphans
  history paths); per-worker `makedirs` left as-is (rejected — 6 copies of the
  same 3-line pattern).

### 2. Keep danbooru video / sankaku books splits

- **Decision**: `danbooru` `<tag>/<Rating>/{images,video}` and sankaku
  `<tag>/<Rating>/{images,books}` keep their third level.
- **Rationale**: Those levels carry signal (media type / pool membership),
  unlike the constant `images/` level that holds 100% of files everywhere
  else. Spec FR-001 targets the noise level only.
- **Alternatives considered**: Full flatten (rejected — mixes videos into
  image piles, a behavior change nobody asked for).

### 3. Sorted `+` multi-tag folder names

- **Decision**: `MULTI_TAG_SEP.join(sorted(tags))` (clarified Session
  2026-09-22, Option B).
- **Rationale**: One canonical folder per tag set regardless of query order;
  `+` never occurs in sanitized single tags, so no collisions.
- **Alternatives considered**: Query order (rejected in clarify — duplicates
  folders for reordered queries).

### 4. Cross-folder dedup via content hash (remaining work)

- **Decision**: Site-wide known-hash set checked in `enqueue_download`
  before queueing; booru filenames already embed md5 and `BaseDownloader`
  parses it incrementally during download — reuse that, no HEAD requests
  (a prior `ponytail:` note documents HEAD as wasted round-trips).
- **Rationale**: Filename dedup is per-`site_root` today, so a file fetched
  under `rem/` re-downloads under `rem+ram/`. Hash set is O(1) per file,
  survives restarts via existing history-file pattern.
- **Alternatives considered**: Hardlink/copy into each query folder
  (rejected — doubles disk use, the opposite of clean); dedup only at
  gallery-display level (rejected — still wastes bandwidth and disk).

### 5. No on-disk migration of old folders

- **Decision**: Old `.../images/`-nested files stay where they are; gallery
  resolves both via walk + stored paths; filename dedup prevents re-fetch.
- **Rationale**: Moving user libraries risks data loss for cosmetic gain.
- **Alternatives considered**: One-time move-up migration (rejected —
  risky, irreversible without backup, zero functional benefit).
