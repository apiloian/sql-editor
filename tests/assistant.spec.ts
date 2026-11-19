import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockAssistantRuntime } from './assistant-runtime.ts'

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Ask the SQL assistant' })
const send = (page: Page) => page.getByRole('button', { name: 'Send to SQL assistant' })

async function submit(page: Page, message: string) {
  await prompt(page).fill(message)
  await send(page).click()
}

test('retains a definition through collapse and toggle, and starts fresh on reload or a new tab', async ({ page, context }) => {
  const definition = 'Active registrations include paid trials.'
  const runs = await mockAssistantRuntime(context, ({ messages }) => {
    const latest = messages.at(-1)?.content
    if (latest === definition) return { text: 'I will use that definition.', sql: 'SELECT 1;' }
    return messages.some((message) => message.content === definition)
      ? { text: 'Used the earlier definition.', sql: 'SELECT 2;' }
      : { text: 'What definition should I use?' }
  })
  let sqlExecutions = 0
  await context.route('**/query', (route) => {
    if (route.request().postDataJSON().source !== 'metadata') sqlExecutions++
    return route.fulfill({ json: { rows: [] } })
  })

  await page.goto('/')
  await submit(page, definition)
  await expect(page.locator('.view-lines')).toContainText('SELECT 1;')
  const toggle = page.getByRole('switch', { name: 'SQL assistant' })
  await page.getByRole('textbox', { name: 'SQL query' }).focus()
  await toggle.click()
  await expect(prompt(page)).not.toBeVisible()
  await toggle.click()
  await submit(page, 'Group those by week.')
  await expect(page.locator('.view-lines')).toContainText('SELECT 2;')
  expect(runs[1].threadId).toBe(runs[0].threadId)
  expect(runs[1].messages.map(({ content }) => content)).toEqual([definition, 'I will use that definition.', 'Group those by week.'])
  expect(runs[1].context).toContainEqual({ description: 'Current ClickHouse editor SQL', value: 'SELECT 1;' })
  expect(runs[1]).not.toHaveProperty('action')
  await expect(page.getByRole('button', { name: /Assistant action:/ })).toHaveCount(0)

  const otherPage = await context.newPage()
  await otherPage.goto('/')
  await submit(otherPage, 'Group those by week.')
  await expect(otherPage.getByText('What definition should I use?')).toBeVisible()
  expect(runs[2].messages.map(({ content }) => content)).toEqual(['Group those by week.'])
  expect(runs[2].threadId).not.toBe(runs[0].threadId)

  await page.reload()
  await submit(page, 'Group those by week.')
  await expect(page.getByText('What definition should I use?')).toBeVisible()
  expect(runs[3].messages.map(({ content }) => content)).toEqual(['Group those by week.'])
  expect(runs[3].threadId).not.toBe(runs[0].threadId)
  expect(sqlExecutions).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('sql-editor-ui.query-activity.v1'))).toBeNull()
})

test('an assistant edit is undoable and failed requests restore editing with a trace ID', async ({ page, context }) => {
  await mockAssistantRuntime(context, ({ messages }) => messages.at(-1)?.content === 'Generate'
    ? { text: 'Prepared your query.', sql: 'SELECT 42;' }
    : { error: 'Could not read database metadata. Trace ID abc-123.' })
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  const sql = page.getByRole('textbox', { name: 'SQL query' })
  await sql.focus()
  await page.keyboard.insertText('SELECT 1;')
  await submit(page, 'Generate')
  await expect(page.locator('.view-lines')).toContainText('SELECT 42;')
  await page.getByRole('button', { name: 'Undo SQL edit' }).click()
  await expect(page.locator('.view-lines')).toContainText('SELECT 1;')

  await submit(page, 'Find a table')
  await expect(page.getByText(/Trace ID abc-123/)).toBeVisible()
  await expect(sql).toBeEditable()
  await expect(prompt(page)).toBeEditable()
  await expect(page.locator('.view-lines')).toContainText('SELECT 1;')
})

