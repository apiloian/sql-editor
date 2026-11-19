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
    performance.setResourceTimingBufferSize(1_000)
    localStorage.setItem('sql-editor-ui.query-activity.v1', JSON.stringify(statements.map((sql, index) => ({
      id: `results-seed-${index}`, sql, startedAt: Date.now() - index, database: 'default',
      status: 'success', duration: 1, rowCount: 0,
    }))))
  }, followupSql ? [editorSql, followupSql] : [editorSql])

  const requests: string[] = []
  await page.route('https://api.example.test/editor-api/query', (route) => {
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
  await results.getByRole('combobox', { name: 'Slice label' }).selectOption('number')
  await results.getByRole('combobox', { name: 'Slice size' }).selectOption('metric')
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

async function renderedChart(page: Page) {
  await expect(page.locator('.chart-stage canvas').first()).toBeVisible()
  return page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>('.chart-stage [_echarts_instance_]')
    const resource = performance.getEntriesByType('resource').find(({ name }) => /\/echarts_core\.js(?:\?|$)/.test(name))
    if (!host || !resource) throw new Error('Expected an ECharts canvas in the results.')
    const { getInstanceByDom } = await import(resource.name)
    const chart = getInstanceByDom(host)
    if (!chart) throw new Error('Expected the chart to be mounted.')
    const series = chart.getModel().getSeriesByIndex(0)
    const data = series.getData()
    const bounds = host.getBoundingClientRect()
    const elements = chart.getZr().storage.getDisplayList()
    return {
      text: elements.flatMap((element: { style?: { text?: string } }) => element.style?.text ?? []),
      area: Boolean(series.option.areaStyle),
      category: (chart.getOption().xAxis?.[0]?.data ?? []) as string[],
      values: data.mapArray(series.subType === 'pie' ? 'value' : 'y', (value: number) => Number.isNaN(value) ? null : value) as (number | null)[],
      series: chart.getModel().getSeries().map((item: typeof series) => ({
        name: item.name,
        values: item.getData().mapArray(item.subType === 'pie' ? 'value' : 'y', (value: number) => Number.isNaN(value) ? null : value),
      })) as { name: string; values: (number | null)[] }[],
      slices: series.subType === 'pie' ? Array.from({ length: data.count() }, (_, index) => {
        const slice = data.getItemGraphicEl(index)
        const label = slice.getTextContent()
        const line = slice.getTextGuideLine()
        const shape = slice.shape
        const angle = (shape.startAngle + shape.endAngle) / 2
        return {
          fill: slice.style.fill as string,
          stroke: line.style.stroke as string,
          opacity: Number(slice.style.opacity ?? 1),
          labelOpacity: Number(label.style.opacity ?? 1),
          lineOpacity: Number(line.style.opacity ?? 1),
          point: {
            x: bounds.x + shape.cx + Math.cos(angle) * shape.r * 0.65,
            y: bounds.y + shape.cy + Math.sin(angle) * shape.r * 0.65,
          },
        }
      }) : [],
      barPoints: series.subType === 'bar' ? Array.from({ length: data.count() }, (_, index) => {
        const bar = data.getItemGraphicEl(index)?.shape
        return bar ? { x: bounds.x + bar.x + bar.width / 2, y: bounds.y + bar.y + bar.height / 2 } : null
      }) : [],
      trendPoints: series.subType === 'line' ? Array.from({ length: data.count() }, (_, index) => {
        const plot = series.coordinateSystem.master.getRect()
        return { x: bounds.x + chart.convertToPixel({ xAxisIndex: 0 }, index), y: bounds.y + plot.y + plot.height / 2 }
      }) : [],
      zoomControls: (chart.getOption().dataZoom ?? []).map(({ type }: { type: string }) => type) as string[],
    }
  })
}

