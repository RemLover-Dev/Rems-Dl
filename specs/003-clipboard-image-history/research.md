# Research: Clipboard History Image Capture

All Technical Context unknowns resolved from live environment + code
inspection (no NEEDS CLARIFICATION remain).

## D1 — Why paste works but history misses the image

**Decision**: Root cause is capture, not clipboard write: `/api/clipboard`
correctly runs `wl-copy`/`xclip` (Rems_Dl.py:304-332), so paste works, but
history tools only record an entry if **their** watcher/daemon observes the
change (or is fed explicitly). On this machine `cliphist` has no reliable
`wl-paste --watch` (Hyprland autostart does not run under KDE), and Klipper’s
DBus API is text-only (`setClipboardContents(QString)` — verified live via
`qdbus6 org.kde.klipper /klipper`).

**Rationale**: Explains the user’s exact symptom and why starting ad-hoc
watchers “didn’t work for everyone” (dies with session, not portable).

**Alternatives considered**: blame WebKit clipboard (rejected — paste works);
require user-managed watchers (rejected — violates FR-003 / clarification
“works for everyone”).

## D2 — Where to hook history push

**Decision**: Single choke point inside `POST /api/clipboard` **after** a
successful system clipboard write. Every in-app image copy already funnels
through `writeClipboardBlob` → that endpoint (`web/script.js:2969-3003`);
`copyViewerImage` is the only UI entry and calls those helpers.

**Rationale**: FR-006 (all entry points) is satisfied by construction; one
call site to test; paste result is already known before history runs.

**Alternatives considered**: JS-side second fetch to a history endpoint
(needs bytes twice, races toast timing — rejected); push before wl-copy
(history shows entry while clipboard still old — rejected).

## D3 — Detection: “currently running” tools (clarified Q3)

**Decision**: Probe, in order, tools that are **active on this machine**, not
a fixed allow-list of everything that exists:

| Tool kind | “Running” signal | Image push mechanism |
|-----------|------------------|----------------------|
| cliphist | `cliphist` on `PATH` **and** (`wl-paste` watch process containing `cliphist` **or** cliphist DB path exists and `cliphist list` exits 0) | pipe same bytes to `cliphist store` (stdin) |
| Klipper (KDE) | DBus name `org.kde.klipper` is owned (`qdbus6`/`dbus-send` ListNames) | **text-only API** → text placeholder line (D4) |
| CopyQ | process `copyq` | best-effort: try `copyq add` with bytes if binary present (Linux) |
| greenclip / other | not detected here | no code until seen in the wild |
| Windows / macOS | N/A for this feature | existing clipboard write only (best-effort OS history) |

Detection runs per copy (cheap); failures ⇒ treat as not running (FR-005).

**Rationale**: Clarification Q3 = guarantee targets the tool **running on
that machine**; probing avoids supporting “installed but not running” and
avoids an unbounded allow-list (Q3 option A rejected).

**Alternatives considered**: fixed minimum set named in spec (rejected — user
chose C); scan every possible history package (rejected — YAGNI / unbounded).

## D4 — Klipper (and other text-only history UIs): placeholder (clarified Q4)

**Decision**: Prefer image-capable tools first (cliphist → full image entry,
US1). If the **only** running history tool is text-only (Klipper DBus is
`setClipboardContents(QString)` only — verified live):

1. Write a text placeholder as the clipboard’s text representation **in
   addition to** the image (multi-mime is not required: placeholder is for
   history, image is for paste).
2. Order that guarantees FR-001: set placeholder via Klipper DBus (it may
   also set clipboard text), then **re-run image `wl-copy`** so the final
   clipboard owner still serves `image/png` for immediate paste.
3. Placeholder body: `Rems-Dl image: <filename> | <url>` (links back to the
   image — clarified Q4).

If Klipper `setClipboardContents` cannot be made safe without breaking paste
in a given environment, **skip Klipper** and rely on FR-005 degrade when no
image-capable tool exists — paste never loses to history (FR-001
non-negotiable).

