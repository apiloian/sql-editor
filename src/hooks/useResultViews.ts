import { useRef, useState } from 'react'
import type { SqlEditorHandle, SqlEditTarget } from '../components/SqlEditor/SqlEditor'
import type { PreparedView, ViewSuggestion, VisualizationContext } from '../lib/assistant-view'
import type { ResultsView } from '../lib/chart'
import type { QueryState } from '../lib/query'
import { editorStatements } from '../lib/sql'
import type { EditorStatement } from '../lib/sql'

type CompletedRun = Extract<QueryState, { status: 'complete' }>
type RunViews = { runId: number; index: number; suggestions: Record<number, ViewSuggestion> }

export function useResultViews(
  result: QueryState,
  getEditor: () => SqlEditorHandle | null,
  execute: (statements: string[]) => Promise<CompletedRun | undefined>,
) {
  const [prepared, setPrepared] = useState<PreparedView | null>(null)
  const pending = useRef<PreparedView | null>(null)
  const revision = useRef(0)
  const [runViews, setRunViews] = useState<RunViews | null>(null)
  const completed = result.status === 'complete' ? result : null
  const active = completed && runViews?.runId === completed.runId ? runViews : null
  const selectedIndex = active?.index ?? completed?.lastAttemptedIndex ?? 0
  const selected = completed?.statements[selectedIndex]

  function prepare(view: PreparedView | null) {
    pending.current = view
    setPrepared(view)
  }

  function choosePreparedView(kind: ResultsView) {
    if (!pending.current) return
    revision.current++
    prepare({ ...pending.current, suggestion: { ...pending.current.suggestion, kind } })
  }

  function getVisualizationContext(): VisualizationContext {
    return {
      revision: revision.current,
      selected: completed && selected?.result.kind === 'rows'
        ? { runId: completed.runId, index: selectedIndex, sql: selected.sql, columns: selected.result.columns }
        : undefined,
    }
  }

  function applySuggestion(suggestion: ViewSuggestion, target: SqlEditTarget, replacement: string | undefined, context: VisualizationContext) {
    if (context.revision !== revision.current) return 'The workspace changed while the assistant was working. Ask again to update the view.'
    if (suggestion.target === 'result') {
      if (!context.selected) return
      const { runId, index } = context.selected
      setRunViews((current) => ({
        runId, index, suggestions: { ...(current?.runId === runId ? current.suggestions : {}), [index]: suggestion },
      }))
      return
    }

    const current = getEditor()?.getEditTarget()
    if (!current || current.modelId !== target.modelId || (replacement === undefined && current.version !== target.version)) {
      return 'The SQL changed. Ask again to prepare its view.'
    }

    const start = target.range?.start ?? 0
    const suffixLength = target.sql.length - (target.range?.end ?? target.sql.length)
    // Read the applied text from Monaco so its line ending normalization is reflected in the offsets.
    const scope = current.sql.slice(start, current.sql.length - suffixLength)
    const statement = editorStatements(scope, start)[suggestion.statementIndex]
    if (!statement) return 'The suggested view could not be matched to a statement. Select its SQL and ask again.'
    prepare({ suggestion, statement, modelId: current.modelId, version: current.version })
  }

  async function run(statements: EditorStatement[]) {
    if (!statements.length) return
    revision.current++
    const current = getEditor()?.getEditTarget()
    const view = pending.current
    const index = view && current?.modelId === view.modelId && current.version === view.version
      ? statements.findIndex(({ start, end }) => start === view.statement.start && end === view.statement.end)
      : -1
    const finished = await execute(statements.map(({ sql }) => sql))
    const latest = pending.current
    if (finished && view && latest?.statement === view.statement && finished.statements[index]?.result.kind === 'rows') {
      const lastOutcome = finished.statements[finished.lastAttemptedIndex].result
      const openIndex = lastOutcome.kind === 'rows' || lastOutcome.kind === 'command' ? index : finished.lastAttemptedIndex
      setRunViews({ runId: finished.runId, index: openIndex, suggestions: { [index]: latest.suggestion } })
      prepare(null)
    }
  }

  function selectOutcome(index: number) {
    if (!completed) return
    revision.current++
    setRunViews({ runId: completed.runId, index, suggestions: active?.suggestions ?? {} })
  }

  function clearSelectedSuggestion() {
    revision.current++
    if (!active?.suggestions[selectedIndex]) return
    const suggestions = { ...active.suggestions }
    delete suggestions[selectedIndex]
    setRunViews({ ...active, suggestions })
  }

  return {
    prepared, selectedIndex, suggestedView: active?.suggestions[selectedIndex],
    choosePreparedView, getVisualizationContext, applySuggestion, run, selectOutcome, clearSelectedSuggestion,
    onSqlChange() { if (pending.current) prepare(null) },
  }
}
