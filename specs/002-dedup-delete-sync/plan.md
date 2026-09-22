# Implementation Plan: Dedup Deletion Sync

**Branch**: `002-dedup-delete-sync` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-dedup-delete-sync/spec.md`

## Summary

Wire the already-existing but never-called `DedupStore.remove_by_filepath()`
into both gallery delete endpoints, add a `remove_missing_files()` sweep to the
store, run that sweep from the Refresh endpoint (combined with a new
missing-entry prune the endpoint currently lacks) and from the existing
background startup rescan thread, and surface two response fields the UI
consumes: `dedup_warning` on delete, `removed_entries`/`removed_records` on
refresh. Store paths are absolute (verified against live DB rows), delete
endpoints already compute the same absolute path — matching is exact-string
deletion plus in-memory phash-index maintenance already implemented.

## Technical Context

**Language/Version**: Python 3.13 (runtime), no other languages beyond existing JS UI

**Primary Dependencies**: Flask + flask-socketio (existing), sqlite3 stdlib, Pillow/imagehash (existing dedup), pywebview desktop shell

**Storage**: `database/dedup.sqlite3` (table `image_hashes`, absolute `filepath` column) + `database/gallery.json` — no schema migration needed

**Testing**: `pytest test/ -q` (existing 6 tests) + scripted store/API smoke checks per quickstart.md; no new test framework

**Target Platform**: Desktop (Linux/Windows/macOS via pywebview); loopback HTTP only

**Project Type**: Single desktop app (`Rems_Dl.py`, `core/`, `workers/`, `web/`)

**Performance Goals**: Refresh on 5,000 images ≤ 30 s (SC-003) — one `os.path.isfile` per record/entry, well inside budget; startup sweep must not block UI (SC-006)

**Constraints**: No schema change; no new dependencies; no PII (Principle VI); work MUST land on feature branch, not `main` (Principle VII — repo is currently on `main`)

**Scale/Scope**: ~13–10⁴ dedup rows, ~10⁴ gallery entries; 2 endpoints + 1 store module + 1 frontend toast path + startup thread

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Image Quality First | PASS | No download-path changes |
| II. Speed / upstream respect | PASS | Sweeps are local `isfile` scans; startup sweep stays in existing background thread; no network touched |
| III. Deduplication by Default | PASS | Feature *repairs* dedup state: records for existing files untouched (FR-005), idempotent (FR-008), cross-session persistence unchanged |
| IV. Tag & Metadata Integrity | PASS | No tag/rating/sidecar behavior changes |
| V. Local-First Gallery | PASS | All operations local; loopback unchanged; refresh/startup stay server-side local FS |
| VI. No Personal Information in Code | PASS | No PII, no credentials, no personal paths hard-coded |
| VII. Branch-Based Development | **ACTION REQUIRED before implementation** | Current git branch is `main`; implementation MUST run on `002-dedup-delete-sync` first |

**Gate result**: PASS on design; VII is a process gate for the implement phase (no code written by this command).

## Project Structure

### Documentation (this feature)

```text
specs/002-dedup-delete-sync/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── gallery-cleanup.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
Rems_Dl.py               # EDIT: delete endpoints, rescan endpoint, startup_rescan
core/dedup_store.py      # EDIT: add remove_missing_files()
core/shared.py           # no change (check_duplicate/remove_gallery_files reused as-is)
web/script.js            # EDIT: dedup_warning toast + refresh summary counts
test/                    # no new framework; quickstart smoke scripts only
```

**Structure Decision**: extend the existing single-project desktop layout; no new packages, modules beyond the two functions and three endpoint/thread wirings above.

## Complexity Tracking

None — no Constitution violations to justify.
