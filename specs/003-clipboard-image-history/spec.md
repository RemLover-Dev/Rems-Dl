# Feature Specification: Clipboard History Image Capture

**Feature Branch**: `003-clipboard-image-history`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "your fix didnt work i cant see the copied image in my clipboard history although i can still paste the image also do a fix that works for everyone"

## Clarifications

### Session 2026-09-23

- Q: When a clipboard history tool is running but its own display hides image entries (so the user still cannot see the copied picture), should this feature count as done once the history tool accepts the image, or only when the user can actually see and re-select that image in their history UI? (FR-002) → A: User must see and re-select the image in their history UI
- Q: Which desktop platforms must guarantee a visible history entry (not just best-effort), so acceptance tests can treat the others as optional? (FR-008) → A: Linux desktop guaranteed; others best-effort
- Q: On Linux, does the visible-history guarantee apply to any clipboard history manager the user might run, or only to a defined minimum set you name for testing? (FR-008) → A: Only the history tool detected as currently running on that machine
- Q: If the history tool currently running on Linux fundamentally cannot display image entries (text-only tool), what counts as done for image copies on that machine? (FR-008) → A: Text placeholder/history line linking to the image

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copied image appears in clipboard history (Priority: P1)

A user copies an image from Rems-Dl (viewer copy, gallery copy, or any in-app
copy action). They can paste it into another application immediately (already
works today). They also open their desktop's clipboard history and see the
copied image as a recent entry they can select and paste again later.

**Why this priority**: This is the reported defect. Paste already succeeds;
the missing piece is history visibility. P1 alone resolves the user's
complaint and is the entire MVP of this feature.

**Independent Test**: Copy an image from the app, open the system clipboard
history — the image is listed as the newest entry (or a text placeholder
that links to it if the history tool is text-only); selecting it pastes the
image (or the linking placeholder for text-only tools).

**Acceptance Scenarios**:

1. **Given** the user has a clipboard history manager available on their
   system, **When** they copy an image from the app, **Then** the image
   appears (visible and re-selectable) in the history UI without any extra
   user action.
2. **Given** an image was just copied from the app, **When** the user pastes
   into another app immediately, **Then** the paste still succeeds (no
   regression from the history step).
3. **Given** an image was copied from the app, **When** the user later opens
   clipboard history and selects that entry, **Then** pasting yields the same
   image bytes that were originally copied (or, for a text-only history tool,
   the placeholder that links to that image; immediate paste of the image
   bytes from the app still works in all cases).

---

### User Story 2 - Works without per-machine setup (Priority: P2)

The fix must work for every user of the app on their supported desktop
platform, without that user configuring desktop-specific clipboard watchers,
autostart entries, or other environment tweaks. History capture happens as
part of the app's own copy flow.

**Why this priority**: The previous attempt required machine-specific setup
and still did not show the image for this user. A fix that only works when
the environment is hand-configured does not meet the "works for everyone"
requirement. P2 is what makes P1 reliable outside one machine.

**Independent Test**: On a fresh Linux desktop with no clipboard-history
autostart configured by the user, copy an image from the app — if a history
manager is present and running, the entry appears; the user never edits
system config to achieve this. Non-Linux desktops are best-effort only.

**Acceptance Scenarios**:

1. **Given** a Linux desktop with a clipboard history tool detected as
   currently running and no user-configured watchers for app copies, **When**
   the user copies an image from the app, **Then** the image still appears
   (visible and re-selectable) in that tool's history UI.
2. **Given** the same environment, **When** the user copies an image, **Then**
   no setup wizard, permission prompt, or documentation step is required
   first.

---

### User Story 3 - Graceful behavior when history is unavailable (Priority: P3)

Some systems have no clipboard history manager, or the manager is not
running. Copy and paste from the app must behave exactly as they do today:
the image lands on the clipboard and pastes successfully, with no error
message, hang, or degraded copy UX caused by the history attempt.

**Why this priority**: Robustness. The app must not break copy/paste on
systems without history; P1/P2 remain fully useful if P3 is the only
remaining gap, so it is lowest priority but still required before release.

**Independent Test**: On a system with no clipboard history manager (or with
it stopped), copy an image from the app — paste works, no error is shown,
the app does not freeze.

**Acceptance Scenarios**:

1. **Given** no clipboard history manager is available, **When** the user
   copies an image from the app, **Then** paste still works and no error is
   displayed.
2. **Given** a history manager that fails or is slow while the app copies an
   image, **When** the copy completes, **Then** the user can still paste the
   image and the app remains responsive.
3. **Given** a history manager that is running normally, **When** the user
   copies an image, **Then** the history step adds no perceptible delay to
   the copy feedback.

---

### Edge Cases

- No clipboard history manager installed or running → copy/paste unchanged;
  no error, no retry loop.
- History manager present but errors or times out → copy/paste still
  succeed; history miss is silent (best-effort).
- Image larger than the history tool's typical entry size → attempt still
  made; failure is silent and paste remains unaffected.
- History manager accepts the entry but its UI would hide/filter image
  entries → feature is not done for that copy; the app must still deliver a
  visible, re-selectable history entry (FR-002) without patching the
  third-party tool.
- Detected running history tool is fundamentally text-only (cannot display
  image entries at all) → done is a visible text placeholder/history line
  linking to the copied image (FR-002); immediate paste of the image bytes
  must still work with no error.
