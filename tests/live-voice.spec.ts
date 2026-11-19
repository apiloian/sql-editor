import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { expect, test } from '@playwright/test'
import { mockAssistantRuntime } from './assistant-runtime.ts'

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })

const workerSource = await readFile(new URL('../public/workers/whisper-transcriber.js', import.meta.url), 'utf8')
const withoutImport = workerSource.replace(/^import[^\n]+\n/, '')

test('live inference coalesces updates and flushes audio arriving during inference on Stop', async () => {
  const messages: unknown[] = []
  const releases: (() => void)[] = []
  let inFlight = 0
  let maxInFlight = 0
  const listener: { handler?: (event: { data: unknown }) => Promise<void> } = {}
  runInNewContext(withoutImport, {
    Float32Array,
    env: { backends: { onnx: { wasm: {} } } },
    pipeline: async () => async (audio: Float32Array) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise<void>((resolve) => releases.push(resolve))
      inFlight--
      return { text: `${audio.length} samples` }
    },
    self: {
      postMessage: (message: unknown) => messages.push(message),
      addEventListener: (_name: string, callback: (event: { data: unknown }) => Promise<void>) => { listener.handler = callback },
    },
  })
  const handler = listener.handler
  if (!handler) throw new Error('Worker message handler missing')
  await handler({ data: { type: 'init' } })
  await handler({ data: { type: 'start', session: 1 } })
  await handler({ data: { type: 'audio', session: 1, audio: new Float32Array(16_000).fill(0.1) } })
  await expect.poll(() => releases.length).toBe(1)
  await handler({ data: { type: 'audio', session: 1, audio: new Float32Array(16_000).fill(0.1) } })
  await handler({ data: { type: 'stop', session: 1 } })
  releases[0]()
  await expect.poll(() => releases.length).toBe(2)
  releases[1]()
  await expect.poll(() => messages).toContainEqual({ type: 'complete', session: 1, transcript: '32000 samples' })
  expect(messages).toContainEqual({ type: 'partial', session: 1, transcript: '16000 samples' })
  expect(maxInFlight).toBe(1)
})

test.describe('voice composer with synthetic microphone and stub inference', () => {
  test('dictation joins the typed conversation and submits only the edited text on Send', async ({ page, context }) => {
    const runs = await mockAssistantRuntime(context, () => ({ text: 'Got it.' }))
    await page.route('**/query', (route) => route.fulfill({ json: { rows: [] } }))
    await page.route('**/workers/whisper-transcriber.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `const env = { backends: { onnx: { wasm: {} } } }; const pipeline = async () => async audio => ({text: audio.length >= 32000 ? 'show trips by month' : 'show trips'});\n${withoutImport}`,
    }))
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Ask the SQL assistant' })
    const send = page.getByRole('button', { name: 'Send to SQL assistant' })
    await expect(page.getByTestId('copilot-chat-input').locator(':scope > [data-layout]')).toHaveCSS('padding-top', '4px')
    await expect(send).toHaveCSS('width', '32px')
    await input.fill('Count trips')
    await send.click()
    await expect(page.getByText('Got it.', { exact: true })).toBeVisible()
    await input.fill('Please')
    await page.getByRole('button', { name: 'Start voice input' }).click()
    const stop = page.getByRole('button', { name: 'Stop recording' })
    await expect(stop).toBeVisible()
    await expect(stop.locator('.lucide-square')).toBeVisible()
    await expect(input).toHaveValue('Please show trips', { timeout: 15_000 })
    await expect(input).toHaveValue('Please show trips by month', { timeout: 15_000 })
    await expect(stop).toBeVisible()
    await stop.click()
    await expect(page.getByRole('button', { name: 'Start voice input' })).toBeVisible()
    await expect(input).toHaveValue('Please show trips by month')
    await expect(input).toBeEditable()
    expect(runs).toHaveLength(1)
    await input.fill('Please show trips by week')
    await send.click()
    await expect.poll(() => runs.length).toBe(2)
    expect(runs[1].messages.map(({ content }) => content)).toEqual(['Count trips', 'Got it.', 'Please show trips by week'])
  })
})
