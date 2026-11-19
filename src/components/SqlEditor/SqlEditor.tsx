import type { EditorStatement } from '../../lib/sql'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Icon } from '@clickhouse/click-ui'
import Editor from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { monaco, sqlEditorOptions } from '../../lib/monaco-sql'
import type { Ref } from 'react'
import type { Theme } from '../../lib/theme'
import type { DatabaseSchema } from '../../lib/schema'
import { completionColumnsQuery } from '../../lib/schema-queries'
import { createCompletionCatalog } from '../../lib/sql-completion'
import { registerSqlEditorCommands } from '../../lib/sql-editor-commands'
import type { EditorHistory } from '../../lib/sql-editor-commands'
import './sql-editor.css'

export type { EditorHistory } from '../../lib/sql-editor-commands'
export type SqlEditTarget = { sql: string; modelId: string; version: number; range: { start: number; end: number } | null }
export type SqlEditorHandle = {
  getValue: () => string; replaceSql: (sql: string) => void; undo: () => void; redo: () => void
  getEditTarget: () => SqlEditTarget | undefined; applyAssistantEdit: (target: SqlEditTarget, sql: string) => void
}

type SqlEditorProps = { schema: DatabaseSchema | null; onSqlChange: (hasSql: boolean) => void; onRun: (statements: EditorStatement[]) => Promise<void>; theme: Theme; bottomPadding: number; readOnly?: boolean; ref?: Ref<SqlEditorHandle>; onHistoryChange: (history: EditorHistory) => void }

function assistantTarget(editor: monaco.editor.IStandaloneCodeEditor): SqlEditTarget | undefined {
  const model = editor.getModel()
  if (!model) return
  const selection = editor.getSelection()
  const range = selection && !selection.isEmpty() ? {
    start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()),
  } : null
  return { sql: model.getValue(), modelId: model.id, version: model.getVersionId(), range }
}

function replaceRange(editor: monaco.editor.IStandaloneCodeEditor, range: monaco.IRange, text: string, reveal: boolean) {
  if (editor.getModel()?.getValueInRange(range) === text) return
  const locked = editor.getRawOptions().readOnly
  if (locked) editor.updateOptions({ readOnly: false })
  try {
    editor.pushUndoStop()
    editor.executeEdits('sql-assistant', [{ range, text, forceMoveMarkers: true }], reveal
      ? (edits) => edits.map((edit) => monaco.Selection.fromRange(edit.range, monaco.SelectionDirection.LTR)) : undefined)
    editor.pushUndoStop()
    const selection = editor.getSelection()
    if (reveal && selection) editor.revealRangeInCenterIfOutsideViewport(selection)
  } finally {
    if (locked) editor.updateOptions({ readOnly: true })
  }
}

export function SqlEditor({ schema, onSqlChange, onRun, theme, bottomPadding, readOnly, ref, onHistoryChange }: SqlEditorProps) {
  const [actionMessage, setActionMessage] = useState('')
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
      if (editor && model) replaceRange(editor, model.getFullModelRange(), sql, false)
    },
    getEditTarget() {
      const editor = editorRef.current
      return editor ? assistantTarget(editor) : undefined
    },
    applyAssistantEdit(target, sql) {
      const editor = editorRef.current
      const model = editor?.getModel()
      const current = editor && assistantTarget(editor)
      if (!editor || !model || !current || current.modelId !== target.modelId || current.version !== target.version ||
        current.range?.start !== target.range?.start || current.range?.end !== target.range?.end) {
        throw new Error('The SQL edit target changed while the assistant was working. Select the target and send again.')
      }
      const range = target.range ? monaco.Range.fromPositions(model.getPositionAt(target.range.start), model.getPositionAt(target.range.end)) : model.getFullModelRange()
      replaceRange(editor, range, sql, target.range !== null)
    },
    undo() { editorRef.current?.trigger('toolbar', 'undo', null); editorRef.current?.focus() },
    redo() { editorRef.current?.trigger('toolbar', 'redo', null); editorRef.current?.focus() },
  }), [])
  const runRef = useRef(onRun)
  useEffect(() => { runRef.current = onRun }, [onRun])
  const reportChange = useCallback((text: string | undefined) => onSqlChange(Boolean(text?.trim())), [onSqlChange])

  return <><Editor height="100%" language="sql" theme={`workspace-${theme}`}
    onChange={reportChange}
    loading={<div className="editor-loading">Loading SQL editor…</div>}
    onMount={(editor) => {
      editorRef.current = editor
      registerSqlEditorCommands(editor, {
        getCompletionCatalog: () => completionCatalog.current,
        onRun: (statements) => runRef.current(statements),
        onHistoryChange: (history) => historyRef.current(history),
        onMessage: setActionMessage,
        onDispose: () => {
          if (editorRef.current === editor) editorRef.current = null
        },
      })
      editor.focus()
    }}
    options={{ ...sqlEditorOptions, readOnly, padding: { top: 24, bottom: bottomPadding } }}
  />
    {actionMessage && <div className="editor-action-message" role="alert"><span>{actionMessage}</span><button type="button" aria-label="Dismiss editor message" onClick={() => setActionMessage('')}><Icon name="cross" size="xs" aria-hidden="true" /></button></div>}
  </>
}
