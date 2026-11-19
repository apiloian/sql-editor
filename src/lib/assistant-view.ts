import { resultViews } from './chart'
import type { ResultsView } from './chart'
import type { QueryColumn } from './query'
import type { EditorStatement } from './sql'

const MAX_METADATA_SQL_LENGTH = 40_000
const MAX_METADATA_COLUMNS = 128
const MAX_FIELD_LENGTH = 512
const MAX_METADATA_LENGTH = 96_000

type ViewFields = {
  kind: ResultsView
  category: string | null
  measure: string | null
  splitBy: string | null
}

export type ViewSuggestion = ViewFields & (
  | { target: 'result'; statementIndex: null }
  | { target: 'statement'; statementIndex: number }
)

export type PreparedView = {
  suggestion: Extract<ViewSuggestion, { target: 'statement' }>
  modelId: string
  version: number
  statement: EditorStatement
}

export type SelectedResultContext = {
  runId: number
  index: number
  sql: string
  columns: QueryColumn[]
}

export type VisualizationContext = {
  revision: number
  selected?: SelectedResultContext
}

function isViewKind(value: unknown): value is ResultsView {
  return resultViews.some(({ id }) => id === value)
}

function isField(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseViewSuggestion(value: unknown): ViewSuggestion | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 6) return
  const { target, kind, statementIndex, category, measure, splitBy } = value
  if (!isViewKind(kind) || !isField(category) || !isField(measure) || !isField(splitBy)) return

  const fields = { kind, category, measure, splitBy }
  if (target === 'result' && statementIndex === null) return { ...fields, target, statementIndex }
  if (target === 'statement' && typeof statementIndex === 'number'
    && Number.isSafeInteger(statementIndex) && statementIndex >= 0 && statementIndex < MAX_METADATA_SQL_LENGTH) {
    return { ...fields, target, statementIndex }
  }
}

export function serializeResultMetadata(result: SelectedResultContext | undefined): string | undefined {
  if (!result || !result.sql.trim() || result.sql.length > MAX_METADATA_SQL_LENGTH || !result.columns.length) return

  const columns = result.columns.slice(0, MAX_METADATA_COLUMNS).map(({ name, type }) => ({ name, type }))
  if (columns.some(({ name, type }) => name.length > MAX_FIELD_LENGTH || !type || type.length > MAX_FIELD_LENGTH)) return
  const value = JSON.stringify({ sql: result.sql, columns })
  return value.length <= MAX_METADATA_LENGTH ? value : undefined
}
