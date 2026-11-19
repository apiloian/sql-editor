# Working on the ClickHouse SQL editor

This directory contains the React client and the product specifications. The parent directory contains the Express server, ClickHouse setup, and [assessment brief](../README.md).

## Product and stage work

- For intended behavior, read the [product requirements](product/product-requirements.md), including the review clarifications at the end. For the stage under discussion, use its file in the [stage index](product/stages/README.md). Stage documents describe the planned rework. Inspect the running code before describing what v1 already supports.
- When reviewing a stage, update the requested document in English. Describe what the user can do, what the client and server each handle, and how to recognize success or failure. Treat examples as illustrations of supported behavior. Keep decisions marked open until the user resolves them or delegates the choice during implementation.
- During planning, write acceptance scenarios and expected outcomes. During implementation, write and run explicit tests alongside each feature, then exercise its manual review scenario. Record significant implementation tradeoffs in the relevant [client](DECISION_LOG.md) or [project](../DECISION_LOG.md) decision log.

## Running and checking changes

| Working directory | Commands | Purpose |
| --- | --- | --- |
| Parent directory | `docker compose up -d`, then `npm start` | Start ClickHouse and the Express API for live checks. |
| This directory | `npm run dev` | Start the editor. Its [Vite proxy](vite.config.ts) forwards API requests to Express. |
| This directory | `npm test -- tests/pagination.spec.ts` | Run a focused Playwright suite. Substitute the suite for the feature being changed. |
| This directory | `npm run lint` and `npm run build` | Check the client and its production build. |
| Parent directory | `npm test` | Run the server package’s tests. |

Playwright starts its own Vite instance. Check whether a browser test mocks the API before treating it as evidence of database behavior. For changes that affect writes or cancellation, verify the outcome against a disposable ClickHouse table or query.
