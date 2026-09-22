<!--
Sync Impact Report
- Version change: 1.1.0 → 1.2.0 (removed retired mandates from Principle IV
  and Additional Constraints)
- Modified principles: IV. Tag & Metadata Integrity (dropped Hydrus sidecar,
  auto-suggest, and favorites/history mandates)
- Added sections: none
- Removed sections: none (offline tag-DB shipment mandate removed from
  Additional Constraints)
- Follow-up TODOs: needs user clarification on the loopback/port remark
  (Principle V left untouched)
-->

# Rems-Dl Constitution

## Core Principles

### I. Image Quality First (NON-NEGOTIABLE)
Every download path MUST fetch the highest-resolution source file the upstream
API/site exposes (full-size image, original video, ugoira-converted GIF at
source fidelity). No downscaling, recompression, or thumbnail substitution is
allowed in the default pipeline. Resolution/format filters (e.g. Pinterest
resolution filter, video/GIF-only modes) MUST be opt-in user choices, never
silent defaults. Quality regressions are release-blocking bugs.

### II. Speed with Upstream-Rules Respect
Rems-Dl is a multi-threaded, multi-source scraper (18+ APIs/sites) where speed
is a priority second only to image quality. All workers MUST use concurrent
fetching with tactical delays, retry loops, and rate-limit handling (anti-ban
pauses, proxy support, TLS impersonation where required). Each site/API's ToS,
rate limits, and auth requirements MUST be respected by default; deviation is
allowed ONLY on explicit user instruction (e.g. custom delays, proxy, or
credentials set via Settings/.env). Credential-based higher limits (Rule34,
Gelbooru, Sankaku, Pixiv) MUST be supported via Settings/.env.

### III. Deduplication by Default
The download pipeline MUST deduplicate before writing: content-hash or
source-ID checks prevent re-downloading and re-storing identical files.
Re-runs of the same query MUST be idempotent (skip existing, no duplicates on
disk or in gallery). Dedup state MUST survive restarts.

### IV. Tag & Metadata Integrity
Every downloaded item MUST retain its source tags, artist, rating
(`rating:g/s/q/e` unified system), and source URL. Workers MUST append
normalized rating tags, extract categorized tags (artist/character/copyright/
metadata). No sidecar files, no tag auto-suggest mandate, and no
favorites/search-history mandate: those features are retired and MUST NOT be
reintroduced without a constitution amendment.

### V. Local-First Gallery Experience
Downloaded media MUST be viewable offline in the Gallery/Archive tab (Focus
Mode, rating-aware folders, instant next-on-delete) with no network dependency.
The app MUST remain a native desktop app on loopback (`127.0.0.1`, ephemeral
port via `pywebview`); `REMS_HEADLESS=1` is the only mode that binds
`0.0.0.0:$PORT` for Docker/server use. Nothing is ever exposed to the network
by default.

## Additional Constraints

Python 3.10+ desktop stack: `Rems_Dl.py` entry point, `core/` shared pipeline
(`BaseDownloader`, tag engine, gallery store), `workers/` per-source modules,
`web/` glass-morphism UI (Socket.IO live logs).
Security: credentials only in `.env`/Settings tab, never logged; TLS
verification configurable; proxy support for Cloudflare-fronted sources.
Legal: educational/archiving purpose only; NSFW sources require of-age users;
respect upstream ToS and rate limits. License: MIT for own code; `workers/
pixiv.py` GPL-2.0-only, `rule34Py` GPL-3.0-only per LICENSE.

## Development Workflow

Simplicity first: reuse `core/shared.py` pipeline and existing worker patterns;
no new abstraction for a single source. Changes MUST keep per-worker isolation
(a broken worker never breaks the app). Quality gates: manual smoke test
(download + gallery view + dedup re-run) per touched worker; integration check
for tag output and rating folders. Release automation via
`.github/workflows/release.yml` on `v*` tags (Windows exe, Linux binary,
Docker image). All PRs MUST verify constitution compliance (quality,
dedup, tags, loopback safety).

## Governance

This constitution supersedes all other practices for Rems-Dl. Amendments
require a documented proposal, version bump per semver (MAJOR: incompatible
principle removal/redefinition; MINOR: new principle/expanded guidance;
PATCH: clarifications/wording), and migration notes where behavior changes.
PRs and reviews MUST check compliance; unjustified complexity MUST be rejected.
Runtime guidance lives in `README.md` / `README_fa.md` and `CHANGELOG.md`.

**Version**: 1.2.0 | **Ratified**: 2026-09-22 | **Last Amended**: 2026-09-22
