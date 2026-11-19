import { expect, test } from '@playwright/test'

const activityKey = 'clickhouse.query-activity.v1'

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
  await page.getByRole('button', { name: 'Clear activity log', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Clear activity log?' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmation).not.toBeVisible()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Clear activity log', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear activity log', exact: true })).toBeFocused()
  await expect(dialog.locator('.activity-entry')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Filter activity log by status' }).selectOption('error')
  await expect(dialog.getByText('No matching queries')).toBeVisible()
  await page.getByRole('button', { name: 'Clear activity log', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(confirmation).toHaveCount(0)
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await expect(dialog.getByText('No queries yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear activity log', exact: true })).toBeDisabled()
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
  await page.getByRole('button', { name: 'Clear activity log', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  finish()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeAttached()
  await expect(page.getByRole('dialog', { name: 'Activity log', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open activity log' }).click()
  await expect(page.getByText('No queries yet')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), activityKey)).toBeNull()
})

test('clearing also updates an already-open activity log in another tab', async ({ page, context }) => {
  const otherPage = await context.newPage()
  await otherPage.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await otherPage.goto('/')
  await otherPage.getByRole('button', { name: 'Open activity log' }).click()
  await expect(otherPage.locator('.activity-entry')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear activity log', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(otherPage.getByText('No queries yet')).toBeVisible()
  await otherPage.close()
})
