# Client and server architecture review

## Final implementation priorities

These findings come from tracing the current source. Runtime and deployment behavior were not exercised. The first item depends on who can reach the service. The remaining three apply to ordinary editor use.

### 1. Restrict who can execute SQL before sharing the server

Express accepts SQL without checking the caller’s identity and starts listening without a host restriction. Compose publishes the ClickHouse ports on host interfaces, and the default user configuration grants access management. An origin allowlist governs browser responses. It does not authorize database operations. Actual exposure depends on the host firewall and any upstream authentication. [Express entry point](../../src/index.ts) · [Compose](../../docker-compose.yml) · [ClickHouse user configuration](../../docker/users.xml)

**Smallest fix.** For the local assessment, bind Express and the published database ports to loopback. For a shared deployment, keep ClickHouse private, authenticate access to the API, and give the editor a database identity limited to its intended databases and operations. Verify that a caller outside that boundary cannot submit SQL through either endpoint.

### 2. Make CSV recovery read-only

After an inconclusive confirmation, **Check import result** calls the same POST as **Import**. If the original request never reached Express, the upload is still verified and the status check starts the first insert. Concurrent confirmations already share a promise. This defect concerns a write initiated by a status action. [Dialog](../src/components/CsvImportDialog/CsvImportDialog.tsx) · [Import hook](../src/hooks/useCsvImport.ts) · [Client API](../src/lib/csv-import-api.ts) · [Server confirm handler](../../src/csv-import.ts)

**Smallest fix.** Add a read-only lookup for the same import ID and connection identity. Report awaiting confirmation, in progress, a recorded outcome, or unavailable. Wire the recovery button to that lookup. If the first request never arrived, checking status must leave the table untouched. If the insert succeeded and its reply was lost, checking must return the stored receipt. An expired receipt leaves the outcome unknown.

### 3. Release abandoned CSV verification slots

Verification reserves one of eight process-wide upload slots. After verification, the server keeps the file and entry for 30 minutes or until confirmation. Replacing a verified file or cancelling the dialog drops its ID in the browser. An interrupted verify can also finish on the server after the browser disconnects. Eight abandoned successful verifications can therefore block every new upload until expiry. [Client selection and dismissal](../src/hooks/useCsvImport.ts) · [Server admission, storage, and expiry](../../src/csv-import.ts)

**Smallest fix.** Release a superseded or dismissed verified ID through an identity-checked operation. Handle disconnects during verification on the server, including cleanup if an entry was created before the response could be delivered. Keep expiry as a fallback. Release must apply only to uploads still awaiting confirmation. After repeated file replacements or cancellations, a fresh upload must still be admitted. An import already in progress must retain its file until completion.

### 4. Bound result memory on both sides of the query API

The server reads ClickHouse incrementally but retains every returned row for an explicit outer limit, then serializes the whole result to JSON. A single wide row can also grow the line buffer before a row count applies. The browser parses the complete response and keeps every statement outcome for the current script. Grid pagination only affects rendering. Ordinary reads with wide values or several large results can exhaust the API process or the browser tab. [Planner](../../src/query-plan.ts) · [Response reader](../../src/query-execution.ts) · [Fetch decoder](../src/lib/query-api.ts) · [Script results](../src/hooks/useScriptExecution.ts)

**Fix boundary.** Enforce a response-byte budget while reading chunks, before assembling an oversized line or JSON response. Bound cumulative retained results for a script and surface an explicit size-limit outcome. Preserve statement order, completed write outcomes, and the existing rule that a display limit cannot narrow a write. The byte budgets and user-facing handling are open product decisions. Check one wide row and several individually acceptable results whose combined size exceeds the script budget. [Result requirements](stages/01-query-results.md)

The earlier client extractions for activity completion, pane resizing, and schema rules are already present. Keep the agreed component naming convention. The notes below preserve previous design decisions and are outside this critical implementation queue. [Activity owner](../src/hooks/useQueryActivity.ts) · [Workspace panels](../src/components/WorkspacePanels/WorkspacePanels.tsx) · [Schema rules](../src/lib/schema.ts)

