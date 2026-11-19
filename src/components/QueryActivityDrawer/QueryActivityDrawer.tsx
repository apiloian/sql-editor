import { useRef, useState } from 'react'
import { Logs } from 'lucide-react'
import { Button, Dialog, Icon, Select } from '@clickhouse/click-ui'
import type { IconName } from '@clickhouse/click-ui'
import { ACTIVITY_LIMIT } from '../../hooks/useQueryActivity'
import type { QueryActivity } from '../../hooks/useQueryActivity'
import { formatSqlForDisplay } from '../../lib/format-sql'
import { DrawerFrame } from '../DrawerFrame/DrawerFrame'
import './query-activity-drawer.css'

const statuses: Record<QueryActivity['status'], { label: string; icon: IconName }> = {
  running: { label: 'Running', icon: 'loading' },
  success: { label: 'Success', icon: 'check-in-circle' },
  error: { label: 'Failed', icon: 'warning' },
  unknown: { label: 'Unknown', icon: 'question' },
}

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(statuses).map(([value, { label }]) => ({ value, label })),
]

function durationLabel(duration: number | null) {
  if (duration === null) return '—'
  return duration < 1000 ? `${Math.round(duration)} ms` : `${(duration / 1000).toFixed(2)} s`
}

function timestamp(value: number) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type Props = { entries: QueryActivity[]; warning: string | null; onClose: () => void; onClear: () => void; onLoad: (sql: string) => void; loadDisabled?: boolean }

export function QueryActivityDrawer({ entries, warning, onClose, onClear, onLoad, loadDisabled }: Props) {
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [filterContainer, setFilterContainer] = useState<HTMLDivElement | null>(null)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const matching = entries.filter((entry) => filter === 'all' || entry.status === filter)
  const selected = matching.find((entry) => entry.id === selectedId) ?? matching[0]

  return (
    <DrawerFrame className="activity-drawer" title="Activity log" closeLabel="Close activity log" onClose={onClose}>
      {warning && <p className="activity-warning" role="alert"><Icon name="warning" size="sm" aria-hidden="true" />{warning}</p>}
      <div className="activity-toolbar" ref={setFilterContainer}>
        <div className="activity-summary">
          <strong>{entries.length} {entries.length === 1 ? 'query' : 'queries'}</strong>
          <span>Last {ACTIVITY_LIMIT} runs · Stored in this browser</span>
        </div>
        <div className="activity-filters">
          <Select
            container={filterContainer ?? undefined}
            value={filter}
            onSelect={setFilter}
            triggerProps={{ 'aria-label': 'Filter activity log by status' }}
          >
            <div role="listbox" aria-label="Activity statuses">
              {statusOptions.map(({ value, label }) => (
                <Select.Item key={value} value={value} label={label} role="option" aria-selected={filter === value} />
              ))}
            </div>
          </Select>
          <Button
            ref={clearButtonRef}
            type="empty"
            htmlType="button"
            iconLeft="trash"
            label="Clear logs"
            disabled={entries.length === 0}
            onClick={() => setConfirmOpen(true)}
          />
        </div>
      </div>
      <div className="activity-body">
        <section className="activity-list" aria-label="Run commands">
          {matching.length ? matching.map((entry) => <button key={entry.id} type="button" className="activity-entry" aria-pressed={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}>
            <span className="activity-entry-meta"><span className="activity-status" data-status={entry.status}><Icon name={statuses[entry.status].icon} size="xs" aria-hidden="true" />{statuses[entry.status].label}</span><time dateTime={new Date(entry.startedAt).toISOString()}>{timestamp(entry.startedAt)}</time><span>{durationLabel(entry.duration)}</span></span>
            <code>{entry.sql.replace(/\s+/g, ' ').trim()}</code>
            {entry.database && <span className="activity-database">{entry.database}</span>}
          </button>) : <div className="activity-empty"><Logs size={28} strokeWidth={1.5} aria-hidden="true" /><h3>{entries.length ? 'No matching queries' : 'No queries yet'}</h3><p>{entries.length ? 'Try a different status filter.' : 'Commands you run from the editor will appear here.'}</p></div>}
        </section>
        {selected && <section className="activity-detail" aria-label="Selected query details">
          <div className="activity-detail-heading"><h3>Query details</h3><Button type="empty" htmlType="button" iconLeft="query" label="Load in editor" disabled={loadDisabled} onClick={() => onLoad(selected.sql)} /></div>
          <dl className="activity-facts">
            <div><dt>Started</dt><dd><time dateTime={new Date(selected.startedAt).toISOString()}>{new Date(selected.startedAt).toLocaleString()}</time></dd></div>
            <div><dt>Duration</dt><dd>{durationLabel(selected.duration)}</dd></div>
            <div><dt>Status</dt><dd>{statuses[selected.status].label}</dd></div>
            {selected.database && <div><dt>Database</dt><dd>{selected.database}</dd></div>}
            {selected.status === 'success' && 'rowCount' in selected && <div><dt>Rows returned</dt><dd>{selected.rowCount.toLocaleString()}</dd></div>}
            {selected.status === 'success' && 'message' in selected && <div><dt>Result</dt><dd>{selected.message}</dd></div>}
          </dl>
          {selected.status === 'unknown' && <p className="activity-note">{'message' in selected ? selected.message : 'The server may still be running this query or may have completed it.'}</p>}
          {selected.status === 'error' && <pre className="activity-error">{selected.error}</pre>}
          <pre className="activity-sql"><code>{formatSqlForDisplay(selected.sql)}</code></pre>
        </section>}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Content className="activity-confirm" role="alertdialog" title="Clear logs?"
          description="This removes all saved queries and execution details from this browser."
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelButtonRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            clearButtonRef.current?.focus()
          }}>
          <div className="activity-confirm-actions">
            <Button ref={cancelButtonRef} type="empty" htmlType="button" label="Cancel" onClick={() => setConfirmOpen(false)} />
            <Button type="danger" htmlType="button" label="Clear all" onClick={() => {
              onClear()
              onClose()
            }} />
          </div>
        </Dialog.Content>
      </Dialog>
    </DrawerFrame>
  )
}
