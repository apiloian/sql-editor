import { themes } from '@clickhouse/click-ui'
import { loader } from '@monaco-editor/react'
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

export const sqlEditorOptions = {
  ariaLabel: 'SQL query', automaticLayout: true, minimap: { enabled: false }, useShadowDOM: false,
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", fontSize: 14, lineHeight: 25,
  scrollBeyondLastLine: false, lineNumbersMinChars: 3,
  renderLineHighlight: 'gutter', overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
  wordWrap: 'on', tabSize: 4, quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true, wordBasedSuggestions: 'currentDocument', fixedOverflowWidgets: true,
} satisfies monaco.editor.IStandaloneEditorConstructionOptions

export { monaco }
