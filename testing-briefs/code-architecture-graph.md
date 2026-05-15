# Testing Brief: Code Architecture Graph (`PARSED_CODE` mode)
Date: 2026-05-15
Status: Pre-implementation

## Summary
A new `contentToSend` value, `PARSED_CODE`, walks the active file (or folder) via VS Code's language-server symbol providers, emits `source target` edge lines, and posts them to `/graphAndStatements` with `language: "ZZ"` and `partOfSpeechToProcess: "HASHTAGS_AND_WORDS"`. Clicking a node navigates to the symbol's definition through a per-graph symbol table held on `InfraNodusViewProvider`. Three things are new and load-bearing: a hard dependency on an LSP being installed and responsive, a request body shape never sent before, and a click-handler branch that diverges from the existing find-in-files path.

## Risk Map (highest first)

### R1 — LSP unavailable, slow, or returning partial results
- **Scenario**: `executeDocumentSymbolProvider` returns `[]` or `undefined` on a `.go` / `.rs` / `.py` file whose language server hasn't activated yet (cold start), isn't installed, or has crashed. Builder produces an empty/short edge list; InfraNodus returns either an error ("text too short") or a near-empty graph the user can't distinguish from a real one.
- **Likelihood**: high — LSP cold-start is normal on first open.
- **Impact**: silently wrong graph; clicking nodes does nothing because the symbol table is empty.
- **Suggestion**: detect zero symbols *before* the POST and surface a distinct UI message ("No symbols found — is the language server active?").

### R2 — `executeReferenceProvider` performance / hang
- **Scenario**: folder scope, ~500 symbols × N callsites; the per-symbol reference query serializes and stalls. The webview already shows "loading"; user can't tell if it's hung.
- **Likelihood**: medium-high on real projects.
- **Impact**: extension UI appears frozen; user reloads or kills VS Code; symbol-count cap from the plan is the only defence and may not be enough.
- **Suggestion**: per-call timeout + cancellation token tied to a new `processDocument` invocation.

### R3 — Symbol-table key collisions
- **Scenario**: two symbols share a lowercased name (`User` class + `user` exported var, or same name in two files). The table is a flat `Map<string, SymbolRecord>` so the second one overwrites the first. Click sends the user to the wrong definition.
- **Likelihood**: medium; near-certain in folder scope.
- **Impact**: navigation lies. Worse than not navigating at all.

### R4 — `_currentMode` flip-back staleness
- **Scenario**: user runs `PARSED_CODE`, the click handler stores `_currentMode="code"` and a symbol table. User switches `contentToSend` back to `PARSED_TEXT_ONLY` and re-analyzes a markdown file. If `processDocument` doesn't reset `_currentMode` *before* the new graph renders, a click event arriving on the old graph (or out-of-order) still hits the symbol-table branch.
- **Likelihood**: medium — switching modes mid-session is a power-user pattern.
- **Impact**: clicks on text-mode nodes try to navigate to stale symbol locations; falls through to find-in-files only if the lookup misses.
- **Suggestion**: clear both fields at the top of `processDocument`, not at the bottom.

### R5 — InfraNodus response under the new request body
- **Scenario**: `language: "ZZ"` + empty stopwords + edge-list input is a combination the server has never seen from this client. Risks: server lemmatizes/lowercases anyway; node names returned don't match the symbol-table keys; line-order direction not honoured; very short bodies (<3 lines) rejected.
- **Likelihood**: medium — this is exactly what the case-preservation spike is meant to catch, but the spike won't cover the short-input and direction cases.
- **Impact**: graph renders, click does nothing because lowercased-token lookup misses.

### R6 — Click handler regression for text mode
- **Scenario**: new mode-aware branch is inserted *ahead* of the existing wikilink-unwrap / find-in-files logic at `extension.ts:541-607`. A bug in the gating condition (e.g. defaulting `_currentMode` to `"code"` on a fresh provider before any analysis runs) silently breaks the existing search flow.
- **Likelihood**: low if `_currentMode` defaults to `"text"`, but the failure is invisible — text-mode users see find-in-files do nothing.

### R7 — Folder scope mixed languages
- **Scenario**: folder has `.ts`, `.py`, `.md`. Plan dispatches `PARSED_CODE` for everything, but `.md` has no useful symbols and the workspace symbol provider returns Markdown headings as `String` kind. These leak into the edge list as bare words.
- **Likelihood**: high in real repos.
- **Impact**: noisy graph; symbols collide with English words (R3).

## Edge Cases

**State / mode conflicts**
- Switch `PARSED_CODE` → `PARSED_TEXT_ONLY` → click a graph node before the new graph finishes loading.
- Run `PARSED_CODE` on file A, then activate editor on file B (different language) before reload completes.
- Trigger folder-scope `visualizeAsGraph` while a single-file `PARSED_CODE` analysis is still in flight.

**Timing / async**
- Cold LSP: open VS Code, immediately run `PARSED_CODE` on a `.py` file before Pylance activates.
- Rapid-fire reload while reference resolution is mid-flight.
- Dirty (unsaved) editor — does `executeDocumentSymbolProvider` reflect unsaved edits, and do ranges remain valid after the user types more?

**Data extremes**
- 5000-line file with one giant class.
- File with one function, no references → empty edge list.
- File where every symbol is named with a common English word (`get`, `set`, `data`, `index`) — InfraNodus stopword/lemmatization spike must confirm these survive with `language: "ZZ"`.
- Symbol names that are single characters (`x`, `i`, `_`).
- Symbol names containing Unicode (`café`, CJK).
- File outside any workspace folder (scratch file, untitled buffer).
- File whose definition resolves into `node_modules` or `.d.ts` — does the click open the right thing, or jump into a vendored file the user doesn't want to edit?
- Generated code (e.g. `*.g.ts`) where ranges may be stale or sourcemapped.
- Recursive function (`foo` calls `foo`) — self-edge: does InfraNodus accept it, dedupe it, or drop the line?
- Two symbols with the same name in different files (folder scope, R3).

