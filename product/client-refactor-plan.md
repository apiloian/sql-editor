# Client refactor plan

## How to execute this plan

1. **Pick the scope from the request.** For a specific stage, work through its numbered steps. For Stage 4, use the named component or follow table order. For the full refactor, resume at the first unmet criterion in stage order. A request to review or revise this plan is documentation work.
2. **Read the current callers first.** From `client/`, inspect `git status --short`, `git diff`, and `git diff --cached` for the files involved. Build on edits already present. On resume, compare the code with the completion criteria below and start at the first unmet criterion in scope.
3. **Use the product spec for behavior and this plan for ownership.** Follow the repository instructions and read the feature stage relevant to the current change. The review examples below are expected outcomes. [Repository instructions](../AGENTS.md) · [Product requirements and clarifications](product-requirements.md) · [Feature stage index](stages/README.md)
4. **Close each requested change with evidence.** Identify the old responsibility removed, its current owner, and which acceptance outcomes were verified. Follow the user's current verification instructions. While the request to skip tests applies, trace the normal and failure paths in source and label runtime behavior as unverified. Record significant implementation tradeoffs in the [client decision log](../DECISION_LOG.md).

## Stage 1. Establish client architecture around the Run workflow

**Current ownership (steps 1.1–1.3).** Both Run actions now use `useScriptExecution`. It owns the in-flight guard, sequential requests, activity updates, and skipped outcomes. Monaco publishes SQL availability to the workspace. The results component tracks the selected statement by run ID. These changes are present in source. [Workspace](../src/App.tsx) · [Executor hook](../src/hooks/useScriptExecution.ts) · [Result selection](../src/components/ResultsTable/ResultsTable.tsx)

### 1.4 Separate editor SQL scope from execution policy

**Recommendation.** Split `lib/sql.ts` by caller. Keep the text operations that require a caret or selection in the browser. Keep query planning and execution on the server. The current dependency runs backwards: Express imports its tokenizer and verb classifier from client source. Moving the whole file to Express would reverse that dependency while leaving Monaco dependent on the same code. [SQL helpers](../src/lib/sql.ts) · [Server planner](../../src/query-plan.ts)

| Responsibility | Caller today | Target |
| --- | --- | --- |
| Choose text for Run | Toolbar Run calls `splitStatements`. The Monaco shortcut and context menu call `statementsForRun` with offsets. | A client editor-scope module owns statement ranges, exact selections, and inline INSERT payload boundaries. |
| Read tokens and offsets | The scope helpers, Monaco autocomplete, and Express planner call `sqlTokens`. | A pure lexer shared at build time. Autocomplete can inspect incomplete text locally. [Completion context](../src/lib/sql-completion.ts) |
| Classify the leading verb | Express uses `statementVerb` and `isReadVerb` when planning. The browser uses them only to report an unconfirmed delivery. | Keep the small classifier shared while both consumers need it. It recognizes a list of verbs and a limited WITH form. Its result is a hint about possible effects. ClickHouse privileges enforce permissions. [Client failure handling](../src/lib/query-api.ts) |
| Rewrite and execute | Express receives SQL, computes the plan itself, and applies limits, deadlines, and write acknowledgment rules. | Server-owned. A default SELECT display limit must preserve the full write scope of INSERT INTO … SELECT. The server must make its own decision for every request. [Query route](../../src/index.ts) · [Executor](../../src/query-execution.ts) |

**Migration order.** First separate the editor-scope functions from the pure lexer and classifier. Keep one statement per HTTP request. For a physical move, establish how both deployable builds will obtain the shared source: the client's Git root is `client/`, so a parent-only file would be missing from a standalone client checkout. Migrate imports together, including the server suite that currently imports the client splitter. The planner's separate import of the default row limit and the executor's result types also need accounting before declaring the server independent of client source. [Editor scope cases](../tests/sql-run-scope.spec.ts) · [Server query cases](../../tests/query-commands.test.ts)

