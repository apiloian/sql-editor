import { expect, test } from '@playwright/test'

test('the app starts and renders the SQL editor page', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')

  await expect(page).toHaveTitle('SQL Editor')
  await expect(page.getByRole('heading', { name: 'ClickHouse SQL editor', exact: true })).toBeVisible()
  await expect(page.getByText('Untitled query', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close database sidebar', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Database explorer' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open database sidebar', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Database explorer' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
