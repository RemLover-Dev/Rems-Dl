# Contract: Clipboard History Push

## Endpoint (existing, extended response)

`POST /api/clipboard`  
Loopback only. Header `User-Agent: RemsDlDesktopApp/1.0` required (existing
guard).

### Request

| Header | Value |
|--------|--------|
| `Content-Type` | MIME of body (`image/png`, `image/jpeg`, `text/plain`, …) |
| body | raw bytes (non-empty) |

### Response `200` (paste path success — required for FR-001)

```json
{ "ok": true, "history": "pushed" | "skipped" | "unsupported" }
```

| `history` | Meaning |
|-----------|---------|
| `pushed` | ≥1 running history tool accepted an entry (image bytes or placeholder) |
| `skipped` | Tools detected but all pushes failed/timed out (still `ok: true`) |
| `unsupported` | No running history tool detected (FR-005) |

### Error responses (unchanged contract)

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"empty"}` | empty body |
| 501 | `{"error":"no clipboard tool"}` | no `wl-copy`/`xclip` |
| 500 | `{"error":"..."}` | clipboard set failed |

History push **never** changes these outcomes and **never** turns a 200 into
a 4xx/5xx (FR-004, FR-010).

### Frontend expectations

- `web/script.js` `writeClipboardBlob`: treat any `r.ok` as success (already
  does); ignore `history` field (no UI change required).
- Toast timing unchanged (SC-004): history must not block the fetch response
  meaningfully — push runs with ≤1s subprocess budget inside the same
  request or immediately after clipboard_ok (see research D5).

## Detection contract (unit-testable pure functions)

```text
detect_running_history_tools() -> list[HistoryTarget]
push_history(data: bytes, mime: str, targets: list[HistoryTarget]) -> "pushed"|"skipped"
```

- `detect_*`: no side effects; safe when tools missing.
- `push_*`: per-target try/except + timeout; returns `pushed` if any target
  succeeded.
