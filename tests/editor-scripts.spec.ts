/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function rows(value: number) {
  return { kind: 'rows' as const, columns: [{ name: 'value', type: 'UInt32' }], rows: [[value]], truncated: false, durationMs: 1 }
}

type Outcome = ReturnType<typeof rows> | { kind: 'error'; message: string; durationMs: number }

async function openEditor(page: Page, outcomes: Record<string, Outcome> = {}, sql?: string) {
  if (sql) {
    await page.addInitScript((text) => localStorage.setItem('sql-editor-ui.query-activity.v1', JSON.stringify([{
      id: 'editor-fixture', sql: text, database: 'default', startedAt: Date.now(), status: 'success', duration: 1, rowCount: 0,
    }])), sql)
  }
  const requests: string[] = []
  await page.route('**/query', async (route) => {
    const body: unknown = route.request().postDataJSON()
    if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string') {
      throw new Error('Expected a query string in the request body.')
    }
    if ('source' in body && body.source === 'metadata') {
      return route.fulfill({ json: { ...rows(0), columns: [], rows: [] } })
    }
    expect(body).toEqual({ query: body.query })
    const query = body.query.replaceAll('\r\n', '\n')
    requests.push(query)
    const outcome = outcomes[query] ?? { kind: 'error', message: 'Unexpected SQL in test', durationMs: 1 }
    return route.fulfill({ status: outcome.kind === 'error' ? 422 : 200, json: outcome })
  })
  await page.goto('/')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control')
  const input = page.getByRole('textbox', { name: 'SQL query' })
  await expect(input).toBeFocused()
  if (sql) {
    await page.getByRole('button', { name: 'Open activity log' }).click()
    await page.getByRole('button', { name: 'Load in editor' }).click()
  }
  const run = page.getByRole('button', { name: 'Run', exact: true })
  const results = page.getByRole('region', { name: 'Query results' })
  const selector = results.getByRole('combobox', { name: 'Statement outcome' })
  const cell = (value: number) => results.getByRole('cell', { name: String(value), exact: true })
  const paste = async (text: string) => {
    await page.evaluate((value) => navigator.clipboard.writeText(value), text)
    await input.press('ControlOrMeta+v')
  }
  const line = (text: string) => page.locator('.monaco-editor .view-line').filter({ hasText: text })
  const moveToLine = async (text: string) => {
    await line(text).click({ position: { x: 3, y: 10 } })
    await page.keyboard.press('Home')
  }
  return { input, modifier, requests, run, results, selector, cell, paste, moveToLine }
}

function renderedLines(page: Page) {
  return expect.poll(() => page.locator('.monaco-editor .view-line').evaluateAll(lines =>
    lines.map(line => (line.textContent ?? '').replaceAll(/[\u00a0\u00b7\u2e31]/g, ' ').replaceAll('\u200c', '')),
  ))
}

const partialError = 'Syntax error: SELECT requires a projection.'

test('the editor shortcut executes the complete multiline statement at the caret', async ({ page }) => {
  const middle = 'SELECT number AS middle\n\nFROM numbers(1)'
  const { input, modifier, requests, cell, moveToLine } = await openEditor(page, { [middle]: rows(202) }, `SELECT 101;\n${middle};\nSELECT 303`)
  await moveToLine('FROM numbers(1)')
  await input.press(`${modifier}+Enter`)
  await expect.poll(() => requests).toEqual([middle])
  await expect(cell(202)).toBeVisible()
})

