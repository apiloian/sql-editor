import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const usersColumns = [
  ['users', 'id', 'UInt32'],
  ['users', 'name', 'String'],
  ['users', 'registered_at', 'DateTime'],
]

function queryRows(names: string[], rows: string[][]) {
  return {
    kind: 'rows',
    columns: names.map(name => ({ name, type: 'String' })),
    rows,
    truncated: false,
    durationMs: 1,
  }
}

async function openEditor(page: Page) {
  let ordersUserColumn = 'user_id'
  await page.route('**/query', (route) => {
    const body: unknown = route.request().postDataJSON()
    if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
      throw new Error('Expected a query string in the request body.')
    }

    const query = body.query
    if (query.includes('FROM system.databases')) {
      return route.fulfill({ json: queryRows(['name', 'engine', 'current_database'], [
        ['archive', 'Atomic', 'default'],
        ['default', 'Atomic', 'default'],
      ]) })
    }
    if (query.includes('FROM system.tables WHERE is_temporary = 0')) {
      return route.fulfill({ json: queryRows(['database', 'name', 'engine'], [
        ['archive', 'orders', 'MergeTree'],
        ['default', 'orders', 'MergeTree'],
        ['default', 'users', 'MergeTree'],
      ]) })
    }
    if (query.includes("FROM system.columns WHERE database = 'default'")) {
      return route.fulfill({ json: queryRows(['table', 'name', 'type'], [
        ['orders', ordersUserColumn, 'UInt32'],
        ['orders', 'amount', 'UInt64'],
        ...usersColumns,
      ]) })
    }
    if (query.includes("FROM system.columns WHERE database = 'archive'")) {
      return route.fulfill({ json: queryRows(['table', 'name', 'type'], [
        ['orders', 'amount', 'Decimal(18, 2)'],
      ]) })
    }
    throw new Error(`Unexpected query in autocomplete test: ${query}`)
  })

  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'SQL query' })
  const refresh = page.getByRole('button', { name: 'Refresh databases' })
  const suggestions = page.getByRole('listbox', { name: 'Suggest' })
  await expect(input).toBeFocused()
  await expect(refresh).toBeEnabled()

  return {
    input,
    refresh,
    updateOrdersColumn: () => { ordersUserColumn = 'user_key' },
    suggestion: (label: string) => suggestions.locator(`[aria-label^="${label},"], [aria-label^="${label} "]`),
    line: page.locator('.monaco-editor .view-line'),
  }
}

test('schema suggestions show table and column details and insert at the caret', async ({ page }) => {
  const { suggestion, line } = await openEditor(page)
  await page.keyboard.insertText('SELECT  FROM orders')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Home')
  for (let index = 0; index < 'SELECT '.length; index++) await page.keyboard.press('ArrowRight')
  await page.keyboard.type('user')

  await expect(suggestion('users').getByText('3 columns', { exact: true })).toBeVisible()
  await expect(suggestion('users').locator('.codicon-symbol-struct')).toBeVisible()
  const userId = suggestion('user_id')
  await expect(userId.getByText('orders · UInt32', { exact: true })).toBeVisible()
  await expect(userId.locator('.codicon-symbol-field')).toBeVisible()
  await userId.click()
  await expect(line).toHaveText('SELECT user_id FROM orders')
})

test('the editor offers ClickHouse functions and SQL keywords alongside schema suggestions', async ({ page }) => {
  const { input, suggestion } = await openEditor(page)
  await page.keyboard.type('SEL')
  await expect(suggestion('SELECT').locator('.codicon-symbol-keyword')).toBeVisible()

  await input.press('Escape')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.type('SELECT a')
  await expect(suggestion('amount')).toBeVisible()
  await expect(suggestion('abs').locator('.codicon-symbol-function')).toBeVisible()
})

test('database refresh replaces column suggestions for the current database', async ({ page }) => {
  const { input, line, refresh, suggestion, updateOrdersColumn } = await openEditor(page)
  await page.keyboard.type('SELECT user')
  await expect(suggestion('user_id')).toBeVisible()
  await input.press('Escape')

  updateOrdersColumn()
  await refresh.click()
  await expect(refresh).toBeEnabled()
  await input.focus()
  await page.keyboard.press('Control+Space')
  await expect(suggestion('user_key').getByText('orders · UInt32', { exact: true })).toBeVisible()
  await expect(suggestion('user_id')).toHaveCount(0)
  await expect(line).toHaveText('SELECT user')
  await input.press('Escape')

  await page.getByRole('button', { name: 'Insert data from a file' }).click()
  const picker = page.getByRole('dialog', { name: 'Insert data from a file' }).getByLabel('Destination table', { exact: true })
  await picker.selectOption({ label: 'default.orders' })
  await expect(picker.locator('option:checked')).toHaveText('default.orders')
})

test('a dot after a database or qualified table offers the corresponding names', async ({ page }) => {
  const { input, suggestion, line } = await openEditor(page)
  await page.keyboard.type('SELECT * FROM arc')
  await expect(suggestion('archive')).toBeVisible()
  await suggestion('archive').click()
  await page.keyboard.press('Period')
  await expect(suggestion('orders')).toBeVisible()
  await expect(suggestion('users')).toHaveCount(0)
  await page.keyboard.type('ord')
  await suggestion('orders').click()
  await expect(line).toHaveText('SELECT * FROM archive.orders')

  await input.press('Escape')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.insertText('SELECT archive.orders')
  await page.keyboard.press('Period')
  const amount = suggestion('amount')
  await expect(amount.getByText('orders · Decimal(18, 2)', { exact: true })).toBeVisible()
  await page.keyboard.type('am')
  await amount.click()
  await expect(line).toHaveText('SELECT archive.orders.amount')
})