**Review criteria.** A semicolon inside a quoted string stays in its statement. A partial selection reaches the API verbatim. An inline CSV payload retains its final newline. A lost write acknowledgment stops the script and leaves retry to the user.

**Separate behavior correction.** Reporting a missing API base before dispatch changes the error the user sees. Implement it when the requested scope includes query error handling. Its acceptance case is a write with no configured API base reporting a configuration failure before dispatch. Loss of confirmation after dispatch still yields an uncertain write outcome.

**Review scenario.** Select one statement in a three-statement script. The editor shortcut runs the selection. Toolbar Run attempts the whole script in order. If statement two fails, it opens on that error, keeps the first result, and marks the third skipped. Browsing the first result sends zero requests. The activity log contains one entry per attempted statement.

## Stage 2. Define shared UI components through their callers

The workspace toolbar has its own component. Activity and table details share a Click UI drawer frame for the title, close control, and focus restoration. Each drawer owns its content and interactions, including the nested Activity confirmation. [Toolbar](../src/components/WorkspaceToolbar/WorkspaceToolbar.tsx) · [Drawer frame](../src/components/DrawerFrame/DrawerFrame.tsx) · [Activity drawer](../src/components/QueryActivityDrawer/QueryActivityDrawer.tsx) · [Table details](../src/components/TableDetails/TableDetails.tsx)

1. Extract a workspace toolbar with named actions and the small set of values each control displays. Use the existing Click UI controls directly. The parent wires Run, theme, assistant visibility, and editor history.
2. Extract the shared drawer frame using activity and table details as its first callers. Use Click UI Dialog for the lifecycle, accessible title, and backdrop dismissal. Keep filtering, tab navigation, and clear confirmation in their respective features. Keep the activity status menu inside the drawer, and return focus to **Clear logs** when its confirmation is canceled.
3. Review the three resize interactions together. The sidebar measures pixels, the workspace divider measures a percentage, and the grid resizes individual columns. Share pointer handling only where it removes duplication and preserves each control’s keyboard behavior and units.

**Review scenario.** Open activity from the toolbar, select **Clear logs**, and cancel. The confirmation closes, the activity drawer stays open, and its entries remain visible. Open table details, navigate its tabs with the keyboard, then close it with Escape. Verify focus returns to the invoking control and the SQL selection survives.

## Stage 3. Give styles a predictable home

**Implemented.** Global CSS owns the cascade layers, theme defaults, focus styles, and a few rules used across features. The workspace, toolbar, drawers, results, charts, schema browser, and CSV modal import their own styles. The Monaco menu and CopilotKit input overrides live with their integrations. [Global styles](../src/index.css) · [Results styles](../src/components/ResultsTable/results-table.css) · [Monaco styles](../src/components/SqlEditor/sql-editor.css) · [CopilotKit styles](../src/components/AssistantComposer/assistant-composer.css)

1. Keep resets, theme values, focus defaults, and cascade layer order in the global stylesheet. Put shared drawer styles with the drawer frame from Stage 2.
2. Move one feature’s rules at a time, starting with results and pagination. Move its media queries and dark-theme rules in the same change. Import each feature stylesheet from its owner.
3. Group Monaco menu overrides and CopilotKit input overrides with their integrations. Prefer a supported component prop when it provides the same presentation. Preserve the precedence of overrides that depend on the library markup.

**Completion criterion.** For each moved feature, its owner imports its styles, obsolete global rules are removed, and the feature’s responsive and theme rules still apply in the intended cascade order.

**Review scenario.** Inspect the same result in both themes and at desktop and narrow widths. Page controls should remain usable, resized headers should align with cells, and the focused control should be visible. Open the Monaco context menu and focus the assistant input to check the library-specific styles after the move.

## Stage 4. Simplify feature components one at a time

### State ownership review

Before changing a component, list each stored value, who changes it, who reads it, and what resets it. Use the component's lifetime, its React key, and its callers as evidence. A reducer is useful when one event must update several related values together. Independent controls can each have local state. A hook that merely returns the same setters leaves the ownership problem in place.

