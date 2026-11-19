import type { BrowserContext } from '@playwright/test'

type RunInput = {
  threadId: string
  runId: string
  messages: { id: string; role: string; content?: string }[]
  context: { description: string; value: string }[]
}
type Reply = { text: string; sql?: string; view?: unknown } | { error: string }

export async function mockAssistantRuntime(context: BrowserContext, respond: (input: RunInput) => Reply | Promise<Reply>, onStop?: () => void) {
  const runs: RunInput[] = []
  const site = 'https://api.example.test/editor-api'
  await context.route(site + '/assistant/info', (route) => route.fulfill({
    json: { mode: 'sse', agents: { default: { name: 'SQL assistant', description: 'ClickHouse SQL' } } },
  }))
  await context.route(site + '/assistant/agent/default/stop/*', async (route) => {
    onStop?.()
    await route.fulfill({ json: { stopped: true } })
  })
  await context.route(site + '/assistant/agent/default/run', async (route) => {
    const input: RunInput = route.request().postDataJSON()
    runs.push(input)
    const reply = await respond(input)
    const { threadId, runId } = input
    const messageId = 'reply-' + runId
    const events: Record<string, unknown>[] = [{ type: 'RUN_STARTED', threadId, runId }]
    if ('error' in reply) {
      events.push({ type: 'RUN_ERROR', message: reply.error })
    } else {
      events.push(
        { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: reply.text },
        { type: 'TEXT_MESSAGE_END', messageId },
      )
      if (reply.sql) events.push({ type: 'CUSTOM', name: 'sql-editor.replace-sql', value: reply.sql })
      if (reply.view) events.push({ type: 'CUSTOM', name: 'sql-editor.suggest-view', value: reply.view })
      events.push({ type: 'RUN_FINISHED', threadId, runId })
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body: events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
    })
  })
  return runs
}
