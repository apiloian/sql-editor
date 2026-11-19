# Implementation stages

Work through one stage at a time. During planning, describe each feature’s acceptance scenarios and expected outcomes. During implementation, write and run explicit automated tests for those scenarios alongside the feature. Use the running app for the stage’s manual review. The [product requirements](../product-requirements.md) define the intended behavior.

| Stage | Outcome to review | Depends on |
| --- | --- | --- |
| [1. Execute SQL and inspect each statement’s outcome](01-query-results.md) | Query data and schema, run writes and schema changes, inspect returned rows or command outcomes, and recover from errors and timeouts. | Existing v1 |
| [2. Edit and run scripts](02-editor-and-scripts.md) | Run a selection, a statement, or a script and recover from a failed statement. | 1 |
| [3. Import CSV](03-csv-import.md) | Verify a file, import it, and query the inserted rows. | 1 and the existing schema browser |
| [4. Explore schema and activity](04-schema-and-activity.md) | Find database objects, complete identifiers, and inspect previous runs. | 1–2 |
| [5. Visualize results](05-charts.md) | Explore one execution’s rows in a table or chart. | 1 |
| [6. Work with the assistant](06-assistant.md) | Refine SQL across turns and prepare a chart for a manual run. | 1, 2, 4, 5 |

The proposed order delivers the assessment’s main requirement first and its named CSV bonus before chart and assistant work. Stage numbers indicate review order. The dependency column identifies which work can move earlier.

For each stage, extend the closest existing test suite, run the focused tests, and demonstrate the review example. From the repository root use `npm test` for server tests. From `client/` use `npm test -- tests/<suite>.spec.ts` for a Playwright suite and `npm run build` for the client build. Record major implementation tradeoffs in the project's decision log.