async function dragAcrossChart(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

test('suggests fields, capitalizes axis titles, and changes measures and statements locally', async ({ page }) => {
  const first = 'SELECT product, orders, revenue FROM products'
  const second = 'SELECT month, registrations FROM accounts'
  const { results, requests } = await runSql(page, first + ';\n' + second, {
    [first]: rowsOutcome([
      { name: 'product', type: 'String' }, { name: 'orders', type: 'UInt32' }, { name: 'revenue', type: 'Decimal(10, 2)' },
    ], [['Desk', 3, '125.25'], ['Lamp', 7, '89.50']]),
    [second]: rowsOutcome([{ name: 'month', type: 'String' }, { name: 'registrations', type: 'UInt32' }], [['May', 19]]),
  })
  const statement = results.getByRole('combobox', { name: 'Statement outcome' })
  await statement.selectOption('0')
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  const category = results.getByRole('combobox', { name: 'Category' })
  await expect(category).toHaveValue('product')
  const measure = results.getByRole('combobox', { name: 'Measure' })
  await expect(measure).toHaveValue('orders')
  await expect.poll(async () => (await renderedChart(page)).text).toEqual(expect.arrayContaining(['Product', 'Orders']))
  expect((await renderedChart(page)).values).toEqual([3, 7])
  await measure.selectOption('revenue')
  await expect.poll(async () => (await renderedChart(page)).values).toEqual([125.25, 89.5])
  expect((await renderedChart(page)).text).toContain('Revenue')
  await category.selectOption('orders')
  await expect.poll(async () => (await renderedChart(page)).category).toEqual(['3', '7'])
  await category.selectOption('product')
  await results.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(results.getByRole('cell', { name: '125.25' })).toBeVisible()
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  await expect(measure).toHaveValue('revenue')
  await statement.selectOption('1')
  await expect(results.getByRole('combobox', { name: 'Category' })).toHaveValue('month')
  await expect(measure).toHaveValue('registrations')
  await expect.poll(async () => (await renderedChart(page)).values).toEqual([19])
  expect(requests).toEqual([first, second])
})

test('line and area zoom and reset while preserving query order and gaps', async ({ page }) => {
  const sql = 'SELECT month, registrations FROM monthly_totals'
  const { results, requests } = await runSql(page, sql, {
    [sql]: rowsOutcome([{ name: 'month', type: 'String' }, { name: 'registrations', type: 'Nullable(UInt32)' }], [
      ['March', 10], ['January', 15], ['February', null], ['April', 25], ['May', 33],
    ]),
  })
  for (const view of ['Line', 'Area']) {
    await results.getByRole('button', { name: view, exact: true }).click()
    const reset = results.getByRole('button', { name: 'Reset zoom' })
    await expect(reset).toBeDisabled()
    await expect(results.getByRole('status').filter({ hasText: 'These appear as gaps.' })).toBeVisible()
    await expect.poll(async () => (await renderedChart(page)).area).toBe(view === 'Area')
    const chart = await renderedChart(page)
    expect(chart.category).toEqual(['March', 'January', 'February', 'April', 'May'])
    expect(chart.values).toEqual([10, 15, null, 25, 33])
    expect(chart.zoomControls).not.toContain('slider')
    await dragAcrossChart(page, chart.trendPoints[1], chart.trendPoints[3])
    await expect.poll(async () => (await renderedChart(page)).values).toEqual([15, null, 25])
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()
    await expect.poll(async () => (await renderedChart(page)).values).toEqual(chart.values)
  }
  expect(requests).toEqual([sql])
})

test('splits bar, line and area into aligned series and keeps pie independent', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 1000 })
  const sql = 'SELECT month, signups, channel FROM grouped_monthly_signups'
  const { results, requests } = await runSql(page, sql, {
    [sql]: rowsOutcome([
      { name: 'month', type: 'String' }, { name: 'signups', type: 'UInt32' }, { name: 'channel', type: 'String' },
    ], [['March', 31, 'Web'], ['March', 22, 'Mobile'], ['January', 12, 'Mobile'], ['February', 45, 'Web'], ['February', 19, 'Mobile']]),
  })
  const split = results.getByRole('combobox', { name: 'Split by' })
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  await expect(split).toHaveValue('')
  await split.selectOption('channel')
  const segments = [
    { name: 'Web', values: [31, null, 45] },
    { name: 'Mobile', values: [22, 12, 19] },
  ]
  for (const view of ['Bar', 'Line', 'Area']) {
    await results.getByRole('button', { name: view, exact: true }).click()
    await expect(split).toHaveValue('channel')
    await expect.poll(async () => (await renderedChart(page)).series).toEqual(segments)
    const chart = await renderedChart(page)
    expect(chart.category).toEqual(['March', 'January', 'February'])
    expect(chart.text).toEqual(expect.arrayContaining(['Web', 'Mobile']))
    if (view === 'Area') expect(chart.area).toBe(true)
  }

  await results.getByRole('button', { name: 'Pie', exact: true }).click()
  await expect(split).toHaveCount(0)
  await expect.poll(async () => (await renderedChart(page)).slices.length).toBe(5)
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  await expect(split).toHaveValue('channel')
  await split.selectOption('')
  await expect.poll(async () => (await renderedChart(page)).series).toEqual([{ name: 'Signups', values: [31, 22, 12, 45, 19] }])
  expect(requests).toEqual([sql])
})

