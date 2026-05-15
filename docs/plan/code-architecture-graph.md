# Plan: Code Architecture Graph View

## Goal

Add a mode where the extension renders a **structural reference graph** of the active file (or selected folder): nodes are functions, classes, methods, and exported variables; edges are references / contains / imports. Clicking a node in the existing graph webview jumps the editor to the symbol's definition. The existing "search" directive operates over symbol names rather than free text.

The graph is **undirected**. The underlying InfraNodus pipeline is a co-occurrence graph and the rendered iframe does not surface arrow directionality; v1 ships without direction in any user-facing copy or layout.

This is a **reference graph**, not a true call graph — `executeReferenceProvider` returns every textual reference (calls, type annotations, JSDoc, re-exports, etc.). A real call graph (TS Compiler API) is deferred to a later version.

## Why this fits the current architecture

Three pieces already do most of the work:

1. The InfraNodus `/graphAndStatements` endpoint treats each line as one statement, and tokens that co-occur on a line become connected nodes (`src/extension.ts:1415-1442`). We don't need a different endpoint — we feed one edge per line.
2. The "click" and "search" events from the graph already bubble back into the extension (`src/extension.ts:541-607`) and trigger find-in-files. We branch this handler so that, in code mode, the token is looked up in a symbol table and we jump to the symbol's `Location` instead.
3. The `contentToSend` setting (`src/extension.ts:430-433`, `package.json:155-167`) already gates *what* gets sent to InfraNodus. We add a third option for code-graph mode and re-use the same plumbing.

## Encoding

Send symbols as plain tokens. With

```json
"contextSettings": {
  "partOfSpeechToProcess": "HASHTAGS_AND_WORDS",
  "language": "ZZ"
}
```

lemmatization is disabled (`ZZ`) and a line containing only symbol names produces a clean edge between them, with no stopword removal stripping single-character names and no lemmatization mangling `users → user`. No `[[wikilinks]]` are needed. Stopwords are explicitly emptied (`stopwords: []`) so symbol names that collide with English words (`count`, `data`, `name`) survive.

### Casing and case-collisions (load-bearing)

InfraNodus normalizes display strings to lowercase. We accept lowercase display in v1: the graph iframe is rendered by `graph.infranodus.com` and the host extension has no label-override channel into that iframe (verified in `src/webview.html:1480-1545` — the only messages crossing the boundary are `LOAD_JSON`, `READY`, `PROCESSING_*`, and external-action events). The symbol table is used **only for click → navigate**, not for display.

The symbol table is keyed by `name.toLowerCase()`, which means **two distinct symbols with the same lowercased name will silently collide** (`class User` + `var user`; or two methods named `render` on different classes; or symbols sharing a name across files in folder scope). This is a correctness issue, not a display issue.

**Collision handling at build time** (mandatory in v1):

1. When the builder produces a symbol, check whether its lowercased name is already in the table.
2. If yes, *both* symbols are renamed by appending a disambiguating suffix derived from the parent / file: `user` and `user_someclass`, or `render_userpanel` and `render_admincard`. The same suffix is applied to every edge line that mentions the symbol.
3. Log the collision to the InfraNodus Log webview so the user can see what happened.

This keeps navigation deterministic and prevents InfraNodus from merging the two into one visual node.

## New setting value: `PARSED_CODE`

Extend `infranodus-graph-view.contentToSend` (`package.json:155-167`) with a new value, ordered between the existing two:

| Value | Label | Behavior |
|---|---|---|
| `PARSED_TEXT_ONLY` (default) | "Parsed Text Only (comments, plain text, [[wikilinks]])" | Existing: `_extractParsedText` |
| `PARSED_CODE` (new) | "Parsed Code (architecture reference graph: functions, classes, variables)" | New: code-graph builder, described below |
| `FULL_FILE_CONTENTS` | "Full File Contents" | Existing: `_compressCodeBlocks` |

When `PARSED_CODE` is selected, the new builder runs. When it isn't selected, **all existing logic is untouched** — this is purely additive.

