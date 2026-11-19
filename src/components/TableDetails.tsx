import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadTableMetadata } from '../lib/schema'
import type { TableMetadata, TableReference } from '../lib/schema'

type MetadataState =
  | { status: 'loading' }
  | { status: 'success'; metadata: TableMetadata }
  | { status: 'error'; message: string }

type DetailView = 'overview' | 'columns' | 'ddl'
const views: { id: DetailView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'columns', label: 'Columns' },
  { id: 'ddl', label: 'Create SQL' },
]

function displayCount(value: string | null) {
  return value === null ? 'Unavailable' : BigInt(value).toLocaleString()
}

export function TableDetails({ table, onClose }: { table: TableReference; onClose: () => void }) {
  const [state, setState] = useState<MetadataState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<DetailView>('overview')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { database, name, engine } = table

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    let active = true
    void loadTableMetadata({ database, name, engine }).then(
      (metadata) => { if (active) setState({ status: 'success', metadata }) },
      (error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load table details.' }) },
    )
    return () => { active = false }
  }, [database, name, engine, revision])

  const columns = state.status === 'success' ? state.metadata.columns : []

  return createPortal(
    <dialog ref={dialogRef} className="table-drawer" aria-labelledby="table-drawer-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      }}>
      <div className="drawer-layout">
        <header className="drawer-header">
          <div><h2 id="table-drawer-title" title={`${database}.${name}`}>{database}.{name}</h2><span title="The storage engine controls how this table stores and reads data.">{state.status === 'success' ? state.metadata.overview.engine : engine}</span></div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="Close table details" autoFocus>×</button>
        </header>
        <div className="drawer-view-switch" role="group" aria-label="Table detail view">
          {views.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}{item.id === 'columns' && state.status === 'success' && <span>{state.metadata.columns.length}</span>}</button>)}
        </div>
        <div className="drawer-content" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && <div className="drawer-message" role="status"><span className="spinner" aria-hidden="true" />Loading table details…</div>}
          {state.status === 'error' && <div className="schema-error" role="alert"><p>Could not load table details</p><span>{state.message}</span><button type="button" onClick={() => { setState({ status: 'loading' }); setRevision((value) => value + 1) }}>Try again</button></div>}
          {state.status === 'success' && view === 'overview' && <>
            <h3 className="drawer-section-title">Overview</h3>
            <dl className="drawer-overview">
              <div><dt>Database</dt><dd>{database}</dd></div>
              <div><dt>Table</dt><dd>{name}</dd></div>
              <div><dt>Engine</dt><dd>{state.metadata.overview.engine}</dd></div>
              <div><dt>Columns</dt><dd>{state.metadata.columns.length}</dd></div>
              <div><dt>Rows</dt><dd>{displayCount(state.metadata.overview.totalRows)}</dd></div>
              <div><dt>Storage size</dt><dd>{state.metadata.overview.totalBytes === null ? 'Unavailable' : `${displayCount(state.metadata.overview.totalBytes)} bytes`}</dd></div>
            </dl>
            <h3 className="drawer-section-title">Keys and partitioning</h3>
            <dl className="drawer-overview">
              <div><dt>Sorting key</dt><dd><code>{state.metadata.overview.sortingKey || 'Not defined'}</code></dd></div>
              <div><dt>Primary key</dt><dd><code>{state.metadata.overview.primaryKey || 'Not defined'}</code></dd></div>
              <div><dt>Partition key</dt><dd><code>{state.metadata.overview.partitionKey || 'Not defined'}</code></dd></div>
              {state.metadata.overview.samplingKey && <div><dt>Sampling key</dt><dd><code>{state.metadata.overview.samplingKey}</code></dd></div>}
            </dl>
            {state.metadata.overview.comment && <><h3 className="drawer-section-title">Comment</h3><p className="drawer-comment">{state.metadata.overview.comment}</p></>}
          </>}
          {state.status === 'success' && view === 'columns' && <>
            {columns.length === 0 ? <p className="drawer-caption">No columns are visible to this connection.</p> : <dl className="drawer-columns">{columns.map((column) => <div className="drawer-column-row" key={column.name}>
              <dt>{column.name}</dt><dd className="drawer-column-type">{column.type}</dd>
              {column.defaultKind && <dd className="drawer-column-extra"><strong>{column.defaultKind}</strong> <code>{column.defaultExpression}</code></dd>}
              {column.comment && <dd className="drawer-column-extra">{column.comment}</dd>}
            </div>)}</dl>}
          </>}
          {state.status === 'success' && view === 'ddl' && <><h3 className="drawer-section-title">Create table SQL</h3>{state.metadata.overview.createSql ? <pre className="drawer-sql"><code>{state.metadata.overview.createSql}</code></pre> : <p className="drawer-caption">Creation SQL is not available for this table.</p>}</>}
        </div>
      </div>
    </dialog>, document.body,
  )
}