test('the shortcut runs selections and toolbar Run executes the whole editor', async ({ page }) => {
  const first = 'SELECT 101'
  const second = 'SELECT 202'
  const third = 'SELECT 303'
  const { input, modifier, requests, run, results, selector, cell, moveToLine } = await openEditor(page, {
    [first]: rows(101), [second]: rows(202), [third]: rows(303),
    [`${first};`]: rows(101), [`\n${second}`]: rows(202),
    SELECT: { kind: 'error', message: partialError, durationMs: 1 },
  }, `${first};\n${second};\n${third}`)
  await moveToLine(first)
  for (let index = 0; index < `${first};\n${second}`.length; index++) await page.keyboard.press('Shift+ArrowRight')
  await input.press(`${modifier}+Enter`)
  await expect(cell(202)).toBeVisible()
  await expect(selector.getByRole('option')).toHaveCount(2)
  expect(requests).toEqual([`${first};`, `\n${second}`])

  await run.click()
  await expect(cell(303)).toBeVisible()
  await expect(selector.getByRole('option')).toHaveCount(3)
  expect(requests).toEqual([`${first};`, `\n${second}`, first, second, third])

  await moveToLine(second)
  for (let index = 0; index < 'SELECT'.length; index++) await page.keyboard.press('Shift+ArrowRight')
  await input.press(`${modifier}+Enter`)
  const error = results.getByRole('alert')
  await expect(error.getByText('SELECT', { exact: true })).toBeVisible()
  await expect(error.getByText(partialError, { exact: true })).toBeVisible()
  expect(requests).toEqual([`${first};`, `\n${second}`, first, second, third, 'SELECT'])
})

test('script boundaries respect SQL quotes and comments and outcomes stay available locally', async ({ page }) => {
  const first = "SELECT 'a;b' AS `quoted;identifier` -- line ; comment\n\nFROM numbers(1)"
  const second = '/* block ; comment */\nSELECT 202'
  const third = 'SELECT 303'
  const { requests, run, selector, cell } = await openEditor(page, {
    [first]: rows(101), [second]: rows(202), [third]: rows(303),
  }, `${first};\n${second};\n${third}`)
  await run.click()
  await expect(cell(303)).toBeVisible()
  await expect(selector.locator('option:checked')).toHaveText(/^Statement 3\b/)
  await expect(selector.getByRole('option')).toHaveText([/^Statement 1\b/, /^Statement 2\b/, /^Statement 3\b/])
  expect(requests).toEqual([first, second, third])

  await selector.selectOption({ index: 0 })
  await expect(cell(101)).toBeVisible()
  await selector.selectOption({ index: 1 })
  await expect(cell(202)).toBeVisible()
  expect(requests).toEqual([first, second, third])
})

test('toolbar editing history, word navigation, and line comments preserve SQL indentation', async ({ page }) => {
  const { run, input, modifier, paste, moveToLine } = await openEditor(page)
  const original = ['SELECT alpha FROM beta', '    WHERE active = 1', '      AND ready = 1', 'ORDER BY alpha']
  const [first, second, third, fourth] = original
  const undo = page.getByRole('button', { name: 'Undo SQL edit' })
  const redo = page.getByRole('button', { name: 'Redo SQL edit' })
  const assistant = page.getByRole('switch', { name: 'SQL assistant' })
  const prompt = page.getByRole('textbox', { name: 'Ask the SQL assistant' })
  await expect(prompt).toBeVisible()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await paste(original.join('\n'))
  await renderedLines(page).toEqual(original)
  await undo.click()
  await renderedLines(page).toEqual([''])
  await redo.click()
  await renderedLines(page).toEqual(original)

  await moveToLine(first)
  await page.keyboard.press('Control+ArrowRight')
  await page.keyboard.insertText('|')
  await renderedLines(page).toEqual(['SELECT| alpha FROM beta', second, third, fourth])
  await undo.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+ArrowLeft')
  await page.keyboard.insertText('|')
  await renderedLines(page).toEqual(['SELECT alpha FROM |beta', second, third, fourth])
  await undo.click()

  await moveToLine(first)
  await input.press('Escape')
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual([expect.stringMatching(/^--\s?SELECT alpha FROM beta$/), second, third, fourth])
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual(original)

  await assistant.click()
  await expect(prompt).toHaveCount(0)
  await moveToLine('WHERE active = 1')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+End')
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual([first, expect.stringMatching(/^ +--\s?WHERE active = 1$/), expect.stringMatching(/^ +--\s*AND ready = 1$/), fourth])
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual(original)
  await expect(undo).toBeEnabled()
  await expect(run).toBeEnabled()
})

