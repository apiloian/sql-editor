import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type QueryColumn = { name: string; type: string }
type QueryOutcome = { durationMs: number } & (
  | { kind: 'rows'; columns: QueryColumn[]; rows: unknown[][]; truncated: boolean }
  | { kind: 'command' | 'error' | 'unknown'; message: string }
  | { kind: 'timeout'; timeoutMs: number; writeOutcomeUnknown: boolean }
)

const browseSql = 'SELECT number, detail, metric FROM browser_fixture ORDER BY number'
const browseColumns = [
  { name: 'number', type: 'UInt32' },
  { name: 'detail', type: 'String' },
  { name: 'metric', type: 'Nullable(UInt32)' },
]
const browseRows = Array.from({ length: 800 }, (_, index) => [
  index + 1,
  `Record ${index + 1} ${'long text '.repeat(20).trim()}`,
  index === 799 ? 9123 : null,
])

function rowsOutcome(columns: QueryColumn[], rows: unknown[][], truncated = false): QueryOutcome {
  return { kind: 'rows', columns, rows, truncated, durationMs: 37 }
}

async function runSql(page: Page, editorSql: string, outcomes: Record<string, QueryOutcome>, followupSql?: string) {
  await page.addInitScript((statements) => {
    localStorage.setItem('sql-editor-ui.query-activity.v1', JSON.stringify(statements.map((sql, index) => ({
      id: `results-seed-${index}`, sql, startedAt: Date.now() - index, database: 'default',
      status: 'success', duration: 1, rowCount: 0,
    }))))
  }, followupSql ? [editorSql, followupSql] : [editorSql])

  const requests: string[] = []
  await page.route('**/query', (route) => {
    const body: unknown = route.request().postDataJSON()
    if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
      throw new Error('Expected a query string in the request body.')
    }
    expect(route.request().method()).toBe('POST')
    const query = body.query.trim().replace(/;$/, '').trimEnd()
    if (query.includes('FROM system.databases')) {
      return route.fulfill({ json: rowsOutcome([
        { name: 'name', type: 'String' }, { name: 'engine', type: 'String' },
        { name: 'current_database', type: 'String' },
      ], [['default', 'Atomic', 'default']]) })
    }
    if (query.includes('FROM system.tables WHERE is_temporary = 0')) {
      return route.fulfill({ json: rowsOutcome([
        { name: 'database', type: 'String' }, { name: 'name', type: 'String' }, { name: 'engine', type: 'String' },
      ], []) })
    }
    expect(body).toEqual({ query: body.query })
    requests.push(query)
    const outcome = outcomes[query]
    if (!outcome) throw new Error(`Unexpected query: ${query}`)
    const status = outcome.kind === 'timeout' ? 504 : outcome.kind === 'unknown' ? 502 : outcome.kind === 'error' ? 422 : 200
    return route.fulfill({ status, json: outcome })
  })

  await page.goto('/')
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await page.getByRole('button', { name: 'Load in editor' }).click()
  const run = page.getByRole('button', { name: 'Run', exact: true })
  await run.click()
  const results = page.getByRole('region', { name: 'Query results' })
  await expect(results).toBeVisible()
  return { results, requests, run }
}