test('canceling an assistant request unlocks SQL and keeps the draft available', async ({ page, context }) => {
  let finish!: () => void
  const delayed = new Promise<void>((resolve) => { finish = resolve })
  await mockAssistantRuntime(context, async () => {
    await delayed
    return { text: 'Late response', sql: 'SELECT 999;' }
  }, finish)
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  const sql = page.getByRole('textbox', { name: 'SQL query' })
  await sql.focus()
  await page.keyboard.insertText('SELECT 1;')
  await submit(page, 'Show registrations')
  try {
    const cancel = page.getByRole('button', { name: 'Cancel assistant request' })
    await expect(cancel).toBeVisible()
    await sql.focus()
    await page.keyboard.press('x')
    await expect(page.locator('.view-lines')).toHaveText('SELECT 1;')
    await cancel.click()
    await expect(page.getByText('Assistant request canceled.')).toBeVisible()
    await expect(prompt(page)).toHaveValue('Show registrations')
  } finally {
    finish()
  }
  await expect(page.locator('.view-lines')).toContainText('SELECT 1;')
  await sql.focus()
  await page.keyboard.press('End')
  await page.keyboard.type(' -- editable')
  await expect(page.locator('.view-lines')).toContainText('-- editable')
})

test('the selected statement is revised in place and the whole script remains an available target', async ({ page, context }) => {
  const original = ['CREATE TABLE registrations (registered Date) ENGINE = Memory;', 'SELECT * FROM registrations;', 'DROP TABLE registrations;']
  const revised = 'SELECT * FROM registrations WHERE registered >= today() - INTERVAL 3 MONTH;'
  const whole = ['-- Reviewed script', ...original]
  const runs = await mockAssistantRuntime(context, ({ messages }) => messages.at(-1)?.content === 'Review the whole script'
    ? { text: 'Reviewed the script.', sql: whole.join('\n') }
    : { text: 'Limited the selected statement.', sql: revised })
  let executions = 0
  await page.route('**/query', (route) => {
    if (route.request().postDataJSON().source !== 'metadata') executions++
    return route.fulfill({ json: { rows: [] } })
  })
  await page.goto('/')
  const sql = page.getByRole('textbox', { name: 'SQL query' })
  await sql.focus()
  await page.keyboard.insertText(original.join('\n'))
  const lines = page.locator('.monaco-editor .view-line')
  await lines.nth(1).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await expect(page.getByText('Selected SQL', { exact: true })).toHaveCount(0)
  await submit(page, 'Only include registrations from the last three months')
  await expect(lines).toHaveText([original[0], revised, original[2]])
  const source = runs[0].context.find(({ description }) => description === 'Current ClickHouse editor SQL')?.value
  const selected = runs[0].context.find(({ description }) => description === 'Selected ClickHouse editor SQL range')?.value
  if (!source || !selected) throw new Error('Expected editor SQL and selection offsets in the request.')
  const { start, end } = JSON.parse(selected)
  expect(source.slice(start, end)).toBe(original[1])
  await page.getByRole('button', { name: 'Undo SQL edit' }).click()
  await expect(lines).toHaveText(original)
  await page.getByRole('button', { name: 'Redo SQL edit' }).click()
  await expect(lines).toHaveText([original[0], revised, original[2]])

  await sql.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Whole editor', { exact: true })).toHaveCount(0)
  await submit(page, 'Review the whole script')
  await expect(lines).toHaveText(whole)
  expect(runs[1].context.some(({ description }) => description === 'Selected ClickHouse editor SQL range')).toBe(false)
  expect(executions).toBe(0)
})

