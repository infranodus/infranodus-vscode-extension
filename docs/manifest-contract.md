# infranodus/manifest.json — contract for the VSCode extension

*How to register a graph exported from the extension in a workspace's
`infranodus/manifest.json`, so that agents (Claude Code / Cursor / any
CLAUDE.md-reading assistant) can find and query it later. Companion to the
`infranodus-cli` skill in the InfraNodus-Skills repo, which owns this file
format.*

## Background: what the manifest is

Projects processed by the `infranodus-cli` skill get an `infranodus/`
folder at the project root containing:

- `manifest.json` — the **routing table**: one entry per InfraNodus graph
  built from this project, recording what the graph is for so an agent can
  match a user's question to the right graph and query it via the MCP
  tools (`retrieve_from_knowledge_base`, `analyze_existing_graph_by_name`,
  `generate_content_gaps`).
- `INFRANODUS_REPORT.md` — an **append-only log** of dated build sections
  and insights. Never rewritten.

The project's `CLAUDE.md` carries a marker-delimited `## infranodus` block
instructing agents to read the manifest and query the graphs before
grepping files. The graph *content* lives only on the InfraNodus server —
there are no local content copies.

The manifest is formed in two passes by the skill: extraction registers
scope entries (`graphName: null`), upload completes them (graph identity +
routing metadata). **The extension is a third writer** — it registers
graphs the user exports manually from the editor.

## When to write

After a successful export (`doNotSave=false` + `contextName`, HTTP 200, no
`error` in the response body) **and** when a workspace folder is open.
Write `<workspaceRoot>/infranodus/manifest.json` (create the folder and a
`{"scopes": {}}` skeleton if absent). No workspace → nothing to write.

## Merge rules (critical)

1. **Read–modify–write.** Parse the existing JSON, upsert only your own
   entry under `scopes`, serialize back pretty-printed (2-space indent).
   Preserve every key you don't understand — the file has other writers.
2. **Never touch entries you didn't create.** Especially entries with
   `"policy": "generated"` (machine-owned by the skill).
3. **Key**: use the graph name itself (the `contextName` the user typed).
   Re-export to the same name = update the same entry.
4. If parsing fails (corrupt JSON), do not overwrite — surface an error.

## Entry schema

| Field | Required | Value / where to get it |
|---|---|---|
| `graphName` | **yes** | the export's `contextName`. Never write `null` (null means "pending upload" to the skill's uploader). |
| `policy` | **yes** | the string `"external"`. Never `"generated"` — that marks a file as deletable machine output. `"external"` guarantees the skill's tooling treats the entry as query-only: never uploads to it, never deletes anything. |
| `source` | yes | `"vscode-extension"` |
| `updated` | yes | today, ISO `YYYY-MM-DD` |
| `purpose` | **strongly recommended** — this is the primary routing field | compose: `"manual export from VSCode — <workspace-relative source path>"`, or `"… — selection"` / `"… — clipboard analysis"`. Add the doc type if known. |
| `url` | recommended | `response.data.graphUrl` if present; else `<serverUrl>/<userName>/<encodeURIComponent(graphName)>` when the username is known; else omit |
| `topics` | recommended | `response.data.extendedGraphSummary.mainTopics`, top ≤10 (see "one request" below) |
| `gaps` | recommended | `response.data.extendedGraphSummary.contentGaps`, top ≤6 |
| `hint` | optional | `response.data.graphSummary` — the structural overview string (MainConcepts / MainTopics / TopicalGaps / ConceptualGateways / Relations / DiversityStatistics). Store as-is. |
| `diversity` | optional | condensed from stats if available, e.g. `"diversified, modularity high"`; omit rather than guess |
| `develop` | optional | AI suggestions for developing the graph further; requires a separate `/api/v1/graphAndAdvice` call with `optimize=optimize` (slow — invokes an LLM). Condense each entry to ≤400 chars, keep ≤2. Usually skip. |
| `file` | optional | workspace-relative path of the source document, **only if the export came from a saved file** (provenance). Omit for selection/clipboard exports — entries without `file` are explicitly supported. |
| `statements` | optional | count from `response.data.statistics` if handy |

**Do not write:** `wikilinksMode` unless you actually set a non-default
mode; `graphName: null`; `policy: "generated"`.

## Getting topics/gaps/hint in ONE request

The existing export request already sends `aiTopics: true`. Add two query
params to the export URL and the same response carries everything:

```
/api/v1/graphAndStatements?doNotSave=false&addstats=true
    &extendedGraphSummary=true          ← mainTopics + contentGaps
    &includeGraphSummary=true           ← graphSummary (the hint text)
    &contextName=<name>
```

Then: `topics` ← `extendedGraphSummary.mainTopics`, `gaps` ←
`extendedGraphSummary.contentGaps`, `hint` ← `graphSummary`. No extra
round-trips. All three are best-effort: if a field is missing from the
response, omit it from the entry — never block or fail the export over
metadata.

## Example entry

```json
"my-auth-notes": {
  "graphName": "my-auth-notes",
  "policy": "external",
  "source": "vscode-extension",
  "purpose": "manual export from VSCode — src/auth/README.md",
  "url": "https://infranodus.com/dmitry/my-auth-notes",
  "topics": [
    "Token Rotation: session expiry validation refresh (1 | 34% | 41%)",
    "Deployment Config: env fly secrets rollout (2 | 20% | 18%)"
  ],
  "gaps": [
    "Gap 1: Token Rotation (session expiry validation) -> Deployment Config (env fly secrets)"
  ],
  "hint": "<Main Concepts (…)>: token (18 | 0.44 | 1), session (…) … <DiversityStatistics>: Modularity: 0.58 …",
  "file": "src/auth/README.md",
  "updated": "2026-08-02"
}
```

## Optional: the log

You may also append a dated section to `infranodus/INFRANODUS_REPORT.md`
(create with a one-line header if absent):

```markdown
## Export 2026-08-02

### my-auth-notes — https://infranodus.com/dmitry/my-auth-notes
- purpose: manual export from VSCode — src/auth/README.md
- topics: Token Rotation: …; Deployment Config: …
- gaps: Gap 1: …
```

**Append-only**: never modify or delete existing content in that file.

## Never do

- Rewrite the manifest from a template (wipes other writers' entries).
- Set `policy: "generated"` or `graphName: null`.
- Edit or remove entries owned by other sources.
- Modify existing content in `INFRANODUS_REPORT.md`.
- Touch the project's `CLAUDE.md` — registration of the agent-routing
  block is the skill's job (`upload_scopes.py --register-project`).

## What this buys the user

Once registered, any agent session in that workspace sees the exported
graph in the routing table next to the repo-scan graphs: it matches
questions against `purpose`/`topics`, disambiguates with `hint`, and
queries the graph by `graphName` with the InfraNodus MCP tools — the
export becomes part of the project's queryable knowledge base instead of
a one-off visualization.
