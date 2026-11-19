# 5. Visualize results

Build on the returned rows and column information from stage 1. Start with the chart configuration helper and results chart component.

- [ ] Render bar, area, line, and pie charts for suitable results. Share the selected statement’s full returned dataset with the chart and preserve its truncation notice. Keep paging controls in the table.
- [ ] Review example datasets to choose the controls each chart needs. Evaluate number formatting, legend placement, and category colors during this stage.
- [ ] Match each pie leader line to its slice. Hovering emphasizes the slice, connector, and label together. Support zoom and reset on bar charts.

**Tests.** Use 800 returned rows with 50 visible in the table. Verify that all 800 reach the chart and paging makes no chart change or query request. Cover each chart type, an empty or unsuitable result, truncation, bar zoom/reset, and pie hover followed by pointer exit.

**Review.** Switch between table and chart on the same run. Compare pie labels and connectors for several categories, then zoom into a bar chart and restore its full range.
