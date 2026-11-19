import { fetchApi } from './api'

export type CsvDestination = { database: string; name: string }

export type CsvImportError = { message: string; record?: number; column?: string }

export type CsvVerification =
  | { kind: 'verified'; importId: string; checkedRows: number; hasMore: boolean }
  | (CsvImportError & { kind: 'invalid'; checkedRows: number; hasMore: boolean })

export type CsvImportResult =
  | { kind: 'complete'; insertedRows: number }
  | (CsvImportError & {
      kind: 'failed'
      insertedRows: number
      unknownChunk?: { firstRecord: number; lastRecord: number }
    })

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseError(data: unknown): CsvImportError | null {
  if (!isObject(data) || typeof data.message !== 'string') return null
  return {
    message: data.message,
    record: isCount(data.record) && data.record > 0 ? data.record : undefined,
    column: typeof data.column === 'string' ? data.column : undefined,
  }
}

function parseVerification(data: unknown, ok: boolean): CsvVerification {
  if (isObject(data) && isCount(data.checkedRows) && typeof data.hasMore === 'boolean') {
    const sample = { checkedRows: data.checkedRows, hasMore: data.hasMore }
    if (ok && data.kind === 'verified' && typeof data.importId === 'string' && data.importId) {
      return { ...sample, kind: 'verified', importId: data.importId }
    }
    const error = parseError(data)
    if (data.kind === 'invalid' && error) return { ...sample, ...error, kind: 'invalid' }
  }
  throw new Error(parseError(data)?.message ?? 'The server could not verify the file.')
}

function parseImportResult(data: unknown, ok: boolean): CsvImportResult | null {
  if (!isObject(data) || !isCount(data.insertedRows)) return null
  if (data.kind === 'complete' && ok) return { kind: 'complete', insertedRows: data.insertedRows }
  const error = parseError(data)
  if (data.kind !== 'failed' || !error) return null
  const chunk = data.unknownChunk
  if (chunk === undefined) return { ...error, kind: 'failed', insertedRows: data.insertedRows }

  if (!isObject(chunk) || !isCount(chunk.firstRecord) || !isCount(chunk.lastRecord)
    || chunk.firstRecord < 1 || chunk.lastRecord < chunk.firstRecord) return null

  return {
    ...error,
    kind: 'failed',
    insertedRows: data.insertedRows,
    unknownChunk: { firstRecord: chunk.firstRecord, lastRecord: chunk.lastRecord },
  }
}

export async function verifyCsvImport(table: CsvDestination, file: File, signal: AbortSignal): Promise<CsvVerification> {
  const target = new URLSearchParams({ database: table.database, table: table.name })
  const response = await fetchApi(`/csv-import/verify?${target}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'text/csv' },
    signal,
  })
  const payload: unknown = await response.json().catch(() => null)
  return parseVerification(payload, response.ok)
}

export async function confirmCsvImport(importId: string): Promise<CsvImportResult | null> {
  const response = await fetchApi(`/csv-import/${encodeURIComponent(importId)}/confirm`, { method: 'POST' })
  const payload: unknown = await response.json().catch(() => null)
  return parseImportResult(payload, response.ok)
}
