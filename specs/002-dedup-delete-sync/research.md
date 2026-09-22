# Research: Dedup Deletion Sync

All Technical Context unknowns resolved from live code inspection (no NEEDS
CLARIFICATION remain).

## D1 — Removal API: reuse the existing method

**Decision**: Call the already-implemented `DedupStore.remove_by_filepath()`
(core/dedup_store.py:318) from delete endpoints; do not write a new removal path.

**Rationale**: The method deletes rows *and* maintains the in-memory phash
prefilter index under the store lock — the two things a hand-rolled DELETE
would get wrong. It is simply never called today (grep: 0 call sites).

**Alternatives considered**: raw SQL in endpoints (reimplements index upkeep — rejected); new wrapper method (no added behavior — rejected).

## D2 — Path matching: exact absolute path

**Decision**: Match on the absolute path string. DB rows store absolute paths
(verified: 5/5 live rows start with `/home/.../Rems Dl/...`); both delete
endpoints already build `os.path.join(MASTER_FOLDER, img["filepath"])`, the
same absolute form workers pass to `check_duplicate()` at download time.

**Rationale**: Same construction ⇒ same string ⇒ exact `WHERE filepath = ?`
hits. No normalization layer needed for paths produced by one codebase.

**Alternatives considered**: match by filename only (collides across folders — rejected); normcase/normpath canonicalization (deferred: adds Windows-case edge handling not required by any FR; revisit only if field reports misses).

**Known tradeoff (spec-literal)**: if the whole library root is relocated, old
absolute paths dangle and sweeps remove those records (FR-002/004/009 say
"file no longer exists"). Store self-heals: subsequent downloads re-add
signatures; filename-level download history still blocks same-name re-fetch.
No root-tracking heuristic — rejected as silent special-case behavior.

## D3 — Sweep primitive: one new store method

**Decision**: Add `DedupStore.remove_missing_files() -> int`: snapshot
`id, filepath` under lock, `os.path.isfile` each (lock released during stat),
batch-delete missing ids, pop phash index, return count.

**Rationale**: Single owner of index consistency (same pattern as
`remove_by_filepath`); callers (refresh, startup) stay one-liners.

**Alternatives considered**: sweep in each caller with raw SQL (index drift risk — rejected); existence check piggybacked on `find_duplicate` (lazy, doesn't satisfy explicit sweeps — rejected).

## D4 — Refresh: synchronous combined run

**Decision**: `POST /api/gallery/rescan` keeps its current synchronous walk,
gains (a) prune of gallery entries whose files are missing (endpoint
currently only *adds* — prune exists only in `startup_rescan`) and (b) a
`remove_missing_files()` call; response extends with `removed_entries` and
`removed_records` (FR-007).

**Rationale**: One press, one run, both effects (clarified Q2=A). ~10⁴
`isfile` stats ≪ SC-003's 30 s budget; sync keeps the response counts honest.

**Alternatives considered**: background refresh job (response couldn't carry
final counts without polling — rejected as over-engineering for local FS speed).

## D5 — Startup sweep: reuse the existing background thread

**Decision**: Append `remove_missing_files()` to the end of
`startup_rescan()` (Rems_Dl.py:1523), which already runs as a daemon thread
spawned at boot — no new thread, no work on the critical path before window
creation.

**Rationale**: SC-006 / clarified Q3: sweep must not freeze startup. The
gallery prune already lives there; dedup prune is the same shape. Thread is
started *before* `create_window` but never joined — UI never waits on it.

**Alternatives considered**: dedicated second thread (duplicate walk/lock
traffic — rejected); sweep before window (violates SC-006 — rejected).

## D6 — Failure surfacing: response flag + toast (clarified Q1=C)

**Decision**: Delete endpoints wrap `remove_by_filepath` in try/except; on
failure the JSON gains `"dedup_warning": true` (file is still deleted).
`web/script.js` delete handlers read it and show an existing `showToast(...)`
warning naming Refresh as the cleanup path.

**Rationale**: Q1 answer C — best-effort delete + immediate user-visible
warning; FR-001 text matches exactly.

**Alternatives considered**: strict abort (Q1 option A — rejected by user);
silent best-effort (Q1 option B — rejected by user).

## D7 — Non-image files

**Decision**: Videos/zips never have records (`_DEDUP_SKIP_EXTS` in
core/shared.py:330 — `check_duplicate` returns None before hashing). Delete
endpoints call `remove_by_filepath` unconditionally; for those files it is a
no-op delete (0 rows).

**Rationale**: one code path, no extension branching; zero-cost when no row matches.

## D8 — Concurrency

**Decision**: Rely on the store's existing `threading.Lock` (used by
`remove_by_filepath`/`remove_missing_files`) and SQLite single-writer
semantics; refresh, startup sweep, and in-flight download `check_and_add`
calls interleave safely. Sweeps are idempotent (FR-008) so overlap is harmless.

**Rationale**: lock discipline already proven for add/check; extending it to
the two read-stat-then-delete methods requires no new machinery.