**Rationale**: Clarified Q4 = text placeholder links to image; FR-001 still
requires image paste to win the final clipboard state; no third-party tool
patching (spec out of scope).

**Alternatives considered**: replace/upgrade text-only tool (rejected — Q4
option A); paste-only with no history (rejected — Q4 option B); ship our own
history UI (out of scope in spec); call Klipper API without re-asserting
image (rejected — risks FR-001 regression).

## D5 — Non-blocking / failure isolation (FR-004, FR-009, FR-010)

**Decision**: History push in a daemon thread or with hard subprocess
timeouts (≤1.0s), all exceptions swallowed (optional `console` debug only,
never `showToast` error). Endpoint returns `{"ok": true}` as today on paste
success even if history push fails. Optional response field
`history: "pushed"|"skipped"|"unsupported"` for contract tests only.

**Rationale**: SC-003/SC-004; constitution “per-worker isolation” analogue —
a broken history tool never breaks copy.

**Alternatives considered**: synchronous unlimited wait (violates SC-004);
surface errors (violates FR-010).

## D6 — Text/URL copies (FR-007)

**Decision**: Same endpoint, same push helper, `mime` starts with `text/`.
No separate UI text-copy button exists today (`copyUrlToClipboard` fetches
**image bytes** from URL, not the URL string); FR-007 is satisfied for any
future/existing text POST to `/api/clipboard` without new UI.

**Rationale**: One code path; no speculative UI.

**Alternatives considered**: dedicated text-copy route (YAGNI).

## D7 — Windows / macOS (FR-008 best-effort)

**Decision**: No extra native history APIs. OS clipboard write already
happens via `xclip`/`wl-copy` absence paths and `navigator.clipboard`
fallback; Windows/macOS clipboard history, when enabled by the user, observes
normal copy — best-effort = do not break it; no new code beyond skipping
Linux-only detection when `WAYLAND_DISPLAY`/`DISPLAY` + tools absent.

**Rationale**: Clarification Q2 = Linux guaranteed, others best-effort;
spec out-of-scope for platform-specific history features.

**Alternatives considered**: WinRT clipboard history API (rejected — scope,
no Windows CI guarantee).

## D8 — Constitution re-check post-design

**Decision**: PASS. No new dependencies (stdlib + existing CLIs), no network
(FR-009), no PII (FR-009/VI), no download-path or dedup changes (I–IV),
loopback-only app surface unchanged (V), implementation stays on
`003-clipboard-image-history` (VII).

**Alternatives considered**: embed a history daemon (rejected — replaces
user’s tool, out of scope).

## D9 — Live KDE validation: IgnoreImages + wl-clipboard 2.3.0 (post-implement)

**Decision**: On this machine (Plasma 6.7.5 Wayland, `wl-clipboard` 2.3.0
already speaks `ext-data-control-v1`, Klipper via `plasmashell`):

1. Stock `wl-copy --type image/png` only enters Klipper history when
   `IgnoreImages=false` in `~/.config/klipperrc` (verified: count grows,
   menu shows `▨ WxH`). App does **not** write that file (FR-003/Constitution);
   document as optional user/desktop setting for full image thumbnails.
2. App path: `POST /api/clipboard` → `history: "pushed"`; history UI shows
   both the real image row (via wl-copy + data-control) **and** the D4
   placeholder (`Rems-Dl image: …`); clipboard still `image/png` for paste.
3. `IgnoreImages=true` (or missing data-control) ⇒ only the placeholder row
   (clarified Q4 still met). Klipper DBus remains QString-only — no image
   push API (unchanged D4).
4. Unrelated: pacman `klipper` is 3D-printer firmware, not KDE clipboard
   (`libklipper.so.6` ← `plasma-workspace`).

**Rationale**: Proves FR-001/FR-002/SC-001 on the real user stack without
app-side config writes or package changes.

**Alternatives considered**: app writes `klipperrc` (rejected — violates
FR-003); require wl-clipboard upgrade (rejected — already 2.3.0).
