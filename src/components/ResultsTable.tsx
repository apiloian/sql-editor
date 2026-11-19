import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Table2 } from 'lucide-react'
import { DEFAULT_PAGE_SIZE, DEFAULT_RESULT_LIMIT, failureMessage, formatCell } from '../lib/query'
import type { QueryState, RowResult, StatementOutcome } from '../lib/query'
import { chartFields, resultViews } from '../lib/chart'
import type { ChartAxes, ResultsView } from '../lib/chart'
import type { Theme } from '../lib/theme'

const ResultsChart = lazy(() => import('./ResultsChart'))
const PAGE_SIZES = [25, 50, 100, 500, 1_000]
const COLUMN_WIDTH = { initial: 180, min: 80, max: 1200 }
const ROW_NUMBER_WIDTH = 60

type ResultsTableProps = { result: QueryState; theme: Theme; onSelect: (index: number) => void }

function outcomeLabel(result: StatementOutcome['result']): string {
  switch (result.kind) {
    case 'rows': return `${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? 'row' : 'rows'} returned`
    case 'command': return 'Command acknowledged'
    case 'error': return 'Query failed'
    case 'unknown': return 'Write outcome unknown'
    case 'timeout': return 'Statement timed out'
    case 'skipped': return 'Skipped'
  }
}

