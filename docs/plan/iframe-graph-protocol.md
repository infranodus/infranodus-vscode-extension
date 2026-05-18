# Iframe Graph Protocol — `LOAD_JSON` vs `RECALCULATION`, Hidden Nodes, Stopwords

How the extension talks to the embedded `graph.infranodus.com` iframe so that interactive actions (deleting a node, hiding words, selecting topics) survive the round-trip through the InfraNodus API. Mirrors the patterns already in `infranodus-obsidian-plugin` and `infranodus-extension`; documented here because the contract is non-obvious and was wrong in earlier versions.

## The three layers

```
extension host (Node)  ←postMessage→  webview (browser)  ←postMessage→  iframe (graph.infranodus.com)
       extension.ts                       webview.html                      infranodus-graph
```

Every message that crosses one of these boundaries is logged with a prefix:
- `[InfraNodus][ext] …` — extension host side
- `[InfraNodus][webview] …` — webview side
- `[iframe]: …` — forwarded from the iframe (the webview injects a console wrapper on iframe `onload`)

To inspect: **Help → Toggle Developer Tools** (extension host) and **Command Palette → Developer: Open Webview Developer Tools** (webview + iframe).

## Iframe message types we use

The iframe (`infranodus-graph/src/api/extension.js:1-17`) defines the protocol. The ones that matter for this extension:

| Type | Direction | What it does |
|---|---|---|
| `READY` | iframe → host | iframe announces it can receive data |
| `LOAD_JSON` | host → iframe | **Full reset.** `loadJson()` at `ExtractedGraph.jsx:792` creates a new 3D graph object with `removedNodes: []`. Local hidden/selected state stops mattering. Use on the very first render of a graph. |
| `RECALCULATION` | host → iframe | **Preserves local state.** `onRecalculation` at `ExtractedGraph.jsx:491` calls `setRecalculatedGraphData(newGraphData)` through a separate state path. The iframe's `removedWords` / `selectedWords` / `groups` survive. Use for every update **after** the first. |
| `UPDATE_REMOVED_NODES` | iframe → host | User added or removed a node from the hidden set. Payload is the *complete* current list. |
| `UPDATE_SELECTED_NODES` | iframe → host | Click selection changed. |
| `UPDATE_GROUPS` | iframe → host | Topic-cluster selection changed. |
| `EXTERNAL_ACTION` | iframe → host | AI actions (`question`, `develop`, `summarize`, `chat`, …) triggered from the graph UI. |

**Sending `LOAD_JSON` when you should send `RECALCULATION` is the root cause of "I deleted a node and it came back."** The iframe redraws from scratch and the local hide is lost.

## How the InfraNodus API really wants `stopwords`

The `/api/v1/graphAndStatements` endpoint reads `stopwords` from inside `contextSettings`, not from the top level of the body:

```ts
{
  name,
  text,
  aiTopics: true,
  contextSettings: {
    partOfSpeechToProcess: "...",
    doubleSquarebracketsProcessing: "PROCESS_AS_HASHTAGS",
    mentionsProcessing: "CONNECT_TO_ALL_CONCEPTS",
    stopwords: ["const", "var", "let", "foo"],   // ← here
    lemmatizeHashtags: true,                      // ← set when stopwords are non-empty
  },
}
```

This matches `infranodus-obsidian-plugin/src/infranodus/index.ts:157-163` and `infranodus-extension/src/background/providers/infranodus.ts:164-165`. A top-level `body.stopwords` is silently ignored — this was the latent bug behind the `infranodus-graph-view.stopwords` user setting never appearing to do anything.

`_buildRequestBody` in `src/extension.ts` is the single place that constructs this body; both code-mode and text-mode branches must keep the nesting right.

## Hidden-nodes round trip

The end-to-end flow when a user deletes a node from the rendered graph:

```
1. iframe         → emits UPDATE_REMOVED_NODES { payload: ["foo"] }
2. webview.html   → forwards to extension as { command: "updateRemovedNodes", payload: ["foo"] }
3. extension.ts   → onDidReceiveMessage "updateRemovedNodes":
                        - dedupes payload, compares with this._wordsToHide
                        - if changed: this._wordsToHide = ["foo"]; await this.processDocument()
4. extension.ts   → POST /api/v1/graphAndStatements with
                        contextSettings.stopwords = [...configured, "foo"]
                        contextSettings.lemmatizeHashtags = true
5. extension.ts   → response arrives → topicsSubject.next(data)
6. extension.ts   → because this is a SUBSEQUENT update for this document
                    (this._initialLoadDoneForKey === this._lastProcessedKey),
                    posts { type: "RECALCULATION", payload: { entriesAndGraphOfContext } }
7. webview.html   → case "RECALCULATION": forwards { type: "RECALCULATION", payload } to iframe
                    (also stashes payload in vscode.state.graphData for restore)
8. iframe         → onRecalculation: swaps in new graph data via setRecalculatedGraphData
                    Local state (removedWords) untouched → "foo" stays hidden visually too.
```

