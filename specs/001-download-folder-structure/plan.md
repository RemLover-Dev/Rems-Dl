# Implementation Plan: Download Folder Structure

**Branch**: `001-download-folder-structure` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-download-folder-structure/spec.md`

## Summary

Unify all 18 workers on `site / query / <Rating> / files` (no noise `images/`
level), reserve sorted `+`-joined query folders for future multi-tag search and
per-rating subfolders for future multi-rating search. P1 cleanup is already
implemented (`rating_subdir()` + 6 worker migrations + NekosAPI `+` join);
remaining work is cross-folder content-hash dedup so multi-tag queries never
re-download files already fetched under another query folder.

## Technical Context

**Language/Version**: Python 3.10+

**Primary Dependencies**: aiohttp (async pipeline), Flask + Flask-SocketIO
(desktop backend), pywebview (native window), gallery-dl (Pixiv/Zerochan
interop), curl_cffi (TLS impersonation)

**Storage**: Filesystem (`Rems Dl/<site>/<query>/<Rating>/`), JSON stores
(`database/gallery.json`, `database/image_history.json`,
`<site_root>/download_history.json`)

**Testing**: pytest (`test/test_database.py`, `test/test_settings.py`), manual
smoke test per touched worker (download + gallery view + dedup re-run)

**Target Platform**: Windows/Linux desktop (PyInstaller exe/binary), Docker
headless (`REMS_HEADLESS=1`)

**Project Type**: Desktop app (Python backend + web UI)

**Performance Goals**: No regression in per-worker throughput; dedup check
stays O(1) per file (set lookup, no extra network round-trips)

**Constraints**: Offline-capable gallery; loopback-only by default; no
reorganization of existing on-disk folders (gallery history paths must keep
resolving); per-worker isolation (one broken worker never breaks the app)

**Scale/Scope**: 18 workers, 1 shared helper, ~12 lines changed for P1 (done)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] I. Image Quality First — folder placement only; no fetch/resolution change.
- [x] II. Speed with Upstream-Rules Respect — no request-pattern change; dedup
  sets avoid extra requests, never add any.
- [x] III. Deduplication by Default — extended, not weakened: cross-folder
  content-hash dedup is this plan's remaining work.
- [x] IV. Tag & Metadata Integrity — no sidecars reintroduced (v1.2.0);
  tags/rating keep flowing to gallery store with filepath.
- [x] V. Local-First Gallery Experience — gallery rescans by `os.walk` and
  stored paths; layout-agnostic, verified in code (`Rems_Dl.py` rescan/import).
- [x] Simplicity — one helper in `core/shared.py`, no new abstractions.

Post-design re-check: no new violations. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-download-folder-structure/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
core/
└── shared.py            # rating_subdir(), MULTI_TAG_SEP (done)
workers/
├── gelbooru.py gsbooru.py yande.py konachan.py safebooru.py pixiv.py  # rating_subdir (done)
├── nekosapi.py          # sorted "+" multi-tag folder (done)
├── danbooru.py sankaku.py  # video/books splits kept (signal, not noise)
└── *.py                 # flat query folders where no rating data exists
test/
├── test_database.py
└── test_settings.py
```

**Structure Decision**: Single-project layout, existing `core/` + `workers/`
split kept; no new packages or layers.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
