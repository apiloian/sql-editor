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
  | { status: 'complete'; runId: number; statements: StatementOutcome[]; lastAttemptedIndex: number }

export const DEFAULT_PAGE_SIZE = 50
export const DEFAULT_RESULT_LIMIT = 10_000

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
