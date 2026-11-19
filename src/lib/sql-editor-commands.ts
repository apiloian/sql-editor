import type { EditorStatement } from './sql'
import { monaco } from './monaco-sql'
import { sqlCompletions } from './sql-completion'
import type { createCompletionCatalog } from './sql-completion'
import { editorStatementsForRun } from './sql'

export type EditorHistory = { canUndo: boolean; canRedo: boolean }

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

type EditorCommandCallbacks = {
  getCompletionCatalog: () => ReturnType<typeof createCompletionCatalog> | null
  onRun: (statements: EditorStatement[]) => Promise<void>
  onHistoryChange: (history: EditorHistory) => void
  onMessage: (message: string) => void
  onDispose: () => void
}

export function registerSqlEditorCommands(editor: monaco.editor.IStandaloneCodeEditor, callbacks: EditorCommandCallbacks) {
  let disposed = false
  let formatting = false
  function updateHistory() {
    const model = editor.getModel()
    callbacks.onHistoryChange({ canUndo: model?.canUndo() ?? false, canRedo: model?.canRedo() ?? false })
  }

  const registrations = [
    editor.onDidChangeModelContent(updateHistory),
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', '`', '"'],
      async provideCompletionItems(model, position, _context, token) {
        if (disposed || editor.getModel() !== model) return
        const catalog = callbacks.getCompletionCatalog()
        const result = await sqlCompletions(model, position, catalog)
        if (disposed || editor.getModel() !== model || token.isCancellationRequested || callbacks.getCompletionCatalog() !== catalog) return
        return result
      },
    }),
    addReversibleCommentAction(editor),
    editor.addAction({
      id: 'run-query', label: 'Run', contextMenuGroupId: '0_sql', contextMenuOrder: 1,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const model = editor.getModel()
        const selection = editor.getSelection()
        if (!model || !selection) return
        void callbacks.onRun(editorStatementsForRun(model.getValue(), {
          start: model.getOffsetAt(selection.getStartPosition()),
          end: model.getOffsetAt(selection.getEndPosition()),
        }))
      },
    }),
    editor.addAction({
      id: 'sql-word-left', label: 'Move to previous word', keybindings: [ctrl | monaco.KeyCode.LeftArrow],
      run: () => editor.trigger('keyboard', 'cursorWordStartLeft', null),
    }),
    editor.addAction({
      id: 'sql-word-right', label: 'Move to next word boundary', keybindings: [ctrl | monaco.KeyCode.RightArrow],
      run: () => editor.trigger('keyboard', 'cursorWordEndRight', null),
    }),
    editor.addAction({
      id: 'format-sql', label: 'Format', contextMenuGroupId: '0_sql', contextMenuOrder: 2,
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: async () => {
        const model = editor.getModel()
        const original = model?.getValue()
        if (!model || !original?.trim() || formatting) return
        formatting = true
        callbacks.onMessage('')
        try {
          const { format } = await import('sql-formatter')
          if (disposed || editor.getModel() !== model) return
          const formatted = format(original, { language: 'clickhouse', tabWidth: model.getOptions().tabSize })
          if (model.getValue() !== original) {
            callbacks.onMessage('SQL changed while formatting. Format again with the latest text.')
            return
          }
          if (formatted !== original) {
            editor.pushUndoStop()
            editor.executeEdits('format-sql', [{ range: model.getFullModelRange(), text: formatted, forceMoveMarkers: true }])
            editor.pushUndoStop()
          }
        } catch {
          if (!disposed) callbacks.onMessage('Could not format this SQL. Check for incomplete strings or statements.')
        } finally {
          formatting = false
        }
      },
    }),
  ]

  editor.onDidDispose(() => {
    disposed = true
    for (const registration of registrations) registration.dispose()
    callbacks.onDispose()
  })
  updateHistory()
}
