# 5. Visualize query results

After running SQL, a user can switch from inspecting individual rows to answering a question about those same rows. They might compare revenue across products, follow registrations over time, or see how much each category contributes to a total. They should be able to tell which columns they are looking at, which rows the chart represents, and how to inspect a crowded chart. [Product requirements](../product-requirements.md#query-result-charts)

## Where the product starts

The results panel already offers Table, Bar, Area, Line, and Pie. It passes the selected statement’s full returned dataset to ECharts, keeps pagination in the table, and displays the truncation notice in both views. Setup currently consists of two column selectors. The chart uses eight theme colors, gives every pie connector the same muted color, and has no bar zoom or explicit pie hover treatment that fades the other slices and labels together. [Results panel](../../src/components/ResultsTable/ResultsTable.tsx) · [Chart component](../../src/components/ResultsChart/ResultsChart.tsx) · [Value handling](../../src/lib/chart.ts)

## The first implementation

| What the user wants to do | Expected experience |
| --- | --- |
| Compare categories | Choose a **bar chart**, identify the category and numeric measure, and inspect their values. Drag across the bars in the plot and release to zoom into that category range. **Reset zoom** restores the full range. |
| See a trend | Choose **line** or **area** for an ordered result such as registrations by month. Both show the values in query order. The area view fills the region under the line. Missing measures remain visible as gaps. Drag across the plot to zoom and use **Reset zoom** to restore the full range. |
| Understand a share | Choose **pie** for a category and a nonnegative measure with at least one positive value. Give every slice’s leader line the color of its slice. As in the reference image, hovering over a slice keeps the slice, line, and label prominent, fades the others together, and shows the category and value. Moving to a second slice transfers focus. Moving off the pie restores the full view. |
| Configure or correct a chart | Make the choice specific to the chart. For example, a user comparing products should recognize which field identifies the product and which measures revenue. For a pie, they should recognize which field names a slice and which determines its size. Let them inspect and change those choices using columns from the selected result. If the fields are unsuitable, explain which kind of value is needed and keep the table available. |
| Distinguish categories | Use a small palette with enough distinct colors to avoid unnecessary repetition. Keep the mark, its connector, and its tooltip marker consistent. Check readability in both editor themes and with enough categories for colors to repeat. Labels and tooltips should still identify a category when a color is reused. |

For the first pass, try suggesting a category and measure when column names and types make the choice straightforward. Allow the user to override them. This is a design to evaluate with real results. The layout of the controls and the final defaults can be refined after using the first implementation.

The first pass uses **Category** and **Measure** for bar, line, and area, and **Slice label** and **Slice size** for pie. Axis titles use the selected field names with the first letter capitalized. Pie cycles through ten theme colors in result order.

Bar, Line, and Area offer an optional **Split by** field. Each distinct split value gets its own labeled series. Bar draws side-by-side bars. Line and Area overlay series on the same category axis. Pie uses its slice controls. Split charts preserve the category order from the result and leave missing entries as gaps. Return one row per category and split value and use at most eight series. The chart explains when to group or filter the SQL.

## What data the chart represents

- The server supplies the existing statement outcome, including ordered columns, types, rows, and truncation status. The frontend configures and renders the chart from that outcome. Switching view, changing a field, hovering, or zooming requires zero additional query executions.
- A chart uses all rows returned for the selected statement. If the table shows 50 of 800 returned rows, the chart receives 800. If the default limit truncated the result, show the same notice in the chart. Honor larger explicit SQL limits. Counts reported as rows read by ClickHouse describe database work.
- SQL controls sorting and aggregation. For example, to plot total revenue per product, use the result of a query that groups by product. Two returned orders for the same product remain two observations unless the SQL combines them.
- For an empty result, a command acknowledgment, or a failed statement, retain the corresponding Stage 1 outcome. Switching script statements must never leave a previous statement’s data visible as the new chart. For missing or unplottable values, preserve the existing explanation of gaps or omitted pie slices.
- Manual chart setup works independently of the assistant. The later assistant stage can prepare a view for particular SQL and populate it after the user runs that SQL. [Stage 6](06-assistant.md)

## Acceptance scenarios for implementation

| Scenario | What to verify |
| --- | --- |
| Page through an 800-row result and switch to a chart | A value found only on the last page is represented from either page. Changing the page, view, or field makes no additional query request. Keep the existing browser coverage for this behavior and for the truncation notice. |
| Compare two measures for the same categories | Return a product name, order count, and revenue. Switch the measure from count to revenue and check the displayed values against the table. Switch to a statement with different columns and verify its chart uses valid fields from that result. |
| Inspect ordered monthly data | Plot the same result as line and area. Zoom into a range containing a missing measure, then reset. Verify order, values, the area fill, and the gap. |
| Compare monthly data by channel | Set **Split by** to channel in Bar, Line, and Area. Verify that the series align on month, a missing channel value leaves a gap, and Pie has only its slice controls. Try a duplicate category/channel pair or more than eight channels and check the SQL guidance. |
| Follow a pie label | Use several distinct categories. Hover one slice, then another, then leave the chart. Check connector colors, label emphasis, the tooltip value, and restoration in both themes. |
| Inspect a dense bar chart | Click a bar to inspect it. Drag across a range in the plot in either direction. Drag again to narrow the range. Reset and verify that all categories return with the original values and row count. |
| Inspect an unsuitable result | Try text-only data, an empty SELECT, and negative or all-zero pie values. Verify that the user can see the result or a useful explanation and return to the table. |

Write automated tests alongside implementation. The existing [browser result tests](../../tests/pagination.spec.ts) cover full-result chart scope and truncation. Use the running editor for visual review of hover emphasis, repeated colors, label legibility, and zoom.

## Review after the first implementation

Use three examples in the running app: revenue by product for bar zoom, registrations by month for line and area, and a product mix for pie hover. Review them once with a few categories and again with crowded labels. Then decide:

- Which setup controls or suggestions genuinely help, and where should the view selector live?
- Would number formatting or legend placement solve a visible problem in these examples?
- How many colors are useful before reuse, and how strongly should other slices fade?

These are follow-up design choices. The first implementation includes four chart types, shared result scope, pie interaction, and drag zoom in bar, line, and area.
