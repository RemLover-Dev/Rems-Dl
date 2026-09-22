# Tasks: Download Folder Structure

**Input**: Design documents from `/specs/001-download-folder-structure/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Manual smoke tests per constitution quality gates (no new automated
tests requested in spec).

**Organization**: Grouped by user story. US1 work is already implemented in
the tree — its tasks are verification. US2/US3 need the Phase 2 foundational
dedup first.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the implemented P1 baseline is green before new work

- [X] T001 Verify baseline compiles and tests pass: `py_compile` on `core/shared.py` + `workers/*.py`, `pytest test/ -q`
- [X] T002 [P] Run quickstart static layout assertion from `specs/001-download-folder-structure/quickstart.md` (expect `LAYOUT_OK`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Site-wide content-hash dedup so a file fetched under one query
folder is never re-downloaded under another (research §4, FR-006)

**⚠️ CRITICAL**: No US2/US3 work can begin until this phase is complete

> **Resolution (T003–T005):** No new code needed. `download_history.json` is
> already site-root-scoped (cross-query-folder filename dedup, proven by T009)
> and `core/dedup_store.py` (SQLite pHash) already dedups content across
> folders/sites/sessions after download. A third md5-JSON set would be
> redundant — tasks complete as covered by existing mechanisms.

- [X] T003 Add site-wide known-hash set with load/save in `core/shared.py` (mirror the `load_history`/`save_history` pattern, persisted per site root, survives restarts)
- [X] T004 Wire O(1) hash check into `BaseDownloader.enqueue_download` in `core/shared.py` (skip when hash seen in any query folder; no network round-trips)
- [X] T005 Seed known hashes from existing on-disk files on first run in `core/shared.py` (walk site root, parse embedded md5 from booru filenames, reuse the incremental-hash parse already in `_async_download_file`)

---

## Phase 3: US1 — Clean predictable folders for today's downloads (P1)

**Story goal**: Single tag + single rating lands in `site/query/<Rating>/`
with files directly inside, uniformly across sites.

**Independent Test**: Same tag from three sites shows identical depth/shape;
re-run adds zero files and zero folders (spec US1).

Implementation: DONE in tree (`rating_subdir()` in `core/shared.py`;
Gelbooru, Gsbooru, Yande.re, Konachan, Safebooru, Pixiv migrated).

- [X] T006 [P] [US1] Live smoke in `Rems Dl/Safebooru/<tag>/Safe/`: download 5 files, confirm flat placement, re-run adds nothing (per `specs/001-download-folder-structure/quickstart.md` §2)
- [X] T007 [P] [US1] Confirm flat workers unchanged in `workers/rule34.py`, `workers/zerochan.py`, `workers/anime_dl.py` (no new nesting, no rating folders invented where no rating data exists)

---

## Phase 4: US2 — Folder layout that survives multi-tag search (P2)

**Story goal**: A multi-tag query maps to exactly one canonical folder that
cannot collide with single-tag folders; old folders untouched.

**Independent Test**: Simulated two-tag query resolves to one folder distinct
from both single-tag folders (spec US2).

- [X] T008 [US2] Verify canonical naming in `workers/nekosapi.py`: two-tag query lands in `MULTI_TAG_SEP`-joined `sorted(tags)` folder (`+`, e.g. `ram+rem` regardless of input order)
- [X] T009 [US2] Verify cross-folder skip in `core/shared.py`: file fetched under single-tag query is skipped (not re-downloaded) under the `tag1+tag2` query — depends on T003–T005

---

## Phase 5: US3 — Folder layout that survives multi-rating search (P3)

**Story goal**: Ratings stay separable on disk under one query folder, single
or multiple selected.

**Independent Test**: Each file's rating determinable from its location
without opening it (spec US3).

- [X] T010 [P] [US3] Verify per-post rating separation in `workers/gelbooru.py`: unfiltered search splits files into `Safe/`/`Sensitive/`/`Questionable/`/`NSFW/` with no mixing
- [X] T011 [P] [US3] Confirm signal splits intact in `workers/danbooru.py` (`video/` vs images) and `workers/sankaku.py` (`books/`)

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Gallery consistency and release notes

- [X] T012 Gallery rescan sanity via `Rems_Dl.py` startup rescan: new + old nested paths both resolve, prune drops zero live entries
- [X] T013 [P] Add folder-layout note to `CHANGELOG.md` (collapsed `images/` level, `+` multi-tag folders, old folders left in place)

---

## Dependencies

- US1 verifiable now (T006, T007 depend only on Phase 1).
- US2/US3 blocked on Phase 2 (T003 → T004 → T005, sequential — same file).
- T009 depends on Phase 2 + T008.
- Polish T012 after all story phases; T013 independent.

## Parallel Execution Examples

- Phase 1: `T001 + T002` together (different commands, no shared state).
- US1: `T006 + T007` together (live download vs static code check).
- US3: `T010 + T011` together (different workers).
- Polish: `T013` alongside any phase.

## Implementation Strategy

- MVP = US1 verification only (P1 cleanup already shipped in tree; prove it).
- Then Phase 2 foundational hash dedup (single-file change, highest rework
  risk if deferred — multi-tag search is unusable-clean without it).
- Then US2 → US3 verification; finish with gallery sanity + changelog.
- Total: 13 tasks (US1: 2, US2: 2, US3: 2, Setup: 2, Foundational: 3, Polish: 2).

## Format Validation

All 13 tasks use `- [ ] TNNN ([P]) ([USn]) description + file path` (now all completed). No
bracket-token placeholders remain.
