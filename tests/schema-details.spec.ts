import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const longName = 'archived_orders_with_a_long_qualified_name_for_narrow_drawers'
const ordersDdl = "CREATE TABLE default.orders (user_id UInt32 COMMENT 'ID of the purchaser', amount Decimal(18, 4), CONSTRAINT positive_amount CHECK (amount > 0)) ENGINE = MergeTree ORDER BY user_id COMMENT 'Submitted orders'"
const viewDdl = 'CREATE VIEW archive.recent_orders AS SELECT user_id FROM default.orders ORDER BY user_id'
const plainDdl = 'CREATE TABLE default.plain_table (value UInt32) ENGINE = Memory'

const objects = [
  { database: 'default', name: 'orders', engine: 'MergeTree', ddl: ordersDdl, comment: 'Submitted orders', columns: [
    ['user_id', 'UInt32', '', '', 'ID of the purchaser'],
    ['amount', 'Decimal(18, 4)', 'DEFAULT', '0', ''],
  ] },
  { database: 'archive', name: 'recent_orders', engine: 'View', ddl: viewDdl, comment: 'A view of recent orders', columns: [
    ['user_id', 'UInt32', '', '', ''],
  ] },
  { database: 'default', name: 'plain_table', engine: 'Memory', ddl: plainDdl, comment: '   ', columns: [
    ['value', 'UInt32', '', '', '   '],
  ] },
  { database: 'archive', name: longName, engine: 'MergeTree', ddl: `CREATE TABLE archive.${longName} (id UInt64) ENGINE = MergeTree ORDER BY id`, comment: 'Archive of older orders', columns: [
    ['id', 'UInt64', '', '', 'Older order identifier'],
  ] },
  { database: 'system', name: 'query_log', engine: 'SystemLog', ddl: '', comment: '', columns: [] },
]

function queryRows(names: string[], rows: (string | null)[][]) {
  return {
    kind: 'rows',
    columns: names.map(name => ({ name, type: 'String' })),
    rows,
    truncated: false,
    durationMs: 1,
  }
}

async function openExplorer(page: Page, beforeOverview?: (name: string) => Promise<void>) {
  await page.route('**/query', async (route) => {
    const { query } = route.request().postDataJSON() as { query: string }
    if (query.includes('FROM system.databases')) {
      return route.fulfill({ json: queryRows(['name', 'engine', 'current_database'], [
        ['archive', 'Atomic', 'default'],
        ['default', 'Atomic', 'default'],
        ['system', 'Ordinary', 'default'],
      ]) })
    }
    if (query.includes('FROM system.tables WHERE is_temporary = 0')) {
      return route.fulfill({ json: queryRows(['database', 'name', 'engine'], objects.map(({ database, name, engine }) => [database, name, engine])) })
    }
    if (query.includes('SELECT table, name, type FROM system.columns')) {
      const matching = objects.filter(({ database }) => query.includes(`database = '${database}'`))
      return route.fulfill({ json: queryRows(['table', 'name', 'type'], matching.flatMap(({ name, columns }) => columns.map(([column, type]) => [name, column, type]))) })
    }
    const object = objects.find(({ database, name }) => query.includes(`database = '${database}'`) && (query.includes(`name = '${name}'`) || query.includes(`table = '${name}'`)))
    if (object && query.includes('FROM system.tables')) {
      await beforeOverview?.(object.name)
      const { engine, ddl, comment } = object
      return route.fulfill({ json: queryRows(['engine', 'sorting_key', 'primary_key', 'partition_key', 'sampling_key', 'create_table_query', 'comment', 'total_rows', 'total_bytes'], [[
        engine, '', '', '', '', ddl, comment, engine === 'View' ? null : '12', engine === 'View' ? null : '50',
      ]]) })
    }
    if (object && query.includes('FROM system.columns')) {
      return route.fulfill({ json: queryRows(['name', 'type', 'default_kind', 'default_expression', 'comment'], object.columns) })
    }
    throw new Error(`Unexpected query in schema explorer test: ${query}`)
  })
  await page.goto('/')
  const openSidebar = page.getByRole('button', { name: 'Open database sidebar' })
  if (await openSidebar.isVisible()) await openSidebar.click()
  const sidebar = page.getByRole('complementary', { name: 'Database explorer' })
  await expect(sidebar.getByRole('button', { name: 'Refresh databases' })).toBeEnabled()
  return { sidebar, search: sidebar.getByRole('textbox', { name: 'Search databases, tables, and views' }) }
}