test('explains duplicate pairs and too many series without discarding query results', async ({ page }) => {
  const repeated = 'SELECT month, signups, channel FROM duplicate_channels'
  const crowded = 'SELECT month, signups, channel FROM crowded_channels'
  const columns = [
    { name: 'month', type: 'String' }, { name: 'signups', type: 'UInt32' }, { name: 'channel', type: 'String' },
  ]
  const { results, requests } = await runSql(page, repeated + ';\n' + crowded, {
    [repeated]: rowsOutcome(columns, [['January', 15, 'Web'], ['January', 26, 'Web']]),
    [crowded]: rowsOutcome(columns, Array.from({ length: 9 }, (_, index) => ['January', index + 1, 'Channel ' + index])),
  })
  const outcome = results.getByRole('combobox', { name: 'Statement outcome' })
  const split = results.getByRole('combobox', { name: 'Split by' })
  await results.getByRole('button', { name: 'Line', exact: true }).click()
  await split.selectOption('channel')
  await expect(results.getByText(/(?:up to|at most) 8/i)).toBeVisible()
  await outcome.selectOption('0')
  await expect(results.getByText(/GROUP BY/i)).toBeVisible()
  await split.selectOption('')
  await expect.poll(async () => (await renderedChart(page)).values).toEqual([15, 26])
  await results.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(results.getByRole('cell', { name: '26', exact: true })).toBeVisible()
  expect(requests).toEqual([repeated, crowded])
})

test('pie focuses the slice, matching connector, and label through two hovers in both themes', async ({ page }) => {
  const sql = 'SELECT product, amount FROM product_mix'
  const { results, requests } = await runSql(page, sql, {
    [sql]: rowsOutcome([{ name: 'product', type: 'String' }, { name: 'amount', type: 'UInt32' }], [
      ['Desk', 40], ['Lamp', 37], ['Chair', 34], ['Shelf', 31], ['Book', 28], ['Pen', 25],
      ['Tray', 22], ['Vase', 19], ['Mug', 16], ['Clock', 13], ['Mat', 10], ['Cart', 7],
    ]),
  })
  await results.getByRole('button', { name: 'Pie', exact: true }).click()
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', { name: 'Dark mode' }).click()
    const initial = await renderedChart(page)
    expect(initial.slices).toHaveLength(12)
    expect(new Set(initial.slices.map(({ fill }) => fill)).size).toBeGreaterThanOrEqual(8)
    for (const slice of initial.slices) expect(slice.stroke).toBe(slice.fill)
    for (const [index, name, value] of [[0, 'Desk', '40'], [1, 'Lamp', '37']] as const) {
      const { point } = initial.slices[index]
      await page.mouse.move(point.x, point.y)
      await expect.poll(async () => {
        const chart = await renderedChart(page)
        const focus = chart.slices[index]
        const other = chart.slices[1 - index]
        return focus.opacity === 1 && focus.labelOpacity === 1 && focus.lineOpacity === 1
          && other.opacity < 0.5 && other.labelOpacity < 0.5 && other.lineOpacity < 0.5
      }).toBe(true)
      const tooltipRow = page.locator('.chart-stage').getByText(name, { exact: true }).locator('..')
      await expect(tooltipRow.getByText(value, { exact: true })).toBeVisible()
      const marker = tooltipRow.locator('span[style*="background-color"]')
      expect(await marker.evaluate((element, fill) => {
        const swatch = document.createElement('span')
        swatch.style.backgroundColor = fill
        return getComputedStyle(element).backgroundColor === swatch.style.backgroundColor
      }, initial.slices[index].fill)).toBe(true)
    }
    await results.getByRole('heading', { name: 'Query results' }).hover()
    await expect.poll(async () => (await renderedChart(page)).slices.every(
      ({ opacity, labelOpacity, lineOpacity }) => opacity === 1 && labelOpacity === 1 && lineOpacity === 1,
    )).toBe(true)
  }
  expect(requests).toEqual([sql])
})

