# 2. Edit SQL and run scripts

A user can keep several statements in one editor, run the SQL they intend, and see what happened to each statement. For example, they can run a multiline query from its WHERE clause, select two statements to execute together, or run an entire script that creates a table, inserts rows, and reads them back. If the insert fails, the editor should take the user to that error and keep the earlier creation outcome available.

[Product requirements](../product-requirements.md) · [Stage 1 statement outcomes](01-query-results.md)

## Stage 1 foundation

The workspace opens with an empty Monaco editor, a visible assistant composer, and controls for editing history, theme, and activity. Stage 1 added sequential execution and a results panel that retains one outcome per statement. Express already owns the 10-minute deadline and uses the ClickHouse query ID to request cancellation. [Workspace](../../src/App.tsx) · [Server execution](../../../src/query/execution.ts)

## Choosing what runs

The shortcut is Cmd+Enter on macOS and Ctrl+Enter on Windows/Linux.

| User action | Expected behavior |
| --- | --- |
| Select SQL and use popup Run or the shortcut | Execute the selected text. If several statements are selected, execute them in their source order. A partial selection stays within the selected range. If it is invalid SQL, surface the error for that selection. |
| Place the caret in a statement and use popup Run or the shortcut | Execute the complete statement containing the caret, including all its lines. Adjacent statements stay available for a separate run. |
| Choose toolbar Run | Execute the entire editor in source order, including when a selection is active. |

Identify statement boundaries using semicolons outside quoted SQL text, quoted identifiers, and comments. Blank lines can occur inside a statement. The final statement can end at the end of the selection or editor without a trailing semicolon. Preserve the user's SQL in the editor. These rules apply to reads, writes, schema changes, and mixed scripts.

## Following a run and recovering from failure

Execute statements sequentially. Start the next statement after ClickHouse confirms the outcome of the preceding request. For a write acknowledged as submitted, keep that distinction in its message. Use the row, command, error, and unknown-write outcomes defined in Stage 1.

- **Single statement.** Show its outcome directly in **Query results**.
- **Successful multi-statement run.** Show one ordered statement selector in that panel. Open the last outcome by default. Selecting an earlier statement restores its recorded rows or operation message without another request or repeated write.
- **Confirmed error.** Stop at the failing statement, select it, and show its position and the ClickHouse message. Keep earlier results and confirmed changes available. Identify every later statement as skipped.
- **Timeout or lost confirmation.** Start a fresh 10-minute server deadline for each statement. Keep the browser request open long enough to receive the server outcome. On expiry, abort the in-flight request, request cancellation of that query in ClickHouse, and show the timed-out statement and duration. Stop the run. If a write lost confirmation, report its outcome as unknown and leave retry to the user. The editor must be ready for a subsequent explicit Run.

## Editing in the workspace

Keep undo and redo available in the toolbar. Ctrl+Left and Ctrl+Right move between word boundaries. Cmd+/ on macOS and Ctrl+/ on Windows/Linux toggle SQL line comments on the current line or all selected lines. Toggling twice restores the original SQL and indentation.

Double-click selects the word. Right-click opens the compact action popup beside the pointer. Its actions must remain visible and clickable above adjacent panels, including near the viewport edge and when the floating composer is expanded. Preserve the empty startup editor, visible composer, assistant toggle, theme switch, and activity-log access. Database-aware autocomplete is specified with the schema work in [Stage 4](04-schema-and-activity.md).

## Acceptance scenarios to automate during implementation

| Scenario | Observable result |
| --- | --- |
| Run the middle of three statements | With the caret on the FROM line of a multiline middle query, popup Run and the platform shortcut each submit only that complete query. |
| Selection takes precedence | Select two statements out of three. The shortcut executes those two in order. With the same selection, toolbar Run executes all three. Selecting an invalid fragment surfaces its error and leaves surrounding SQL unexecuted. |
| Delimiters within SQL | Use a quoted semicolon, a quoted identifier containing a semicolon, line and block comments containing semicolons, a blank line within a statement, and a final statement without a terminator. Verify the exact SQL boundaries and execution order. |
| Successful mixed script | Create a disposable table, insert a known row, and select it. Verify all three outcomes in order and that the last is selected. Switch between them and confirm the insert happened exactly once. |
| Middle statement fails | Make the first write succeed, the second statement fail, and the third write a recognizable value. Verify the error is selected, the first change persists, and the third value was never written. Fix the failed SQL and rerun it from the caret. |
| Middle statement times out | Verify the 10-minute default and that a statement completing after 60 seconds can still succeed. Use a simulated clock or a short test deadline to exercise expiry. Verify the timeout duration and statement position, cancellation in ClickHouse, the skipped final statement, and a successful subsequent run. Simulate loss of write confirmation and verify the unknown outcome and absence of an automatic retry. |
| Editor shortcuts and workspace | From an empty workspace, type, undo, and redo. Navigate a line in both directions by word. Toggle comments twice on one line and an indented multiline selection. Check surrounding lines and toolbar access with the composer visible and hidden. |
| Popup after scrolling | Right-click near different editor edges with the composer open and the results panel visible. Verify the menu follows the pointer, remains within the viewport, and accepts a click on Run or Format. |

During implementation, cover SQL boundaries with focused tests, database effects and cancellation with ClickHouse integration tests, and shortcut, popup, and selector behavior with Playwright. The existing [browser smoke test](../../tests/app.spec.ts) and [server query tests](../../../tests/query-commands.test.ts) provide starting points. Run server tests with `npm test` from the repository root and browser tests with `npm test` from `client/`.

**Manual review.** Run a mixed script, inspect each outcome, then introduce an error in the middle. Correct and rerun just that statement with the shortcut. Right-click near the bottom of the editor and use the menu after resizing the results panel.

## Implementation decisions

At a semicolon, caret execution uses the statement that ends there. In the gap after it, caret execution uses the following statement. Trailing whitespace after the last statement belongs to that last statement. Right-click inside an existing selection keeps that selection. Elsewhere, popup Run uses the clicked statement.

The results panel uses an ordered selector to switch between recorded outcomes.

Playwright covers editor controls, statement boundaries, and switching recorded outcomes. The live script checks use disposable ClickHouse tables and confirm write order, recovery after an error, and cancellation under a two-second test deadline. A separate live query returned successfully after 62 seconds. [Editor tests](../../tests/editor-scripts.spec.ts) · [SQL boundary tests](../../tests/sql-run-scope.spec.ts) · [Live script tests](../../tests/statement-timeout.spec.ts)
