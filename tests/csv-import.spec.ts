/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const title = 'Insert data from a file'
const defaultTable = 'default.orders'
const archiveTable = 'archive.orders'
const apiBase = 'https://api.example.test/editor-api'

const csv = (name: string, records: string[]) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(['amount', ...records, ''].join('\n')),
})

async function openImport(page: Page) {
  await page.route(`${apiBase}/query`, async (route) => {
    const body: unknown = route.request().postDataJSON()
    if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
      throw new Error('Expected a schema query.')
    }

    const databases = body.query.includes('FROM system.databases')
    if (!databases && !body.query.includes('FROM system.tables WHERE is_temporary = 0')) {
      throw new Error(`Unexpected query: ${body.query}`)
    }
    await route.fulfill({
      json: {
        kind: 'rows',
        columns: (databases ? ['name', 'engine', 'current_database'] : ['database', 'name', 'engine'])
          .map((name) => ({ name, type: 'String' })),
        rows: databases
          ? [['default', 'Atomic', 'default'], ['archive', 'Atomic', 'default']]
          : [['default', 'orders', 'MergeTree'], ['archive', 'orders', 'MergeTree']],
        truncated: false,
        durationMs: 1,
      },
    })
  })

  const verifications: Route[] = []
  await page.route((url) => `${url.origin}${url.pathname}` === `${apiBase}/csv-import/verify`, (route) => {
    verifications.push(route)
  })
  const confirmations: Route[] = []
  await page.route(`${apiBase}/csv-import/*/confirm`, (route) => {
    confirmations.push(route)
  })

  await page.goto('/')
  await page.getByRole('button', { name: title, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  const destination = dialog.getByLabel('Destination table', { exact: true })
  await destination.selectOption({ label: defaultTable })
  const file = dialog.getByLabel('CSV file', { exact: true })
  const importButton = dialog.getByRole('button', { name: 'Import', exact: true })
  await expect(importButton).toBeDisabled()
  return { dialog, destination, file, importButton, verifications, confirmations }
}

function expectUpload(route: Route, database: string, file: ReturnType<typeof csv>) {
  const request = route.request()
  const { searchParams } = new URL(request.url())
  expect(request.method()).toBe('POST')
  expect(searchParams.get('database')).toBe(database)
  expect(searchParams.get('table')).toBe('orders')
  expect(request.headers()['content-type']).toMatch(/^text\/csv\b/)
  expect(request.postDataBuffer()).toEqual(file.buffer)
}

test('checks the selected CSV and waits for confirmation before reporting completion', async ({ page }) => {
  const { dialog, file, importButton, verifications, confirmations } = await openImport(page)
  const eightRecords = csv('eight.csv', Array.from({ length: 8 }, (_, index) => String(index + 1)))
  const picker = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose CSV file', exact: true }).click()
  await (await picker).setFiles(eightRecords)
  await expect.poll(() => verifications.length).toBe(1)
  expectUpload(verifications[0], 'default', eightRecords)
  await expect(dialog.getByText(/uploading and verifying.*default\.orders/i)).toBeVisible()
  await expect(importButton).toBeDisabled()
  await verifications[0].fulfill({ json: { kind: 'verified', importId: 'eight', checkedRows: 8, hasMore: false } })
  await expect(dialog.getByText(/all 8 rows passed validation for default\.orders/i)).toBeVisible()
  await expect(importButton).toBeEnabled()

  const twentyRecords = csv('twenty.csv', Array.from({ length: 20 }, (_, index) => String(index + 1)))
  await file.setInputFiles(twentyRecords)
  await expect.poll(() => verifications.length).toBe(2)
  expectUpload(verifications[1], 'default', twentyRecords)
  await expect(importButton).toBeDisabled()
  await verifications[1].fulfill({ json: { kind: 'verified', importId: 'twenty', checkedRows: 20, hasMore: false } })
  await expect(dialog.getByText(/all 20 rows passed validation for default\.orders/i)).toBeVisible()
  await expect(dialog.getByText(/remaining rows/i)).toHaveCount(0)
  await expect(importButton).toBeEnabled()
  expect(confirmations).toHaveLength(0)

  await importButton.click()
  await expect.poll(() => confirmations.length).toBe(1)
  expect(confirmations[0].request().method()).toBe('POST')
  expect(confirmations[0].request().url()).toBe(`${apiBase}/csv-import/twenty/confirm`)
  await expect(importButton).toBeDisabled()
  await expect(dialog.getByText(/importing into default\.orders/i)).toBeVisible()
  const completion = dialog.getByText(/(?:inserted|imported) 20 rows/i)
  await expect(completion).toHaveCount(0)
  await confirmations[0].fulfill({ json: { kind: 'complete', insertedRows: 20 } })
  await expect(completion).toBeVisible()
  expect(confirmations).toHaveLength(1)
})

test('a dropped replacement CSV and a changed destination require their own verdict', async ({ page }) => {
  await page.addInitScript(() => {
    const fetchFromBrowser = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input
      if (new URL(url, window.location.href).pathname !== '/editor-api/csv-import/verify') {
        return fetchFromBrowser(input, init)
      }

      // Let superseded responses reach the app even when it would cancel the request.
      const response = await fetchFromBrowser(input, { ...init, signal: null })
      const readJson = response.json.bind(response)
      response.json = async () => {
        const payload: unknown = await readJson()
        if (payload && typeof payload === 'object' && 'importId' in payload && typeof payload.importId === 'string') {
          const { importId } = payload
          requestAnimationFrame(() => requestAnimationFrame(() => {
            document.documentElement.setAttribute(`data-csv-verdict-${importId}`, '')
          }))
        }
        return payload
      }
      return response
    }
  })

  const { dialog, destination, file, importButton, verifications, confirmations } = await openImport(page)
  const original = csv('original.csv', ['1'])
  await file.setInputFiles(original)
  await expect.poll(() => verifications.length).toBe(1)
  expectUpload(verifications[0], 'default', original)

  const replacement = csv('replacement.csv', Array.from({ length: 21 }, (_, index) => String(index + 1)))
  const dataTransfer = await page.evaluateHandle(({ contents, name, type }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([contents], name, { type }))
    return transfer
  }, { contents: replacement.buffer.toString(), name: replacement.name, type: replacement.mimeType })
  const dropZone = dialog.getByRole('region', { name: 'CSV upload', exact: true })
  await dropZone.dispatchEvent('dragover', { dataTransfer })
  await dropZone.dispatchEvent('drop', { dataTransfer })
  await dataTransfer.dispose()
  await expect.poll(() => verifications.length).toBe(2)
  expectUpload(verifications[1], 'default', replacement)

  await verifications[0].fulfill({ json: { kind: 'verified', importId: 'old-file', checkedRows: 1, hasMore: false } })
  await expect(page.locator('html')).toHaveAttribute('data-csv-verdict-old-file', '')
  await expect(importButton).toBeDisabled()

  await destination.selectOption({ label: archiveTable })
  await expect.poll(() => verifications.length).toBe(3)
  expectUpload(verifications[2], 'archive', replacement)

  await verifications[1].fulfill({ json: { kind: 'verified', importId: 'old-table', checkedRows: 20, hasMore: true } })
  await expect(page.locator('html')).toHaveAttribute('data-csv-verdict-old-table', '')
  await expect(importButton).toBeDisabled()
  expect(confirmations).toHaveLength(0)

  await verifications[2].fulfill({ json: { kind: 'verified', importId: 'current', checkedRows: 20, hasMore: true } })
  await expect(dialog.getByText(/first 20 rows passed validation for archive\.orders/i)).toBeVisible()
  await expect(dialog.getByText(/remaining rows will be checked during import/i)).toBeVisible()
  await expect(importButton).toBeEnabled()
})