- User copies an image, then immediately copies a second image → both copy
  actions behave correctly; history reflects at least the most recent copy
  when the manager supports it.
- Clipboard history feature disabled at the OS level → same as "no manager":
  copy/paste unaffected.
- Concurrent copy actions → each copy independently succeeds for paste;
  no shared-state corruption.
- Unsupported or unknown desktop → feature degrades to today's behavior
  (paste works; history may miss the entry).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After any successful in-app image copy, the image MUST remain
  immediately pasteable (no regression to existing paste behavior).
- **FR-002**: After a successful in-app image copy, the user MUST be able to
  see that image in their clipboard history UI and re-select it (paste it
  again from history) whenever a clipboard history manager is present on the
  system—not merely have the manager silently accept an entry the UI never
  displays. If the detected running history tool is text-only (cannot render
  image entries), a visible text placeholder/history line that links to the
  copied image satisfies this requirement for that tool (Clarifications
  2026-09-23); immediate paste of the image bytes must still work either
  way.
- **FR-003**: History population MUST be part of the app's own copy flow and
  MUST NOT require the user to configure desktop-specific clipboard watchers,
  autostart items, or other per-machine setup.
- **FR-004**: The history step MUST be best-effort: it MUST NOT block, delay
  perceptibly, or fail the copy/paste operation if the history manager is
  missing, slow, or returns an error.
- **FR-005**: On systems with no clipboard history manager (or with history
  disabled), copy and paste MUST behave exactly as they do today, and the
  system MUST NOT show an error caused by the absent history manager.
- **FR-006**: Every existing in-app image-copy entry point (viewer copy,
  gallery/grid copy, and any other path that puts an image on the clipboard)
  MUST use the same history-aware behavior.
- **FR-007**: Text/URL copy actions from the app MUST also become visible in
  clipboard history under the same conditions as FR-002, without changing
  their current paste behavior.
- **FR-008**: On Linux desktop, when a clipboard history tool is detected as
  currently running on that machine, the solution MUST make in-app image
  copies visible and re-selectable in that tool's history UI (FR-002)
  without per-machine manual setup. The guarantee is against the running tool
  on that machine—not a fixed allow-list and not tools that are not running.
  If no history tool is detected, behavior falls back to FR-005. On other
  desktop platforms the app supports, history population MUST be best-effort
  with no setup requirement; Docker/headless has no clipboard history and is
  out of scope.
- **FR-009**: The feature MUST NOT require network access, elevated
  privileges, or changes to files outside the app's normal runtime scope.
- **FR-010**: Failure or absence of clipboard history MUST NOT be logged as
  an application error to the user or treated as a download/copy failure.

### Key Entities

- **Clipboard Copy Action**: A user-initiated action that places image bytes
  or text onto the system clipboard. Produces one pasteable clipboard content
  and, when possible, one clipboard-history entry.
- **Clipboard History Entry**: A recent-copy record maintained by the user's
  desktop or a third-party history tool, allowing the user to re-select and
  re- paste a prior copy. Owned by the environment, not by the app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On Linux desktop with a clipboard history tool detected as
  running, 100% of in-app image copies are visible in that tool's history UI
  as a re-selectable entry (full image when the tool supports image display;
  otherwise a text placeholder linking to the image) within 2 seconds of the
  copy action.
- **SC-002**: After any in-app image copy, immediate paste into another
  application succeeds in 100% of attempts (zero paste regressions).
- **SC-003**: On systems with no clipboard history manager, in-app image
  copy + paste succeeds in 100% of attempts with zero user-visible errors.
- **SC-004**: The copy action's visible feedback is not delayed by more than
  1 second versus current behavior when history is available.
- **SC-005**: A new user on a fresh Linux desktop install can copy an image
  from the app and find it in clipboard history with zero configuration
  steps. Other desktop platforms: same attempt must not error; visibility is
  best-effort (FR-008).
- **SC-006**: All documented in-app image-copy entry points exhibit the same
  history behavior (no path left behind).

## Assumptions

- The app can already place image bytes on the system clipboard; the user
  confirmed paste works. This feature only adds reliable history visibility.
- "Clipboard history" means whatever history mechanism the user's desktop or
  third-party tool provides; the app detects and uses what is available
  rather than shipping its own history UI.
- "Works for everyone" means: on Linux, the history tool currently running on
  that machine must show and allow re-selecting in-app image copies with no
  per-machine setup (Clarifications 2026-09-23); other desktop platforms are
  best-effort with the same zero-setup rule; Docker/headless is out of scope
  (no clipboard).
- History population is best-effort (FR-004); environments that cannot accept
  history entries degrade to today's paste-only behavior (FR-005).
- URL/text copies share the same mechanism (FR-007); their primary contract
  (immediate paste) is unchanged.
- Done for an image copy requires the user to see and re-select it in their
  history UI (Clarifications 2026-09-23), not merely a silent accept by the
  manager; the app must cooperate so popular history UIs actually display the
  entry. On Linux the guarantee targets the history tool currently running on
  that machine; if that tool is text-only, a linking text placeholder is
  sufficient.
- Out of scope: building an in-app clipboard-history viewer, replacing the
  user's history tool, patching/modifying third-party history tools
  themselves, starting or managing history daemons for copies made by *other*
  applications, and Windows/macOS-specific history features beyond what the
  OS already exposes to normal copy operations.
