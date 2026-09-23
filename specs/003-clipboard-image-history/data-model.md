# Data Model: Clipboard History Image Capture

No persistent app schema. Entities are process-local / third-party.

## Clipboard Copy Action (in-flight request)

| Field | Type | Notes |
|-------|------|-------|
| data | bytes | Raw body of `POST /api/clipboard` (image or text) |
| mime | str | `Content-Type` without parameters (e.g. `image/png`, `text/plain`) |
| clipboard_ok | bool | True when `wl-copy`/`xclip` succeeded (FR-001 gate before history) |
| history_targets | list[HistoryTarget] | Tools detected as running at push time |
| history_result | enum | `pushed` \| `skipped` \| `unsupported` (response field for tests; not user-facing) |

**Lifecycle**:

```
POST /api/clipboard
  → validate non-empty
  → set system clipboard (existing wl-copy/xclip path)
  → if clipboard_ok: detect running history tools
       → for each target: best-effort push (timeout ≤1s, swallow errors)
  → respond {"ok": true, "history": <history_result>}
```

Paste success never depends on `history_result` (FR-004, FR-010).

## HistoryTarget (ephemeral, per copy)

| Field | Type | Notes |
|-------|------|-------|
| kind | str | `cliphist` \| `klipper` \| `copyq` \| … |
| mode | enum | `image_bytes` \| `text_placeholder` |
| how | str | short label for tests/debug (`stdin store`, `dbus setClipboardContents`, …) |

**Identity**: not persisted; recomputed every request.

**Validation rules**:
- `image_bytes` only if tool can display/store images (cliphist).
- `text_placeholder` only for text-only tools (Klipper DBus API is QString-only) and only when paste will be re-asserted as image afterwards (research D4 / FR-001).
- No target ⇒ `history_result=unsupported` (still `ok: true`).

## Clipboard History Entry (third-party, not owned)

Owned by the environment (spec Key Entities). App does not store, index, or
list entries. Success for an image copy = user can see/re-select in that
tool’s UI (FR-002), or a linking text placeholder when the tool is
text-only (clarified Q4).

## Text placeholder shape (text-only tools)

Plain string, no binary:

```text
Rems-Dl image: <filename> | <url>
```

`url` = source URL when known, else absolute gallery file URL used for the
copy — links the history line back to the image (FR-002 carve-out).