test('moving the SQL selection while the assistant works discards the late edit and keeps the prompt', async ({ page, context }) => {
  let finish!: () => void
  const wait = new Promise<void>((resolve) => { finish = resolve })
  await mockAssistantRuntime(context, async () => {
    await wait
    return { text: 'Revised.', sql: 'SELECT 3;' }
  })
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  await page.getByRole('textbox', { name: 'SQL query' }).focus()
  await page.keyboard.insertText('SELECT 1;\nSELECT 2;')
  await page.keyboard.press('Shift+Home')
  await submit(page, 'Change this selection')
  try {
    await expect(page.getByText('Working on your SQL…')).toBeVisible()
    await page.locator('.monaco-editor .view-line').first().click()
  } finally {
    finish()
  }
  await expect(page.getByRole('alert').filter({ hasText: 'The SQL edit target changed' })).toBeVisible()
  await expect(prompt(page)).toHaveValue('Change this selection')
  await expect(page.locator('.monaco-editor .view-line')).toHaveText(['SELECT 1;', 'SELECT 2;'])
})

const registrationsSql = "SELECT toStartOfWeek(registered) AS week, count() AS registrations FROM registrations WHERE registered >= today() - INTERVAL 3 MONTH GROUP BY week ORDER BY week"
const resultColumns = [{ name: 'week', type: 'Date' }, { name: 'registrations', type: 'UInt64' }]
const registrationRows = [['2026-11-02', '42'], ['2026-11-09', '64']]
const weeklyView = { target: 'statement', statementIndex: 0, kind: 'line', category: 'week', measure: 'registrations', splitBy: null }
const preparePrompt = 'Show registrations over the last three months as a weekly line chart'

async function mockRegistrationQueries(page: Page, failFirst = false) {
  const queries: string[] = []
  await page.route('**/query', (route) => {
    const { query } = route.request().postDataJSON()
    if (/FROM system\.(databases|tables)/.test(query)) {
      return route.fulfill({ json: { kind: 'rows', columns: [], rows: [], truncated: false, durationMs: 1 } })
    }
    queries.push(query)
    if (failFirst && queries.length === 1) {
      return route.fulfill({ status: 422, json: { kind: 'error', message: 'Fixture query failed', durationMs: 2 } })
    }
    return route.fulfill({ json: { kind: 'rows', columns: resultColumns, rows: registrationRows, truncated: true, durationMs: 3 } })
  })
  return queries
}

const resultView = (page: Page, name: string) => page.getByRole('group', { name: 'Result view' }).getByRole('button', { name, exact: true })
const preparedView = (page: Page) => page.getByLabel('Prepared view')
const runSql = (page: Page) => page.getByRole('button', { name: 'Run', exact: true }).click()

test('prepares a weekly chart, honors the manual override, and restyles returned rows without running SQL', async ({ page, context }) => {
  const requests = await mockRegistrationQueries(page)
  const runs = await mockAssistantRuntime(context, ({ messages }) => messages.at(-1)?.content === preparePrompt
    ? { text: 'Prepared weekly registrations.', sql: registrationsSql, view: weeklyView }
    : { text: 'Showing the weekly result as an area chart.', view: { ...weeklyView, target: 'result', statementIndex: null, kind: 'area' } })
  await page.goto('/')
  await submit(page, preparePrompt)
  await expect(preparedView(page)).toHaveValue('line')
  await preparedView(page).selectOption('bar')
  await expect(page.locator('.chart-content canvas')).toHaveCount(0)
  expect(requests).toEqual([])

  await runSql(page)
  await expect(resultView(page, 'Bar')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chart-content canvas')).toBeVisible()
  await expect(preparedView(page)).toHaveCount(0)
  await expect(page.getByText('Showing the first 10,000 rows.', { exact: false })).toBeVisible()
  await resultView(page, 'Table').click()
  await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible()
  await submit(page, 'Show this result as an area chart')
  await expect(resultView(page, 'Area')).toHaveAttribute('aria-pressed', 'true')
  const metadata = runs[1].context.find(({ description }) => description === 'Selected query result metadata')
  expect(JSON.parse(metadata?.value ?? 'null')).toEqual({ sql: registrationsSql, columns: resultColumns })
  expect(requests).toEqual([registrationsSql])
  const activity = await page.evaluate(() => JSON.parse(localStorage.getItem('sql-editor-ui.query-activity.v1') ?? '[]'))
  expect(activity).toHaveLength(1)
  expect(activity[0].sql).toBe(registrationsSql)
})

test('matches a chart to the targeted statement even when another statement has identical SQL', async ({ page, context }) => {
  const requests = await mockRegistrationQueries(page)
  await mockAssistantRuntime(context, () => ({
    text: 'Prepared a chart for the second statement.',
    sql: `${registrationsSql};\n${registrationsSql};`,
    view: { ...weeklyView, statementIndex: 1 },
  }))
  await page.goto('/')
  await submit(page, preparePrompt)
  await expect(preparedView(page)).toHaveValue('line')
  await page.locator('.monaco-editor .view-line').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Run\b/ }).click({ delay: 125 })
  await expect(resultView(page, 'Table')).toHaveAttribute('aria-pressed', 'true')
  await expect(preparedView(page)).toHaveValue('line')

  await runSql(page)
  const outcomes = page.getByRole('combobox', { name: 'Statement outcome' })
  await expect(outcomes).toHaveValue('1')
  await expect(resultView(page, 'Line')).toHaveAttribute('aria-pressed', 'true')
  await outcomes.selectOption('0')
  await expect(resultView(page, 'Table')).toHaveAttribute('aria-pressed', 'true')
  await outcomes.selectOption('1')
  await expect(resultView(page, 'Line')).toHaveAttribute('aria-pressed', 'true')
  expect(requests).toEqual([registrationsSql, registrationsSql, registrationsSql])
})