<details>
<summary>Earlier architecture review and component conventions</summary>

## Recommended architecture

Keep the component folders already in place. Use a shallow client structure with one question guiding placement: **who needs to understand this code to change it?** The editor, results panel, and activity drawer are recognizable entry points. A maintainer can open one folder to find a view, its styles, and any private pieces that warrant their own files. The cost is an extra directory for a small component such as `DrawerFrame`. A second hierarchy of feature folders would add little here since these components already have clear names.

| Location | What belongs here |
| --- | --- |
| `App.tsx` and `workspace.css` | Compose the workspace. Wire siblings together when one panel affects another, such as an assistant turn locking the editor and disabling toolbar actions. |
| `components/<Name>/` | Keep the named component and its CSS together. A private child can start in the same file and move to a sibling file when it owns a distinct interaction. Give a shared view such as `DrawerFrame` its own component folder. Use direct imports. |
| `hooks/` | Keep the existing hooks that manage work over time. Script sequencing, CSV verification, and voice capture each have a lifecycle an owner must preserve. Ordinary input, selection, and disclosure state can stay in the view. |
| `lib/` | Keep named modules for calculations, integration code, and API clients. The existing `query-api.ts` and `csv-import-api.ts` already isolate HTTP from their views. Retain their paths for this refactor. |
| `index.css` | Keep theme defaults, cascade order, and shared focus styles global. Put responsive rules and third-party overrides beside the component that owns them. Keep the existing results stylesheet together while the grid is used only inside the results panel. |

### Component naming

Under `src/components/`, use the component’s **PascalCase** name for both its folder and its `.tsx` file. When the component owns a stylesheet, keep it in the same folder and use **kebab-case** for its filename.

```text
src/components/SqlEditor/
  SqlEditor.tsx
  sql-editor.css
```

### How to decide what to split

- **Move state with the interaction it controls.** In `App`, `editorSize`, the workspace measurement ref, and the divider handlers can all move into `WorkspacePanels` together. In the same file, `assistantBusy` has several consumers and belongs at their common parent. The number of state declarations alone tells us little about either decision.
- **Preserve the lifetime of each value.** In `ResultsTable`, page size and preferred view survive statement changes. The grid's page and column sizing belong to the mounted result. Keep that distinction when extracting markup. In `DatabaseSidebar`, each `DatabaseGroup` can continue owning its own expansion state. [Results panel](../src/components/ResultsTable/ResultsTable.tsx) · [Grid](../src/components/ResultsGrid/ResultsGrid.tsx) · [Sidebar](../src/components/DatabaseSidebar/DatabaseSidebar.tsx)
- **Group values when they transition together.** The existing CSV phase union already ties verification and import results to the selected file and table. Keep its transition logic and stale-response guard in the hook. Focus and drag feedback belong in the dialog. This is a concrete model for other multi-step operations when they acquire mutually exclusive states. [CSV hook](../src/hooks/useCsvImport.ts) · [Dialog](../src/components/CsvImportDialog/CsvImportDialog.tsx)
- **Split a large component when its caller gets simpler.** The workspace divider is ready because its parent can hand it two panes and forget the resize mechanics. Keep a short private renderer such as `RowsView` alongside its caller while a move would only change its import path. Carry component-specific styles with any extracted view when it acquires independent callers.

The three client changes below are implemented. The recorder maps statement results to saved activity. `WorkspacePanels` owns the divider while `App` composes the panes. The schema model owns database classification and CSV destination selection. The server architecture review below is a separate queue. [Recorder](../src/hooks/useQueryActivity.ts) · [Workspace panels](../src/components/WorkspacePanels/WorkspacePanels.tsx) · [Schema model](../src/lib/schema.ts)

## 1. Give the activity recorder the complete statement result

**Problem.** The executor receives a typed `StatementResult`, chooses one of three activity methods, and converts a successful result into a number or a string. The recorder then inspects that primitive to decide which fields to persist. This splits knowledge of the storage format across two hooks. [Executor](../src/hooks/useScriptExecution.ts) · [Recorder](../src/hooks/useQueryActivity.ts) · [Statement types](../src/lib/query.ts)

