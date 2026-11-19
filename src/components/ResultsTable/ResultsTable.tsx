import { lazy, Suspense, useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import { DEFAULT_PAGE_SIZE, DEFAULT_RESULT_LIMIT, failureMessage } from '../../lib/query'
import type { QueryState, RowResult, StatementOutcome } from '../../lib/query'
import { resolveSuggestedView, resultViews } from '../../lib/chart'
import type { ChartAxes, ResultsView } from '../../lib/chart'
import type { ViewSuggestion } from '../../lib/assistant-view'
import type { Theme } from '../../lib/theme'
import { ResultsGrid } from '../ResultsGrid/ResultsGrid'
import './results-table.css'

const ResultsChart = lazy(() => import('../ResultsChart/ResultsChart'))

type ResultsTableProps = {
  result: QueryState
  theme: Theme
  selectedIndex: number
  onSelectOutcome: (index: number) => void
  suggestedView?: ViewSuggestion
  preparedView?: ResultsView
  onPreparedViewChange: (view: ResultsView) => void
  onManualViewChange: () => void
}

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

export function ResultsTable({ result, theme, selectedIndex, onSelectOutcome, suggestedView, onManualViewChange, preparedView, onPreparedViewChange }: ResultsTableProps) {
  const [preferredView, setView] = useState<ResultsView>('table')
  const [axes, setAxes] = useState<ChartAxes>({})
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [localViews, setLocalViews] = useState<{ runId: number; views: Record<number, { axes: ChartAxes; view: ResultsView }> } | null>(null)
  const completed = result.status === 'complete' ? result : null
  const selected = completed?.statements[selectedIndex]
  const outcome = selected?.result
  const rowKey = completed ? `${completed.runId}:${selectedIndex}` : ''
  const currentViews = completed && localViews?.runId === completed.runId ? localViews.views : {}
  const scopedChart = currentViews[selectedIndex]
  const suggestion = useMemo(() => outcome?.kind === 'rows' && suggestedView
    ? resolveSuggestedView(outcome, suggestedView)
    : undefined, [outcome, suggestedView])
  const canChart = outcome?.kind === 'rows' && outcome.rows.length > 0
  const view = canChart ? suggestion?.view ?? scopedChart?.view ?? preferredView : 'table'
  const suggestedAxes = suggestion && suggestion.view !== 'table' ? suggestion.axes : undefined
  const chartAxes = suggestedAxes ?? scopedChart?.axes ?? axes
  const failed = outcome?.kind === 'error' || outcome?.kind === 'timeout' || outcome?.kind === 'unknown'

  function chooseView(next: ResultsView, nextAxes = chartAxes) {
    if (completed && (suggestion || scopedChart)) {
      setLocalViews({ runId: completed.runId, views: { ...currentViews, [selectedIndex]: { axes: nextAxes, view: next } } })
    } else {
      setView(next)
      setAxes(nextAxes)
    }
    onManualViewChange()
  }

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
        {completed && completed.statements.length > 1 && (
          <select className="statement-select" aria-label="Statement outcome" value={selectedIndex} onChange={(event) => onSelectOutcome(Number(event.target.value))}>
            {completed.statements.map(({ result: item }, index) => <option key={index} value={index}>Statement {index + 1} · {outcomeLabel(item).toLowerCase()}</option>)}
          </select>
        )}
        {canChart && <div className="results-view-switch" role="group" aria-label="Result view">
          {resultViews.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>{item.label}</button>)}
        </div>}
      </div>
      {preparedView && <div className="results-view-note prepared-view">
        <label>Prepared view <select className="statement-select" value={preparedView}
          onChange={(event) => {
            const choice = resultViews.find(({ id }) => id === event.target.value)
            if (choice) onPreparedViewChange(choice.id)
          }}>
          {resultViews.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <span>Run the prepared statement to load its data.</span>
      </div>}
      {suggestion?.view === 'table' && suggestion.reason && <p className="results-view-note" role="status">{suggestion.reason}</p>}
      {outcome?.kind === 'rows' && completed && (
        <RowsView key={rowKey} result={outcome} pageSize={pageSize} onPageSize={setPageSize} view={view} theme={theme} axes={chartAxes} onAxesChange={(next) => chooseView(view, next)} />
      )}
      {outcome?.kind !== 'rows' && <div className="results-content">
        {result.status === 'running' && <div className="empty-state"><span className="spinner" aria-hidden="true" /><h3>Running your query</h3><p>Waiting for ClickHouse.</p></div>}
        {outcome?.kind === 'command' && <div className="result-message"><p>{outcome.message}</p></div>}
        {selected && outcome?.kind === 'skipped' && <div className="result-message"><p>This statement was skipped.</p><pre>{selected.sql}</pre></div>}
        {selected && failed && (
          <div className="error-state" role="alert">
            <span className="error-badge" aria-hidden="true">!</span>
            <div>
              <h3>Statement {selectedIndex + 1}{outcome.kind === 'timeout' ? ' timed out' : ''}</h3>
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
  return (
    <>
      {result.truncated && <p className="results-truncation">Showing the first {DEFAULT_RESULT_LIMIT.toLocaleString('en-US')} rows. To return more, add a LIMIT to your query.</p>}
      <ResultsGrid result={result} visible={view === 'table'} pageSize={pageSize} onPageSize={onPageSize} />
      {view !== 'table' && (
        <div className="results-content chart-content">
          <Suspense fallback={<div className="empty-state"><p>Loading chart…</p></div>}>
            <ResultsChart result={result} kind={view} theme={theme} axes={axes} onAxesChange={onAxesChange} />
          </Suspense>
        </div>
      )}
    </>
  )
}
