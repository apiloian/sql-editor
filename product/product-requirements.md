# ClickHouse SQL editor

Working product vision for the assessment. The editor, results table, and chart requirements build on the first version. Sections marked as drafts will evolve during product review.

## Editor requirements

| Interaction | Expected behavior and acceptance example |
| --- | --- |
| Open the editor | Opening `/` shows one workspace with an empty SQL editor and the assistant composer visible. |
| Undo and redo | Keep both toolbar buttons. After typing a change, Undo restores the previous text and Redo reapplies the change. |
| Run selection or statement | Popup **Run** and Cmd+Enter on macOS or Ctrl+Enter on Windows/Linux use the selection when present. Otherwise they execute the complete statement containing the caret, including all its lines. If the selection contains several statements, run them in order within that selection. |
| Run the editor | Toolbar **Run** executes the entire editor in order and shows each outcome. |
| Navigate by word | In the editor, Ctrl+Left and Ctrl+Right move the caret to the previous or next word boundary. Verify both directions on a line containing several SQL tokens. |
| Toggle line comments | In the editor, Cmd+/ on macOS or Ctrl+/ on Windows/Linux toggles SQL line comments (`--`). With no selection, toggle the line containing the caret. With a selection spanning several lines, comment each selected line. Press the shortcut again with those lines selected to restore the original SQL, including indentation. Verify that surrounding lines stay unchanged. |
| Open the action popup | Double-clicking selects the word. Right-clicking opens the compact popup beside the mouse pointer. It stays visible above neighboring panels and within the viewport. Verify after scrolling and near the editor edges, where the first version sometimes misplaced it. |
| Complete SQL while typing | Offer matching table and column names from the current database alongside SQL keywords and ClickHouse functions. Selecting a suggestion inserts that identifier at the caret. Refreshing schema metadata updates the suggestions. |

The autocomplete references show how to distinguish similar names. For a database with the pictured schema, typing `SELECT user` can suggest the column `user_id` with the detail `orders · UInt32` and the table `users` with the detail `3 columns`. Typing `SELECT a` can suggest the column `amount` alongside functions such as `abs`. Use icons and details to distinguish suggestion types. These names are examples drawn from the screenshots.