test('an invalid sample identifies the data record and leaves Import disabled', async ({ page }) => {
  const { dialog, file, importButton, verifications, confirmations } = await openImport(page)
  const invalidSample = csv('invalid.csv', [...Array.from({ length: 19 }, () => '1'), 'abc'])
  await file.setInputFiles(invalidSample)
  await expect.poll(() => verifications.length).toBe(1)
  const reason = 'Expected a number.'
  await verifications[0].fulfill({
    status: 422,
    json: { kind: 'invalid', message: reason, checkedRows: 20, hasMore: false, record: 20, column: 'amount' },
  })
  await expect(dialog.getByText(/verification failed.*default\.orders.*checked 20 rows/i)).toBeVisible()
  await expect(dialog.getByText(/data (?:record|row) 20/i)).toBeVisible()
  await expect(dialog.getByText(/\bamount\b/i)).toBeVisible()
  await expect(dialog.getByText(reason, { exact: false })).toBeVisible()
  await expect(importButton).toBeDisabled()
  expect(confirmations).toHaveLength(0)
})

test('an uncertain chunk is displayed separately from confirmed inserts', async ({ page }) => {
  const { dialog, file, importButton, verifications, confirmations } = await openImport(page)
  await file.setInputFiles(csv('orders.csv', Array.from({ length: 200 }, () => '1')))
  await expect.poll(() => verifications.length).toBe(1)
  await verifications[0].fulfill({ json: { kind: 'verified', importId: 'orders', checkedRows: 20, hasMore: true } })
  await importButton.click()
  await expect.poll(() => confirmations.length).toBe(1)
  const reason = 'The ClickHouse acknowledgment was lost.'
  await confirmations[0].fulfill({
    json: {
      kind: 'failed',
      insertedRows: 100,
      message: reason,
      unknownChunk: { firstRecord: 101, lastRecord: 200 },
    },
  })
  await expect(dialog.getByText(reason, { exact: false })).toBeVisible()
  await expect(dialog.getByText(/(?:100\s+(?:rows\s+)?(?:confirmed|inserts?)|confirmed\D+100)/i)).toBeVisible()
  await expect(dialog.getByText(/(?:101\D+200.*unknown|unknown.*101\D+200)/i)).toBeVisible()
  await expect(importButton).toBeHidden()
  expect(confirmations).toHaveLength(1)
})
