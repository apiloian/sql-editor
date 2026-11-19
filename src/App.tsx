import { useRef, useState } from 'react'
import { Undo2, Redo2, Logs, PanelLeftClose, PanelLeftOpen, Upload } from 'lucide-react'
import type { SqlEditorHandle, EditorHistory } from './components/SqlEditor'
import { requestAssistant } from './lib/assistant'
import { SqlEditor } from './components/SqlEditor'
import { ResultsTable } from './components/ResultsTable'
import { executeStatement, failureMessage } from './lib/query'
import { splitStatements } from './lib/sql'
import type { QueryState, StatementOutcome } from './lib/query'
import type { Theme } from './lib/theme'
import { DatabaseSidebar } from './components/DatabaseSidebar'
import { useDatabaseSchema } from './hooks/useDatabaseSchema'
import { AssistantComposer } from './components/AssistantComposer'
import { QueryActivityDrawer } from './components/QueryActivityDrawer'
import { useQueryActivity } from './hooks/useQueryActivity'
import { CsvImportDialog } from './components/CsvImportDialog'
import './components/csv-import.css'

function App({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const activity = useQueryActivity()
  const [activityOpen, setActivityOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryState>({ status: 'idle' })
  const showResults = result.status !== 'idle'
  const [editorSize, setEditorSize] = useState(58)
  const [assistantEnabled, setAssistantEnabled] = useState(true)
  const editor = useRef<SqlEditorHandle>(null)
  const [history, setHistory] = useState<EditorHistory>({ canUndo: false, canRedo: false })
  const workspace = useRef<HTMLDivElement>(null)
  const running = useRef(false)
  const { state: schemaState, refresh: refreshSchema } = useDatabaseSchema()
  const importTables = schemaState.status === 'success'
    ? schemaState.schema.databases.flatMap(database => /^(system|information_schema)$/i.test(database.name) ? [] :
      database.tables.filter(table => !/^(View|MaterializedView|LiveView|WindowView)$/i.test(table.engine))
        .map(table => ({ database: database.name, name: table.name })))
    : []
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 900px)').matches)

  async function runQuery(statements: string[]) {
    if (running.current || !statements.length) return

    running.current = true
    const outcomes: StatementOutcome[] = []
    const database = schemaState.status === 'success' ? schemaState.schema.currentDatabase : null

    try {
      for (const [index, sql] of statements.entries()) {
        setResult({ status: 'running', statementNumber: index + 1, statementCount: statements.length })
        const activityId = activity.start(sql, database)
        const outcome = await executeStatement(sql)
        outcomes.push({ sql, result: outcome })
        if (outcome.kind === 'rows' || outcome.kind === 'command') {
          activity.succeed(activityId, outcome.durationMs, outcome.kind === 'rows' ? outcome.rows.length : 0)
          continue
        }
        activity.fail(activityId, outcome.durationMs, failureMessage(outcome))
        break
      }

      const selected = outcomes.length - 1
      for (const sql of statements.slice(outcomes.length)) outcomes.push({ sql, result: { kind: 'skipped' } })
      setResult({ status: 'complete', statements: outcomes, selected })
    } finally {
      running.current = false
    }
  }

  return (
    <main className="sql-workspace">
      {importOpen && <CsvImportDialog tables={importTables} onClose={() => setImportOpen(false)} />}
      {activityOpen && <QueryActivityDrawer onClear={activity.clear} entries={activity.entries} warning={activity.warning} onClose={() => setActivityOpen(false)} onLoad={(sql) => { editor.current?.replaceSql(sql); setActivityOpen(false) }} />}
      {sidebarOpen && <DatabaseSidebar state={schemaState} onRefresh={refreshSchema} />}
      <div className="workspace-main">
      <header className="workspace-header">
        <button className="theme-toggle sidebar-toggle" type="button" aria-label={sidebarOpen ? 'Close database sidebar' : 'Open database sidebar'} aria-expanded={sidebarOpen} aria-controls="database-sidebar" title={sidebarOpen ? 'Close database sidebar' : 'Open database sidebar'} onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <PanelLeftClose size={17} strokeWidth={1.6} aria-hidden="true" /> : <PanelLeftOpen size={17} strokeWidth={1.6} aria-hidden="true" />}
        </button>
        <div className="header-actions">
          <div className="editor-history" role="group" aria-label="SQL edit history">
            <button className="theme-toggle" type="button" aria-label="Undo SQL edit" title="Undo (⌘Z / Ctrl+Z)" disabled={!history.canUndo} onClick={() => editor.current?.undo()}><Undo2 size={16} strokeWidth={1.7} aria-hidden="true" /></button>
            <button className="theme-toggle" type="button" aria-label="Redo SQL edit" title="Redo (⌘⇧Z / Ctrl+Shift+Z)" disabled={!history.canRedo} onClick={() => editor.current?.redo()}><Redo2 size={16} strokeWidth={1.7} aria-hidden="true" /></button>
          </div>
          <div className="workspace-preferences" role="group" aria-label="Workspace preferences">
            <button className="assistant-toggle" type="button" role="switch" aria-label="SQL assistant" aria-checked={assistantEnabled} onClick={() => setAssistantEnabled(!assistantEnabled)} title={assistantEnabled ? 'Turn off assistant' : 'Turn on assistant'}><span>Assistant</span><span className="assistant-switch-track" aria-hidden="true"><span /></span></button>
            <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Dark mode" aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark'
                ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>
                : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z" /></svg>}
            </button>
          </div>
          <span className="toolbar-divider" aria-hidden="true" />
          <button className="theme-toggle" type="button" aria-label="Insert data from a file" title="Insert data from a file" aria-haspopup="dialog" onClick={() => setImportOpen(true)}><Upload size={16} strokeWidth={1.7} aria-hidden="true" /></button>
          <button className="theme-toggle activity-toggle" type="button" aria-label="Open activity log" title="Activity log" aria-haspopup="dialog" onClick={() => setActivityOpen(true)}><Logs size={16} strokeWidth={1.7} aria-hidden="true" /></button>
          <button className="run-button" type="button" onClick={() => void runQuery(splitStatements(editor.current?.getValue() ?? ''))}
            disabled={!query.trim() || result.status === 'running'}>
            {result.status === 'running' ? <span className="spinner" aria-hidden="true" /> : <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 2 9 6-9 6V2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
            {result.status === 'running' ? 'Running…' : 'Run'}
          </button>
        </div>
      </header>
      <div className="workspace-panels" ref={workspace} style={{ gridTemplateRows: showResults ? `minmax(140px, ${editorSize}fr) 3.5px minmax(160px, ${100 - editorSize}fr)` : 'minmax(0, 1fr)' }}>
        <section className="editor-panel" aria-label="SQL editor">
          <SqlEditor ref={editor} schema={schemaState.status === 'success' ? schemaState.schema : null} onHistoryChange={setHistory} onChange={setQuery} onRun={runQuery} theme={theme} bottomPadding={assistantEnabled ? 100 : 24} />
          {assistantEnabled && <AssistantComposer currentSql={query} onRequest={async (action, prompt, signal) => {
            const original = editor.current?.getValue()
            if (original === undefined) throw new Error('The SQL editor is still loading.')
            const sql = await requestAssistant(action, prompt, original, signal)
            if (signal.aborted) return
            if (editor.current?.getValue() !== original) throw new Error('Your SQL changed while the assistant was working. Send again with the latest query.')
            editor.current.replaceSql(sql)
          }} />}
        </section>
        {showResults && <><div className="panel-divider" role="separator" aria-label="Resize editor and results" aria-orientation="horizontal" aria-valuenow={Math.round(editorSize)} aria-valuemin={25} aria-valuemax={80} tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              setEditorSize((size) => Math.max(25, Math.min(80, size + (event.key === 'ArrowUp' ? -5 : 5))))
            }
          }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const bounds = workspace.current?.getBoundingClientRect()
            if (bounds) setEditorSize(Math.max(25, Math.min(80, ((event.clientY - bounds.top) / bounds.height) * 100)))
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        ><span /></div>
        <ResultsTable result={result} theme={theme} onSelect={(selected) => {
          setResult((current) => current.status === 'complete' ? { ...current, selected } : current)
        }} /></>}
      </div>
      </div>
    </main>
  )
}

export default App
