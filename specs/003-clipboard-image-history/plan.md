# Implementation Plan: Clipboard History Image Capture

**Branch**: `003-clipboard-image-history` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-clipboard-image-history/spec.md`

## Summary

After `/api/clipboard` successfully places bytes on the system clipboard
(`wl-copy`/`xclip` — paste already works), best-effort push the same bytes (or,
for image-in-text-only tools, a linking placeholder) into every clipboard
history tool **detected as currently running** on the machine, so the user
sees and can re-select the copy in their history UI within 2s—without any
per-machine watcher/autostart setup. History is strictly non-blocking and
must never fail the paste path.

## Technical Context

**Language/Version**: Python 3.13 (backend), existing vanilla JS UI

**Primary Dependencies**: Flask (existing), stdlib `subprocess`/`shutil`/
`socket` for tool detection; optional `qdbus`/`dbus-send` CLI for Klipper
(both present on target KDE box); no new Python packages

**Storage**: N/A for app state — history lives in the third-party tool’s own
store (e.g. cliphist DB); no schema/files added by this feature

**Testing**: `pytest test/ -q` (existing 6 tests) + unit tests for
detection/push helpers with mocks + `quickstart.md` smoke scripts; gates
`py_compile Rems_Dl.py` and `node --check web/script.js`

**Target Platform**: **Linux desktop = hard guarantee (FR-008)**; Windows/
macOS best-effort via existing clipboard path; Docker/headless out of scope

**Project Type**: Single desktop app (`Rems_Dl.py`, `web/`)

**Performance Goals**: History push done within 2s of copy (SC-001); copy
feedback not delayed >1s vs today (SC-004) → push must be async/short-timeout
relative to the toast

**Constraints**: No network, no elevation, no files outside app runtime
(FR-009); no PII (Principle VI); no new deps; no per-user setup (FR-003);
history failures invisible to user (FR-010); branch-only workflow (Principle
VII)

**Scale/Scope**: One HTTP endpoint + one small helper module (or functions in
`Rems_Dl.py`) + detection/push for a handful of tool kinds; all in-app image
copy entry points already funnel through `writeClipboardBlob` →
`/api/clipboard`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Image Quality First | PASS | Copy uses original bytes already; no re-encode; history push sends same bytes |
| II. Speed / upstream respect | PASS | Local IPC/subprocess only; no network; short timeouts |
| III. Deduplication by Default | PASS | No download/gallery/dedup changes |
| IV. Tag & Metadata Integrity | PASS | No tag/rating/sidecar changes |
| V. Local-First Gallery | PASS | Loopback unchanged; history is local desktop IPC; no remote exposure |
| VI. No Personal Information in Code | PASS | No PII/hard-coded user paths; detection uses PATH/DBus/process only; history content is runtime user data, never committed |
| VII. Branch-Based Development | PASS (design) | `setup_plan` reports branch `003-clipboard-image-history`; implement/commit only on this branch |

**Gate result**: PASS pre-design. Post-design re-check: PASS (no new deps,
no storage, no network, no PII — see research.md decisions).

## Project Structure

### Documentation (this feature)

```text
specs/003-clipboard-image-history/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── clipboard-history.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
Rems_Dl.py               # EDIT: /api/clipboard — after clipboard set, call history push helper
core/clipboard_history.py  # NEW: detect running tools + best-effort push (cliphist store, Klipper text placeholder, no-op elsewhere)
web/script.js            # NO behavior change required (all image copies already POST /api/clipboard); verify text path if any
test/test_clipboard_history.py  # NEW: unit tests for detect/push (mock subprocess/dbus)
```

**Structure Decision**: keep logic in one new `core/` module (matches
constitution “reuse `core/shared.py` pipeline” style; avoids bloating
`Rems_Dl.py`); endpoint change is a few lines. No frontend contract change
beyond optional response field for tests.

## Complexity Tracking

None — no Constitution violations to justify.
