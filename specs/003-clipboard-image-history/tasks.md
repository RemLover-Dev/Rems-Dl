---

description: "Task list for Clipboard History Image Capture"
---

# Tasks: Clipboard History Image Capture

**Input**: Design documents from `/specs/003-clipboard-image-history/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/clipboard-history.md, quickstart.md

**Tests**: Unit tests included per plan.md Testing (`pytest` + mocks); no separate TDD mandate in spec — write tests with implementation.

**Organization**: Tasks grouped by user story (US1 P1, US2 P2, US3 P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (omit in Setup, Foundational, Polish)
- Exact file paths in every description

## Path Conventions

Single project at repo root: `Rems_Dl.py`, `core/`, `web/`, `test/`.

---

## Phase 1: Setup

**Purpose**: Process gate before any implementation code

- [X] T001 Create/switch git branch to `003-clipboard-image-history` per Principle VII (do not commit to `main` or leave work only on `002-dedup-delete-sync`)
- [X] T002 [P] Confirm design docs present under `specs/003-clipboard-image-history/` (plan.md, research.md, data-model.md, contracts/clipboard-history.md, quickstart.md)

**Checkpoint**: On correct branch; docs readable

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared module skeleton + endpoint wiring that every story depends on

**⚠️ CRITICAL**: No story work until this phase is complete

- [X] T003 Create `core/clipboard_history.py` with `HistoryTarget` (fields `kind`, `mode`, `how` per data-model.md), `detect_running_history_tools() -> list` returning `[]` stub, and `push_history(data: bytes, mime: str, targets: list) -> str` returning `"skipped"` stub (contracts/clipboard-history.md)
- [X] T004 Wire `POST /api/clipboard` in `Rems_Dl.py` (`set_clipboard`, ~:304): after successful clipboard set only, call detect+push from `core/clipboard_history.py` with ≤1s budget; extend 200 JSON with `"history": "pushed"|"skipped"|"unsupported"`; never change 400/501/500 outcomes; wrap push in try/except (FR-004, FR-010)
- [X] T005 [P] Add `test/test_clipboard_history.py` unit test: empty detect → endpoint or helper reports `unsupported`/`skipped` without raising; `push_history(..., [])` does not throw

**Checkpoint**: Foundation ready — copy still pastes; `history` field present; stories can fill in real detect/push

---

## Phase 3: User Story 1 - Copied image appears in clipboard history (Priority: P1) 🎯 MVP

**Goal**: After in-app image copy, running history tool shows a visible, re-selectable entry (image bytes via cliphist; text placeholder via Klipper-only per clarified Q4) while immediate paste still yields the image

**Independent Test**: Copy image from gallery viewer → open history UI → entry visible and re-selectable; immediate paste still inserts image (`quickstart.md` Q1, Q4)

### Implementation for User Story 1

- [X] T006 [US1] Implement cliphist detection in `core/clipboard_history.py` per research D3: `cliphist` on PATH **and** (`wl-paste` watch process containing `cliphist` **or** cliphist DB exists and `cliphist list` exits 0) → `HistoryTarget(kind="cliphist", mode="image_bytes", how="stdin store")`
- [X] T007 [US1] Implement cliphist push in `core/clipboard_history.py`: pipe raw `data` to `cliphist store` stdin, timeout ≤1.0s, return success/failure without raising (FR-002 image entry when tool displays images)
- [X] T008 [US1] Implement Klipper detection in `core/clipboard_history.py`: DBus name `org.kde.klipper` owned → `HistoryTarget(kind="klipper", mode="text_placeholder", how="dbus setClipboardContents")` (research D3)
- [X] T009 [US1] Implement Klipper text-only placeholder push in `core/clipboard_history.py` per research D4 / data-model placeholder `Rems-Dl image: <filename> | <url>`: set placeholder via `setClipboardContents`, then **re-run image clipboard write** (`wl-copy`/`xclip` same bytes+mime as original) so final clipboard is still the image (FR-001, clarified Q4); skip Klipper if re-assert cannot run
- [X] T010 [US1] Implement CopyQ best-effort push in `core/clipboard_history.py` only if `copyq` process detected (research D3); same timeout/error rules
- [X] T011 [US1] `push_history` in `core/clipboard_history.py` returns `"pushed"` iff ≥1 target succeeded, else `"skipped"` (contract); image-capable targets preferred over placeholder-only when both present
- [X] T012 [US1] Pass placeholder context (filename/url when known) into push path from `Rems_Dl.py` `set_clipboard` (query/form optional or derive from referrer/path — keep request contract backward compatible: raw body + Content-Type unchanged)
- [X] T013 [US1] Unit tests in `test/test_clipboard_history.py`: mock `subprocess`/`shutil.which` for cliphist detect+push success; Klipper detect mocked; assert `push_history` → `"pushed"`; assert re-assert clipboard call invoked after Klipper placeholder
- [X] T014 [US1] Manual smoke per `quickstart.md` Q1: POST PNG via test client or UI copy → `cliphist list` gains binary entry; `wl-paste --list-types` still has `image/png`; dt < 2s (SC-001, SC-002)

**Checkpoint**: US1 independently valid — image visible in history UI and paste unregressed

---

## Phase 4: User Story 2 - Works without per-machine setup (Priority: P2)

**Goal**: Detection/push is entirely runtime probe inside app copy flow — no autostart, no user config, no docs step

**Independent Test**: Fresh Linux session with no app-managed watchers required: copy from app → running tool’s history UI shows entry; grep confirms feature writes no autostart/config (US2 scenarios, FR-003, SC-005)

### Implementation for User Story 2

- [X] T015 [US2] Verify in `core/clipboard_history.py` + `Rems_Dl.py`: no writes to `~/.config/autostart`, systemd user units, Hyprland/KDE autostart, or any user clipboard-watcher config (FR-003); detection only reads PATH/process/DBus (research D3)
- [X] T016 [US2] Ensure detection runs on every copy (cheap, no cached “first-run setup”) inside `Rems_Dl.py` `set_clipboard` → `detect_running_history_tools()` (data-model lifecycle)
- [X] T017 [US2] Unit test in `test/test_clipboard_history.py`: detect uses only `shutil.which` / process / DBus probes (mock those); assert no filesystem writes outside app runtime (FR-009) — e.g. mock `open` for config paths not used
- [X] T018 [US2] Manual: `quickstart.md` Q1 on machine with history tool already running **without** any Rems-Dl-specific watcher setup — entry appears (SC-005); non-Linux path: no crash when tools absent (research D7)

**Checkpoint**: US2 valid without user config; no setup artifacts left on disk

---

## Phase 5: User Story 3 - Graceful behavior when history is unavailable (Priority: P3)

**Goal**: Missing/slow/broken history never breaks paste, never shows error, never freezes UI

**Independent Test**: No history tool (or force push failure) → POST `/api/clipboard` still `ok: true`, paste works, no error toast; healthy tool still ≤1s extra (US3 scenarios, FR-004/005/010, SC-003/004)

### Implementation for User Story 3

- [X] T019 [US3] Harden `core/clipboard_history.py` `push_history`/`detect_running_history_tools`: per-target try/except; subprocess timeout ≤1.0s; never raise to caller (FR-004)
- [X] T020 [US3] Confirm `Rems_Dl.py` `set_clipboard`: history failure cannot flip 200→error; no `showToast`/user-facing log for history miss (FR-010); empty/missing tools → `"unsupported"` still `ok: true` (contract, FR-005)
- [X] T021 [US3] Unit tests in `test/test_clipboard_history.py`: `Popen` raises `OSError` → `"skipped"`, no exception; no targets → `"unsupported"`; optional: assert push wall time bounded by timeout mock (SC-004 budget)
- [X] T022 [US3] Manual `quickstart.md` Q2: copy with history probes failing → `ok: true`, paste works, no warning toast (SC-003)

**Checkpoint**: All stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Gates, docs, cleanup

- [X] T023 [P] Run regression gates: `python3 -m py_compile Rems_Dl.py core/clipboard_history.py` and `python3 -m pytest test/ -q` (existing 6 + new clipboard tests) and `node --check web/script.js`
- [X] T024 [P] Walk `specs/003-clipboard-image-history/quickstart.md` Q1–Q4 end-to-end; record pass/skip in notes (SC-001–SC-006)
- [X] T025 Verify `web/script.js` `writeClipboardBlob` still treats any `r.ok` as success and ignores `history` field (contract Frontend expectations — no UI change)
- [X] T026 Grep implementation for PII / personal paths (Principle VI); confirm no new deps in `requirements.txt`
- [X] T027 Update `CHANGELOG.md` only if release notes are required for this branch’s merge process (skip if not merging yet)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks all user stories**
- **US1 (Phase 3)**: Depends on Foundational (T003–T005)
- **US2 (Phase 4)**: Depends on Foundational; benefits from US1 real detect/push (T006–T011) but T015–T018 can start once T003–T004 exist
- **US3 (Phase 5)**: Depends on Foundational + ideally US1 push implementations (hardening wraps real code); can begin hardening stubs after T003–T005
- **Polish (Phase 6)**: After desired stories complete (MVP: US1; full: US1–US3)

### User Story Dependencies

- **US1 (P1)**: After Foundational — no deps on US2/US3
- **US2 (P2)**: After Foundational — independently testable; integrates with US1 detect path when present
- **US3 (P3)**: After Foundational — hardening is cross-cutting but independently testable with mocks

### Parallel Opportunities

- T001 ∥ T002 (Setup)
- T005 ∥ T003/T004 if T005 only needs stub signatures (prefer after T003)
- Within US1: T006 ∥ T008 ∥ T010 (different tool branches, same file — **serialize file edits**; parallelize test writing T013 with doc reads)
- T023 ∥ T024 (different commands)
- US2 and US3 phases can run in parallel with each other after Foundational if staffed (different concerns; shared file `core/clipboard_history.py` → prefer sequential edits)

---

## Parallel Example: User Story 1

```text
# Same-file risk on core/clipboard_history.py — implement sequentially T006→T011
# Parallelizable with US1 core:
Task: "Unit tests in test/test_clipboard_history.py (T013) once stubs exist"
Task: "Manual Q1 smoke prep (T014) reading quickstart.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1 (cliphist image push + Klipper placeholder + paste re-assert)
3. **STOP and VALIDATE**: quickstart Q1 + Q4 — image visible in history, paste works
4. Ship/demo MVP

### Incremental Delivery

1. Setup + Foundational → history field live, stubs safe
2. US1 → visible history entries (MVP)
3. US2 → prove zero config (usually documentation/verification of existing design)
4. US3 → hardening/tests for absent/broken tools
5. Polish gates → merge-ready on `003-clipboard-image-history`

### MVP scope

**US1 only** delivers the user’s reported fix (image in history + paste intact). US2/US3 are verification and robustness required before release (spec marks US3 required before release).

---

## Notes

- [P] tasks = different files or independent commands
- [Story] labels only in US phases
- Do not add network calls or new pip dependencies (FR-009, plan constraints)
- Do not touch `.env`
- Hold commits until user explicitly asks; branch must be `003-clipboard-image-history` before implement (T001)