| Target | State decision | Behavior to preserve |
| --- | --- | --- |
| [App](../src/App.tsx) | Eight state declarations cover several lifetimes. Move `editorSize`, the measurement ref, and divider handlers into a workspace split-pane component. Leave `sidebarOpen` and `assistantEnabled` at their common owner. Keep Monaco's `hasSql` and history snapshots available to the toolbar. If activity and CSV are mutually exclusive by design, model the active dialog as `'activity' \| 'import' \| null` after confirming that interaction. | Mount the pane around the editor from startup. Showing results, hiding the assistant, and resizing must preserve the Monaco model, selection, and undo history. Keep the existing keyboard steps and size limits. |
| [AssistantConversation](../src/components/AssistantComposer/AssistantComposer.tsx) | Highest coordination risk. One submission sets `active.current`, local `pending`, and the parent's `assistantBusy`. Give the workspace and composer one reactive pending value. The turn operation still needs a synchronous guard and an identity for cancellation. Keep the editable draft, notice, and stable tab thread ID separate. Place SDK setup under the same cleanup boundary as execution. | Two rapid sends start one turn. Cancel or setup failure releases the editor lock, restores the draft, and discards a late edit. Hiding and reopening the composer preserves the thread. |
| [ResultsTable and RowsView](../src/components/ResultsTable/ResultsTable.tsx) | Four state values belong to the panel and three to its keyed row view. Keep preferred view, axes, and page size across runs. Scope selection to the run. Keep page and custom widths under the existing run-and-statement key, above the conditional grid/chart branch. Derive effective axes, widths, and visible rows. The observed DOM width is an external input. | Page two and a resized column survive switching to chart and back on the same statement. Changing the selected statement resets the row view. A new run selects its last attempted statement and retains the page-size preference. |
| [CsvImportDialog](../src/components/CsvImportDialog/CsvImportDialog.tsx) | Only two state declarations, yet the component also mirrors the entire `Phase` in `current.current`. The union already expresses the workflow. Isolate request coordination and keep an immediate guard for verification replacement, duplicate confirmation, and unmount. Narrow the ref only after accounting for every synchronous read. Drag highlighting belongs to the drop zone. | Replacing a file invalidates its pending result immediately. Rapid confirmation starts one client request. Closing during verification discards the response. An uncertain import keeps the existing import ID for recovery. |
| [DatabaseSidebar](../src/components/DatabaseSidebar/DatabaseSidebar.tsx) and [QueryActivityDrawer](../src/components/QueryActivityDrawer/QueryActivityDrawer.tsx) | Each has four local declarations. Sidebar search, system visibility, selected object, and width have independent writers. The activity filter, selected ID, confirmation visibility, and mounted menu container also serve different interactions. Keep them local and continue deriving filtered lists and selected entries. The menu container needs a render when its DOM node becomes available. | Search preserves group expansion when cleared. Hiding system objects closes a selected system object. Canceling Clear logs restores focus and preserves filter and entries. |
| [useVoiceTranscript](../src/hooks/useVoiceTranscript.ts) | Two state declarations hide a more important distinction. Worker readiness lasts for the mount. Capture, partial text, and cancellation belong to one recording. Group recording resources by session ID if changing this hook. Keep worker and microphone handles outside render state. | Stop flushes the last audio before finalizing. Late microphone permission or worker events for an old session cannot attach to a new recording. |

Keep the simple cases small. The details tab is a local choice. Chart zoom state reflects an ECharts event. In `useDatabaseSchema`, inspect the whole refresh sequence before removing `refreshing`: it also covers cancellation and invalidation across the schema cache. A single query's loading flag has a different lifetime. [Table details](../src/components/TableDetails/TableDetails.tsx) · [Chart zoom](../src/components/ResultsChart/ResultsChart.tsx) · [Schema refresh](../src/hooks/useDatabaseSchema.ts)

### Implementation standard for state changes

