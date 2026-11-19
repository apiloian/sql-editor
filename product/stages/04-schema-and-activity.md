# 4. Explore the database schema and query activity

A user can find a table or view, understand its columns, use those columns in SQL, and return to a previous run. The database drawer answers “What is this object?” The activity drawer answers “What did I run and what happened?” Both should leave enough room for their main content. [Product requirements](../product-requirements.md)

## Database explorer and object details

| Interaction | Expected behavior |
| --- | --- |
| Browse or search | Show regular databases by default. Search the visible databases, tables, and views, including objects in collapsed databases. Turning on **Show system databases** includes their objects in search. Turning it off hides them again. Preserve the existing search behavior. |
| Select a table or view | Open its drawer with the qualified name visible. Reduce header height and surrounding padding so the user can see more metadata immediately. Keep long names readable and the close control reachable. |
| Switch detail views | Redesign the three controls so the active view is clear. **Overview** shows object metadata, **Columns** shows each column with its type and available details, and the third view shows the stored creation statement. **DDL** shows the creation statement. For a view, show its own creation statement. |
| Read a description | Show the object’s ClickHouse comment under **Description** in Overview. Show each available column comment alongside its column in Columns. Omit an empty description. When switching between objects, show metadata belonging to the selected object. |

The sidebar filters system databases before matching the search. The details drawer reads comments and stored DDL through the existing query API and ClickHouse system tables. [Sidebar](../../src/components/DatabaseSidebar.tsx) · [Details drawer](../../src/components/TableDetails.tsx) · [Schema queries](../../src/lib/schema.ts)

## Schema-aware SQL completion

The earlier stages already delivered the Monaco completion provider. Preserve its use of current database metadata alongside SQL keywords and ClickHouse functions. For the example schema from the product review, typing `user` can offer the column `user_id` with the detail `orders · UInt32` and the table `users` with `3 columns`. Suggestion icons distinguish kinds. Accepting an item inserts the identifier at the caret. After a schema refresh, suggestions reflect the updated columns. The existing suite also covers qualified database and table names. [Completion provider](../../src/lib/sql-completion.ts) · [Existing autocomplete scenarios](../../tests/autocomplete.spec.ts)

Keep the shared schema data usable by the Stage 3 CSV destination picker. Selecting an object for inspection or refreshing metadata must preserve the SQL the user is editing.

## Activity log

- **Layout.** Use the same compact header and padding as the object drawer. Move the saved query count and the “last 200 runs stored in this browser” tip to the top, then remove the footer. Give the history list more space while keeping the selected SQL and its metadata readable. The list and details scroll independently. Selected details use 35% of the drawer body below the header and controls.
- **Filter and selection.** Fix the **All statuses** control so its label and dropdown icon are visible, aligned, and clickable, including on a narrow screen. Choosing Running, Success, Failed, or Unknown shows matching runs. All statuses restores the full list. Keep a clear empty state when nothing matches.
- **Inspect and reuse SQL.** Show formatted SQL, timestamp, status, duration and database when available, with the recorded result or error information. Show the original text if the formatter cannot parse it. Preserve **Load in editor** as an explicit action that restores the original SQL for editing. Loading or inspecting an entry must never execute it. Only SQL the user actually runs belongs in history.
- **Browser storage.** Keep the latest 200 runs in local storage under `sql-editor-ui.query-activity.v1`. Reloading restores saved entries and their metadata. Use the new key consistently for reading, writing, clearing, and cross-tab clear events.
- **Clear logs.** Label the action **Clear logs**. Confirming clears the entire saved history, even with a status filter active, and closes both the confirmation and the drawer. Cancel or Escape dismisses only the confirmation and preserves the list. Clearing while a query is running must keep that entry cleared when it finishes.

Activity history is browser-local. The backend supplies query outcomes through the execution path from Stages 1 and 2. [Activity drawer](../../src/components/QueryActivityDrawer.tsx) · [Storage hook](../../src/hooks/useQueryActivity.ts) · [Drawer layout](../../src/index.css)

## Acceptance scenarios for implementation

| Scenario | Expected observation |
| --- | --- |
| Search a collapsed database and a hidden system object | The matching regular table or view is discoverable. The system object appears only with system visibility enabled. |
| Inspect a commented table, a view, then an object without comments | The qualified name, object description, column descriptions, and creation SQL follow the selected object. Empty descriptions disappear. Switching detail views and closing the drawer preserves the editor contents. |
| Complete and refresh | Select a suggested column and verify the inserted identifier. Refresh after a schema change and check the new suggestion. The CSV picker can still select the intended qualified table. |
| Inspect a successful and a failed run | Filter and switch back to All statuses. Details match the selected entry. Reload and load the saved SQL into the editor. No extra execution occurs. |
| Clear from a filtered list | Cancel first and verify that all entries remain. Confirm next and verify that both dialogs close, filtered-out entries are also cleared, and reload and an already-open tab show the cleared history. |
| Review both drawers | With a long object name and multiline SQL, check header density, tab selection, icon alignment, the position of the retention tip, and how many history entries remain visible above the details. |

Write and run explicit tests alongside implementation. Update fixtures that use the old storage key or button label. The [existing activity suite](../../tests/activity.spec.ts) already exercises confirmation, reload, an in-flight query finishing after a clear, and cross-tab clearing.

**Manual review.** Start with a collapsed database, find a view, inspect its description and DDL, and close the drawer. Use a column suggestion in the editor and run the query. Open its activity entry, reload, then clear the log with a filter active.
