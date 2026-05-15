# Changelog

All notable changes to the **InfraNodus Graph View** extension are documented here.

## 0.8.1

### Added

- **Export button on the AI advice panel.** A new Export action sits next to Copy in the AI prompt / response panel. Click it to send the currently visible AI prompt or response to InfraNodus as its own graph.
  - **Selection-aware**: if you have text selected inside the panel, only the selection is exported. Otherwise, the full visible content (prompt or response) is sent.
  - **Reuses the existing export-preview flow**: same modal as the main "Export Analyzed Content" button — editable graph name, editable text, Submit / Cancel.
  - **Auto-named graph**: `<analyzed-file>-ai-<kind-slug>`, derived from the panel badge. Examples: `extension.ts-ai-idea`, `README.md-ai-question`, `notes.md-ai-bridge-gap`.
  - **Empty-state guard**: clicking Export before any advice has loaded shows a quick "Nothing to export yet" hint instead of opening an empty preview.

### Fixed

- **AUTO mode no longer warns "no code symbols found"** when opening a folder that contains only prose files (e.g. all `.md`). The warning was correct under explicit `PARSED_CODE` but spurious under `AUTO`, where falling back to text mode is by design. The same silencing applies to file scope: AUTO opening a code-extension file whose language server isn't available now falls back silently. The warning still appears when the user explicitly selected `PARSED_CODE` and got no symbols back.

## 0.8.0

### Added

- **Code Architecture Graph mode.** A new `PARSED_CODE` value for `contentToSend` builds a knowledge graph from the active file's (or folder's) code structure: nodes are functions, classes, methods, and exported variables; edges are containment and references. **Clicking a node in the graph jumps the editor to that symbol's definition.** Works for every language with a VS Code language server installed (TS/JS, Python, Go, Rust, Java, etc.).
- **Auto content mode** (new default for `contentToSend`). `AUTO` picks per file: prose files (`.md`, `.txt`, `.rst`, …) use Parsed Text extraction; code files (`.ts`, `.py`, `.go`, …) use the new code-architecture graph; unknown extensions fall back to Parsed Text.
- **Settings page is now grouped into five labelled sections**: API Connection, Text & Code Analysis, AI Assistant, Appearance, and Advanced (Self-Hosting). Per-option help text was rewritten and `enumDescriptions` were added.
- **Symbol-name collision handling** for the code graph: when two distinct symbols share a lowercased name (e.g. `class User` and `var user`), the builder disambiguates them with a parent-derived suffix so navigation stays deterministic. Logged to the InfraNodus Log webview.
- **LSP cold-start retry**: the code-graph builder retries once after 500ms if the language server has not yet finished indexing the file.
- **Per-build caps for folder scope**: 500 symbols, 5,000 edges, 200 files. Single-file scope is unconstrained.

### Changed (behavior — affects users who never customized these)

- **`contentToSend` default changed from `PARSED_TEXT_ONLY` to `AUTO`.** Users who never set this explicitly will now see a code architecture graph when opening code files. To restore the previous behavior, set `infranodus-graph-view.contentToSend` to `PARSED_TEXT_ONLY` in your `settings.json`.
- **`partOfSpeechToProcess` default changed from `WORDS_IF_NO_HASHTAGS` to `HASHTAGS_AND_WORDS`.** Files with `[[wikilinks]]` or `#hashtags` will now include all meaningful words as graph nodes alongside the markup, rather than restricting to the markup. To restore previous behavior, set this setting to `WORDS_IF_NO_HASHTAGS`.
- Both changes are silent (no migration prompt). Users with explicit values in `settings.json` are not affected.

### Internal

- New `CodeGraphBuilder` module wraps VS Code's `executeDocumentSymbolProvider` / `executeReferenceProvider` / `executeWorkspaceSymbolProvider` with the retry, caps, and collision logic described above.
- Centralized request-body construction in `_buildRequestBody`; code mode now sends `partOfSpeechToProcess: "HASHTAGS_AND_WORDS"`, `language: "ZZ"` (no lemmatization), and `stopwords: []` regardless of user settings.
- `_currentMode` is reset at the top of `processDocument` and `processFolderContent` so in-flight click events always resolve against the visible graph.
- In code mode the original source text — not the edge-list serialization sent to the API — is what gets stored for AI-chat-from-graph features.

### Documentation

- Added `docs/plan/code-architecture-graph.md` covering the design rationale and known limitations.
- Added `testing-briefs/code-architecture-graph.md` covering the testing surface for the new mode.

---

## 0.7.x and earlier

Earlier versions are tracked via git history; no formal changelog was kept. Highlights:

- 0.7.2 — Better context retrieval and concept search.
- 0.7.1 — Correctly filter content depending on graph selections.
- 0.7.0 — Better processing of HTML content; better tag stripping.
