import { formatCell } from './query'
import type { QueryRow } from './query'

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