1. **Propose the smallest change.** Name the files, the state that moves or disappears, its new owner, and the interaction most likely to regress. For a nontrivial ownership change, present the design and wait for architecture approval before editing application code. An already approved design can proceed within its agreed scope.
2. **Choose the representation from the behavior.** Derive values during render when props and state determine them. Use typed state variants for mutually exclusive phases, refs for imperative resources, and effects for synchronization with external systems. Keep TypeScript strict. Introduce memoization, context, or a library only for a concrete need.
3. **Review the result against its callers.** Follow each normal, failed, canceled, and stale transition that applies. Review the diff for duplicate writers, lost cleanup, unintended remounts, and abstractions that only forward props. For implementation, use the applicable type, lint, and focused behavior checks under the verification instructions above. Report tradeoffs and any unverified behavior.

### Current composition

```text
App
├── WorkspaceToolbar
├── DatabaseSidebar → DatabaseGroup and TableDetails → DrawerFrame
├── SqlEditor → Monaco configuration and editor commands
├── AssistantComposer → useAssistantTurn and useVoiceTranscript
├── ResultsTable → RowsView → ResultsGrid and lazy ResultsChart
├── QueryActivityDrawer → DrawerFrame
└── CsvImportDialog → useCsvImport → typed CSV API
```

**Implemented.** These boundaries are present in the client. Express still handles query execution, CSV verification and insertion, and the assistant runtime. The review scenarios below remain the runtime checks for this stage.

| Component | Current ownership | Review scenario |
| --- | --- | --- |
| [ResultsTable](../src/components/ResultsTable/ResultsTable.tsx) | The panel owns outcome selection and view preferences. [ResultsGrid](../src/components/ResultsGrid/ResultsGrid.tsx) owns measurement, resizing, and paging and retains its state as the user switches views. Both renderers receive the same positional result. | Switch from page two to a chart and back. The chart uses every returned row, the grid returns to page two, and switching views sends zero queries. |
| [ResultsChart](../src/components/ResultsChart/ResultsChart.tsx) | The [chart module](../src/lib/chart.ts) resolves fields by column position and prepares series and validation. Duplicate column labels are distinguishable. The lazy chart component owns ECharts rendering and zoom. | Select each of two same-named columns, then switch between split series and pie. Try a nonnumeric measure or duplicate category and split pair. The table stays available. |
| [SqlEditor](../src/components/SqlEditor/SqlEditor.tsx) | [Monaco setup](../src/lib/monaco-sql.ts) owns worker and theme configuration. [Editor commands](../src/lib/sql-editor-commands.ts) register and dispose with each editor. SqlEditor owns the edit target, validation, and undo boundaries. | Apply an assistant edit and undo it once. If the target selection changes before a reply arrives, the late edit leaves the document intact. |
| [CsvImportDialog](../src/components/CsvImportDialog/CsvImportDialog.tsx) | The dialog owns focus, file input, and drag and drop. [The import hook](../src/hooks/useCsvImport.ts) owns request identity and phase transitions. [The CSV API module](../src/lib/csv-import-api.ts) sends requests and validates responses. | Replace file A with B during verification. A late success for A cannot enable Import for B. A failed import can show confirmed rows and a separate uncertain chunk. |
| [AssistantComposer](../src/components/AssistantComposer/AssistantComposer.tsx) | The composer owns draft and voice feedback. [The turn hook](../src/hooks/useAssistantTurn.ts) owns SDK setup, cancellation, rollback, and cleanup. Monaco still checks the final edit target. | Cancel a request, edit the restored draft, and submit again. The editor unlocks, a late edit is ignored, and toggling the assistant preserves the tab’s conversation. |
| [DatabaseSidebar](../src/components/DatabaseSidebar/DatabaseSidebar.tsx) | A single visibility calculation filters groups and their objects. Expansion stays with each group. [Schema queries](../src/lib/schema-queries.ts) pass cancellation to their metadata requests. | Search a collapsed database, toggle system visibility, then refresh. The groups and completion suggestions reflect the refreshed catalog. |
| [QueryActivityDrawer](../src/components/QueryActivityDrawer/QueryActivityDrawer.tsx) | Detail display and loading share the selected entry. The formatted SQL is for reading and **Load in editor** uses the original SQL. Clear confirmation is local to the drawer. | Filter the list, load an entry, and confirm the editor receives the original text without running it. Clearing history removes entries outside the filter too. |
| [TableDetails](../src/components/TableDetails/TableDetails.tsx) | A single object-specific query supplies all three tabs. No extra panel split was needed. | Open two objects in succession. A late response for the first leaves the second object’s title, columns, and DDL consistent. |