test('pages through 800 rows locally and widens a column with its cells', async ({ page }) => {
  const { results, requests } = await runSql(page, browseSql, {
    [browseSql]: rowsOutcome(browseColumns, browseRows),
  })
  await expect(results.getByRole('heading', { name: 'Query results', exact: true })).toBeVisible()
  await expect(results.getByRole('status').filter({ hasText: /\b37\s*ms\b/ })).toBeVisible()
  await expect(results.getByLabel('Search results')).toHaveCount(0)
  const table = results.getByRole('table')
  const rows = table.getByRole('row').filter({ has: page.getByRole('cell') })
  const firstPage = results.getByRole('button', { name: 'First page', exact: true })
  const previousPage = results.getByRole('button', { name: 'Previous page', exact: true })
  const nextPage = results.getByRole('button', { name: 'Next page', exact: true })
  const lastPage = results.getByRole('button', { name: 'Last page', exact: true })
  const pageSize = results.getByRole('combobox', { name: 'Results per page' })

  await expect(pageSize).toHaveValue('50')
  await expect(pageSize.getByRole('option')).toHaveCount(5)
  for (const size of ['25', '50', '100', '500', '1000']) {
    await expect(pageSize.locator(`option[value="${size}"]`)).toHaveCount(1)
  }
  await expect(rows).toHaveCount(50)
  await expect(firstPage).toBeDisabled()
  await expect(previousPage).toBeDisabled()
  expect(requests).toEqual([browseSql])

  const resize = table.getByRole('separator', { name: 'Resize detail' })
  const detailHeader = table.getByRole('columnheader').filter({ has: page.getByRole('separator', { name: 'Resize detail' }) })
  const detailCell = rows.first().getByRole('cell', { name: /^Record 1 / })
  await resize.scrollIntoViewIfNeeded()
  const handle = await resize.boundingBox()
  const before = await detailHeader.boundingBox()
  if (!handle || !before) throw new Error('Expected a visible column header and resize handle.')
  const pointer = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 120, pointer.y, { steps: 6 })
  await page.mouse.up()
  const header = await detailHeader.boundingBox()
  const cell = await detailCell.boundingBox()
  if (!header || !cell) throw new Error('Expected the resized header and its first cell.')
  expect(header.width).toBeGreaterThan(before.width + 60)
  expect(Math.abs(header.x - cell.x)).toBeLessThan(1)
  expect(Math.abs(header.width - cell.width)).toBeLessThan(1)

  await nextPage.click()
  await expect(rows.first().getByRole('cell').first()).toHaveText('51')
  await expect(rows.last().getByRole('cell').first()).toHaveText('100')
  await pageSize.selectOption('100')
  await expect(rows).toHaveCount(100)
  await lastPage.click()
  await expect(rows.first().getByRole('cell').first()).toHaveText('701')
  await expect(rows.last().getByRole('cell').first()).toHaveText('800')
  await expect(nextPage).toBeDisabled()
  await expect(lastPage).toBeDisabled()
  await previousPage.click()
  await expect(rows.first().getByRole('cell').first()).toHaveText('601')
  await firstPage.click()
  await expect(rows.first().getByRole('cell').first()).toHaveText('1')
  await pageSize.selectOption('1000')
  await expect(rows).toHaveCount(800)
  await expect(rows.last().getByRole('cell').first()).toHaveText('800')
  await expect(nextPage).toBeDisabled()
  expect(requests).toEqual([browseSql])
})

test('charts all 800 rows regardless of the table page', async ({ page }) => {
  const { results, requests } = await runSql(page, browseSql, {
    [browseSql]: rowsOutcome(browseColumns, browseRows),
  })
  const chart = results.getByRole('img', { name: /\b9123\b/ })
  const chartDataNote = results.getByRole('status').filter({ hasText: /\b799 values are missing\b/ })
  const pie = results.getByRole('button', { name: 'Pie', exact: true })
  await pie.click()
  await results.getByRole('combobox', { name: 'Category' }).selectOption('number')
  await results.getByRole('combobox', { name: 'Value' }).selectOption('metric')
  await expect(chart).toBeVisible()
  await expect(chartDataNote).toBeVisible()
  await expect(results.getByRole('combobox', { name: 'Results per page' })).toHaveCount(0)

  await results.getByRole('button', { name: 'Table', exact: true }).click()
  await results.getByRole('button', { name: 'Next page', exact: true }).click()
  const firstRow = results.getByRole('row').filter({ has: page.getByRole('cell') }).first()
  await expect(firstRow.getByRole('cell').first()).toHaveText('51')
  await pie.click()
  await expect(chart).toBeVisible()
  await expect(chartDataNote).toBeVisible()
  expect(requests).toEqual([browseSql])
})

test('preserves column names for a query that returns zero rows', async ({ page }) => {
  const sql = 'SELECT number, detail, metric FROM browser_fixture WHERE false'
  const { results, requests } = await runSql(page, sql, { [sql]: rowsOutcome(browseColumns, []) })
  const table = results.getByRole('table')
  for (const { name } of browseColumns) {
    await expect(table.getByRole('columnheader').filter({ hasText: name })).toBeVisible()
  }
  await expect(table.getByRole('cell')).toHaveCount(0)
  await expect(results.getByText(/(?:\b(?:zero|0)\s+rows\b|\breturned no rows\b)/i).first()).toBeVisible()
  expect(requests).toEqual([sql])
})

test('shows the truncation notice in both the table and chart views', async ({ page }) => {
  const sql = 'SELECT number FROM numbers(10001)'
  const rows = Array.from({ length: 10_000 }, (_, number) => [number])
  const { results, requests } = await runSql(page, sql, {
    [sql]: rowsOutcome([{ name: 'number', type: 'UInt32' }], rows, true),
  })
  const notice = results.getByText('Showing the first 10,000 rows. To return more, add a LIMIT to your query.', { exact: true })
  await expect(notice).toBeVisible()
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  await expect(notice).toBeVisible()
  expect(requests).toEqual([sql])
})

const createSql = 'CREATE TABLE default.browser_fixture (number UInt32) ENGINE = Memory'
const created = 'Created table default.browser_fixture'
const insertSql = 'INSERT INTO default.browser_fixture VALUES (1)'
const inserted = 'Inserted 1 row into default.browser_fixture'
const describeSql = 'DESCRIBE TABLE default.browser_fixture'
const describeOutcome = rowsOutcome([{ name: 'name', type: 'String' }, { name: 'type', type: 'String' }], [['number', 'UInt32']])