Note: `contentToSend` was originally a "which subset of text to send" axis; `PARSED_CODE` introduces a "different kind of graph" semantic onto the same setting. Accepted trade-off for v1 (minimum change). If users find the coupling confusing, v2 can split the axis or expose code-graph mode via a separate command (`InfraNodus: Show Architecture Graph`).

## How the code graph is built

Use VS Code's built-in symbol providers rather than per-language parsers:

- `vscode.executeDocumentSymbolProvider` → tree of `DocumentSymbol`s (functions, classes, methods, exported variables) for the active file. Produces nodes and `contains` edges.
- `vscode.executeReferenceProvider` per symbol → who references it. Produces `references` edges (not strict calls — see Goal section).
- `vscode.executeWorkspaceSymbolProvider` → folder scope only, scoped per-language (see below) to resolve cross-file references.

This means every language with a working LSP installed in the user's VS Code "just works" — TS/JS, Python, Go, Rust, Java, etc. No new parser dependency.

### Symbol kinds included by default

- Functions, methods, constructors
- Classes, interfaces, enums
- Exported variables / constants

Local variables and parameters are **excluded** (too noisy). No setting in v1.

### Cross-language safety (folder scope)

`executeWorkspaceSymbolProvider` aggregates results across every active language server and returns by name prefix, so a Python `User` will match a TypeScript `User`. Folder-scope cross-file resolution must filter results to those whose `Location.uri` resolves to a document with the **same `languageId`** as the originating symbol, via `vscode.workspace.openTextDocument(uri).languageId`.

### Shallow / nested symbol trees

Some language extensions return flat `DocumentSymbol[]` (no `children` populated). The "enclosing symbol" lookup must therefore be a **range-containment scan** over the full symbol list (find the symbol whose `range` strictly contains the reference site), not a tree-children walk. This works equally well on shallow and nested trees.

### Edge production

For each included symbol `S` in the file:

1. Emit a `contains` line from S's parent (class / file / namespace) to S — when a parent exists in the symbol set.
2. For each reference to S found by `executeReferenceProvider`, locate the enclosing symbol `R` via range-containment scan. Emit `R S` (order arbitrary; graph is undirected).
3. For imports, emit `currentFile importedSymbol`.

Each edge is one line. Edges are deduplicated.

### Caps

- **Symbols per build**: 500 (folder scope). Exceeded → short-circuit with a warning.
- **Edges per build**: 5,000 (folder scope). Exceeded → truncate and warn. Avoids a multi-hundred-KB POST body.
- Single-file scope is unconstrained for both.

### LSP readiness

`executeDocumentSymbolProvider` returns `undefined` or `[]` both when no LSP is installed *and* when the LSP is still indexing on a cold start. The builder must distinguish:

1. First attempt: call the provider. If non-empty, proceed.
2. If empty: wait 500ms, retry once.
3. If still empty: surface a clear message — "No symbols found. The language server may not be installed or indexing for this file type." Do **not** send an empty edge list to InfraNodus.

## Symbol table

Maintained on the provider for the duration of the current graph:

```ts
type SymbolRecord = {
  canonicalName: string;           // original case, post-collision-suffix
  kind: vscode.SymbolKind;
  uri: vscode.Uri;
  range: vscode.Range;             // selectionRange preferred
};
type SymbolTable = Map<string, SymbolRecord>;  // key = canonicalName.toLowerCase()
```

Stored on the `InfraNodusViewProvider` instance. Replaced atomically when a new code graph is built.

## Click → navigate

Branch added to the existing `processExternalAction` handler (`src/extension.ts:541-607`) ahead of the wikilink-unwrap logic:

```ts
if (this._currentMode === "code") {
  const lastToken = tokens[tokens.length - 1]?.toLowerCase();
  const symbol = this._symbolTable.get(lastToken);
  if (symbol) {
    const doc = await vscode.workspace.openTextDocument(symbol.uri);
    const editor = await vscode.window.showTextDocument(doc);
    editor.revealRange(symbol.range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(symbol.range.start, symbol.range.start);
    return;
  }
  // fall through to find-in-files if not resolvable
}
```

