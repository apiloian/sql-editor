import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  await expect(page.locator('.monaco-editor')).toBeVisible()
})

test('assistant SQL is one undoable edit with keyboard redo', async ({ page }) => {
  let original = ''
  await page.route('**/assistant', async (route) => {
    const request = route.request().postDataJSON()
    expect(request.action).toBe('generate')
    expect(request.prompt).toBe('Count trips')
    original = request.sql
    await route.fulfill({ json: { sql: 'SELECT count() AS total FROM trips;' } })
  })
  await page.getByRole('textbox', { name: 'Ask the SQL assistant' }).fill('Count trips')
  await page.getByRole('button', { name: 'Send to SQL assistant' }).click()
  await expect(page.locator('.view-lines')).toContainText('SELECT count() AS total FROM trips;')
  await page.getByRole('button', { name: 'Undo SQL edit' }).click()
  await expect(page.locator('.view-lines')).toContainText('FROM numbers(10);')
  expect(original).toContain('FROM numbers(10);')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.view-lines')).toContainText('SELECT count() AS total FROM trips;')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.view-lines')).toContainText('FROM numbers(10);')
  await page.getByRole('button', { name: 'Redo SQL edit' }).click()
  await expect(page.locator('.view-lines')).toContainText('SELECT count() AS total FROM trips;')
})

test('a late assistant response cannot overwrite a manual edit', async ({ page }) => {
  let finish: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  let started: (() => void) | undefined
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  await page.route('**/assistant', async (route) => {
    started?.()
    await waiting
    await route.fulfill({ json: { sql: 'SELECT 999;' } })
  })
  await page.getByRole('textbox', { name: 'Ask the SQL assistant' }).fill('Change SQL')
  await page.getByRole('button', { name: 'Send to SQL assistant' }).click()
  await requestStarted
  await page.locator('.monaco-editor').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('SELECT 42;')
  finish?.()
  await expect(page.getByRole('status')).toContainText('Your SQL changed')
  await expect(page.locator('.view-lines')).toContainText('SELECT 42;')
})