**Change.** Keep `start(sql, database)`. Replace `succeed`, `fail`, and `unknown` on the recorder interface with `finish(id: string, result: StatementResult)`. Call it once after each attempted statement. In the recorder, translate the discriminated result into the existing activity entry using its existing completion and persistence logic.

| Statement result | Activity entry |
| --- | --- |
| Rows | Success with returned row count |
| Command | Success with command message |
| Error or timeout with a known write outcome | Error with the existing formatted failure message |
| Unknown or timeout with an unknown write outcome | Unknown with the existing formatted failure message |

**Done when** the executor owns sequencing, stopping, and marking skipped statements, and the recorder alone chooses the persisted status and fields. Preserve duration, the storage key and shape, and the guard that ignores completion after history was cleared. For a three-statement run that fails on statement two, only the two attempted statements produce activity. [Activity scenarios](../tests/activity.spec.ts)

## 2. Move split-pane layout out of App

**Problem.** The workspace root assembles the editor and results, but also measures a DOM element, captures pointer input, handles arrow keys, and computes grid rows. Those details have one owner: the resizable divider. [App](../src/App.tsx) · [Workspace styles](../src/workspace.css)

**Change.** Add `src/components/WorkspacePanels/WorkspacePanels.tsx`. Pass editor content and optional results as React nodes. Move the grid container, measurement ref, editor-size state, divider markup, and resize handlers together. Keep the editor handle, assistant lock, toolbar actions, and script execution at their existing owners. Use the existing classes and workspace stylesheet.

**Done when** `App` composes the two panes without pointer handlers or size arithmetic. Mount `WorkspacePanels` from startup and keep the editor subtree in the same position as results appear. Preserve the current initial split, bounds, keyboard increments, and separator semantics. Showing the first result and resizing must retain the editor model, undo history, and mounted assistant conversation.

## 3. Put shared schema rules beside the schema model

**Problem.** The workspace, sidebar, and autocomplete each recognize system database names independently. The workspace also knows which engines the CSV picker excludes. That makes a layout module responsible for catalog policy. [App](../src/App.tsx) · [Sidebar](../src/components/DatabaseSidebar/DatabaseSidebar.tsx) · [Autocomplete](../src/lib/sql-completion.ts) · [Schema model](../src/lib/schema.ts)

**Change.** Add a pure `isSystemDatabase(name)` predicate beside the schema model and use it at all three call sites. Add a pure `csvImportDestinations(schema)` selector for the picker. Preserve the existing destination order and the `{ database, name }` shape. Keep search and the show-system toggle in the sidebar. Server-side import validation remains authoritative.

**Done when** the client recognizes `system` and `information_schema` case-insensitively in one place, and `App` contains no database-name or table-engine filters. The picker must still exclude the four currently filtered engines: `View`, `MaterializedView`, `LiveView`, and `WindowView`. Sidebar visibility and autocomplete eligibility remain distinct consumer decisions. [Schema scenarios](../tests/schema-details.spec.ts) · [Autocomplete scenarios](../tests/autocomplete.spec.ts) · [CSV picker scenarios](../tests/csv-import.spec.ts)

## SQL ownership and packaging

Keep caret and selection handling in the editor. The lexer and small verb classifier have both browser and server consumers. Express owns authoritative query planning, limits, deadlines, and execution. Today the server imports the lexer, classifier, result limit, and result types through the client source tree. A physical move requires a separate packaging decision because the frontend has its own Git root and build context. The three client tasks above can land independently of that decision. [SQL helpers](../src/lib/sql.ts) · [Server planner](../../src/query-plan.ts) · [Server executor](../../src/query-execution.ts)

## Server architecture review

Keep the server’s flat `src/` layout for now. The existing split between SQL planning and query execution is useful. The same is true of CSV record parsing and ClickHouse-specific validation. The main places to improve are where one module owns two lifecycles, or imports another subsystem to reuse a small function. The following stages are independent of the three client tasks.