test('toggling existing line comments twice preserves their exact spacing and is undoable', async ({ page }) => {
  const original = ['    --SELECT 1;', '    --    SELECT 2;']
  const { input, modifier, moveToLine } = await openEditor(page, {}, original.join('\n'))
  await moveToLine('--SELECT 1;')
  await input.press(`${modifier}+a`)
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual(['    SELECT 1;', '       SELECT 2;'])
  await input.press(`${modifier}+Slash`)
  await renderedLines(page).toEqual(original)
  await page.getByRole('button', { name: 'Undo SQL edit' }).click()
  await renderedLines(page).toEqual(['    SELECT 1;', '       SELECT 2;'])
  await page.getByRole('button', { name: 'Redo SQL edit' }).click()
  await renderedLines(page).toEqual(original)
})

test('right-click opens a compact editor menu beside the pointer above results after scrolling', async ({ page }) => {
  const first = 'SELECT 101'
  const last = 'SELECT 909 FROM numbers(1)'
  const selection = 'SELECT'
  const intermediate = Array.from({ length: 55 }, (_, index) => `SELECT ${index + 1000};`).join('\n')
  const { input, modifier, requests, cell, moveToLine } = await openEditor(page, {
    [first]: rows(101), [last]: rows(909), [selection]: rows(910),
  }, `${first};\n${intermediate}\n${last}`)
  const editor = page.locator('.monaco-editor')
  await editor.hover()
  await page.mouse.wheel(0, -4000)
  await moveToLine(`${first};`)
  await input.press(`${modifier}+Enter`)
  await expect(cell(101)).toBeVisible()

  const prompt = page.getByRole('textbox', { name: 'Ask the SQL assistant' })
  await prompt.fill('Review this script.\nCheck that the last statement returns the expected row.')
  await expect(page.getByTestId('copilot-chat-input')).toHaveAttribute('data-layout', 'expanded')
  const editorBox = await editor.boundingBox()
  if (!editorBox) throw new Error('Expected the editor to have visible bounds.')
  await input.press(modifier === 'Meta' ? 'Meta+ArrowDown' : 'Control+End')
  const target = editor.locator('.view-line').filter({ hasText: 'SELECT 909' })
  await expect(target).toBeInViewport()
  await expect(editor.locator('.view-line').filter({ hasText: /^SELECT\s101;$/ })).toHaveCount(0)
  const targetBox = await target.boundingBox()
  const viewport = page.viewportSize()
  if (!targetBox || !viewport) throw new Error('Expected the scrolled line and viewport to have visible bounds.')
  const menu = page.getByRole('menu')
  async function openMenuNear(pointer: { x: number; y: number }) {
    await page.mouse.click(pointer.x, pointer.y, { button: 'right' })
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    if (!box || !viewport) throw new Error('Expected the menu and viewport to have visible bounds.')
    expect(box.width).toBeLessThan(230)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    expect(Math.min(Math.abs(box.x - pointer.x), Math.abs(box.x + box.width - pointer.x))).toBeLessThan(42)
    expect(Math.min(Math.abs(box.y - pointer.y), Math.abs(box.y + box.height - pointer.y))).toBeLessThan(32)
  }
  await openMenuNear({ x: editorBox.x + editorBox.width - 35, y: targetBox.y + targetBox.height / 2 })
  await menu.getByRole('menuitem', { name: /^Run\b/ }).click({ delay: 125 })
  await expect(cell(909)).toBeVisible()
  expect(requests).toEqual([first, last])

  await moveToLine(last)
  const word = target.getByText('SELECT', { exact: true })
  await word.dblclick()
  await expect(menu).not.toBeVisible()
  await word.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /^Run\b/ }).click({ delay: 125 })
  await expect(cell(910)).toBeVisible()
  expect(requests).toEqual([first, last, selection])

  await input.press(modifier === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home')
  const topLine = editor.locator('.view-line').filter({ hasText: /^SELECT\s101;$/ })
  await expect(topLine).toBeInViewport()
  const topBox = await topLine.boundingBox()
  if (!topBox) throw new Error('Expected the first line to have visible bounds.')
  await openMenuNear({ x: topBox.x + 12, y: topBox.y + topBox.height / 2 })
  await menu.getByRole('menuitem', { name: /^Run\b/ }).click({ delay: 125 })
  await expect(cell(101)).toBeVisible()
  expect(requests).toEqual([first, last, selection, first])
})