For multi-node `search` events: run find-in-files restricted to the symbol names via the existing infrastructure.

### Mode lifecycle

`this._currentMode` (`"text" | "code"`) is **reset at the top of `processDocument`** based on the active `contentToSend` setting, *before* the network call. This ensures an in-flight click that arrives between two `processDocument` invocations hits the branch matching the graph the user is currently looking at. The symbol table is similarly cleared at the same point.

## InfraNodus request body (code mode)

```ts
{
  name: fileName,
  text: edgeLinesJoinedByNewline,           // "parseDocument extractText\n..."
  aiTopics: true,
  stopwords: [],
  contextSettings: {
    partOfSpeechToProcess: "HASHTAGS_AND_WORDS",
    language: "ZZ",
    doubleSquarebracketsProcessing: "PROCESS_AS_HASHTAGS",
    mentionsProcessing: "CONNECT_TO_ALL_CONCEPTS",
  },
}
```

Endpoint unchanged: `${serverUrl}/api/v1/graphAndStatements?donotsave=true&addStats=true&dotGraph=true&optimize=develop`.

### Clipboard content (load-bearing)

`processDocument` currently calls `_clipboardProvider.updateCurrentContent(text)` at `src/extension.ts:1469` and then `updateCurrentContent(textToProcess)` at `:1481`. In `PARSED_CODE` mode, `textToProcess` is the edge-list string (`"a b\nb c\n..."`), which is meaningless as context for the AI-chat-from-graph features. The fix: **in code mode, always pass the original source text** to `updateCurrentContent`, never the edge serialization. The AI prompts should see code, not edge lines.

## Sync → async refactor

The current `_processTextForAnalysis` (`src/extension.ts:1923`) is sync; the code-graph builder is async (LSP calls). Three call sites need a consistent path:

- `processDocument` (`src/extension.ts:1404`)
- `processContent` (`src/extension.ts:1603`)
- `processFolderContent` (`src/extension.ts:1564`) — and the diff path that also flows through `_processTextForAnalysis`

Introduce one async helper:

```ts
private async resolveSendableText(
  doc: vscode.TextDocument | undefined,
  rawText: string,
  fileName: string,
): Promise<{
  text: string;
  contextSettingsOverride?: Partial<ContextSettings>;
  stopwordsOverride?: string[];
  symbolTable?: SymbolTable;
}>
```

All three sites call this and propagate the optional overrides into the request body. The sync `_processTextForAnalysis` becomes one branch inside this helper. The diff path opts out (no symbol providers on a diff string) — diffs always use the existing text path regardless of `contentToSend`.

## Scope

- **File scope**: the active editor's document.
- **Folder scope**: triggered from the explorer context menu (existing `visualizeAsGraph` path). `processFolderContent` (`src/extension.ts:1564`) iterates files; for `PARSED_CODE` it accumulates symbols across files and resolves cross-file references via the language-scoped `executeWorkspaceSymbolProvider` described above.

No workspace-wide scope. Matches current behavior.

## Concrete change list

