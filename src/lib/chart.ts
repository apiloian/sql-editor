import { formatCell } from './query'
import type { QueryColumn, QueryRow } from './query'

export type ChartKind = 'bar' | 'area' | 'line' | 'pie'
export type ResultsView = 'table' | ChartKind
export type ChartAxes = { xColumn: string; yColumn: string }

export const resultViews: { id: ResultsView; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'bar', label: 'Bar' },
  { id: 'area', label: 'Area' },
  { id: 'line', label: 'Line' },
  { id: 'pie', label: 'Pie' },
]

export function chartNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const number = Number(value)
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return null
  return number
}

export function chartPoints(rows: QueryRow[], xColumn: string, yColumn: string) {
  return rows.map((row) => ({ label: formatCell(row[xColumn]), value: chartNumber(row[yColumn]) }))
}

export function chartFields(columns: QueryColumn[], rows: QueryRow[]) {
  const plottable = columns.filter(({ name }) => rows.some((row) => chartNumber(row[name]) !== null))
  const numericType = /^(?:(?:Nullable|LowCardinality)\()*(?:U?Int\d+|B?Float\d+|Decimal\d*)(?:\b|\()/i
  const numericColumns = plottable.map(({ name }) => name)
  const category = columns.find(({ name }) => !numericColumns.includes(name))
    ?? columns.find(({ type }) => !numericType.test(type))
    ?? columns[0]
  const measures = [...plottable.filter(({ type }) => numericType.test(type)), ...plottable.filter(({ type }) => !numericType.test(type))]
  return {
    numericColumns,
    category: category?.name ?? '',
    measures: measures.map(({ name }) => name),
  }
}
