import { expect, test } from '@playwright/test'
import { mockAssistantRuntime } from './assistant-runtime.ts'

test.use({ reducedMotion: 'reduce' })

test('expands on focus and keeps an editable draft through collapse and toggle', async ({ page, context }) => {
  await mockAssistantRuntime(context, () => ({ text: 'Ready.' }))
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Ask the SQL assistant' })
  const composer = page.locator('.assistant-composer')
  const toggle = page.getByRole('switch', { name: 'SQL assistant' })
  await input.focus()
  const focused = await composer.boundingBox()
  await input.fill('Review the query.\nCheck its grouping.')
  await expect(page.getByTestId('copilot-chat-input')).toHaveAttribute('data-layout', 'expanded')
  await page.getByRole('textbox', { name: 'SQL query' }).focus()
  await expect(input).not.toBeFocused()
  await toggle.click()
  await expect(input).not.toBeVisible()
  await toggle.click()
  await expect(input).toHaveValue('Review the query.\nCheck its grouping.')
  await input.fill('')
  await page.getByRole('textbox', { name: 'SQL query' }).focus()
  const collapsed = await composer.boundingBox()
  expect(focused?.width ?? 0).toBeGreaterThan(collapsed?.width ?? 0)
  await expect(page.getByRole('button', { name: /Assistant action:/ })).toHaveCount(0)
})

test('the dismiss button stays under the pointer through a click', async ({ page, context }) => {
  await mockAssistantRuntime(context, () => ({ text: 'Ready to run.' }))
  await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
  await page.goto('/')

  const input = page.getByRole('textbox', { name: 'Ask the SQL assistant' })
  const editor = page.getByRole('textbox', { name: 'SQL query' })
  const send = page.getByRole('button', { name: 'Send to SQL assistant' })
  const dismiss = page.getByRole('button', { name: 'Dismiss assistant message' })

  for (const focus of [editor, input]) {
    await input.fill('Review the query')
    await send.click()
    await expect(dismiss).toBeVisible()
    await focus.focus()
    const before = await dismiss.boundingBox()
    if (!before) throw new Error('Expected the dismiss button to be visible.')
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    expect(await dismiss.boundingBox()).toEqual(before)
    await expect(focus).toBeFocused()
    await page.mouse.up()
    await expect(dismiss).toHaveCount(0)
  }

  await input.fill('Review the query again')
  await send.click()
  await dismiss.focus()
  await dismiss.press('Enter')
  await expect(dismiss).toHaveCount(0)
})