**Cross-flow interference**
- After `PARSED_CODE`, "Find in Files" via the existing search-bubble path on a text-mode graph still works.
- AI chat / "develop" / "context" actions: confirm they still receive the original *code* text in the clipboard provider, not the edge-list string (which is what `updateCurrentContent` would store if naively reused — see `extension.ts:1469` and `:1481`).
- Diff-as-graph path is untouched.

## Happy-path verification points (TS file → `PARSED_CODE` → click → land at definition)
1. Setting change actually fires a re-analysis (or requires manual reload).
2. `executeDocumentSymbolProvider` returns non-empty within a reasonable budget.
3. Edge-list string has at least one `source target` line; no empty/whitespace-only lines.
4. POST body matches the spec exactly (`stopwords: []`, `language: "ZZ"`); response status 200; `graphologyGraph.attributes.dotGraph` present.
5. Graph iframe renders with node labels recognisably matching symbol names (case-preservation spike outcome).
6. Symbol table on the provider has an entry for every node label rendered.
7. Click event fires `processExternalAction` with `type=click`; lowercased last token resolves to a `SymbolRecord`.
8. `openTextDocument` + `showTextDocument` + `revealRange` lands the cursor inside the symbol's `selectionRange`, not just the file.
9. After navigation, clicking another node still works (symbol table not cleared mid-session).

## Testable now vs. genuinely needs manual UI testing

**Unit / integration testable (no editor instance, no iframe)**
- `_buildCodeArchitectureEdges` pure logic: given a mocked `DocumentSymbol[]` and a mocked reference-provider result, returns the expected deduped edge-line array and a symbol table with correct casing keys.
- Edge-direction ordering (`caller callee`, `parent child`).
- Dispatch in `_processTextForAnalysis` / `processDocument` selects the right branch by setting value.
- `_currentMode` reset semantics.
- Symbol-table collision behaviour (whatever the chosen policy is, lock it down).
- Request body shape diff vs. text mode (snapshot test on the axios payload).

**Integration testable against a real VS Code instance (extension-test runner)**
- `executeDocumentSymbolProvider` returns expected symbols for fixture files with TS server active.
- Click handler navigates: assert active editor URI + selection after dispatching a synthetic `processExternalAction` message.
- No-LSP case: open a fixture with an extension VS Code has no provider for and confirm the graceful-failure message.

**Genuinely manual (cannot be automated against the live iframe at graph.infranodus.com)**
- Whether node labels visually preserve casing in the rendered graph (case-preservation spike → if labels need injection via `SET_SYMBOL_LABELS`, the substitution itself is observable only by eye).
- Whether the loading overlay clears at the right moment in `PARSED_CODE` mode.
- Whether the graph layout is *useful* (visual signal) on real codebases vs. theoretically correct.
- AI-chat-from-graph flows that round-trip through the iframe — type-check passes prove nothing about the rendered iframe behaviour.
- Cross-theme rendering (light/dark) of the new graphs.

## Test fixtures worth preparing
Keep these in a `fixtures/code-graph/` folder (not for shipping, just regression checking):
- `small.ts` — 3 functions, one calls the other two; one class with two methods. Baseline happy path.
- `small.js` — same shape as `small.ts` but plain JS; confirms JS LSP path.
- `small.py` — same shape; confirms a non-TS LSP works.
- `collisions.ts` — symbols named `data`, `get`, `index`, `x`; symbols with identical lowercased names across two files.
- `recursive.ts` — function calling itself; two functions calling each other.
- `huge.ts` — generated/long file (5000+ lines, 200+ symbols) to exercise the cap and timeout.
- `no-lsp.fixture` — file with an extension no installed LSP claims (e.g. `.xyz`). Asserts graceful failure.
- `dirty-buffer scenario` — manual: open `small.ts`, type new function, do NOT save, run `PARSED_CODE`. Documents observed behavior.
- `outside-workspace.ts` — open as an untitled or detached file.
- `mixed-folder/` — `a.ts`, `b.py`, `c.md` together for folder-scope mixed-language run.
- A `.d.ts`-only fixture (symbol resolves into a type-declaration file) to exercise the `node_modules`-like navigation case without requiring `node_modules`.

## Open Questions
- When `contentToSend` changes in settings, does the extension re-analyse automatically or does the user need to reload? (Affects mode-flip risk R4.)
- What does `executeDocumentSymbolProvider` return for a dirty buffer — pre-edit or post-edit symbol ranges? (Affects R-edge-cases / dirty-buffer.)
- Does `language: "ZZ"` actually disable casing normalization on the server, or only lemmatization? (The spike is listed in the plan; brief assumes spike happens first.)
- For folder scope with 500+ symbols, is the cap a hard skip or a sample? The plan says "cap and short-circuit" but not what the user sees.
- Is `_currentMode` set per-graph or per-provider? If the provider is shared across multiple views (it isn't today, but worth confirming), one mode could leak into another graph's clicks.
- Does the clipboard provider's `updateCurrentContent` need to keep the *original source code* (so AI/chat works) while the request sends the *edge list*? The current code at `extension.ts:1469` and `:1481` calls `updateCurrentContent` with both `text` and `textToProcess` — which wins in code mode matters.

## Knowledge File Updates
None this pass — feature is pre-implementation and the risks above haven't yet been verified against runtime behaviour. Re-evaluate after the case-preservation spike and the first end-to-end run; LSP-availability and symbol-table-collision findings are good candidates for a future `testing-knowledge/code-graph.md`.
