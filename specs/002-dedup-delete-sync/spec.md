# Feature Specification: Dedup Deletion Sync

**Feature Branch**: `002-dedup-delete-sync`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "our dedup system ha sa flaw and that is that when a image is deleted its entry in the sqlite file isnt deleted fix this also check for deletd images when the gallery s refresh button is pressed too"

## Clarifications

### Session 2026-09-22

- Q: If the duplicate-detection record can't be removed at the moment you delete an image (storage error, file locked), should the image file still be deleted? → A: Best-effort + surface: delete the file anyway and immediately show the user an error/warning that cleanup will finish on next Refresh
- Q: When the user presses the Refresh button, should it keep also discovering newly added files (its existing behavior) in addition to removing missing ones? → A: Combined: Refresh discovers new files AND removes missing entries/records in the same run
- Q: Should the app's automatic startup rescan also sweep leftover duplicate-detection records, or is pressing Refresh enough? → A: Startup + Refresh, but the startup sweep must run in the background so the app doesn't freeze or get slow

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deleting an image removes its duplicate-detection record (Priority: P1)

A user deletes an image from the gallery (from the grid or the viewer). The
image file disappears AND its duplicate-detection record disappears in the same
operation. If the user later runs the same search again, the picture downloads
again instead of being silently skipped as a "duplicate" of a file that no
longer exists.

**Why this priority**: This is the reported flaw. Stale records for deleted
files permanently block legitimate re-downloads — the core promise of dedup
(stop storing the same bytes twice) turns into a bug (never store it again,
even after the user removed it). P1 alone already fixes the user's complaint.

**Independent Test**: Download an image, delete it from the gallery, re-run the
same query — the image downloads again (not skipped as a duplicate).

**Acceptance Scenarios**:

1. **Given** an image exists on disk with a duplicate-detection record, **When**
   the user deletes it from the gallery, **Then** both the file and its record
   are gone.
2. **Given** the record has been removed, **When** the same content is
   requested again, **Then** the download proceeds normally (no duplicate skip).
3. **Given** identical content stored at two different paths, **When** one copy
   is deleted, **Then** the other copy's record remains and still protects
   against re-storing that content.
4. **Given** removing the record fails at delete time (storage error), **When**
   the user deletes the image, **Then** the file is still deleted, the user
   immediately sees a warning, and the next Refresh removes the leftover
   record.

---

### User Story 2 - Refresh catches images deleted outside the app (Priority: P2)

A user removes files with their file manager (or they are lost/moved). They
press the gallery's Refresh button. Gallery entries for the missing files
disappear, and every duplicate-detection record pointing at a missing file is
removed too. Files that still exist keep their entries and records untouched.

**Why this priority**: Covers deletions the app never saw (out-of-band). The
in-app path (P1) is the common case; refresh is the safety net that makes the
system self-correcting. Independently valuable once P1 exists.

**Independent Test**: Delete a file externally, press Refresh — the image is
gone from the gallery and its record is gone; all still-present files keep
their records.

**Acceptance Scenarios**:

1. **Given** a file was deleted outside the app, **When** the user presses
   Refresh, **Then** its gallery entry and its duplicate-detection record are
   both removed.
2. **Given** some files exist and some are missing, **When** the user presses
   Refresh, **Then** exactly the missing files' entries/records are removed and
   all present files keep theirs.
3. **Given** a duplicate-detection record whose file is not listed in the
   gallery (historical leftover), **When** the user presses Refresh, **Then**
   that orphaned record is removed as well.
4. **Given** no files changed, **When** the user presses Refresh twice, **Then**
   the second run removes nothing.
5. **Given** one new file added and one existing file removed externally,
   **When** the user presses Refresh once, **Then** the new file appears in the
   gallery and the removed file's entry and record are gone after that single
   run.

---

### User Story 3 - Startup sweeps leftovers in the background (Priority: P3)

The app starts after files disappeared while it was closed (or after an
earlier delete failed to remove a record). Without pressing anything, leftover
duplicate-detection records for missing files are cleaned automatically during
startup — and the app becomes usable just as fast as before, because the sweep
runs in the background and never blocks startup.

**Why this priority**: Catches leftovers with zero user effort, but the app is
still fully useful with only P1+P2; this is convenience/robustness, hence P3.

**Independent Test**: Externally delete a file while the app is closed, start
the app — without touching Refresh, the stale record disappears; time-to-
usable at startup is unchanged versus a run with nothing to sweep.

**Acceptance Scenarios**:

