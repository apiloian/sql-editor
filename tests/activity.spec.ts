import { expect, test } from '@playwright/test'

const activityKey = 'sql-editor-ui.query-activity.v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('activity-test-seeded')) return
    localStorage.setItem(key, JSON.stringify([{ id: 'saved-run', sql: 'SELECT 42;', startedAt: Date.now(), database: 'default', status: 'success', duration: 12, rowCount: 1 }]))
    sessionStorage.setItem('activity-test-seeded', 'true')
  }, activityKey)
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Open activity log' }).click()
})

test('clearing requires confirmation, clears every status, and persists after reload', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Activity log' })
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear logs', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Clear logs?' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmation).not.toBeVisible()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Clear logs', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear logs', exact: true })).toBeFocused()
  await expect(dialog.locator('.activity-entry')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Filter activity log by status' }).selectOption('error')
  await expect(dialog.getByText('No matching queries')).toBeVisible()
  await page.getByRole('button', { name: 'Clear logs', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(confirmation).toHaveCount(0)
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await expect(dialog.getByText('No queries yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear logs', exact: true })).toBeDisabled()
  expect(await page.evaluate((key) => localStorage.getItem(key), activityKey)).toBeNull()
  await page.reload()
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await expect(page.getByText('No queries yet')).toBeVisible()
})

test('finishing a cleared running query does not restore its activity entry', async ({ page }) => {
  let finish: () => void = () => {}
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  let started: () => void = () => {}
  const running = new Promise<void>((resolve) => { started = resolve })
  await page.route('**/query', async (route) => {
    started()
    await waiting
    await route.fulfill({ json: { kind: 'rows', columns: [{ name: '42', type: 'UInt8' }], rows: [[42]], truncated: false, durationMs: 12 } })
  })
  await page.getByRole('button', { name: 'Load in editor' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await running
  await page.getByRole('button', { name: 'Open activity log' }).click()
  const filter = page.getByRole('combobox', { name: 'Filter activity log by status' })
  await filter.selectOption('running')
  await expect(page.getByRole('region', { name: 'Run commands' }).getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear logs', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  finish()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeAttached()
  await expect(page.getByRole('dialog', { name: 'Activity log', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await expect(page.getByText('No queries yet')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), activityKey)).toBeNull()
})

test('filters saved outcomes and formats activity SQL while loading the original without running it', async ({ page }) => {
  const originalSql = 'select 42 from numbers(1) where number=0'
  const invalidSql = "SELECT 'unfinished"
  await page.evaluate(({ key, originalSql, invalidSql }) => {
    const now = Date.now()
    localStorage.setItem(key, JSON.stringify([
      { id: 'success', sql: originalSql, startedAt: now, database: 'default', status: 'success', duration: 12, rowCount: 1 },
      { id: 'failed', sql: invalidSql, startedAt: now - 1, database: 'default', status: 'error', duration: 18, error: 'Unclosed string literal' },
      { id: 'unknown', sql: 'INSERT INTO orders VALUES (1)', startedAt: now - 2, database: 'default', status: 'unknown', duration: 23, message: 'The write could not be confirmed.' },
      { id: 'command', sql: 'CREATE TABLE orders (id Int32) ENGINE = Memory', startedAt: now - 3, database: 'default', status: 'success', duration: 5, message: 'Created table orders.' },
    ]))
  }, { key: activityKey, originalSql, invalidSql })
  let runs = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/query') && request.postDataJSON().source !== 'metadata') runs++
  })
  await page.reload()
  await page.getByRole('button', { name: 'Open activity log' }).click()
  const dialog = page.getByRole('dialog', { name: 'Activity log' })
  const filter = dialog.getByRole('combobox', { name: 'Filter activity log by status' })
  const list = dialog.getByRole('region', { name: 'Run commands' })
  const details = dialog.getByRole('region', { name: 'Selected query details' })
  const sql = details.locator('.activity-sql code')
  await expect(dialog.getByText('4 queries', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Last 200 runs · Stored in this browser')).toBeVisible()
  await filter.selectOption('running')
  await expect(list.getByText('No matching queries')).toBeVisible()
  await filter.selectOption('unknown')
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(details.getByText('The write could not be confirmed.')).toBeVisible()
  await filter.selectOption('error')
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(details.getByText('Unclosed string literal')).toBeVisible()
  await expect(sql).toHaveJSProperty('textContent', invalidSql)
  await filter.selectOption('success')
  await expect(list.getByRole('button')).toHaveCount(2)
  await list.getByRole('button', { name: /CREATE TABLE orders/ }).click()
  await expect(details.getByText('Created table orders.')).toBeVisible()
  await filter.selectOption('all')
  await expect(list.getByRole('button')).toHaveCount(4)
  await list.getByRole('button', { name: /select 42/ }).click()
  await expect(sql).toHaveJSProperty('textContent', 'SELECT\n    42\nFROM\n    numbers(1)\nWHERE\n    number = 0')
  await expect(details.getByText('Rows returned')).toBeVisible()
  await expect(details.getByText('12 ms')).toBeVisible()
  await expect(details.getByText('default', { exact: true })).toBeVisible()
  await expect(details.locator('time')).toHaveAttribute('datetime', /^\d{4}-/)
  await details.getByRole('button', { name: 'Load in editor' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.monaco-editor .view-line')).toHaveText(originalSql)
  expect(runs).toBe(0)
})

test('clearing also updates an already-open activity log in another tab', async ({ page, context }) => {
  const otherPage = await context.newPage()
  await otherPage.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await otherPage.goto('/')
  await otherPage.getByRole('button', { name: 'Open activity log' }).click()
  await expect(otherPage.locator('.activity-entry')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear logs', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(otherPage.getByText('No queries yet')).toBeVisible()
  await otherPage.close()
})
