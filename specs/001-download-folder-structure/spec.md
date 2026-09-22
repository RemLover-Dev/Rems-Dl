# Feature Specification: Download Folder Structure

**Feature Branch**: `001-download-folder-structure`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "i want you to mak ethe folder structure clean and use able even whit our multi tag search future i also plan on adding a multi rating search feauture"

## Clarifications

### Session 2026-09-22

- Q: When a multi-tag search combines several tags, should the folder name list the tags in the order the user typed them, or in sorted order? → A: Sorted order (one canonical folder per tag set).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean predictable folders for today's downloads (Priority: P1)

A user downloads images for a single tag with a single rating filter and finds
every file in one predictable place: one site folder, one tag folder, one
rating subfolder, with images directly inside (no stray nesting, no mixed
schemes between sites).

**Why this priority**: This is the daily experience for all 18+ sources. A
uniform layout makes the downloads browsable in any file manager and keeps the
Gallery tab simple. It delivers value with zero dependency on future search
features.

**Independent Test**: Download the same tag from three different sites and
confirm each lands in an identical depth/shape (`<site>/<tag>/<Rating>/` with
files directly inside) and that re-running the download adds no duplicates.

**Acceptance Scenarios**:

1. **Given** a finished single-tag download, **When** the user opens the site
   folder in a file manager, **Then** every image for that tag and rating is
   directly inside one folder with no empty or duplicate sibling folders.
2. **Given** downloads from two different sites for the same tag, **When** the
   user compares their folder shapes, **Then** both follow the same
   site/tag/rating depth convention.
3. **Given** a completed download, **When** the user re-runs the exact same
   search, **Then** no duplicate files appear and no new folders are created.

---

### User Story 2 - Folder layout that survives multi-tag search (Priority: P2)

A user runs a future multi-tag search (e.g. two characters together) and gets
one dedicated folder whose name reflects the full tag combination, so combined
searches never pollute single-tag folders and old single-tag folders keep
working unchanged.

**Why this priority**: Multi-tag search is planned but not built. Reserving the
naming rule now prevents a painful reorganization or filename collision later.

**Independent Test**: Simulate a two-tag query name under the naming rule and
confirm it maps to exactly one folder that cannot collide with either
single-tag folder.

**Acceptance Scenarios**:

1. **Given** the naming rule, **When** a user searches tags `A` and `B`
   together, **Then** results land in one combined folder distinct from the `A`
   folder and the `B` folder.
2. **Given** existing single-tag folders, **When** multi-tag search ships,
   **Then** no existing folder needs renaming or moving.

---

### User Story 3 - Folder layout that survives multi-rating search (Priority: P3)

A user runs a future multi-rating search (e.g. Safe + Sensitive together) and
can still tell ratings apart on disk: either one folder per selected rating or
one combined folder with the rating visible per file grouping, without mixing
ratings silently into a single flat pile.

**Why this priority**: Ratings drive the Gallery filters and the unified
`rating:g/s/q/e` tag system. Losing rating separation on disk would break
filtering trust.

**Independent Test**: Simulate a two-rating query and confirm each downloaded
file's rating is still determinable from its location without opening the file.

**Acceptance Scenarios**:

1. **Given** a multi-rating search over ratings `X` and `Y`, **When** the
   download finishes, **Then** files of rating `X` are separated from files of
   rating `Y` by folder (per-rating subfolders or equivalent grouping).
2. **Given** a single-rating search, **When** it runs after multi-rating
   support ships, **Then** its folder shape is unchanged from today.

---

### Edge Cases

- What happens when a tag contains characters illegal in file names (spaces,
  slashes, unicode)? The folder name uses the already-established sanitized
  tag form and never creates nested paths by accident.
- How does the layout handle a search with no rating filter? Files group under
  one folder per discovered rating, never silently mixed.
- What happens when two different tag combinations sanitize to the same folder
  name? Tags are sorted before joining, so `A+B` and `B+A` map to one
  canonical folder; exact-duplicate queries reuse the folder.
- How do special roots (Pixiv `ranking/`, `Artists/`, category-based sources
  like Nekos.best `Gifs`/`Images`) fit? They keep their special root but adopt
  the same tag/rating depth below it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Download locations MUST follow one uniform depth convention:
  site root / query folder / rating folder, with media files directly inside
  the rating folder (no extra `images/` nesting level, no per-site variants).
- **FR-002**: Query folder names MUST derive deterministically from the search
  tags: a single tag maps to its sanitized form; a multi-tag query maps to the
  sanitized tags sorted alphabetically and joined with a fixed separator.
- **FR-003**: Rating folder names MUST use the existing per-source rating
  labels (e.g. Safe/Sensitive/Questionable/NSFW or Safe/NSFW where the source
  only supports those) so Gallery filters and folder names stay consistent.
- **FR-004**: An unfiltered-rating search MUST separate discovered ratings
  into one folder per rating rather than mixing them.
- **FR-005**: A multi-rating search MUST keep each selected rating in its own
  rating folder under the same query folder.
- **FR-006**: Re-running any identical search MUST be idempotent: no duplicate
  files and no new folders (dedup by filename/history/content identity,
  consistent with the constitution's Deduplication principle).
- **FR-007**: Special roots that exist today (Pixiv `ranking/`, `Artists/`,
  category-based `Gifs`/`Images` splits) MUST be preserved as roots while
  adopting the uniform query/rating depth below them.
- **FR-008**: Every stored file's gallery record MUST capture the query tags and
  rating so the Gallery can filter without parsing folder names.

### Key Entities

- **Query Folder**: Represents one search (single tag today, tag combination
  in future). Attributes: sanitized folder name, source site, sorted tag list.
- **Rating Folder**: Represents one content rating within a query folder.
  Attributes: rating label, rating code (`g/s/q/e` where applicable).
- **Stored Item**: Represents one downloaded file plus its gallery record.
  Attributes: file, recorded tags, recorded rating, source URL.

### Assumptions

- Single-tag + single-rating search is the current behavior being cleaned up;
  multi-tag and multi-rating search do not exist yet and are future consumers
  of this layout, not part of this feature's build.
- The sanitized-tag helper already in use (`safe_tag`) remains the
  sanitization basis; this spec only standardizes how it composes, not how it
  sanitizes individual tags.
- The `+` character joins multi-tag folder names in sorted order (matches
  common booru query syntax and cannot collide with sanitized single tags,
  which never contain `+`).
- Highest-resolution file fetching, dedup, and tag/rating recording
  (constitution principles I, III, IV) are unchanged; only folder placement is
  standardized. No sidecar files (constitution v1.2.0).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can locate any downloaded image in under 30 seconds by
  browsing site / tag / rating folders in a plain file manager.
- **SC-002**: Three downloads of the same tag from three different sources
  all show the identical folder depth and shape.
- **SC-003**: Re-running any completed search adds zero duplicate files and
  zero new folders.
- **SC-004**: A simulated two-tag query name and a simulated two-rating query
  both resolve to folders that keep single-tag and single-rating layouts
  untouched and ratings separable without opening files.
