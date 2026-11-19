import { formatCell } from './query'
import type { RowResult } from './query'
import type { ViewSuggestion } from './assistant-view'

export type ChartKind = 'bar' | 'area' | 'line' | 'pie'
export type ResultsView = 'table' | ChartKind
export type ChartAxes = { xColumn?: string; yColumn?: string; splitColumn?: string }

type ChartField = { index: number; key: string; name: string; label: string; numeric: boolean; numericType: boolean }
const MAX_CHART_SERIES = 8
const NUMERIC_TYPE = /^(?:(?:Nullable|LowCardinality)\()*(?:U?Int\d+|B?Float\d+|Decimal\d*)(?:\b|\()/i

type SplitChartPoints =
  | { kind: 'split'; categories: string[]; series: { id: string; name: string; values: (number | null)[] }[] }
  | { kind: 'duplicate' | 'too-many-series' }

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

export function chartFields({ columns, rows }: RowResult): ChartField[] {
  const names = new Set(columns.map(({ name }) => name))
  const occurrences = new Map<string, number>()
  const labels = new Set<string>()
  return columns.map(({ name, type }, index) => {
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    const base = name || `Column ${index + 1}`
    let label = base
    let suffix = 2
    while (labels.has(label) || (label !== name && names.has(label))) label = `${base} (${suffix++})`
    labels.add(label)
    return {
      index,
      key: JSON.stringify([name, occurrence]),
      name,
      label,
      numeric: rows.some((row) => chartNumber(row[index]) !== null),
      numericType: NUMERIC_TYPE.test(type),
    }
  })
}

function splitChartPoints(rows: RowResult['rows'], xColumn: number, yColumn: number, splitColumn: number): SplitChartPoints {
  const categories: string[] = []
  const categoryIndexes = new Map<string, number>()
  const groups = new Map<string, { label: string; values: Map<number, number | null> }>()

  for (const row of rows) {
    const category = row[xColumn]
    const categoryKey = JSON.stringify([category])
    let index = categoryIndexes.get(categoryKey)
    if (index === undefined) {
      index = categories.length
      categoryIndexes.set(categoryKey, index)
      categories.push(formatCell(category))
    }

    const splitValue = row[splitColumn]
    const id = JSON.stringify([splitValue])
    let group = groups.get(id)
    if (!group) {
      if (groups.size === MAX_CHART_SERIES) return { kind: 'too-many-series' }
      group = { label: splitValue == null ? '(NULL)' : formatCell(splitValue) || '(Empty)', values: new Map() }
      groups.set(id, group)
    }

    if (group.values.has(index)) return { kind: 'duplicate' }
    group.values.set(index, chartNumber(row[yColumn]))
  }

  const names = new Set<string>()
  const series = Array.from(groups, ([id, { label, values }]) => {
    let name = label
    let suffix = 2
    while (names.has(name)) name = `${label} (${suffix++})`
    names.add(name)
    return { id, name, values: categories.map((_, index) => values.get(index) ?? null) }
  })
  return { kind: 'split', categories, series }
}

export function fieldTitle(label: string) {
  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}

export function prepareChart(rows: RowResult['rows'], fields: readonly ChartField[], axes: ChartAxes, kind: ChartKind) {
  const numericFields = fields.filter(({ numeric }) => numeric)
  const category = fields.find(({ key }) => key === axes.xColumn)
    ?? fields.find(({ numeric }) => !numeric)
    ?? fields.find(({ numericType }) => !numericType)
    ?? fields[0]
  const preferredMeasures = [...numericFields.filter(({ numericType }) => numericType), ...numericFields.filter(({ numericType }) => !numericType)]
  const measure = numericFields.find(({ key }) => key === axes.yColumn)
    ?? preferredMeasures.find((field) => field !== category)
    ?? preferredMeasures[0]
  const isPie = kind === 'pie'
  const splitFields = isPie ? [] : fields.filter((field) => field !== category && field !== measure)
  const splitField = splitFields.find(({ key }) => key === axes.splitColumn)
  const points = category && measure
    ? rows.map((row) => ({ label: formatCell(row[category.index]), value: chartNumber(row[measure.index]) }))
    : []
  const split = category && measure && splitField
    ? splitChartPoints(rows, category.index, measure.index, splitField.index)
    : null
  const validPoints = points.filter((point): point is { label: string; value: number } => point.value !== null)
  let message = ''
  if (numericFields.length === 0) message = 'No numeric columns to plot. Return a numeric value in your SQL query.'
  else if (!category || !measure) message = 'Choose a category and a numeric value to create your chart.'
  else if (splitField && split?.kind === 'duplicate') message = `Multiple rows match the same category and split value. Use GROUP BY on ${category.name || category.label} and ${splitField.name || splitField.label} in SQL.`
  else if (splitField && split?.kind === 'too-many-series') message = `Split by supports up to ${MAX_CHART_SERIES} series. Filter or group ${splitField.name || splitField.label} in SQL.`
  else if (validPoints.length === 0) message = 'The selected value column has no plottable numbers.'
  else if (isPie && validPoints.some((point) => point.value < 0)) message = 'Pie charts need non-negative values. Choose another column or adjust your SQL query.'
  else if (isPie && !validPoints.some((point) => point.value > 0)) message = 'Pie charts need at least one positive value.'

  const measureTitle = fieldTitle(measure?.label ?? '')
  return {
    category, measure, numericFields, splitField, splitFields, measureTitle, message, validPoints,
    missingCount: points.length - validPoints.length,
    isSplit: split?.kind === 'split',
    categories: split?.kind === 'split' ? split.categories : points.map((point) => point.label),
    measures: split?.kind === 'split' ? split.series : [{ id: 'measure', name: measureTitle, values: points.map((point) => point.value) }],
  }
}

type SuggestedResultView = { view: 'table'; reason?: string } | { view: ChartKind; axes: ChartAxes }

export function resolveSuggestedView(result: RowResult, suggestion: ViewSuggestion): SuggestedResultView {
  if (suggestion.kind === 'table') return { view: 'table' }
  if (result.rows.length === 0) return { view: 'table', reason: 'The suggested chart needs returned rows. Review the SQL and run it again.' }

  const fields = chartFields(result)
  function uniqueField(name: string | null) {
    if (name === null) return
    const matches = fields.filter((field) => field.name === name)
    return matches.length === 1 ? matches[0] : undefined
  }

  const category = uniqueField(suggestion.category)
  const measure = uniqueField(suggestion.measure)
  const splitBy = suggestion.kind === 'pie' ? null : suggestion.splitBy
  const splitField = uniqueField(splitBy)
  if (suggestion.category !== null && !category) {
    return { view: 'table', reason: `The suggested category “${suggestion.category}” needs one matching column. Choose another category.` }
  }
  if (suggestion.measure !== null && !measure?.numeric) {
    return { view: 'table', reason: `The suggested measure “${suggestion.measure}” needs one numeric column. Choose another measure.` }
  }

  const axes = { xColumn: category?.key, yColumn: measure?.key, splitColumn: splitField?.key }
  const chart = prepareChart(result.rows, fields, axes, suggestion.kind)
  if (splitBy !== null && !chart.splitField) {
    return { view: 'table', reason: `The suggested split “${splitBy}” needs its own unambiguous column. Choose another split.` }
  }
  if (chart.message) return { view: 'table', reason: chart.message }
  return { view: suggestion.kind, axes: { xColumn: chart.category?.key, yColumn: chart.measure?.key, splitColumn: chart.splitField?.key } }
}