## Open decisions and scope boundaries

- **CSV recovery requires a server decision.** Today **Check import result** calls confirm again. If the first confirmation never arrived, that call can start the write. A read-only status lookup needs a separate server operation and a way to report an expired receipt. Track this as a client/server behavior change when reviewing CSV recovery. [Confirmation handler](../../src/csv-import.ts)
- **Assistant-prepared charts are planned product work.** Decide how a proposed view binds to future SQL when implementing Stage 6C. The component refactor can first establish ownership of views for results that already exist. [Assistant visualization stage](stages/06c-visualization.md)

Both items need a separate product or API decision. Complete client-only refactoring against the existing contract while those decisions remain open.

## Current code structure critique

**Start with the interface between script execution and activity storage.** The component extractions already give Monaco commands, CSV requests, chart preparation, and grid rendering identifiable owners. The following changes address coupling still present in the working tree.

| Priority | Structural finding | Smallest useful refactor |
| --- | --- | --- |
| 1. Activity recording | The executor already has a typed `StatementResult`, but it unpacks it into calls to `succeed`, `fail`, or `unknown`. A successful result becomes a `number \| string`, which the activity hook inspects again to recover row count or command message. Both modules must understand the activity record format. | Expose `start(sql, database)` and `finish(id, result)` to the executor. Translate the result into the stored entry once inside the activity module. Keep the executor responsible for deciding when the script stops. Retire the three completion methods once their sole caller migrates. [Script executor](../src/hooks/useScriptExecution.ts) · [Activity recorder](../src/hooks/useQueryActivity.ts) |
| 2. Workspace composition | `App` wires the editor, toolbar, and results together, but it also owns pane measurements, percentage arithmetic, and pointer and keyboard handlers. All of those details serve one divider. | Extract a local `WorkspacePanels` component that owns the grid container, size, ref, and divider. Pass the editor and optional results as content. Keep the editor mounted in the same position when results appear. The sidebar and table grid can keep their own pixel-based resizing. [Workspace](../src/App.tsx) · [Workspace styles](../src/workspace.css) |
| 3. Schema rules | The workspace, sidebar, and completion catalog each define which database names identify system databases. The root component also knows which table engines the CSV picker excludes. | Put a single `isSystemDatabase(name)` predicate beside the schema types. Give the CSV destination filter a named pure function and call it from the composition layer. Keep each caller’s separate visibility decisions local. [Workspace](../src/App.tsx) · [Sidebar](../src/components/DatabaseSidebar/DatabaseSidebar.tsx) · [Completion catalog](../src/lib/sql-completion.ts) · [Schema](../src/lib/schema.ts) |

**Larger dependency to address separately.** Express imports the lexer, classifier, result limit, and result types through the client source tree. Section 1.4 describes which pieces need a shared build location. The editor-specific selection logic belongs with the client. This packaging change can proceed independently of the three client refactors above. [Server planner](../../src/query-plan.ts) · [Server executor](../../src/query-execution.ts)

**Where to stop.** `ResultsGrid` already owns paging and sizing, and `DrawerFrame` already serves both drawer callers. Keep those boundaries. A workspace-wide reducer or a new folder hierarchy would leave all three dependencies in the table intact. The completion criterion for each change is that the former caller no longer knows the implementation detail it used to manage.
