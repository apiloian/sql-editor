import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

const MIN_EDITOR_SIZE = 25
const MAX_EDITOR_SIZE = 80

type WorkspacePanelsProps = {
  editor: ReactNode
  results?: ReactNode
}

function clampEditorSize(size: number) {
  return Math.max(MIN_EDITOR_SIZE, Math.min(MAX_EDITOR_SIZE, size))
}

export function WorkspacePanels({ editor, results }: WorkspacePanelsProps) {
  const workspace = useRef<HTMLDivElement>(null)
  const [editorSize, setEditorSize] = useState(58)
  const showResults = results != null
  const gridTemplateRows = showResults
    ? `minmax(140px, ${editorSize}fr) 3.5px minmax(160px, ${100 - editorSize}fr)`
    : 'minmax(0, 1fr)'

  return (
    <div className="workspace-panels" ref={workspace} style={{ gridTemplateRows }}>
      <section className="editor-panel" aria-label="SQL editor">
        {editor}
      </section>
      {showResults && <>
        <div
          className="panel-divider"
          role="separator"
          aria-label="Resize editor and results"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(editorSize)}
          aria-valuemin={MIN_EDITOR_SIZE}
          aria-valuemax={MAX_EDITOR_SIZE}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              setEditorSize((size) => clampEditorSize(size + (event.key === 'ArrowUp' ? -5 : 5)))
            }
          }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const bounds = workspace.current?.getBoundingClientRect()
            if (bounds) setEditorSize(clampEditorSize(((event.clientY - bounds.top) / bounds.height) * 100))
          }}
        ><span /></div>
        {results}
      </>}
    </div>
  )
}
