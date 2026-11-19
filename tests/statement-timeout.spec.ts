import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

for (const failure of ['timeout', 'error'] as const) {
  test(`stops a mixed script on ${failure} and lets the editor run again`, async ({ page }) => {
    const clickhouseUrl = process.env.CLICKHOUSE_TEST_URL
    if (!clickhouseUrl) {
      test.skip(true, 'Set CLICKHOUSE_TEST_URL to an existing local ClickHouse HTTP endpoint.')
      return
    }

    const endpoint = new URL(clickhouseUrl)
    endpoint.searchParams.set('wait_end_of_query', '1')
    async function direct(query: string) {
      const response = await fetch(endpoint, { method: 'POST', body: query })
      const result = await response.text()
      expect(response.ok, result).toBe(true)
      return result.trim()
    }

    const database = `stage2_${randomUUID().replaceAll('-', '')}`
    const table = `${database}.items`
    const marker = `${database}_slow`
    const first = `INSERT INTO ${table} VALUES (1)`
    const failing = failure === 'timeout'
      ? `INSERT INTO ${table} SELECT number + 10 + sleepEachRow(0.1) AS ${marker} FROM numbers(100) SETTINGS max_block_size=5, max_threads=1, log_queries=1, log_queries_min_query_duration_ms=0`
      : `INSERT INTO ${table} SELECT stage2_missing`
    const skipped = `INSERT INTO ${table} VALUES (3)`
    const followup = `SELECT id AS confirmed_id FROM ${table} WHERE id = 1`
    const script = `${first};\n${failing};\n${skipped};`
    const created = `CREATE TABLE ${database}.more (id UInt64) ENGINE=Memory`
    const inserted = `INSERT INTO ${database}.more VALUES (9)`
    const read = `SELECT id AS mixed_id FROM ${database}.more`
    const mixed = `${created};\n${inserted};\n${read}`
    const requests: string[] = []

    const server = spawn(process.execPath, ['--import', 'tsx', '--eval', `
      const { createApp } = require('./src/index.ts')
      const server = createApp({ clickhouseUrl: process.env.CLICKHOUSE_TEST_URL, statementTimeoutMs: 2000 })
        .listen(0, '127.0.0.1', () => console.log('STAGE2_API=' + server.address().port))
    `], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, CLICKHOUSE_TEST_URL: clickhouseUrl },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const exit = once(server, 'exit')
    const output = createInterface({ input: server.stdout })
    const listening = new Promise<string>((resolve) => {
      output.on('line', (line) => {
        const port = /^STAGE2_API=(\d+)$/.exec(line)?.[1]
        if (port) resolve(port)
      })
    })

    try {
      const port = await Promise.race([
        listening,
        exit.then(([code]) => { throw new Error(`Test API exited before listening (code ${code}).`) }),
      ])
      const queryUrl = `http://127.0.0.1:${port}/query`

      await direct(`CREATE DATABASE ${database}`)
      await direct(`CREATE TABLE ${table} (id UInt64) ENGINE=Memory`)
      await page.addInitScript((statements) => {
        localStorage.setItem('sql-editor-ui.query-activity.v1', JSON.stringify(statements.map((sql, index) => ({
          id: `timeout-seed-${index}`, sql, startedAt: Date.now() - index, database: 'default',
          status: 'success', duration: 1, rowCount: 0,
        }))))
      }, [script, followup, mixed])

      await page.route('**/query', async (route) => {
        const body: unknown = route.request().postDataJSON()
        if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
          throw new Error('Expected a query string in the request body.')
        }
        if (!('source' in body) || body.source !== 'metadata') requests.push(body.query)
        const response = await route.fetch({ url: queryUrl })
        await route.fulfill({ response })
      })

      await page.goto('/')
      await expect(page.locator('.monaco-editor')).toBeVisible()
      const openActivity = page.getByRole('button', { name: 'Open activity log' })
      const loadInEditor = page.getByRole('button', { name: 'Load in editor' })
      const run = page.getByRole('button', { name: 'Run', exact: true })
      const editor = page.getByRole('textbox', { name: 'SQL query' })
      const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control')
      const results = page.getByRole('region', { name: 'Query results' })
      const outcomes = results.getByRole('combobox', { name: 'Statement outcome' })

      await openActivity.click()
      await loadInEditor.click()
      await run.click()
      if (failure === 'timeout') {
        await expect(results.getByRole('status')).toHaveText('Executing statement 2 of 3…')
      }
      await expect(outcomes.locator('option:checked')).toHaveText(/^Statement 2\b/)
      const alert = results.getByRole('alert')
      await expect(alert.getByText(failing, { exact: true })).toBeVisible()
      if (failure === 'timeout') {
        await expect(alert.getByRole('heading', { name: 'Statement 2 timed out', exact: true })).toBeVisible()
        await expect(alert.getByText('The statement timed out after 2 seconds.')).toBeVisible()
        await expect(alert.getByText('The write outcome is unknown.')).toBeVisible()
      } else {
        await expect(alert.getByText(/DB::Exception.*stage2_missing/)).toBeVisible()
      }
      await expect(run).toBeEnabled()

      await outcomes.selectOption({ index: 0 })
      await expect(results.getByText(`Inserted 1 row into ${table}.`, { exact: true })).toBeVisible()
      await outcomes.selectOption({ index: 2 })
      await expect(results.getByText('This statement was skipped.', { exact: true })).toBeVisible()
      await expect(results.getByText(skipped, { exact: true })).toBeVisible()
      expect(requests).toEqual([first, failing])

      if (failure === 'timeout') {
        await expect.poll(async () => {
          await direct('SYSTEM FLUSH LOGS')
          return direct(`SELECT exception_code FROM system.query_log WHERE query_kind = 'Insert' AND position(query, '${marker}') > 0 AND type = 'ExceptionWhileProcessing'`)
        }, { message: 'ClickHouse records the slow INSERT as cancelled' }).toBe('394')
      }
      expect(await direct(`SELECT countIf(id = 1), countIf(id = 3) FROM ${table}`)).toBe('1\t0')

      if (failure === 'error') {
        const fixed = `INSERT INTO ${table} VALUES (2)`
        await page.locator('.monaco-editor .view-line').filter({ hasText: 'stage2_missing' }).click()
        await page.keyboard.press('Home')
        await page.keyboard.press('Shift+End')
        await page.keyboard.insertText(`${fixed};`)
        await page.keyboard.press('ArrowLeft')
        await editor.press(`${modifier}+Enter`)
        await expect(results.getByText(`Inserted 1 row into ${table}.`, { exact: true })).toBeVisible()
        expect(requests).toEqual([first, failing, fixed])
        expect(await direct(`SELECT countIf(id = 1), countIf(id = 2), countIf(id = 3) FROM ${table}`)).toBe('1\t1\t0')
      }

      await openActivity.click()
      await page.getByRole('dialog', { name: 'Activity log' }).getByRole('button').filter({ hasText: followup }).click()
      await loadInEditor.click()
      await run.click()
      await expect(results.getByRole('columnheader', { name: 'confirmed_id' })).toBeVisible()
      await expect(results.getByRole('table').getByRole('cell', { name: '1', exact: true })).toHaveCount(1)
      expect(requests.at(-1)).toBe(followup)
      expect(requests).toHaveLength(failure === 'error' ? 4 : 3)
      if (failure === 'error') {
        await openActivity.click()
        await page.locator('.activity-entry').filter({ hasText: created }).click()
        await loadInEditor.click()
        await run.click()
        await expect(outcomes.locator('option:checked')).toHaveText(/^Statement 3\b/)
        await expect(results.getByRole('cell', { name: '9', exact: true })).toBeVisible()
        await outcomes.selectOption('0')
        await expect(results.getByText(`Created table ${database}.more.`, { exact: true })).toBeVisible()
        await outcomes.selectOption('1')
        await expect(results.getByText(`Inserted 1 row into ${database}.more.`, { exact: true })).toBeVisible()
        expect(requests.slice(4)).toEqual([created, inserted, read])
        expect(await direct(`SELECT count() FROM ${database}.more`)).toBe('1')
      }
    } finally {
      output.close()
      server.kill()
      await exit
      await direct(`DROP DATABASE IF EXISTS ${database} SYNC`)
    }
  })
}