Use semicolons outside quoted text and comments as statement delimiters. Blank lines are whitespace. The final statement may end at the end of the input. For review, put the caret on the FROM line of a multiline query following `SELECT 'a;b';`. The shortcut should execute just the multiline query. Toolbar Run should execute both. This adapts [DBeaver’s statement and script commands](https://dbeaver.com/docs/dbeaver/SQL-Execution/).

## SELECT result limits

For each SELECT the user runs, honor an explicit outer LIMIT, including its offset. If the statement has no outer LIMIT, the server applies a default of 10,000 result rows in ClickHouse. A LIMIT inside a subquery applies only to that subquery. The SQL in the editor stays as written.

When the default leaves additional rows undisplayed, show “Showing the first 10,000 rows. To return more, add a LIMIT to your query.” Show this message in both table and chart views. Exactly 10,000 matching rows constitute a complete result.

| Query or condition | Expected result |
| --- | --- |
| `SELECT * FROM products` with 10,000 matching rows | Return all 10,000 rows without a truncation notice. |
| The same query with 10,001 or more matching rows | Return 10,000 rows and show the notice. |
| `SELECT * FROM products LIMIT 100` | Return up to 100 rows. |
| `SELECT * FROM products LIMIT 25000` with at least 25,000 products | Return all 25,000 requested rows. |

## Query execution timeout

The server allows each statement sent to ClickHouse to run for up to 10 minutes (600 seconds or 600,000 milliseconds). Each statement in a script gets its own deadline. The browser and server-to-ClickHouse request must allow the full execution window and delivery of the outcome. If the deadline expires, abort the in-flight request and request cancellation of the corresponding ClickHouse query. Show which statement timed out and the timeout duration in **Query results**, and return the editor to a state where the user can run another query.

For review, run a three-statement script whose second statement exceeds the timeout. Verify that the first outcome remains available, the second shows the timeout, the third is skipped, and the timed-out query stops in ClickHouse. If a write timed out before its outcome was confirmed, report its outcome as unknown.

## Query results table

| Interaction | Expected behavior and acceptance example |
| --- | --- |
| Read query results | Display returned rows in a table. Label the toolbar **Query results**, show the elapsed time for the query with its unit, and remove the results search field. Additional toolbar metadata is optional and still open. |
| Resize columns | Let users adjust the width of each data column. For example, widening a column containing a long string should reveal more of its value and keep its header aligned with its cells. |
| Navigate pages | Keep pagination. Redesign the controls so users can distinguish moving to the next page from jumping to the last page. With at least three pages of results, a user should be able to reach page two from page one without accidentally skipping to the end. The exact layout is open for design review. |
| Choose rows per page | Keep 50 as the default. Offer 25, 50, 100, 500, and 1,000. Fetch the result once per execution and paginate the returned rows in the browser. For an 800-row result, move to page two and change the page size to 100. Verify that the displayed rows update and both actions make zero additional requests to the server. |

## Query result charts

- Offer bar, area, line, and pie charts for suitable query results.
- On a pie chart, give each leader line (the connector between a slice and its label) the same color as its slice. Verify this on a pie with several differently colored slices.
- Hovering over a pie slice keeps that slice, its label, and its leader line clearly visible while the other slices, labels, and lines fade into the background, as in the visual reference. Moving to another slice transfers the emphasis. Moving off the slices restores the full chart.
- Drag across the plot in bar, line, or area charts to zoom into a category range. Use **Reset zoom** to restore the full range.
- Optionally split bar, line, or area charts into series by a third result column. Keep one row per category and split value. Use SQL to aggregate or limit the groups when needed.
- Use a limited palette with enough distinct colors to reduce repetition. The palette size and how to handle more categories than colors are open design decisions.

Charts use all rows returned for the selected statement. Pagination controls belong to the table. For example, when a query returns 800 rows and the table shows 50 per page, the chart uses all 800. Moving to page two leaves the chart unchanged.

**Chart setup is open for design.** The current X and Y column selectors give users too little control. Review what users need to configure for each chart type before specifying additional controls. How users choose a chart view remains open.

During implementation, revisit whether users need to choose a number format or a legend position. Both are candidate settings.

## Other query outcomes (draft)

- Give commands such as INSERT, UPDATE, DELETE, CREATE, and DROP a result message that describes the operation. For example, report an inserted row count when ClickHouse confirms it, or identify a table that was created. If a count is unavailable, describe the confirmed outcome without guessing.
- Distinguish a SELECT that matches zero rows from a successful command that returns no result set.
- Use one Query results panel. For a multi-statement run, show a statement selector in execution order. After a successful run, select the last statement. Selecting another outcome displays the recorded rows or command message without executing the statement again. For a single statement, show its outcome directly.
- On a confirmed statement error, stop the script. Keep the error at its position in the selector and open it in the panel with the statement number and database message. Preserve earlier results and confirmed changes and mark subsequent statements as skipped. If a write loses its connection before confirmation, report its outcome as unknown and leave retry to the user.

## Database sidebar and details drawer

- Show regular databases by default. Include system databases in the sidebar and its search results only when **Show system databases** is enabled.
- Preserve the existing sidebar search. Match database, table, and view names within the visible databases, including objects in collapsed groups.
- Selecting a table or view opens its details drawer. Keep **Overview** and **Columns**. Use **DDL** as the proposed label for **Create SQL** and continue showing the stored creation statement.
- Reduce the drawer header height and slightly tighten the drawer padding so more metadata fits in view.
- Redesign the tabs for the three detail views. Users should be able to identify the active view at a glance and switch between Overview, Columns, and the creation statement. Review the tab style and spacing in the drawer during implementation.
- When ClickHouse supplies a table or view comment, show it in **Overview** under **Description**. Show each available column comment beside its column in **Columns**. Omit the description when the corresponding comment is empty.

For review, search for a view inside a collapsed database, then search for a system table with system databases hidden and again with them visible. Open an object with both an object comment and a column comment and verify that each appears in its respective view.

## Activity log drawer

- Use the same compact header and tighter padding as the database details drawer. When a query is selected, give its details panel about 35% of the drawer body height so more of the query list stays visible.
- Remove the footer. Move the query count and the tip about the last 200 runs being stored in this browser to the top of the drawer.
- Fix the **All statuses** control so the dropdown icon is visible, aligned, and clear of the label. Selecting a status filters the list. Selecting **All statuses** restores all entries.
- Format the SQL shown in selected-query details. **Load in editor** restores the original SQL for editing without executing it.
- Label the action **Clear logs**. Open a confirmation dialog. Confirming clears all saved activity, including entries outside the active filter, and closes both the dialog and the drawer. Canceling keeps the drawer open and preserves the entries.
- Persist executed SQL and its activity metadata in browser local storage under `sql-editor-ui.query-activity.v1`, replacing `clickhouse.query-activity.v1`.

For review, reload after running a query and verify that its history is still visible. With a status filter applied, try canceling and then confirming **Clear logs**. Reopen the drawer after a reload and verify the confirmed clear persisted.

## Insert data from a file

1. **Insert data from a file** opens a modal. The user selects an existing destination table, then drops a CSV file into the modal or chooses it from a file picker. Show the qualified table name.
2. Upload the file to the server. Before writing any rows, validate the CSV header against the table schema and check the first 20 data records, or all records in a shorter file. Exclude the header from the count. A row passes if its values can be inserted into the mapped columns. Reject an empty or header-only file.
3. Show the verification result inside the modal. Enable **Import** only when the header and every sampled row pass. Report how many rows were checked. Mention further validation only if the file contains more data records. On failure, keep Import disabled and identify the first invalid record, column, and reason when available. Changing the file or destination requires a fresh check.
4. When the user clicks **Import**, process the verified upload on the server in bounded chunks. Continue validating subsequent rows and insert each row, including those in the sample, once per import.

Show the verification message beside **Import**. The server reports how many data records it checked and whether a 21st record exists. Use the selected table name and actual values in the message.

| Verification outcome | Example modal message | Import button |
| --- | --- | --- |
| All 8 records pass | All 8 rows passed validation for `default.orders`. Ready to import. | Enabled |
| All 20 records pass and the file ends | All 20 rows passed validation for `default.orders`. Ready to import. | Enabled |
| The first 20 records pass and a 21st exists | The first 20 rows passed validation. Remaining rows will be checked during import. | Enabled |
| A sampled value fails its column check | Data row 7 has `abc` in `amount`. Expected a number. Correct the CSV and upload it again. | Disabled |

Report completion after the whole import finishes. If a later chunk fails, explain the error and distinguish confirmed inserts from rows whose outcome is unknown. Progress display, final notification placement, and recovery are open for design.

For review, check header-only, shorter-than-20, exactly-20, and longer-than-20 files. An invalid 20th record must block Import with zero writes. An invalid 21st record must be caught during import. For a valid multi-chunk file and a file that fails after a successful chunk, compare the reported outcome with the actual table contents.

## AI assistant

- Use CopilotKit’s prebuilt CopilotChatInput as the optional floating composer. Configure voice dictation to fill the editable prompt for review and explicit submission. It expands on focus and as the prompt grows. Typed and dictated prompts share one conversation per open editor tab. Preserve recent context when the composer collapses or the assistant is toggled. A reload starts a fresh conversation.
- Use one free-form prompt for requests and follow-ups. Retire the Generate, Fix, Improve, and Explain presets and their action-specific request handling. Apply each assistant edit as one undoable change. For the first trial, make the editor read-only while the assistant works, indicate the busy state, and restore editing on success, failure, or cancellation.
- The assistant can use restricted schema metadata tools and configure the table or chart view. Only an explicit user Run action executes editor SQL. The assistant has no tool for executing user queries.
- A request can prepare SQL and a chart together. Bind the prepared view to that SQL. The latest choice made in the composer or through a selector wins. Populate the chart when the user successfully runs the associated SQL. For existing results, changing the view reuses those results.
- Connect the prebuilt input to the tab’s conversation through the CopilotKit runtime in Express. Keep model credentials and schema tools on the server. React owns editor edits and chart settings.

**Implementation trials.** Compare selection-only and whole-editor edits on a multi-statement script. Review the lock during chart-only requests, selector placement, clarification prompts, and the fallback when a chart cannot display the result. Decide whether the model needs actual result values. Start the trial with column names, types, and the SQL that produced the result.

**History and diagnostics.** Conversation history supplies context for follow-ups within the tab. The user-facing activity log records SQL the user runs. Preparing SQL, adding comments, or changing a chart creates no query activity entry.

For the assessment, the proposed diagnostic baseline is one trace ID per assistant request. Use it to link timestamped server events for the request, each model call, and each tool call the runtime reports. Include model or tool name, duration, outcome, a sanitized error category on failure, and token usage when the provider reports it. Log metadata by default. Exclude raw prompts, SQL, result rows, tool arguments and outputs, and credentials. A dedicated trace viewer such as Langfuse is an optional implementation choice.

**Acceptance examples**

- Generate a query and chart, override the chart type manually, then run the query. Verify the override takes effect and the activity log contains one execution. Changing the chart afterward must reuse the result.
- Give the assistant a definition in one turn and refer to it in a later typed or dictated request. Verify context survives toggling the composer. A fresh tab starts independently.
- Simulate a failed schema lookup. Verify editing becomes available again and the failed step is identifiable by trace ID without exposing the SQL or prompt in logs.

## Other workspace notes (draft)

- Keep toolbar controls for enabling or disabling the assistant, switching the color theme, running SQL, and opening the activity log.
- ClickHouse's UI component library is a design preference. The assessment permits other libraries.

Each feature will have acceptance tests and a manual review step when the vision is broken into stages. The assignment also calls for recording major decisions and tradeoffs in the decision log. See the [assessment requirements](../../README.md).

## Clarifications from the product review

- **Query result delivery.** Node.js reads the ClickHouse result incrementally and sends the browser one completed JSON response per statement. Include column names and types even when a query returns zero rows, so the table can still show its headers. If the toolbar includes ClickHouse’s rows-read statistic, label it separately from the number of rows returned or used by the chart.
- **Write notifications.** In **Query results**, show “Updated 12 rows in `default.orders`” when ClickHouse confirms that count. If it only acknowledges submission, show “Update submitted for `default.orders`.” Apply the same distinction to deletes. The editor’s default SELECT limit applies to displayed results. An `INSERT INTO … SELECT` must retain its full intended write scope.
- **Choosing what to run.** Run in the right-click menu follows the same selection and caret rules as the keyboard shortcut. A partial selection executes exactly as selected, including surfacing a database error for an invalid fragment. Toolbar **Run** executes the entire editor even with an active selection.
- **CSV verification and confirmation.** Count logical CSV records when reporting the sample size and failing record number. A newline inside a quoted field belongs to that record. A late verification response for a replaced file or destination must leave the current Import action disabled until the current pair passes. Repeated confirmation of the same import must insert its records only once.
- **Assistant conversation.** A follow-up uses earlier turns even while the conversation transcript is hidden. For example, after asking for registrations over the last three months, the user can reopen the composer and ask “Group those by week” without restating the date range.
- **Test timing.** Each stage describes acceptance scenarios during planning. Write and run the automated tests alongside the corresponding feature during implementation, then review the behavior in the running app.

### Open for implementation review

- **Wide results.** Evaluate a result with large text columns when choosing whether to add a byte limit. The 5 MB figure discussed during review was an example. The product decision so far covers row limits.
- **Activity drawer sizing.** The original target was about 35% of the screen for query details, compared with roughly 50% in v1. The drawer section above interprets that as a share of the drawer body height. Confirm the dimension and reference area against the running layout before styling it.