| File | Change |
|---|---|
| `package.json` | Extend `infranodus-graph-view.contentToSend` enum with `PARSED_CODE` and add its `enumItemLabels` entry. Order: `PARSED_TEXT_ONLY`, `PARSED_CODE`, `FULL_FILE_CONTENTS`. |
| `src/extension.ts` (new section) | `CodeGraphBuilder` module: `buildForDocument(doc): Promise<BuildResult>` and `buildForFolder(uri): Promise<BuildResult>` where `BuildResult = { edges: string[]; symbolTable: SymbolTable; warnings: string[] }`. Implements LSP readiness retry, collision suffixing, range-containment enclosing-symbol lookup, language-scoped workspace symbol resolution, symbol/edge caps. |
| `src/extension.ts` | New private async `resolveSendableText` helper called from all three call sites (`processDocument`, `processContent`, `processFolderContent`). The diff path explicitly opts out. |
| `src/extension.ts` (`processDocument`, line 1390) | At top of method: reset `this._currentMode` from `getContentToSend()`, clear `this._symbolTable`. Use `resolveSendableText` to get `{ text, contextSettingsOverride, stopwordsOverride, symbolTable }`. Merge overrides into the request body. Always pass the **original source** to `_clipboardProvider.updateCurrentContent`, not the edge text. |
| `src/extension.ts` (`processExternalAction` handler, ~line 566) | Add mode-aware branch ahead of the existing token-search path: in code mode, resolve token via symbol table and navigate; fall through to find-in-files if not resolvable. |
| `src/extension.ts` (`InfraNodusViewProvider` class fields, ~line 408) | Add `_symbolTable: SymbolTable` (default empty Map) and `_currentMode: "text" \| "code"` (default `"text"`). |

Everything else — the iframe, the clipboard view, the AI prompts, the existing text path — is untouched. No `webview.html` changes.

## Pre-coding spikes (in order)

1. **Pathological-input round-trip** (must pass before any builder code is written). POST an edge list with `__init__`, `user.profile`, `count`, `data`, and `User`/`user` collision pair. Inspect the returned `graph.nodes`:
   - Does InfraNodus split on `_` / `.` (mangling `__init__` and `user.profile`)?
   - Are single-letter / short tokens preserved with `stopwords: []` and `language: "ZZ"`?
   - Does the `User`/`user` pair come back as one node (confirming the collision-suffix strategy is mandatory) or two (confirming our assumption is wrong)?
   Decisions on tokenization and collision handling depend on this.
2. **LSP coverage spike**: open a TS file, a Python file, and a Go file (or whichever three the developer has locally) and call `executeDocumentSymbolProvider` against each. Confirm the default kind filter (Function, Method, Constructor, Class, Interface, Enum, Variable-if-Exported) is sensible per language. Also test the cold-start race: open a fresh window, call the provider immediately, confirm whether the 500ms retry catches it.
3. **Folder-scope performance**: pick a medium folder (~50 files), run the builder, measure. Confirm the 500-symbol / 5,000-edge caps are appropriate; tune if needed.
4. **Reference vs. call breadth**: on a small TS file, dump the raw `executeReferenceProvider` output for one function and count how many references are calls vs. annotations vs. imports. Sets expectations for users about what the graph "means."

## Testing

See `testing-briefs/code-architecture-graph.md` for the full brief. Highlights:

- **Automatable in extension-host tests**: dispatch via `_currentMode`, edge-list construction, symbol-table key behavior + collision suffixing, request body shape, click→navigate handler branch (`processExternalAction`).
- **Requires manual UI**: casing in the rendered iframe (out of our control), layout usefulness on real codebases, AI-chat round-trips after a code-mode graph.
- **Critical regression checks**: text-mode behavior must be byte-identical when `contentToSend !== "PARSED_CODE"`; diffs always use the text path regardless of setting.
- **Fixtures to keep**: small TS, Python, and "no-LSP" sample files for repeatable manual smoke tests; one file exercising `User`/`user` collision and one with shallow-symbol-tree LSP output.

## Rollout

- **v1** (~1 day): file-scope, DocumentSymbol + references, functions/classes/exported vars, collision suffixing, LSP-readiness retry, click→navigate, source-not-edges to clipboard, `PARSED_CODE` setting wired up, undirected display.
- **v2** (~1 day): folder scope with language-scoped `executeWorkspaceSymbolProvider`, symbol/edge caps, graceful no-LSP failure with clear user messaging.
- **v3** (later, if requested): TS-specific real call graph via the TypeScript Compiler API (already shipped with VS Code). Consider splitting `contentToSend` into orthogonal axes (mode × text-subset) if the coupling proves confusing.

The change is additive — when `contentToSend` is not `PARSED_CODE`, behavior is byte-identical to today.
