import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Logs, Trash2 } from 'lucide-react'
import { Icon } from '@clickhouse/click-ui'
import type { IconName } from '@clickhouse/click-ui'
import { ACTIVITY_LIMIT } from '../hooks/useQueryActivity'
import type { QueryActivity } from '../hooks/useQueryActivity'

const statuses: Record<QueryActivity['status'], { label: string; icon: IconName }> = {
  running: { label: 'Running', icon: 'loading' },
  success: { label: 'Success', icon: 'check-in-circle' },
  error: { label: 'Failed', icon: 'warning' },
  unknown: { label: 'Unknown', icon: 'question' },
}

function durationLabel(duration: number | null) {
  if (duration === null) return '—'
  return duration < 1000 ? `${Math.round(duration)} ms` : `${(duration / 1000).toFixed(2)} s`
}

function timestamp(value: number) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type Props = { entries: QueryActivity[]; warning: string | null; onClose: () => void; onClear: () => void; onLoad: (sql: string) => void }

export function QueryActivityDrawer({ entries, warning, onClose, onClear, onLoad }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const confirmationRef = useRef<HTMLDialogElement>(null)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const matching = entries.filter((entry) => filter === 'all' || entry.status === filter)
  const selected = matching.find((entry) => entry.id === selectedId) ?? matching[0]

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return createPortal(
    <dialog ref={dialogRef} className="table-drawer activity-drawer" aria-labelledby="activity-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
      <div className="drawer-layout">
        <header className="drawer-header">
          <div><Logs size={16} strokeWidth={1.7} aria-hidden="true" /><h2 id="activity-title">Activity log</h2></div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="Close activity log"><Icon name="cross" size="sm" aria-hidden="true" /></button>
        </header>
        {warning && <p className="activity-warning" role="alert"><Icon name="warning" size="sm" aria-hidden="true" />{warning}</p>}
        <div className="activity-filters">
          <select aria-label="Filter activity log by status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statuses).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}</select>
          <button ref={clearButtonRef} className="activity-clear" type="button" disabled={entries.length === 0} onClick={() => {
            const confirmation = confirmationRef.current
            if (confirmation) { confirmation.returnValue = ''; confirmation.showModal() }
          }}><Trash2 size={14} aria-hidden="true" />Clear activity log</button>
        </div>
        <div className="activity-body">
          <div className="activity-list" aria-label="Run commands">
            {matching.length ? matching.map((entry) => <button key={entry.id} type="button" className="activity-entry" aria-pressed={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}>
              <span className="activity-entry-meta"><span className="activity-status" data-status={entry.status}><Icon name={statuses[entry.status].icon} size="xs" aria-hidden="true" />{statuses[entry.status].label}</span><time dateTime={new Date(entry.startedAt).toISOString()}>{timestamp(entry.startedAt)}</time><span>{durationLabel(entry.duration)}</span></span>
              <code>{entry.sql.replace(/\s+/g, ' ').trim()}</code>
              {entry.database && <span className="activity-database">{entry.database}</span>}
            </button>) : <div className="activity-empty"><Logs size={28} strokeWidth={1.5} aria-hidden="true" /><h3>{entries.length ? 'No matching queries' : 'No queries yet'}</h3><p>{entries.length ? 'Try a different status filter.' : 'Commands you run from the editor will appear here.'}</p></div>}
          </div>
          {selected && <section className="activity-detail" aria-label="Selected query details">
            <div className="activity-detail-heading"><h3>Query details</h3><button className="activity-load" type="button" onClick={() => onLoad(selected.sql)}><Icon name="query" size="sm" aria-hidden="true" />Load in editor</button></div>
            <dl className="activity-facts"><div><dt>Started</dt><dd>{new Date(selected.startedAt).toLocaleString()}</dd></div><div><dt>Duration</dt><dd>{durationLabel(selected.duration)}</dd></div><div><dt>Status</dt><dd>{statuses[selected.status].label}</dd></div>{selected.database && <div><dt>Database</dt><dd>{selected.database}</dd></div>}{selected.status === 'success' && <div><dt>Rows returned</dt><dd>{selected.rowCount.toLocaleString()}</dd></div>}</dl>
            {selected.status === 'unknown' && <p className="activity-note">The page reloaded before a result was recorded. The query may have completed on the server.</p>}
            {selected.status === 'error' && <pre className="activity-error">{selected.error}</pre>}
            <pre className="activity-sql"><code>{selected.sql}</code></pre>
          </section>}
        </div>
        <dialog ref={confirmationRef} className="activity-confirm" role="alertdialog" aria-labelledby="clear-activity-title" aria-describedby="clear-activity-description" onCancel={(event) => event.stopPropagation()} onClose={() => {
          if (confirmationRef.current?.returnValue === 'clear') onClose()
          else clearButtonRef.current?.focus()
        }}>
          <h3 id="clear-activity-title">Clear activity log?</h3>
          <p id="clear-activity-description">This removes all saved queries and execution details from this browser.</p>
          <div><button className="activity-cancel" type="button" autoFocus onClick={() => confirmationRef.current?.close()}>Cancel</button><button className="activity-clear" type="button" onClick={() => {
            onClear()
            setSelectedId(null)
            setFilter('all')
            confirmationRef.current?.close('clear')
          }}>Clear all</button></div>
        </dialog>
        <footer className="activity-footer"><span>{entries.length} {entries.length === 1 ? 'query' : 'queries'}</span><span>Last {ACTIVITY_LIMIT} runs · Stored in this browser</span></footer>
      </div>
    </dialog>, document.body,
  )
}
