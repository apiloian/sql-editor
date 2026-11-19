import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Icon, themes } from '@clickhouse/click-ui'
import Editor, { loader } from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/languages/definitions/sql/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type { Ref } from 'react'
import type { Theme } from '../lib/theme'
import type { DatabaseSchema } from '../lib/schema'
import { completionColumnsQuery } from '../lib/schema-queries'
import { createCompletionCatalog, sqlCompletions } from '../lib/sql-completion'
import { statementsForRun } from '../lib/sql'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

monaco.editor.defineTheme('workspace-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'keyword', foreground: '8556E8' },
    { token: 'string', foreground: '187C62' },
    { token: 'number', foreground: 'B36728' },
    { token: 'comment', foreground: '9298A3' },
  ],
  colors: { 'editor.background': '#ffffff', 'editorLineNumber.foreground': '#B0B3BB', 'editorLineNumber.activeForeground': '#555C69', 'editor.lineHighlightBackground': '#FAFAFC', 'editor.selectionBackground': '#E8E8FA', 'editorCursor.foreground': '#6C56C9' },
})

const darkColors = themes.dark.global.color

monaco.editor.defineTheme('workspace-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'keyword', foreground: '88AECE' },
    { token: 'string', foreground: 'B5BD68' },
    { token: 'number', foreground: 'F08D49' },
    { token: 'comment', foreground: '999999' },
  ],
  colors: {
    'editor.background': darkColors.background.default, 'editor.foreground': darkColors.text.default,
    'editorLineNumber.foreground': darkColors.text.disabled, 'editorLineNumber.activeForeground': darkColors.text.default,
    'editor.lineHighlightBackground': darkColors.background.muted, 'editor.selectionBackground': darkColors.stroke.intense,
    'editor.inactiveSelectionBackground': darkColors.background.muted, 'editorCursor.foreground': darkColors.accent.default,
    'editorWidget.background': darkColors.background.muted, 'editorWidget.border': darkColors.stroke.default,
    'editorSuggestWidget.background': darkColors.background.muted, 'editorSuggestWidget.foreground': darkColors.text.default,
    'editorSuggestWidget.border': darkColors.stroke.default, 'editorSuggestWidget.selectedBackground': darkColors.stroke.intense,
    'editorHoverWidget.background': darkColors.background.muted, 'editorHoverWidget.border': darkColors.stroke.default,
    'focusBorder': darkColors.outline.default,
  },
})

export type EditorHistory = { canUndo: boolean; canRedo: boolean }
export type SqlEditorHandle = { getValue: () => string; replaceSql: (sql: string) => void; undo: () => void; redo: () => void }

type SqlEditorProps = { schema: DatabaseSchema | null; onChange: (value: string) => void; onRun: (statements: string[]) => Promise<void>; theme: Theme; bottomPadding: number; ref?: Ref<SqlEditorHandle>; onHistoryChange: (history: EditorHistory) => void }

const ctrl = navigator.userAgent.includes('Macintosh') ? monaco.KeyMod.WinCtrl : monaco.KeyMod.CtrlCmd

function addReversibleCommentAction(editor: monaco.editor.IStandaloneCodeEditor) {
  let previous: {
    model: monaco.editor.ITextModel
    version: number
    range: monaco.Range
    text: string
    originalSelections: monaco.Selection[]
    currentSelections: monaco.Selection[]
  } | undefined

  return editor.addAction({
    id: 'sql-toggle-line-comment',
    label: 'Toggle SQL line comment',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
    run: async () => {
      const model = editor.getModel()
      const selections = editor.getSelections()
      const action = editor.getAction('editor.action.commentLine')
      if (!model || !selections?.length || !action) return
      const last = previous
      previous = undefined
      if (last?.model === model && last.version === model.getVersionId() &&
          selections.length === last.currentSelections.length &&
          selections.every((selection, index) => selection.equalsSelection(last.currentSelections[index]))) {
        editor.pushUndoStop()
        editor.executeEdits('sql-toggle-line-comment', [{ range: last.range, text: last.text }], last.originalSelections)
        editor.pushUndoStop()
        return
      }

      const firstLine = Math.min(...selections.map(selection => selection.startLineNumber))
      const lastLine = Math.max(...selections.map(selection => selection.endLineNumber))
      const range = () => new monaco.Range(firstLine, 1, lastLine, model.getLineMaxColumn(lastLine))
      const text = model.getValueInRange(range())
      const version = model.getVersionId()
      await action.run()
      const currentSelections = editor.getSelections()
      if (editor.getModel() === model && currentSelections && model.getVersionId() !== version) {
        previous = { model, version: model.getVersionId(), range: range(), text, originalSelections: selections, currentSelections }
      }
    },
  })
}