export function ResultsTable({ result, theme, onSelect }: ResultsTableProps) {
  const [preferredView, setView] = useState<ResultsView>('table')
  const [axes, setAxes] = useState<ChartAxes>({ xColumn: '', yColumn: '' })
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const selected = result.status === 'complete' ? result.statements[result.selected] : undefined
  const outcome = selected?.result
  const canChart = outcome?.kind === 'rows' && outcome.rows.length > 0
  const view = canChart ? preferredView : 'table'
  const failed = outcome?.kind === 'error' || outcome?.kind === 'timeout' || outcome?.kind === 'unknown'

  return (
    <section className={`results-panel${failed ? ' results-error' : ''}`} aria-label="Query results" aria-busy={result.status === 'running'}>
      <div className="results-toolbar">
        <div className="results-title"><Table2 size={16} strokeWidth={1.5} aria-hidden="true" /><h2>Query results</h2></div>
        <span className="result-summary" role="status">
          {result.status === 'running' && (result.statementCount > 1
            ? `Executing statement ${result.statementNumber} of ${result.statementCount}…`
            : 'Executing query…')}
          {outcome && outcomeLabel(outcome)}
          {outcome && 'durationMs' in outcome && <><span className="summary-separator" aria-hidden="true">·</span>{Math.round(outcome.durationMs).toLocaleString()} ms</>}
        </span>
        {result.status === 'complete' && result.statements.length > 1 && (
          <select className="statement-select" aria-label="Statement outcome" value={result.selected} onChange={(event) => onSelect(Number(event.target.value))}>
            {result.statements.map(({ result: item }, index) => <option key={index} value={index}>Statement {index + 1} · {outcomeLabel(item).toLowerCase()}</option>)}
          </select>
        )}
        {canChart && <div className="results-view-switch" role="group" aria-label="Result view">
          {resultViews.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
        </div>}
      </div>
      {outcome?.kind === 'rows' && result.status === 'complete' && (
        <RowsView key={result.selected} result={outcome} pageSize={pageSize} onPageSize={setPageSize} view={view} theme={theme} axes={axes} onAxesChange={setAxes} />
      )}
      {outcome?.kind !== 'rows' && <div className="results-content">
        {result.status === 'running' && <div className="empty-state"><span className="spinner" aria-hidden="true" /><h3>Running your query</h3><p>Waiting for ClickHouse.</p></div>}
        {outcome?.kind === 'command' && <div className="result-message"><p>{outcome.message}</p></div>}
        {selected && outcome?.kind === 'skipped' && <div className="result-message"><p>This statement was skipped.</p><pre>{selected.sql}</pre></div>}
        {selected && failed && result.status === 'complete' && (
          <div className="error-state" role="alert">
            <span className="error-badge" aria-hidden="true">!</span>
            <div>
              <h3>Statement {result.selected + 1}{outcome.kind === 'timeout' ? ' timed out' : ''}</h3>
              <pre>{selected.sql}</pre>
              {outcome.kind === 'unknown' && <p>The write outcome is unknown.</p>}
              <pre>{outcome.kind === 'unknown' ? outcome.message : failureMessage(outcome)}</pre>
            </div>
          </div>
        )}
      </div>}
    </section>
  )
}

type RowsViewProps = {
  result: RowResult; pageSize: number; onPageSize: (size: number) => void
  view: ResultsView; theme: Theme; axes: ChartAxes; onAxesChange: (axes: ChartAxes) => void
}

function RowsView({ result, pageSize, onPageSize, view, theme, axes, onAxesChange }: RowsViewProps) {
  const [page, setPage] = useState(1)
  const [customWidths, setCustomWidths] = useState<(number | null)[]>(() => result.columns.map(() => null))
  const [availableWidth, setAvailableWidth] = useState(0)
  const measureTable = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const measure = () => setAvailableWidth(node.clientWidth)
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const drag = useRef<{ column: number; pointer: number; startX: number; width: number } | null>(null)
  const { columns, rows, truncated } = result
  const autoColumns = customWidths.filter(width => width === null).length
  const baseWidth = customWidths.reduce<number>((total, width) => total + (width ?? COLUMN_WIDTH.initial), ROW_NUMBER_WIDTH)
  const extraWidth = Math.max(0, availableWidth - baseWidth) / Math.max(1, autoColumns || columns.length)
  const widths = customWidths.map(width => (width ?? COLUMN_WIDTH.initial) + (width === null || !autoColumns ? extraWidth : 0))
  const maxColumnWidth = Math.max(COLUMN_WIDTH.max, availableWidth)
  const showChart = view !== 'table'
  const chartData = useMemo(() => {
    if (!showChart) return null
    const labels = new Set<string>()
    const chartColumns = columns.map(({ name, type }) => {
      let label = name
      let suffix = 2
      while (labels.has(label)) label = `${name} (${suffix++})`
      labels.add(label)
      return { name: label, type }
    })
    const chartRows = rows.map(row => Object.fromEntries(chartColumns.map(({ name }, index) => [name, row[index]])))
    return { columns: chartColumns.map(({ name }) => name), rows: chartRows, ...chartFields(chartColumns, chartRows) }
  }, [columns, rows, showChart])
  const xColumn = chartData?.columns.includes(axes.xColumn) ? axes.xColumn : chartData?.category ?? ''
  const yColumn = chartData?.numericColumns.includes(axes.yColumn) ? axes.yColumn
    : chartData?.measures.find((name) => name !== xColumn) ?? chartData?.measures[0] ?? ''

  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize))
  const rowOffset = (page - 1) * pageSize
  const visibleRows = rows.slice(rowOffset, rowOffset + pageSize)

  function resize(column: number, width: number) {
    const next = Math.min(maxColumnWidth, Math.max(COLUMN_WIDTH.min, width))
    setCustomWidths(current => current.map((value, index) => index === column ? next : value))
  }

  return <>
    {truncated && <p className="results-truncation">Showing the first {DEFAULT_RESULT_LIMIT.toLocaleString('en-US')} rows. To return more, add a LIMIT to your query.</p>}
    {view !== 'table' && chartData ? (
      <div className="results-content chart-content">
        <Suspense fallback={<div className="empty-state"><p>Loading chart…</p></div>}>
          <ResultsChart columns={chartData.columns} rows={chartData.rows} numericColumns={chartData.numericColumns}
            kind={view} theme={theme} axes={{ xColumn, yColumn }} onAxesChange={onAxesChange} />
        </Suspense>
      </div>
    ) : <>
      <div className="results-content" ref={measureTable}>
        <table className="results-table" style={{ width: widths.reduce((sum, width) => sum + width, ROW_NUMBER_WIDTH) }}>
          <caption className="sr-only">Query result rows</caption>
          <colgroup><col style={{ width: ROW_NUMBER_WIDTH }} />{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead><tr>
            <th scope="col" className="row-number">#</th>
            {columns.map(({ name, type }, index) => (
              <th key={index} scope="col">
                <span className="result-column-label" title={`${name} · ${type}`}>{name}</span>
                <span className="column-resize" role="separator" tabIndex={0} aria-label={`Resize ${name}`} aria-orientation="vertical"
                  aria-valuemin={COLUMN_WIDTH.min} aria-valuemax={maxColumnWidth} aria-valuenow={Math.round(widths[index])}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = { column: index, pointer: event.pointerId, startX: event.clientX, width: widths[index] }
                  }}
                  onPointerMove={(event) => {
                    const active = drag.current
                    if (active?.pointer === event.pointerId) resize(active.column, active.width + event.clientX - active.startX)
                  }}
                  onLostPointerCapture={() => { drag.current = null }}
                  onDoubleClick={() => setCustomWidths(current => current.map((width, column) => column === index ? null : width))}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    resize(index, widths[index] + (event.key === 'ArrowRight' ? 16 : -16))
                  }}
                />
              </th>
            ))}
          </tr></thead>
          <tbody>{visibleRows.map((row, rowIndex) => <tr key={rowOffset + rowIndex}>
            <th scope="row" className="row-number">{(rowOffset + rowIndex + 1).toLocaleString()}</th>
            {row.map((value, index) => {
              const content = formatCell(value)
              return <td key={index} className={value === null ? 'null-value' : undefined} title={content}>{content}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > 0 && <footer className="results-footer">
        <div className="results-pagination-controls">
          <label className="page-size">Results per page
            <select value={pageSize} onChange={(event) => { setPage(1); onPageSize(Number(event.target.value)) }}>
              {PAGE_SIZES.map(size => <option key={size} value={size}>{size.toLocaleString()}</option>)}
            </select>
          </label>
          <span className="pagination-range" aria-live="polite">{(rowOffset + 1).toLocaleString()}–{(rowOffset + visibleRows.length).toLocaleString()} of {rows.length.toLocaleString()}</span>
          <nav className="pagination" aria-label="Results pagination">
            <button type="button" aria-label="First page" title="First page" disabled={page === 1} onClick={() => setPage(1)}><ChevronFirst size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Next page" disabled={page === lastPage} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Last page" title="Last page" disabled={page === lastPage} onClick={() => setPage(lastPage)}><ChevronLast size={16} aria-hidden="true" /></button>
          </nav>
        </div>
      </footer>}
    </>}
  </>
}