test('dragging across bars zooms the selected range and resets without changing rows', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 1050 })
  const sql = 'SELECT product, revenue FROM dense_bars'
  const rows = Array.from({ length: 160 }, (_, i) => ['Product ' + (i + 1), 301 + i])
  const { results, requests } = await runSql(page, sql, {
    [sql]: rowsOutcome([{ name: 'product', type: 'String' }, { name: 'revenue', type: 'UInt32' }], rows),
  })
  await results.getByRole('button', { name: 'Bar', exact: true }).click()
  const reset = results.getByRole('button', { name: 'Reset zoom' })
  await expect(reset).toBeDisabled()
  const before = await renderedChart(page)
  expect(before.values).toHaveLength(160)
  expect(before.zoomControls).not.toContain('slider')
  const first = before.barPoints[25]
  const last = before.barPoints[59]
  if (!first || !last) throw new Error('Expected bars for both ends of the selection.')
  await page.mouse.click(first.x, first.y)
  expect((await renderedChart(page)).values).toEqual(before.values)
  await expect(reset).toBeDisabled()
  await dragAcrossChart(page, first, last)
  await expect.poll(async () => (await renderedChart(page)).values).toEqual(before.values.slice(25, 60))
  const zoomed = await renderedChart(page)
  const innerFirst = zoomed.barPoints[5]
  const innerLast = zoomed.barPoints[12]
  if (!innerFirst || !innerLast) throw new Error('Expected selectable bars after zooming.')
  await dragAcrossChart(page, innerLast, innerFirst)
  await expect.poll(async () => (await renderedChart(page)).values).toEqual(before.values.slice(30, 38))
  const firstVisible = (await renderedChart(page)).barPoints[0]
  if (!firstVisible) throw new Error('Expected a visible bar after the second zoom.')
  await page.mouse.move(firstVisible.x, firstVisible.y)
  await expect.poll(async () => (await renderedChart(page)).text).toContain('331')
  await expect(results.getByRole('status').filter({ hasText: '160 rows returned' })).toBeVisible()
  await reset.click()
  await expect.poll(async () => (await renderedChart(page)).values).toEqual(before.values)
  await expect(reset).toBeDisabled()
  expect(requests).toEqual([sql])
})

test('unsuitable chart selections leave a useful outcome and a way back to the table', async ({ page }) => {
  const text = 'SELECT product FROM products'
  const empty = 'SELECT product FROM products WHERE false'
  const pie = 'SELECT product, delta, zero FROM changes'
  const { results, requests } = await runSql(page, [text, empty, pie].join(';\n'), {
    [text]: rowsOutcome([{ name: 'product', type: 'String' }], [['Desk']]),
    [empty]: rowsOutcome([{ name: 'product', type: 'String' }], []),
    [pie]: rowsOutcome([
      { name: 'product', type: 'String' }, { name: 'delta', type: 'Int32' }, { name: 'zero', type: 'UInt32' },
    ], [['Desk', -4, 0], ['Lamp', 2, 0]]),
  })
  const statement = results.getByRole('combobox', { name: 'Statement outcome' })
  await results.getByRole('button', { name: 'Pie', exact: true }).click()
  await expect(results.getByText(/Pie charts need non-negative values/)).toBeVisible()
  await results.getByRole('combobox', { name: 'Slice size' }).selectOption('zero')
  await expect(results.getByText(/Pie charts need at least one positive value/)).toBeVisible()
  await statement.selectOption('0')
  await expect(results.getByText(/No numeric columns to plot/)).toBeVisible()
  await results.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(results.getByRole('cell', { name: 'Desk' })).toBeVisible()
  await results.getByRole('button', { name: 'Pie', exact: true }).click()
  await statement.selectOption('1')
  await expect(results.getByRole('button', { name: 'Pie', exact: true })).toHaveCount(0)
  await expect(results.getByRole('table').getByRole('columnheader', { name: 'product' })).toBeVisible()
  await expect(results.getByRole('cell')).toHaveCount(0)
  expect(requests).toEqual([text, empty, pie])
})
