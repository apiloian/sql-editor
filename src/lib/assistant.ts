import { fetchApi } from './api'

export type AssistantAction = 'generate' | 'fix' | 'explain' | 'improve'

export async function requestAssistant(action: AssistantAction, prompt: string, sql: string, signal: AbortSignal): Promise<string> {
  const response = await fetchApi('/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, prompt, sql }), signal,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'The assistant could not respond. Try again.'
    throw new Error(message)
  }
  if (!data || typeof data !== 'object' || !('sql' in data) || typeof data.sql !== 'string' || !data.sql.trim()) throw new Error('The assistant returned an empty SQL response.')
  return data.sql
}
