import { useRef, useState } from 'react'
import type { SqlEditorHandle, EditorHistory } from './components/SqlEditor/SqlEditor'
import { SqlEditor } from './components/SqlEditor/SqlEditor'
import { ResultsTable } from './components/ResultsTable/ResultsTable'
import { WorkspacePanels } from './components/WorkspacePanels/WorkspacePanels'
import { WorkspaceToolbar } from './components/WorkspaceToolbar/WorkspaceToolbar'
import { csvImportDestinations } from './lib/schema'
import { editorStatements } from './lib/sql'
import { useResultViews } from './hooks/useResultViews'
import type { Theme } from './lib/theme'
import { DatabaseSidebar } from './components/DatabaseSidebar/DatabaseSidebar'
import { useDatabaseSchema } from './hooks/useDatabaseSchema'
import { AssistantComposer } from './components/AssistantComposer/AssistantComposer'
import { QueryActivityDrawer } from './components/QueryActivityDrawer/QueryActivityDrawer'
import { useQueryActivity } from './hooks/useQueryActivity'
import { useScriptExecution } from './hooks/useScriptExecution'
import { CsvImportDialog } from './components/CsvImportDialog/CsvImportDialog'
import './workspace.css'

function App({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const activity = useQueryActivity()
  const [activityOpen, setActivityOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [hasSql, setHasSql] = useState(false)
  const { state: schemaState, refresh: refreshSchema } = useDatabaseSchema()
  const schema = schemaState.status === 'success' ? schemaState.schema : null
  const { result, runQuery } = useScriptExecution(activity, schema?.currentDatabase ?? null)
  const queryRunning = result.status === 'running'
  const [assistantEnabled, setAssistantEnabled] = useState(true)
  const [assistantBusy, setAssistantBusy] = useState(false)
  const editor = useRef<SqlEditorHandle>(null)
  const views = useResultViews(result, () => editor.current, runQuery)
  const showResults = result.status !== 'idle' || views.prepared !== null
  const [history, setHistory] = useState<EditorHistory>({ canUndo: false, canRedo: false })
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 900px)').matches)

  return (
    <main className="sql-workspace">
      {importOpen && <CsvImportDialog tables={schema ? csvImportDestinations(schema) : []} onClose={() => setImportOpen(false)} />}
      {activityOpen && <QueryActivityDrawer onClear={activity.clear} entries={activity.entries} warning={activity.warning} onClose={() => setActivityOpen(false)} onLoad={(sql) => { editor.current?.replaceSql(sql); setActivityOpen(false) }} loadDisabled={assistantBusy} />}
      {sidebarOpen && <DatabaseSidebar state={schemaState} onRefresh={refreshSchema} />}
      <div className="workspace-main">
        <WorkspaceToolbar
          sidebarOpen={sidebarOpen}
          assistantEnabled={assistantEnabled}
          theme={theme}
          canUndo={!assistantBusy && history.canUndo}
          canRedo={!assistantBusy && history.canRedo}
          hasSql={hasSql}
          queryRunning={queryRunning}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onAssistantChange={setAssistantEnabled}
          onToggleTheme={onToggleTheme}
          onUndo={() => editor.current?.undo()}
          onRedo={() => editor.current?.redo()}
          onOpenImport={() => setImportOpen(true)}
          onOpenActivity={() => setActivityOpen(true)}
          onRun={() => void views.run(editorStatements(editor.current?.getValue() ?? ''))}
        />
        <WorkspacePanels
          editor={<>
            <SqlEditor ref={editor} schema={schema} onHistoryChange={setHistory} onSqlChange={(available) => { setHasSql(available); views.onSqlChange() }} onRun={views.run} theme={theme} bottomPadding={assistantEnabled ? 100 : 24} readOnly={assistantBusy} />
            <AssistantComposer enabled={assistantEnabled} getEditTarget={() => editor.current?.getEditTarget()}
              getVisualizationContext={views.getVisualizationContext} onVisualizationSuggestion={views.applySuggestion}
              onBusyChange={setAssistantBusy} onReplaceSql={(target, sql) => {
                if (!editor.current) throw new Error('The SQL editor is no longer available.')
                editor.current.applyAssistantEdit(target, sql)
              }} />
          </>}
          results={showResults ? <ResultsTable result={result} theme={theme}
            selectedIndex={views.selectedIndex} onSelectOutcome={views.selectOutcome}
            suggestedView={views.suggestedView} onManualViewChange={views.clearSelectedSuggestion}
            preparedView={views.prepared?.suggestion.kind} onPreparedViewChange={views.choosePreparedView} /> : undefined}
        />
      </div>
    </main>
  )
}

export default App
