import { useRef, useState } from 'react'
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { SqlEditTarget } from '../components/SqlEditor/SqlEditor'
import { parseViewSuggestion, serializeResultMetadata } from '../lib/assistant-view'
import type { ViewSuggestion, VisualizationContext } from '../lib/assistant-view'

export const ASSISTANT_AGENT_ID = 'default'
const WORKSPACE_AGENT_ID = 'sql-editor'
const MAX_SQL_LENGTH = 40_000
const RECENT_MESSAGES = 12
const REPLACE_SQL_EVENT = 'sql-editor.replace-sql'
const SUGGEST_VIEW_EVENT = 'sql-editor.suggest-view'
const TURN_ERROR = 'The assistant could not respond. Try again.'

export type AssistantTurnOptions = {
  getEditTarget: () => SqlEditTarget | undefined
  onReplaceSql: (target: SqlEditTarget, replacement: string) => void
  getVisualizationContext: () => VisualizationContext
  onVisualizationSuggestion: (suggestion: ViewSuggestion, target: SqlEditTarget, replacement: string | undefined, context: VisualizationContext) => string | undefined
  onBusyChange: (busy: boolean) => void
}

export type AssistantNotice = { kind: 'reply' | 'status' | 'error'; text: string }

export function useAssistantTurn({ getEditTarget, onReplaceSql, getVisualizationContext, onVisualizationSuggestion, onBusyChange }: AssistantTurnOptions) {
  const [threadId] = useState(() => crypto.randomUUID())
  const { agent, isReady } = useAgent({ agentId: WORKSPACE_AGENT_ID, runtimeAgentId: ASSISTANT_AGENT_ID, threadId })
  const { copilotkit } = useCopilotKit()
  const [pending, setPending] = useState(false)
  const active = useRef<{ cancelled: boolean } | null>(null)

  async function run(text: string): Promise<AssistantNotice | undefined> {
    if (!isReady || active.current) return

    const target = getEditTarget()
    if (!target) return { kind: 'error', text: 'The SQL editor is still loading.' }
    if (target.sql.length > MAX_SQL_LENGTH) {
      return { kind: 'error', text: 'The SQL assistant can review up to 40,000 characters of SQL.' }
    }

    const request = { cancelled: false }
    const history = agent.messages.slice()
    const contextIds: string[] = []
    let subscription: ReturnType<typeof agent.subscribe> | undefined
    let replacement: string | undefined
    let suggestion: ViewSuggestion | undefined
    let failure: string | undefined
    let finished = false
    active.current = request
    setPending(true)

    try {
      const visualization = getVisualizationContext()
      const metadata = serializeResultMetadata(visualization.selected)
      onBusyChange(true)
      agent.setMessages([...history.slice(-RECENT_MESSAGES), { id: crypto.randomUUID(), role: 'user', content: text }])
      contextIds.push(copilotkit.addContext({ description: 'Current ClickHouse editor SQL', value: target.sql, agentIds: [WORKSPACE_AGENT_ID] }))
      if (target.range) {
        contextIds.push(copilotkit.addContext({ description: 'Selected ClickHouse editor SQL range', value: JSON.stringify(target.range), agentIds: [WORKSPACE_AGENT_ID] }))
      }
      if (metadata) {
        contextIds.push(copilotkit.addContext({ description: 'Selected query result metadata', value: metadata, agentIds: [WORKSPACE_AGENT_ID] }))
      }
      subscription = agent.subscribe({
        onCustomEvent({ event }) {
          if (event.name === REPLACE_SQL_EVENT && typeof event.value === 'string' && event.value.trim() && event.value.length <= MAX_SQL_LENGTH) {
            replacement = event.value
          }
          if (event.name === SUGGEST_VIEW_EVENT) suggestion = parseViewSuggestion(event.value)
        },
        onRunFinishedEvent() { finished = true },
        onRunErrorEvent({ event }) { failure = event.message },
      })

      const { newMessages } = await copilotkit.runAgent({ agent })
      if (request.cancelled || !finished || failure) throw new Error(failure || TURN_ERROR)
      if (replacement) onReplaceSql(target, replacement)
      const applicableSuggestion = suggestion?.target === 'result' && (replacement || !metadata) ? undefined : suggestion
      const viewNote = applicableSuggestion && onVisualizationSuggestion(applicableSuggestion, target, replacement, visualization)
      const reply = newMessages.findLast((message) => message.role === 'assistant')
      const replyText = typeof reply?.content === 'string' ? reply.content.trim() : ''
      const message = [replyText || (replacement ? 'SQL updated. Review it, then Run.' : ''), viewNote].filter(Boolean).join('\n\n')
      if (message) return { kind: 'reply', text: message }
    } catch (error) {
      agent.setMessages(history)
      return request.cancelled
        ? { kind: 'status', text: 'Assistant request canceled.' }
        : { kind: 'error', text: error instanceof Error ? error.message : TURN_ERROR }
    } finally {
      try {
        subscription?.unsubscribe()
      } finally {
        for (const contextId of contextIds) copilotkit.removeContext(contextId)
        active.current = null
        setPending(false)
        onBusyChange(false)
      }
    }
  }

  function stop() {
    if (!active.current) return
    active.current.cancelled = true
    copilotkit.stopAgent({ agent })
  }

  return { isReady, pending, run, stop }
}