test('search finds objects in collapsed databases and follows system visibility', async ({ page }) => {
  const { sidebar, search } = await openExplorer(page)
  const archive = sidebar.getByRole('button', { name: /^archive\b/ })
  const view = sidebar.getByRole('button', { name: 'recent_orders View', exact: true })
  const system = sidebar.getByRole('button', { name: /^system\b/ })
  const systemTable = sidebar.getByRole('button', { name: 'query_log SystemLog', exact: true })
  const systemToggle = sidebar.getByRole('checkbox', { name: 'Show system databases' })

  await expect(archive).toHaveAttribute('aria-expanded', 'false')
  await expect(view).toBeHidden()
  await expect(system).toBeHidden()
  await expect(systemToggle).not.toBeChecked()

  await search.fill('  RECENT_ORDERS ')
  await expect(view).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /^default\b/ })).toBeHidden()
  await search.fill('archive')
  await expect(sidebar.getByRole('button', { name: new RegExp(longName) })).toBeVisible()
  await search.clear()
  await expect(archive).toHaveAttribute('aria-expanded', 'false')

  await search.fill('query_log')
  await expect(systemTable).toBeHidden()
  await expect(sidebar.getByText('No matching databases, tables, or views.', { exact: false })).toBeVisible()
  await systemToggle.check()
  await expect(systemTable).toBeVisible()
  await systemToggle.uncheck()
  await expect(systemTable).toBeHidden()
})

test('object descriptions, columns and formatted DDL follow the selected object and preserve the editor', async ({ page }) => {
  const { sidebar, search } = await openExplorer(page)
  await page.getByRole('textbox', { name: 'SQL query' }).focus()
  await page.keyboard.insertText('SELECT user_id FROM default.orders')

  await sidebar.getByRole('button', { name: 'orders MergeTree', exact: true }).click()
  const table = page.getByRole('dialog', { name: 'default.orders' })
  const overview = table.getByRole('tab', { name: 'Overview' })
  const columns = table.getByRole('tab', { name: 'Columns' })
  const ddlTab = table.getByRole('tab', { name: 'DDL' })
  await expect(overview).toHaveAttribute('aria-selected', 'true')
  const overviewPanel = table.getByRole('tabpanel', { name: 'Overview' })
  await expect(overviewPanel.getByRole('heading', { name: 'Description' })).toBeVisible()
  await expect(overviewPanel.getByText('Submitted orders')).toBeVisible()

  await overview.focus()
  await page.keyboard.press('ArrowRight')
  await expect(columns).toBeFocused()
  await expect(columns).toHaveAttribute('aria-selected', 'true')
  const columnsPanel = table.getByRole('tabpanel', { name: 'Columns' })
  await expect(columnsPanel.getByText('user_id', { exact: true })).toBeVisible()
  await expect(columnsPanel.getByText('UInt32', { exact: true })).toBeVisible()
  await expect(columnsPanel.getByText('ID of the purchaser')).toBeVisible()
  await expect(columnsPanel.getByText('DEFAULT', { exact: true })).toBeVisible()

  await ddlTab.click()
  await expect(ddlTab).toHaveAttribute('aria-selected', 'true')
  await expect(table.getByRole('tabpanel', { name: 'DDL' }).locator('pre')).toHaveJSProperty('textContent', [
    'CREATE TABLE default.orders (',
    "\tuser_id UInt32 COMMENT 'ID of the purchaser',",
    '\tamount Decimal(18, 4),',
    '\tCONSTRAINT positive_amount CHECK (amount > 0)',
    ')',
    "ENGINE = MergeTree ORDER BY user_id COMMENT 'Submitted orders'",
  ].join('\n'))
  await table.getByRole('button', { name: 'Close table details' }).click()

  await search.fill('recent_orders')
  await sidebar.getByRole('button', { name: 'recent_orders View', exact: true }).click()
  const view = page.getByRole('dialog', { name: 'archive.recent_orders' })
  await expect(view.getByRole('tabpanel', { name: 'Overview' }).getByText('A view of recent orders')).toBeVisible()
  await view.getByRole('tab', { name: 'DDL' }).click()
  await expect(view.getByRole('tabpanel', { name: 'DDL' }).locator('pre')).toHaveJSProperty('textContent', [
    'CREATE VIEW archive.recent_orders AS',
    'SELECT',
    '    user_id',
    'FROM',
    '    default.orders',
    'ORDER BY',
    '    user_id',
  ].join('\n'))
  await page.keyboard.press('Escape')

  await search.clear()
  await sidebar.getByRole('button', { name: 'plain_table Memory', exact: true }).click()
  const plainTable = page.getByRole('dialog', { name: 'default.plain_table' })
  await expect(plainTable.getByRole('tabpanel', { name: 'Overview' }).getByText('Storage size')).toBeVisible()
  await expect(plainTable.getByRole('heading', { name: 'Description' })).toBeHidden()
  await plainTable.getByRole('tab', { name: 'Columns' }).click()
  await expect(plainTable.getByRole('tabpanel', { name: 'Columns' }).getByText('value', { exact: true })).toBeVisible()
  await expect(plainTable.getByText('ID of the purchaser')).toBeHidden()
  await plainTable.getByRole('button', { name: 'Close table details' }).click()
  await expect(page.locator('.monaco-editor .view-line')).toHaveText('SELECT user_id FROM default.orders')
})

