# Honor frontend pagination in POST /query

Work in the existing Express backend under `src` in the parent project. Do not create a server in `client`. The frontend implementation is already in place.

The frontend owns pagination settings. It defaults to page 1 and 50 rows per page. Its selector supports 25, 50, 100, and 500 rows. Every page request sends:

```json
{ "query": "SELECT * FROM trips ORDER BY trip_id", "page": 1, "pageSize": 50 }
```

Return at most the requested number of rows and this response shape:

```json
{
  "rows": [],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "hasMore": false
  }
}
```

`pagination.totalRows` is optional. Include it only when an accurate total result count is available. The frontend can navigate without a total. Do not invent a total from the current page length or return an extra lookahead row to the browser.

Validate that page is a positive safe integer and pageSize is an allowed positive size. Enforce a backend safety maximum of 500 rows. Honor the requested values rather than overriding them with a backend UI default. Compute the offset as `(page - 1) * pageSize` and validate it remains a safe integer. Reject malformed pagination with JSON `{ "error": "..." }` and a suitable HTTP status.

Apply pagination to the query result on the server, rather than downloading all results and slicing in memory. Use an extra lookahead row or an appropriate ClickHouse mechanism to establish hasMore. Preserve the submitted SQL's semantics, including its existing LIMIT, OFFSET, ORDER BY, and trailing comments. Do not append LIMIT/OFFSET naively. Do not execute statements with side effects a second time to obtain counts. Consult current ClickHouse documentation for safe handling of SELECT, WITH, SHOW/DESCRIBE, and commands without tabular output. Reject unsupported paginated statement types clearly instead of silently ignoring pagination. Queries without deterministic ordering may change between pages; no stable server result snapshot is assumed by the current frontend contract.

Keep the existing behavior when both pagination fields are omitted. The database sidebar and metadata drawer still call POST /query with only `{ "query": "..." }` and require the existing `{ "rows": [...] }` response without an implicit 50-row cap. Preserve ClickHouse connection header forwarding and existing assistant routes.

Paging uses the SQL from the last successful Run, even if the editor text changes afterward. Page changes and page-size changes do not create additional activity-log entries. If a page request fails, the frontend keeps the previous page and shows the error.

Do not run tests or live database commands yet. Report changes and how to restart the existing Express backend.