1. **Given** a leftover record for a missing file exists, **When** the app
   starts, **Then** the record is removed without the user pressing Refresh.
2. **Given** a startup sweep that takes noticeable time, **When** the app
   launches, **Then** the UI becomes usable without waiting for the sweep to
   finish.
3. **Given** no missing files, **When** the startup sweep runs, **Then** 0
   records are removed and normal startup behavior is unchanged.

---

### Edge Cases

- File deleted while the app is closed → detected at the next Refresh (no
  real-time watching in this feature).
- File exists but is unreadable/corrupt → it still exists; its record is kept
  (existence, not readability, is the cleanup criterion).
- Identical content stored at multiple paths → records are per stored file;
  only the missing path's record is removed.
- Refresh pressed during an active download → cleanup applies only to files
  confirmed missing at check time; a file mid-write by the app must not be
  treated as missing.
- Record removal fails during in-app delete → file is deleted anyway with an
  immediate warning; next Refresh or startup sweep removes the leftover record
  (FR-001, FR-009).
- Startup sweep racing an in-app delete or Refresh → cleanup is idempotent
  (FR-008); concurrent runs must not corrupt or double-remove state.
- Very large libraries → refresh must finish in a bounded time (see SC-003)
  without freezing the app after it completes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the user deletes an image inside the app, the system MUST
  remove that image's duplicate-detection record as part of the same delete
  operation. If record removal fails, the system MUST still delete the file
  and MUST immediately show the user a warning; the leftover record MUST then
  be removed by the next Refresh (FR-004). The file MUST NOT be kept solely
  because record removal failed.
- **FR-002**: The system MUST remove a duplicate-detection record only when the
  stored file it refers to no longer exists (deleted in-app or found missing).
- **FR-003**: Pressing the gallery Refresh button MUST, in a single run, both
  discover and add newly present files (existing behavior) and remove gallery
  entries whose files no longer exist.
- **FR-004**: Pressing the gallery Refresh button MUST remove every
  duplicate-detection record whose stored file no longer exists, including
  records not referenced by any gallery entry.
- **FR-005**: Refresh MUST NOT remove records or entries for files that still
  exist; duplicate protection for remaining files MUST be unchanged.
- **FR-006**: After cleanup, downloading the same content again MUST succeed
  (stale records MUST NOT block it).
- **FR-007**: Refresh MUST report a summary that includes how many gallery
  entries and how many duplicate-detection records were removed.
- **FR-008**: Cleanup MUST be idempotent — running delete/refresh/startup
  sweeps repeatedly with no filesystem changes MUST NOT remove anything after
  the first pass.
- **FR-009**: On app startup the system MUST sweep duplicate-detection records
  whose files are missing, running as a background operation that MUST NOT
  block app startup or delay the UI becoming usable.

### Key Entities

- **Gallery Image**: Catalog entry for one stored file (its location, source
  site, tags). Exists only while the file exists (after any cleanup).
- **Duplicate-Detection Record**: Persistent record of one stored file's content
  signature; while its file exists, it prevents the same content from being
  stored again. Tied to exactly one stored file path; removed when that file is
  gone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After deleting an image in-app, re-running its query downloads
  the image again in 100% of cases (0 skips caused by a stale record).
- **SC-002**: After external deletion + Refresh: 0 missing files remain
  referenced by any gallery entry or duplicate-detection record, and 100% of
  still-present files retain their entries and records.
- **SC-003**: Refresh of a 5,000-image library completes within 30 seconds and
  the app is usable immediately afterwards.
- **SC-004**: Consecutive Refresh runs with no filesystem changes remove 0
  entries and 0 records (idempotent).
- **SC-005**: A single Refresh run over a library with 1 newly added file and 1
  externally removed file ends with the new file cataloged and the removed
  file's entry and record gone (both effects from one press).
- **SC-006**: Startup with a pending record sweep makes the app usable in no
  more time than a startup with nothing to sweep — the sweep never sits in the
  critical path before the UI appears.

## Assumptions

- "Refresh button" is the existing gallery refresh/rescan control.
- Duplicate-detection records already persist across restarts; this feature
  adds removal, with the Refresh sweep (FR-004) and startup background sweep
  (FR-009) cleaning historical orphans.
- The startup sweep runs in the background alongside the existing startup
  gallery rescan and MUST NOT delay startup (FR-009, SC-006).
- Out of scope: real-time filesystem watching, undo/delete-recovery, moving
  files back, and changing how duplicate matching itself works.
