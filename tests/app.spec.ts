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

  const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
  await theme.press('Enter')
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await theme.press('Enter')
  await expect(theme).toHaveAttribute('aria-pressed', 'false')

  await page.setViewportSize({ width: 390, height: 740 })
  await page.getByRole('button', { name: 'Close database sidebar', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'SQL assistant' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport({ ratio: 1 })
  expect(pageErrors).toEqual([])
})