export function SqlEditor({ schema, onChange, onRun, theme, bottomPadding, ref, onHistoryChange }: SqlEditorProps) {
  const [actionMessage, setActionMessage] = useState('')
  const formatting = useRef(false)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const queryClient = useQueryClient()
  const completionCatalog = useRef<ReturnType<typeof createCompletionCatalog> | null>(null)
  useEffect(() => {
    completionCatalog.current = schema
      ? createCompletionCatalog(schema, (database) => queryClient.fetchQuery(completionColumnsQuery(database)))
      : null
  }, [queryClient, schema])
  const historyRef = useRef(onHistoryChange)
  useEffect(() => { historyRef.current = onHistoryChange }, [onHistoryChange])
  useImperativeHandle(ref, () => ({
    getValue: () => editorRef.current?.getValue() ?? '',
    replaceSql(sql) {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model || model.getValue() === sql) return
      editor.pushUndoStop()
      editor.executeEdits('sql-assistant', [{ range: model.getFullModelRange(), text: sql, forceMoveMarkers: true }])
      editor.pushUndoStop()
    },
    undo() { editorRef.current?.trigger('toolbar', 'undo', null); editorRef.current?.focus() },
    redo() { editorRef.current?.trigger('toolbar', 'redo', null); editorRef.current?.focus() },
  }), [])
  const runRef = useRef(onRun)
  const actionRef = useRef<monaco.IDisposable[]>([])
  useEffect(() => { runRef.current = onRun }, [onRun])
  useEffect(() => () => actionRef.current.forEach((action) => action.dispose()), [])
  const reportChange = useCallback((text: string | undefined) => onChange(text ?? ''), [onChange])

  return <><Editor height="100%" language="sql" theme={`workspace-${theme}`}
    onChange={reportChange}
    loading={<div className="editor-loading">Loading SQL editor…</div>}
    onMount={(editor) => {
      editorRef.current = editor
      const updateHistory = () => {
        const model = editor.getModel()
        historyRef.current({ canUndo: model?.canUndo() ?? false, canRedo: model?.canRedo() ?? false })
      }
      const historyListener = editor.onDidChangeModelContent(updateHistory)
      editor.onDidDispose(() => { historyListener.dispose(); editorRef.current = null })
      updateHistory()
      actionRef.current.forEach((action) => action.dispose())
      const completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', '`', '"'],
        async provideCompletionItems(model, position, _context, token) {
          if (editor.getModel() !== model) return
          const catalog = completionCatalog.current
          const result = await sqlCompletions(model, position, catalog)
          if (token.isCancellationRequested || completionCatalog.current !== catalog) return
          return result
        },
      })
      actionRef.current = [completionProvider, addReversibleCommentAction(editor), editor.addAction({
        id: 'run-query', label: 'Run', contextMenuGroupId: '0_sql', contextMenuOrder: 1, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => {
          const model = editor.getModel()
          const selection = editor.getSelection()
          if (!model || !selection) return
          void runRef.current(statementsForRun(model.getValue(), {
            start: model.getOffsetAt(selection.getStartPosition()),
            end: model.getOffsetAt(selection.getEndPosition()),
          }))
        },
      }), editor.addAction({
        id: 'sql-word-left', label: 'Move to previous word', keybindings: [ctrl | monaco.KeyCode.LeftArrow],
        run: () => editor.trigger('keyboard', 'cursorWordStartLeft', null),
      }), editor.addAction({
        id: 'sql-word-right', label: 'Move to next word boundary', keybindings: [ctrl | monaco.KeyCode.RightArrow],
        run: () => editor.trigger('keyboard', 'cursorWordEndRight', null),
      }), editor.addAction({
        id: 'format-sql', label: 'Format', contextMenuGroupId: '0_sql', contextMenuOrder: 2,
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
        run: async () => {
          const model = editor.getModel()
          const original = model?.getValue()
          if (!model || !original?.trim() || formatting.current) return
          formatting.current = true
          setActionMessage('')
          try {
            const { format } = await import('sql-formatter')
            const formatted = format(original, { language: 'clickhouse', tabWidth: model.getOptions().tabSize })
            if (editorRef.current !== editor || editor.getModel() !== model) return
            if (model.getValue() !== original) {
              setActionMessage('SQL changed while formatting. Format again with the latest text.')
              return
            }
            if (formatted !== original) {
              editor.pushUndoStop()
              editor.executeEdits('format-sql', [{ range: model.getFullModelRange(), text: formatted, forceMoveMarkers: true }])
              editor.pushUndoStop()
            }
          } catch {
            if (editorRef.current === editor) setActionMessage('Could not format this SQL. Check for incomplete strings or statements.')
          } finally {
            formatting.current = false
          }
        },
      })]
      editor.focus()
    }}
    options={{
      ariaLabel: 'SQL query', automaticLayout: true, minimap: { enabled: false }, useShadowDOM: false,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", fontSize: 14, lineHeight: 25,
      padding: { top: 24, bottom: bottomPadding }, scrollBeyondLastLine: false, lineNumbersMinChars: 3,
      renderLineHighlight: 'gutter', overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
      wordWrap: 'on', tabSize: 4, quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true, wordBasedSuggestions: 'currentDocument', fixedOverflowWidgets: true,
    }}
  />
    {actionMessage && <div className="editor-action-message" role="alert"><span>{actionMessage}</span><button type="button" aria-label="Dismiss editor message" onClick={() => setActionMessage('')}><Icon name="cross" size="xs" aria-hidden="true" /></button></div>}
  </>
}