test('closing a narrow drawer cancels its pending metadata request and the next drawer shows its own object', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 650 })
  let signalRequested!: () => void
  const firstRequested = new Promise<void>((resolve) => { signalRequested = resolve })
  let releaseOverview!: () => void
  const firstOverview = new Promise<void>((resolve) => { releaseOverview = resolve })
  const { sidebar, search } = await openExplorer(page, async (name) => {
    if (name !== 'orders') return
    signalRequested()
    await firstOverview
  })

  await sidebar.getByRole('button', { name: 'orders MergeTree', exact: true }).click()
  await firstRequested
  await expect(page.getByRole('dialog', { name: 'default.orders' }).getByRole('status')).toContainText('Loading table details')
  const cancelledOverview = page.waitForEvent('requestfailed', request =>
    request.url().endsWith('/query') && request.postDataJSON().query.includes("name = 'orders'"))
  await page.keyboard.press('Escape')

  await search.fill(longName)
  await sidebar.getByRole('button', { name: `${longName} MergeTree`, exact: true }).click()
  const drawer = page.getByRole('dialog', { name: `archive.${longName}` })
  const close = drawer.getByRole('button', { name: 'Close table details' })
  await expect(drawer.getByText('Archive of older orders')).toBeVisible()
  releaseOverview()
  expect((await cancelledOverview).failure()?.errorText).toContain('ABORTED')
  await expect(drawer.getByText('Archive of older orders')).toBeVisible()
  await expect(drawer.getByText('Submitted orders')).toBeHidden()

  const heading = await drawer.getByRole('heading', { name: `archive.${longName}` }).boundingBox()
  const closeButton = await close.boundingBox()
  expect(heading).not.toBeNull()
  expect(closeButton).not.toBeNull()
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(closeButton!.x)
  expect(closeButton!.x + closeButton!.width).toBeLessThanOrEqual(360)
  await drawer.getByRole('tab', { name: 'DDL' }).click()
  await expect(drawer.getByRole('tabpanel', { name: 'DDL' }).locator('pre')).toContainText(`CREATE TABLE archive.${longName}`)
  await close.click()
  await expect(drawer).toBeHidden()
})
