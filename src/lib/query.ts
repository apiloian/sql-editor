import { isReadVerb, sqlTokens, statementVerb } from './sql'

export type QueryRow = Record<string, unknown>
export type QueryColumn = { name: string; type: string }
export type RowResult = { kind: 'rows'; columns: QueryColumn[]; rows: unknown[][]; truncated: boolean; durationMs: number }
export type StatementResult =
  | RowResult
  | { kind: 'command'; message: string; durationMs: number }
  | { kind: 'error' | 'unknown'; message: string; durationMs: number }
  | { kind: 'timeout'; timeoutMs: number; writeOutcomeUnknown: boolean; durationMs: number }

export type StatementOutcome = {
  sql: string
  result: StatementResult | { kind: 'skipped' }
}

export type QueryState =
  | { status: 'idle' }
  | { status: 'running'; statementNumber: number; statementCount: number }
  | { status: 'complete'; statements: StatementOutcome[]; selected: number }

export const DEFAULT_PAGE_SIZE = 50
export const DEFAULT_RESULT_LIMIT = 10_000

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

export async function executeStatement(query: string, source: 'editor' | 'metadata' = 'editor'): Promise<StatementResult> {
  const started = performance.now()
  const deliveryFailure = (message: string): StatementResult => ({
    kind: isReadVerb(statementVerb(sqlTokens(query))) ? 'error' : 'unknown',
    message,
    durationMs: performance.now() - started,
  })

  try {
    const response = await fetch('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source === 'metadata' ? { query, source } : { query }),
    })
    const data: unknown = await response.json().catch(() => null)
    if (isStatementResult(data)) return data
    return deliveryFailure(response.ok ? 'The query server returned an invalid response.' : `The query server returned HTTP ${response.status}.`)
  } catch {
    return deliveryFailure('The connection to the query server was lost before confirmation.')
  }
}

export async function executeQuery(query: string): Promise<QueryRow[]> {
  const result = await executeStatement(query, 'metadata')
  if (result.kind === 'rows') return result.rows.map(row => Object.fromEntries(result.columns.map(({ name }, index) => [name, row[index]])))
  if ('message' in result) throw new Error(result.message)
  throw new Error('The metadata query exceeded its execution deadline.')
}

export function formatCell(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function failureMessage(result: Extract<StatementResult, { kind: 'timeout' | 'unknown' | 'error' }>): string {
  if (result.kind === 'timeout') {
    const seconds = result.timeoutMs / 1000
    const duration = seconds === 60 ? '1 minute'
      : seconds > 60 && seconds % 60 === 0 ? `${seconds / 60} minutes`
      : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
    return `The statement timed out after ${duration}.${result.writeOutcomeUnknown ? ' The write outcome is unknown. Check the database before retrying.' : ''}`
  }
  return result.kind === 'unknown' ? `The write outcome is unknown. ${result.message}` : result.message
}
