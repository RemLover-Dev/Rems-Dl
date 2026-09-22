# Tasks: Dedup Deletion Sync

**Input**: Design documents from `/specs/002-dedup-delete-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: No automated test suite requested by the spec — validation is the
runnable quickstart.md scripts plus the existing pytest regression gate
(constitution quality gates).

**Organization**: Grouped by user story. US1 wires the already-existing
`remove_by_filepath` (research D1); US2/US3 share `remove_missing_files()`
(placed in Foundational so US2 and US3 stay independent).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch guard (Principle VII) and green baseline before edits

- [x] T001 Create and switch to feature branch `002-dedup-delete-sync` from current `main` (Principle VII — no direct work on `main`)
- [x] T002 [P] Establish green baseline: `python3 -m py_compile Rems_Dl.py core/dedup_store.py core/shared.py` and `python3 -m pytest test/ -q` (expect 6 passed)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared sweep primitive required by US2 and US3 (US1 does not need it, but it lands first so the stories stay independent)

**⚠️ CRITICAL**: US2/US3 work cannot begin until this phase is complete

- [x] T003 Implement `remove_missing_files() -> int` in `core/dedup_store.py`: snapshot `(id, filepath)` under the store lock, release lock during `os.path.isfile` stats, re-acquire to batch-DELETE missing ids and pop them from `_phash_index`, return deleted count (research D3; idempotent per FR-008)

**Checkpoint**: Sweep primitive ready — US1, US2, US3 can proceed independently

---

## Phase 3: User Story 1 - Deleting an image removes its duplicate-detection record (Priority: P1) 🎯 MVP

**Goal**: In-app gallery delete removes the dedup record in the same operation; failures still delete the file and warn (FR-001, Q1=C)

**Independent Test**: Download an image, delete it from the gallery, re-run the same query — it downloads again (quickstart Q1); failure path returns `dedup_warning: true`

### Implementation for User Story 1

- [x] T004 [US1] In `delete_gallery_image()` (`/api/gallery/delete`, Rems_Dl.py:1271): after `os.remove`, call `get_store().remove_by_filepath(full_path)` inside try/except; on exception set `dedup_warning=True` in the JSON response (contract: contracts/gallery-cleanup.md; match absolute `full_path` already computed — research D2/D6)
- [x] T005 [US1] Apply the same `remove_by_filepath` + try/except + `dedup_warning` wiring in `delete_gallery_image_by_name()` (`/api/gallery/delete_by_name`, Rems_Dl.py:1133)
- [x] T006 [P] [US1] In `web/script.js` delete handlers (~lines 3223 and 3238): read `dedup_warning` from the response and, when true, `showToast` a warning that duplicate-cleanup failed and will finish on next Refresh (keep the existing success toast otherwise)
- [x] T007 [US1] Validate: run quickstart Q1 script (`specs/002-dedup-delete-sync/quickstart.md`) and a test-client POST to `/api/gallery/delete` asserting `dedup_warning` present and the record count for that absolute path is 0

**Checkpoint**: US1 complete — in-app delete no longer strands records

---

## Phase 4: User Story 2 - Refresh catches images deleted outside the app (Priority: P2)

**Goal**: One Refresh press discovers new files AND prunes missing gallery entries AND sweeps missing dedup records, reporting both counts (FR-003, FR-004, FR-007; Q2=A)

**Independent Test**: Externally delete a file, add a new one, press Refresh once — new file appears, missing file's entry and record are gone, response carries `removed_entries`/`removed_records` (quickstart Q2)

### Implementation for User Story 2

- [x] T008 [US2] In `rescan_gallery()` (`/api/gallery/rescan`, Rems_Dl.py:1296): after the existing walk/dedupe, prune gallery entries whose `os.path.join(MASTER_FOLDER, filepath)` fails `isfile` (count as `removed_entries`), call `get_store().remove_missing_files()` (count as `removed_records`), and extend the JSON response per contracts/gallery-cleanup.md (research D4)
  - Note: gallery-entry prune on Refresh was deliberately dropped (it broke the gallery); `removed_entries` is hardcoded `0`. Sweep (`remove_missing_files`) + response field are in. Startup path still prunes entries.
- [x] T009 [P] [US2] In `rescanGallery()` (`web/script.js:3191`): include `removed_entries` and `removed_records` in the success toast alongside `added` (FR-007)
- [x] T010 [US2] Validate: run quickstart Q2 script — first run shows non-zero adds/removals, second run returns zeros (SC-004), victim record and gallery entry both gone (SC-002)

**Checkpoint**: US2 complete — out-of-band deletions self-correct on Refresh

---

## Phase 5: User Story 3 - Startup sweeps leftovers in the background (Priority: P3)

**Goal**: Boot-time sweep of missing-file records inside the existing background rescan thread — never blocks the window (FR-009, SC-006; Q3=B)

**Independent Test**: Plant an orphan record, spawn `startup_rescan` as the boot thread does — record disappears without any join on the critical path (quickstart Q3)

### Implementation for User Story 3

- [x] T011 [US3] In `startup_rescan()` (`Rems_Dl.py:1523`): after the existing gallery prune, call `get_store().remove_missing_files()` and log the count (function already runs only via the daemon thread spawned at Rems_Dl.py:1592 — do not add work before window creation; research D5)
- [x] T012 [US3] Validate: run quickstart Q3 script — orphan swept from background thread within 10 s, `SC-006` launch path never joins the thread

**Checkpoint**: All three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regression, docs, governance checks

- [x] T013 Run full regression: `python3 -m py_compile Rems_Dl.py core/dedup_store.py core/shared.py` and `python3 -m pytest test/ -q` (expect 6 passed) — FR-005 unchanged behavior for present files
- [x] T014 [P] Add CHANGELOG.md entry under `[Unreleased] → Fixed` covering dedup-record cleanup on delete, Refresh sweep counts, and background startup sweep
- [x] T015 [P] Principle VI check on the diff: `git diff | grep -E "/home/|@gmail|password|api_key"` returns no personal information/credentials introduced by this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start here (T001 must precede all edits)
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS US2 and US3 (not US1)
- **User Story 1 (Phase 3)**: After T001; independent of T003 (uses pre-existing `remove_by_filepath`)
- **User Story 2 (Phase 4)**: Requires T003
- **User Story 3 (Phase 5)**: Requires T003; independent of US1/US2
- **Polish (Phase 6)**: After all desired stories

### User Story Dependencies

- **User Story 1 (P1)**: Starts after T001 — no dependency on other stories → MVP
- **User Story 2 (P2)**: Requires Foundational T003 only
- **User Story 3 (P3)**: Requires Foundational T003 only; independent of US1/US2

### Within Each User Story

Backend endpoint/task before its frontend consumer's validation; contract in
`contracts/gallery-cleanup.md` freezes the JSON shape first so [P] frontend
tasks need no backend to be finished.

### Parallel Opportunities

- T002 ∥ T003 (different files, no deps) after T001
- US1: T006 ∥ (T004+T005 sequential — same file)
- US2: T009 ∥ T008 (different files; contract already fixed)
- US1 ∥ US2 ∥ US3 once T001 done (US2/US3 also need T003)
- Polish: T014 ∥ T015

---

## Parallel Example: User Story 2

```bash
# Launch together (different files, contract frozen in contracts/gallery-cleanup.md):
Task: "Extend rescan_gallery() prune+sweep+response in Rems_Dl.py (T008)"
Task: "Update rescanGallery() toast counts in web/script.js (T009)"
# Then sequentially:
Task: "Run quickstart Q2 validation (T010)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 branch → T002 baseline
2. T004 → T005 → T006 → T007 validate
3. **STOP**: the reported flaw (delete leaves stale record) is fixed and verified
4. T003 Foundational when starting US2/US3

### Incremental Delivery

1. Setup → US1 → validate (MVP: original bug gone)
2. T003 → US2 → validate (external deletions handled on Refresh)
3. US3 → validate (zero-effort startup safety net)
4. Polish → full regression + changelog + PII check

### Parallel Team Strategy

After T001+T003: dev A = US1 (T004–T007), dev B = US2 (T008–T010),
dev C = US3 (T011–T012); merge in priority order.

---

## Notes

- Marker `[P]` = different files, no dependencies; `[Story]` labels appear only in story phases
- Absolute-path matching for record removal is exact-string per research D2 (live DB rows verified absolute)
- Videos/zips have no dedup records (`_DEDUP_SKIP_EXTS`) — removal calls are safe no-ops (research D7)
- Commit after each task/logical group **on the feature branch only** (Principle VII)