test('shows a standalone command acknowledgment without a result table', async ({ page }) => {
  const { results, requests } = await runSql(page, insertSql, {
    [insertSql]: { kind: 'command', message: inserted, durationMs: 37 },
  })
  await expect(results.getByText(inserted, { exact: true })).toBeVisible()
  await expect(results.getByRole('table')).toHaveCount(0)
  await expect(results.getByRole('combobox', { name: 'Statement outcome' })).toHaveCount(0)
  expect(requests).toEqual([insertSql])
})

test('opens the last successful statement and revisits earlier outcomes locally', async ({ page }) => {
  const script = `${createSql};\n${describeSql};`
  const { results, requests } = await runSql(page, script, {
    [createSql]: { kind: 'command', message: created, durationMs: 37 },
    [describeSql]: describeOutcome,
  })
  const outcomes = results.getByRole('combobox', { name: 'Statement outcome' })
  await expect(outcomes.locator('option:checked')).toHaveText(/^Statement 2\b/)
  await expect(results.getByRole('cell', { name: 'UInt32', exact: true })).toBeVisible()
  await outcomes.selectOption({ index: 0 })
  await expect(results.getByText(created, { exact: true })).toBeVisible()
  await outcomes.selectOption({ index: 1 })
  await expect(results.getByRole('cell', { name: 'number', exact: true })).toBeVisible()
  expect(requests).toEqual([createSql, describeSql])
})

test('opens a script error, preserves earlier outcomes, and marks the remaining SQL skipped', async ({ page }) => {
  const invalidSql = 'SELECT missing_column FROM default.browser_fixture'
  const skippedSql = 'DROP TABLE default.browser_fixture'
  const errorMessage = 'Unknown identifier missing_column'
  const script = `${createSql};\n${describeSql};\n${invalidSql};\n${skippedSql};`
  const { results, requests, run } = await runSql(page, script, {
    [createSql]: { kind: 'command', message: created, durationMs: 37 },
    [describeSql]: describeOutcome,
    [invalidSql]: { kind: 'error', message: errorMessage, durationMs: 21 },
  })
  const outcomes = results.getByRole('combobox', { name: 'Statement outcome' })
  await expect(outcomes.locator('option:checked')).toHaveText(/^Statement 3\b/)
  await expect(results.getByText(errorMessage, { exact: true })).toBeVisible()
  await expect(results.getByText(invalidSql, { exact: true })).toBeVisible()
  await expect(outcomes.getByRole('option', { name: /^Statement 4\b.*skipped/i })).toHaveCount(1)
  await expect(run).toBeEnabled()
  await outcomes.selectOption({ index: 0 })
  await expect(results.getByText(created, { exact: true })).toBeVisible()
  await outcomes.selectOption({ index: 1 })
  await expect(results.getByRole('cell', { name: 'UInt32', exact: true })).toBeVisible()
  expect(requests).toEqual([createSql, describeSql, invalidSql])
})

test('shows the timeout duration on the timed-out SQL and allows a new run', async ({ page }) => {
  const slowSql = 'SELECT sleep(5)'
  const { results, requests, run } = await runSql(page, slowSql, {
    [slowSql]: { kind: 'timeout', timeoutMs: 600_000, durationMs: 600_002, writeOutcomeUnknown: false },
    [describeSql]: describeOutcome,
  }, describeSql)
  await expect(results.getByText(slowSql, { exact: true })).toBeVisible()
  const alert = results.getByRole('alert')
  await expect(alert.getByRole('heading', { name: 'Statement 1 timed out' })).toBeVisible()
  await expect(alert.getByText('The statement timed out after 10 minutes.', { exact: true })).toBeVisible()
  await expect(alert.getByText(/write outcome is unknown/i)).toHaveCount(0)
  await expect(run).toBeEnabled()

  await page.getByRole('button', { name: 'Open activity log' }).click()
  await page.locator('.activity-entry').filter({ hasText: describeSql }).click()
  await page.getByRole('button', { name: 'Load in editor' }).click()
  await run.click()
  await expect(results.getByRole('cell', { name: 'UInt32', exact: true })).toBeVisible()
  expect(requests).toEqual([slowSql, describeSql])
})

test('shows an unconfirmed write outcome without retrying it', async ({ page }) => {
  const message = 'The ClickHouse connection closed before the insert was confirmed.'
  const { results, requests, run } = await runSql(page, insertSql, {
    [insertSql]: { kind: 'unknown', message, durationMs: 48 },
  })
  await expect(results.getByText(/\bunknown\b/i).first()).toBeVisible()
  await expect(results.getByText(message, { exact: true })).toBeVisible()
  await expect(results.getByText(insertSql, { exact: true })).toBeVisible()
  await expect(run).toBeEnabled()
  expect(requests).toEqual([insertSql])
})
