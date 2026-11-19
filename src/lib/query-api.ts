import { fetchApi } from './api'
import type { QueryColumn, QueryRow, StatementResult } from './query'
import { isReadVerb, sqlTokens, statementVerb } from './sql'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isColumn(value: unknown): value is QueryColumn {
  return isRecord(value) && typeof value.name === 'string' && typeof value.type === 'string'
}

function isStatementResult(value: unknown): value is StatementResult {
  if (!isRecord(value) || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) return false
  switch (value.kind) {
    case 'rows': {
      const { columns, rows, truncated } = value
      return Array.isArray(columns) && columns.every(isColumn) && Array.isArray(rows)
        && rows.every(row => Array.isArray(row) && row.length === columns.length) && typeof truncated === 'boolean'
    }
    case 'command':
    case 'error':
    case 'unknown':
      return typeof value.message === 'string'
    case 'timeout':
      return typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0 && typeof value.writeOutcomeUnknown === 'boolean'
    default:
      return false
  }
}

export async function executeStatement(query: string, source: 'editor' | 'metadata' = 'editor', signal?: AbortSignal): Promise<StatementResult> {
  const started = performance.now()
  const deliveryFailure = (message: string): StatementResult => ({
    kind: isReadVerb(statementVerb(sqlTokens(query))) ? 'error' : 'unknown',
    message,
    durationMs: performance.now() - started,
  })

  try {
    const response = await fetchApi('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source === 'metadata' ? { query, source } : { query }),
      signal,
    })
    const data: unknown = await response.json().catch(() => null)
    signal?.throwIfAborted()
    if (isStatementResult(data)) return data
    return deliveryFailure(response.ok ? 'The query server returned an invalid response.' : `The query server returned HTTP ${response.status}.`)
  } catch {
    signal?.throwIfAborted()
    return deliveryFailure('The connection to the query server was lost before confirmation.')
  }
}

export async function executeQuery(query: string, signal?: AbortSignal): Promise<QueryRow[]> {
  const result = await executeStatement(query, 'metadata', signal)
  if (result.kind === 'rows') return result.rows.map(row => Object.fromEntries(result.columns.map(({ name }, index) => [name, row[index]])))
  if ('message' in result) throw new Error(result.message)
  throw new Error('The metadata query exceeded its execution deadline.')
}
