# 1. Execute SQL and inspect each statement’s outcome

A user can read data, change it, and manage database objects from the editor. After each execution they can answer three questions: which statement ran, what did ClickHouse confirm, and where can I inspect the result? A typical review session might create a table, insert rows, update a value, and query the table to check the change. These are examples of ordinary editor use. They do not define a list of allowed SQL commands.

The [product requirements](../product-requirements.md) define the behavior. This stage covers execution and the results a user sees. The same behavior applies when the editor supplies a selection, a statement at the caret, or several statements in sequence.

## What Query results shows

| What happened | What the user sees |
| --- | --- |
| ClickHouse returned rows | A table with the returned columns, names, and values. This applies to a SELECT, a query beginning with WITH, and commands returning tabular information such as SHOW TABLES or DESCRIBE TABLE. |
| A query matched zero rows | A successful empty result with its column headers and an indication that the query returned zero rows. |
| A write was accepted or completed | An operation-specific message for INSERT, UPDATE, or DELETE identifying the target when known. Include an affected-row count when ClickHouse confirms one. If ClickHouse only acknowledges submission of a mutation, describe it as submitted. |
| A schema operation succeeded | A message describing the confirmed CREATE, ALTER, or DROP operation and the affected object when known. |
| ClickHouse rejected a statement | Show the database error with the statement that caused it. The editor is ready for correction and another run. |
| The 10-minute statement deadline expired | Identify the statement and timeout duration. The server aborts the in-flight request and requests cancellation of the corresponding ClickHouse query. If confirmation of a write was lost, show its outcome as unknown and leave retry to the user. |

Present these outcomes in one **Query results** panel. Show elapsed time with its unit. For a standalone command, show its outcome directly. For a script, keep each outcome associated with its SQL and position so users can revisit a result without rerunning a read or repeating a write. A script that finishes successfully opens on the last outcome. On the first confirmed failure or timeout, show that statement, preserve earlier results and confirmed changes, and mark the remaining statements as skipped. [Stage 2](02-editor-and-scripts.md) covers how the editor identifies statements, runs them in order, and lets users switch between their outcomes.

## Which rows belong to a run

- Honor an explicit outer SELECT limit and offset, including a request larger than 10,000 rows. If the outer query has no limit, apply the 10,000-row default in ClickHouse. A limit inside a subquery counts only for that subquery. Preserve the SQL the user wrote in the editor.
- When additional rows exist beyond the default, show “Showing the first 10,000 rows. To return more, add a LIMIT to your query.” Exactly 10,000 matching rows is a complete result. Keep this information with the returned rows so the table and chart can both display it.
- Apply this policy to the output of a SELECT the user runs. A write can read other rows as part of its work. For example, an INSERT INTO … SELECT must retain the user's intended insert scope.
- Fetch the result once per execution. The table pages through that result locally. A chart uses all rows returned for the selected statement, including those beyond the visible page. [Stage 5](05-charts.md) covers chart presentation.

## Working with the results table

The toolbar reads **Query results** and includes elapsed time. Remove the results search field. Every data column can be widened or narrowed independently, with headers and cells staying aligned. The default page size is 50. Offer 25, 50, 100, 500, and 1,000. Make Next and Last distinguishable so a user stepping through a result can reliably reach the next page. Page and page-size changes reuse the data already in the browser.

## Acceptance scenarios to automate during implementation

| Scenario | What the automated tests should verify |
| --- | --- |
| Create and change data | In a disposable database, create a table, insert known rows, update a value, delete a row, and drop the table. Check the message after each operation. Use follow-up reads to verify data changes once applied. Exercise both a confirmed count and an acknowledgment without a count. |
| Inspect data and metadata | Read populated rows, a filtered query with zero matches, and a schema result such as DESCRIBE TABLE. Verify column headers, values, elapsed time, and the distinction between an empty table and a command acknowledgment. |
| Apply limits | Test exactly 10,000 and 10,001 matches without an outer limit. Test explicit limits of 100 and 25,000, an offset, and a limit in a subquery. Compare the actual rows and truncation message. Verify a write with a SELECT source retains its intended scope. |
| Browse 800 returned rows | Widen a long-text column, move from page one to page two at 50 rows per page, then choose 100 per page. Check the values and headers, distinguish Next from Last, and verify zero additional server requests. Switching to a chart should use all 800 rows. |
| Recover from an execution error | Run invalid SQL and inspect the database message. Correct it and run again. For a mixed script, verify that earlier outcomes remain inspectable, the error is selected, and subsequent SQL was skipped. |
| Recover from a timeout | Run a script with a confirmed write, a slow write, and a final write. Use a short server deadline. Verify that the panel selects the timed-out statement, shows its deadline and unknown write outcome, and keeps the earlier acknowledgment available. Confirm cancellation in ClickHouse, confirm the final write did not run, and run a follow-up read from the editor. |

The existing server and browser suites provide starting points for automated coverage. Exercise database effects and cancellation against ClickHouse, and verify result messages, column resizing, and local pagination in the browser. [Server query tests](../../../tests/query-commands.test.ts) · [Browser result tests](../../tests/pagination.spec.ts)

**Manual review.** Run a write and a follow-up read in the editor. Check whether the write message makes clear what ClickHouse confirmed. Browse and resize the results table to assess whether the navigation controls and column widths work well with real data.

## Frontend verification

On November 18, 2026, Playwright exercised the running editor against local ClickHouse. An empty result kept its column header and showed zero rows. A separate 800-row result let the user widen a column, go to the next page, and change the page size to 100. Switching between the two outcomes and paging sent zero additional queries.

In a three-statement run, ClickHouse rejected the second statement. The panel selected it and displayed the database error, kept the first result available, and marked the third statement as skipped. Run became available again.

In the live timeout test, the browser showed statement 2 of 3 while it ran. When the deadline expired, the panel selected the timed-out write, showed its deadline, and reported its outcome as unknown. Playwright verified that the first write persisted exactly once, the last write never ran, ClickHouse recorded the cancellation, and a follow-up read succeeded. [Live timeout test](../../tests/statement-timeout.spec.ts)

The browser expects one typed outcome per statement from Express. If an open editor shows the earlier “The server response does not contain valid result rows” message, reload the editor and run a read such as `SELECT 1 AS review`. The current frontend displays the `review` column and its value in **Query results**.

## Decisions for implementation

Evaluate very wide results during implementation. The byte policy remains open. The pagination layout and additional toolbar metadata can be reviewed in the running app.