### 1. Give verified CSV uploads one owner

`createCsvImportRouter` owns the HTTP endpoints, upload admission, temporary directories, expiry timers, pending writes, and completed receipts. The confirm handler knows exactly when to cancel expiry, reuse a promise, publish a receipt, and delete the file. Moving just the two handlers to separate files would leave that coordination in the handlers. [CSV router and import lifecycle](../../src/csv-import.ts)

**Change.** Keep request parsing, content type, status codes, and JSON responses in the router. Extract one per-router import manager that owns admission, verification, confirmation, expiry, and cleanup. Reserve capacity before reading the body and release it on parser failure. Keep the existing CSV reader and database adapter as dependencies. The manager must install the in-flight result before another confirmation can start a write. [Record reader](../../src/csv-records.ts) · [ClickHouse adapter](../../src/csv-clickhouse.ts)

**Done when** the router can confirm an upload using its ID and connection identity without accessing a map, timer, or file path. Two concurrent confirmations for the same identity share one insert operation. A later confirmation returns the stored outcome during the retention window. A different identity cannot retrieve it. Preserve the distinction between acknowledged rows and a chunk whose outcome is unknown. [Existing CSV scenarios](../../tests/csv-import.test.ts)

### 2. Separate assistant replies from runtime events

`assistant.ts` already has a natural boundary. `respond` validates editor context, drives the model and metadata calls, and returns an answer with optional SQL. `SqlAssistantAgent.run` owns the abort controller and translates that result into AG-UI events. Currently a change to reply validation requires opening the same module as Express routing, RxJS teardown, and active-thread tracking. [Assistant implementation](../../src/assistant.ts)

**Change.** Extract the reply operation and its request validation into `assistant-reply.ts`. Pass the request headers it uses, the run input, signal, existing options, and trace callback. Keep the router, runner, event mapping, and cancellation lifecycle together in `assistant.ts`. Keep the existing injectable model and metadata session. Preserve the public router and options exports used by callers. [Metadata session](../../src/assistant-metadata.ts) · [Server entry point](../../src/index.ts)

**Done when** changing reply validation requires no knowledge of Observable subscriptions, and changing event emission requires no knowledge of the model loop. A cancelled turn still reaches the model and metadata operations through the same signal, closes the session, and frees the tab for another turn. Preserve the existing event names, error categories, and trace redaction. [Existing assistant scenarios](../../tests/assistant.test.ts)

### 3. Remove a cross-import between CSV and query execution

`csv-clickhouse.ts` imports the entire query execution module for `connectionHeaders`. The assistant separately enumerates the same three headers, and CSV enumerates them again to compute upload ownership. The shared detail is the connection identity. Each caller has different requirements for reading responses, deadlines, and cancellation. [CSV adapter](../../src/csv-clickhouse.ts) · [Query executor](../../src/query-execution.ts) · [Assistant metadata](../../src/assistant-metadata.ts)

**Change.** Put the ordered header names and their extraction in a small `clickhouse-connection.ts` module. Support both Node request headers and the Fetch headers supplied by the assistant runtime. Keep hashing in CSV, where upload identity is used. Keep streaming and query cancellation in the executor and metadata limits in the assistant adapter.

**Done when** CSV has no import from the query executor, all three paths forward the same supported string headers, and the CSV fingerprint retains its current field order and missing-value representation.

### Separate decision for SQL packaging

The server planner imports the lexer, classifier, and result limit from client source at runtime. The executor also imports result types there at compile time. This ties server builds to the client checkout. The editor still needs local text offsets for selection and autocomplete. Keep planning and execution server-owned. Before moving files, choose a shared source or package that both builds can actually consume and account for the server suite’s direct splitter import. Keep editor selection and UI result formatting in the client. [Planner](../../src/query-plan.ts) · [Executor](../../src/query-execution.ts) · [Server suite](../../tests/query-commands.test.ts) · [Client SQL ownership analysis](client-refactor-plan.md)

</details>
