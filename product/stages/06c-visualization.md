# 6C. Prepare a table or chart with the assistant

**Outcome.** The assistant can prepare SQL and its intended view in one conversation, or change the presentation of data the user already fetched. Build on [6A](06a-conversation.md), [6B](06b-sql-editing.md), and the [Stage 5 charts](05-charts.md).

**Starting point.** The results panel already selects a statement outcome and supports table, bar, line, area, and pie views with field choices. The current assistant response supplies SQL. This part connects a proposed view to the relevant statement and to the existing controls. [Results panel](../../src/components/ResultsTable/ResultsTable.tsx) · [Chart fields](../../src/lib/chart.ts)

**Implementation scope**

- **Before Run.** For a request such as “Show registrations over the last three months as a weekly line chart,” prepare SQL and an editable view choice. Associate that choice with the SQL it belongs to. The chart receives data only after the user runs that statement successfully. An edit, an unrelated run, or another statement in the same script must never silently populate the prepared view with different data.
- **After Run.** For “Show this result as a bar chart,” reuse the selected statement’s already-returned rows. Switching the view or adjusting its fields adds zero query executions. Preserve Stage 5 behavior for truncation, unsuitable data, and table pagination.
- **Client and server.** The server returns a validated view suggestion, optionally alongside SQL. Start with column names, types, and the associated SQL as model context. React validates suggested fields against the actual result and applies the most recent user choice, whether expressed in the composer or the chart controls. Keep the table accessible when the proposed chart cannot be drawn.
- **UX trial.** Try a text request first. Review whether a visualization selector or toggle adds value, whether a view-only request needs an editor lock, when to ask a clarifying question, and whether result values are needed beyond metadata. Leave those choices for the working version.

**Acceptance and review.** Prepare SQL and a line chart. Override it to bar before Run and confirm the chart stays unpopulated. Run the matching statement and verify the chosen chart and one query activity entry. Switch back to the table or request a view change and verify zero additional executions. Test an edited query, two statements with similar columns, a failed run, and a missing or unsuitable measure. Each must keep the displayed data associated with the correct statement and give the user a usable next action. For manual review, repeat the registrations example on an existing result and compare the workflow with preparing the view before Run.


**Working version.** Ask for a view in the composer. Use **Prepared view** to override the chart type while the statement waits for Run. You can still inspect any earlier results. Editing the SQL clears the prepared view. If the matching statement fails, you can retry it or edit it and prepare the view again. If the result cannot support the suggested chart, the table displays the returned rows and explains the problem.

Express validates the model's suggestion and sends it as a CopilotKit AG-UI custom event. React receives the suggestion after a successful turn and owns the editor binding, view controls, and column validation. For an existing result, the assistant receives the selected statement's SQL and column metadata. The first trial keeps the editor lock during all assistant turns. Review that behavior and the clarification prompts with the working app.