test('keeps a failed chart empty, invalidates the prepared view after edits, and falls back when an axis is missing', async ({ page, context }) => {
  const requests = await mockRegistrationQueries(page, true)
  await mockAssistantRuntime(context, ({ messages }) => messages.at(-1)?.content === preparePrompt
    ? { text: 'Prepared weekly registrations.', sql: registrationsSql, view: weeklyView }
    : { text: 'Suggested a measure.', view: { ...weeklyView, target: 'result', statementIndex: null, measure: 'missing' } })
  await page.goto('/')
  await submit(page, preparePrompt)
  await expect(preparedView(page)).toHaveValue('line')
  await runSql(page)
  await expect(page.getByText('Fixture query failed')).toBeVisible()
  await expect(preparedView(page)).toHaveValue('line')
  await expect(page.locator('.chart-content canvas')).toHaveCount(0)

  const sql = page.getByRole('textbox', { name: 'SQL query' })
  await sql.focus()
  await sql.press('End')
  await page.keyboard.insertText(' LIMIT 10')
  await expect(preparedView(page)).toHaveCount(0)
  await runSql(page)
  await expect(resultView(page, 'Table')).toHaveAttribute('aria-pressed', 'true')
  await submit(page, 'Chart the current result')
  await expect(page.getByText(/suggested measure .*missing.* needs one numeric column/)).toBeVisible()
  await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible()
  expect(requests).toEqual([registrationsSql, registrationsSql + ' LIMIT 10'])
})

test('a newer manual view wins over an assistant response that arrives later', async ({ page, context }) => {
  let finish!: () => void
  const wait = new Promise<void>((resolve) => { finish = resolve })
  const requests = await mockRegistrationQueries(page)
  await mockAssistantRuntime(context, async ({ messages }) => {
    if (messages.at(-1)?.content === preparePrompt) return { text: 'Prepared weekly registrations.', sql: registrationsSql }
    await wait
    return { text: 'Suggested a line chart.', view: { ...weeklyView, target: 'result', statementIndex: null } }
  })
  await page.goto('/')
  await submit(page, preparePrompt)
  await expect(page.getByText('Prepared weekly registrations.')).toBeVisible()
  await runSql(page)
  await expect(resultView(page, 'Table')).toHaveAttribute('aria-pressed', 'true')
  await submit(page, 'Show a line chart for this result')
  try {
    await expect(page.getByText('Working on your SQL…')).toBeVisible()
    await resultView(page, 'Bar').click()
  } finally {
    finish()
  }
  await expect(page.getByText(/workspace changed while the assistant was working/)).toBeVisible()
  await expect(resultView(page, 'Bar')).toHaveAttribute('aria-pressed', 'true')
  expect(requests).toEqual([registrationsSql])
})
