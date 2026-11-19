import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import type { TableReference } from '../lib/schema'
import { tableMetadataQuery } from '../lib/schema-queries'

type DetailView = 'overview' | 'columns' | 'ddl'
const views: { id: DetailView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'columns', label: 'Columns' },
  { id: 'ddl', label: 'DDL' },
]

function displayCount(value: string | null) {
  return value === null ? 'Unavailable' : BigInt(value).toLocaleString()
}

export function TableDetails({ table, onClose }: { table: TableReference; onClose: () => void }) {
  const query = useQuery(tableMetadataQuery(table))
  const loading = query.isPending || query.isFetching
  const metadata = !loading && query.isSuccess ? query.data : null
  const [view, setView] = useState<DetailView>('overview')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailId = useId()
  const { database, name, engine } = table

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const columns = metadata?.columns ?? []

  function navigateViews(event: KeyboardEvent<HTMLDivElement>) {
    const current = views.findIndex((item) => item.id === view)
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % views.length; break
      case 'ArrowLeft': next = (current - 1 + views.length) % views.length; break
      case 'Home': next = 0; break
      case 'End': next = views.length - 1; break
      default: return
    }
    event.preventDefault()
    setView(views[next].id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus()
  }

  return createPortal(
    <dialog ref={dialogRef} className="table-drawer object-drawer" aria-labelledby={`${detailId}-title`}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      }}>
      <div className="drawer-layout">
        <header className="drawer-header">
          <div><h2 id={`${detailId}-title`}>{database}.{name}</h2><span>{metadata?.overview.engine ?? engine}</span></div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="Close table details" autoFocus>×</button>
        </header>
        <div className="drawer-view-switch" role="tablist" aria-label="Object details" onKeyDown={navigateViews}>
          {views.map((item) => (
            <button key={item.id} id={`${detailId}-${item.id}-tab`} type="button" role="tab"
              aria-controls={`${detailId}-${item.id}-panel`} aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)}>
              {item.label}
              {item.id === 'columns' && metadata && <span aria-hidden="true">{columns.length}</span>}
            </button>
          ))}
        </div>
        {views.map((item) => <div key={item.id} className="drawer-content" role="tabpanel" tabIndex={0}
          id={`${detailId}-${item.id}-panel`} aria-labelledby={`${detailId}-${item.id}-tab`}
          hidden={view !== item.id} aria-busy={loading}>
          {view === item.id && <>
          {loading && <div className="drawer-message" role="status"><span className="spinner" aria-hidden="true" />Loading table details…</div>}
          {!loading && query.isError && <div className="schema-error" role="alert"><p>Could not load table details</p><span>{query.error.message}</span><button type="button" onClick={() => void query.refetch()}>Try again</button></div>}
          {metadata && item.id === 'overview' && <>
            {metadata.overview.comment.trim() && <><h3 className="drawer-section-title">Description</h3><p className="drawer-comment">{metadata.overview.comment}</p></>}
            <dl className="drawer-overview">
              <div><dt>Database</dt><dd>{database}</dd></div>
              <div><dt>{engine.endsWith('View') ? 'View' : 'Table'}</dt><dd>{name}</dd></div>
              <div><dt>Engine</dt><dd>{metadata.overview.engine}</dd></div>
              <div><dt>Columns</dt><dd>{columns.length}</dd></div>
              <div><dt>Rows</dt><dd>{displayCount(metadata.overview.totalRows)}</dd></div>
              <div><dt>Storage size</dt><dd>{metadata.overview.totalBytes === null ? 'Unavailable' : `${displayCount(metadata.overview.totalBytes)} bytes`}</dd></div>
            </dl>
            <h3 className="drawer-section-title">Keys and partitioning</h3>
            <dl className="drawer-overview">
              <div><dt>Sorting key</dt><dd><code>{metadata.overview.sortingKey || 'Not defined'}</code></dd></div>
              <div><dt>Primary key</dt><dd><code>{metadata.overview.primaryKey || 'Not defined'}</code></dd></div>
              <div><dt>Partition key</dt><dd><code>{metadata.overview.partitionKey || 'Not defined'}</code></dd></div>
              {metadata.overview.samplingKey && <div><dt>Sampling key</dt><dd><code>{metadata.overview.samplingKey}</code></dd></div>}
            </dl>
          </>}
          {metadata && item.id === 'columns' && <>
            {columns.length === 0 ? <p className="drawer-caption">No columns are visible to this connection.</p> : <dl className="drawer-columns">{columns.map((column) => <div className="drawer-column-row" key={column.name}>
              <dt>{column.name}</dt><dd className="drawer-column-type">{column.type}</dd>
              {column.defaultKind && <dd className="drawer-column-extra"><strong>{column.defaultKind}</strong> <code>{column.defaultExpression}</code></dd>}
              {column.comment.trim() && <dd className="drawer-column-extra">{column.comment}</dd>}
            </div>)}</dl>}
          </>}
          {metadata && item.id === 'ddl' && (metadata.overview.createSql
            ? <pre className="drawer-sql"><code>{metadata.overview.createSql}</code></pre>
            : <p className="drawer-caption">Creation SQL is unavailable for this object.</p>)}
          </>}
        </div>)}
      </div>
    </dialog>, document.body,
  )
}