The `RECALCULATION` step (#6/#7) is the critical fix. Sending `LOAD_JSON` there would reset the iframe and undo the deletion.

## Provider state that drives the protocol

Added on `InfraNodusViewProvider` in `src/extension.ts`:

| Field | Purpose |
|---|---|
| `_wordsToHide: string[]` | Current hidden-words set for the document being viewed. Sent as part of `contextSettings.stopwords` on every API call. Reset when the document key changes. |
| `_lastProcessedKey: string` | `doc:<uri>` or `content:<name>`. Lets us detect document switches so hidden-words and initial-load state are scoped per document, not leaked across files. |
| `_initialLoadDoneForKey: string \| null` | Tracks whether the iframe has already received its first `LOAD_JSON` for `_lastProcessedKey`. Drives the `LOAD_JSON` vs `RECALCULATION` branch in the `topicsSubject` subscriber. Reset to `null` whenever the key changes. |

Both `processDocument` and `processContent` perform the key-change reset block:

```ts
const docKey = `doc:${documentToProcess.uri.toString()}`;
if (docKey !== this._lastProcessedKey) {
    this._wordsToHide = [];
    this._lastProcessedKey = docKey;
    this._initialLoadDoneForKey = null;
}
```

After this point the request body is built with the current `_wordsToHide`, and the `topicsSubject.next` callback chooses the right outgoing message type.

## Reference points in the sibling implementations

- **Obsidian plugin** — `infranodus-obsidian-plugin/src/graph_view/GraphView.tsx`
  - `692-707` — receives `UPDATE_REMOVED_NODES`, calls `setWordsToHide`
  - `316-579` — fetch `useEffect` with `[wordsToHide]` dependency, calls `getGraphAndStatements({ stopwords: wordsToHide, … })`
  - `474-538` — `if (!loadedIframeRef.current)` branch sends `LOAD_JSON` (+ replays `REMOVED_NODES` after 250 ms); the `else` branch sends `RECALCULATION`
  - `infranodus/index.ts:157-163` — nests `stopwords` and `lemmatizeHashtags: true` under `contextSettings`

- **Browser extension** — `infranodus-extension/src/content-script/GraphModule.tsx`
  - `317-340` — `case EventTypes.REMOVED_NODES` updates `wordsToHide` and uses it for statement-panel filtering (the browser extension is more of a client-side overlay; it does not re-fetch on every change)
  - `background/providers/infranodus.ts:164-165` — same `contextSettings.stopwords` nesting

- **Iframe (graph) reference** — `infranodus-graph/src/views/graph/`
  - `useIframeEvents.js:52-55` — useEffect that emits `UPDATE_REMOVED_NODES` whenever local `removedWords` changes
  - `useIframeEvents.js:108-119` — receives `UPDATE_REMOVED_NODES` (host → iframe), guards against echo with array equality
  - `ExtractedGraph.jsx:792-837` — `loadJson` (resetting reset path)
  - `ExtractedGraph.jsx:491-506` — `onRecalculation` (state-preserving update path)

## Debugging checklist when interactions stop working

1. Open the webview devtools and confirm the iframe emitted what you expected (`[iframe]:` lines, or the `[InfraNodus][webview] received message` envelope).
2. Confirm the webview forwarded the right shape to the extension (`vscode.postMessage` call in `webview.html`).
3. Open the extension-host devtools and confirm `onDidReceiveMessage` saw it and updated `_wordsToHide` (`[InfraNodus][ext] updateRemovedNodes` log line includes `previous`, `incoming`, `changed`).
4. Confirm the outgoing POST log line shows `stopwordsSent` is non-empty and contains the right words. If it's empty, the request body is wrong (probably the stopwords are not under `contextSettings`).
5. Confirm the response came back and `topicsSubject next` log fires.
6. Confirm the right *outgoing* type was chosen: `LOAD_JSON (initial load for key)` only on the first call per document; `RECALCULATION (subsequent update)` on every later call. If it stays on `LOAD_JSON`, `_initialLoadDoneForKey` is being reset somewhere it shouldn't be.

A `LOAD_JSON` on a subsequent call is the classic "I deleted it and it came back" symptom.
