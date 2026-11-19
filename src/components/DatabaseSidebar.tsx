import { useId, useState } from 'react'
import { Icon } from '@clickhouse/click-ui'
import type { DatabaseInfo, SchemaState, TableReference } from '../lib/schema'
import { TableDetails } from './TableDetails'

function isSystemDatabase(database: DatabaseInfo) {
  return ['system', 'information_schema'].includes(database.name.toLowerCase())
}

function DatabaseGroup({ database, currentDatabase, search, selectedTable, onSelectTable }: { database: DatabaseInfo; currentDatabase: string | null; search: string; selectedTable: TableReference | null; onSelectTable: (table: TableReference) => void }) {
  const [expanded, setExpanded] = useState(database.name === currentDatabase)
  const listId = useId()
  const matchesDatabase = database.name.toLowerCase().includes(search)
  const tables = matchesDatabase ? database.tables : database.tables.filter((table) => table.name.toLowerCase().includes(search))
  const open = expanded || Boolean(search)

  return (
    <li className="database-group">
      <button className="database-name" type="button" aria-expanded={open} aria-controls={listId} onClick={() => setExpanded(!expanded)} title={`${database.name} · ${database.engine}`}>
        <span className={`database-chevron${open ? ' expanded' : ''}`} aria-hidden="true">›</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v14c0 4 14 4 14 0V5M5 12c0 4 14 4 14 0" /></svg>
        <span className="database-name-text">{database.name}</span>
        <span className="schema-count" aria-label={`${database.tables.length} tables`}>{database.tables.length}</span>
      </button>
      <div id={listId} hidden={!open}>
        {tables.length === 0 ? <p className="schema-empty">No tables</p> : <ul className="database-tables">{tables.map((table) => <li key={table.name}><button type="button" className="database-table" title={`${database.name}.${table.name} · ${table.engine}`} aria-pressed={selectedTable?.database === database.name && selectedTable.name === table.name} onClick={() => onSelectTable({ ...table, database: database.name })}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 8h16M7 8v9" /></svg><span className="table-name">{table.name}</span><span className="table-engine">{table.engine}</span></button></li>)}</ul>}
      </div>
    </li>
  )
}

export function DatabaseSidebar({ state, onRefresh }: { state: SchemaState; onRefresh: () => void }) {
  const [search, setSearch] = useState('')
  const [showSystemDatabases, setShowSystemDatabases] = useState(false)
  const [selectedTable, setSelectedTable] = useState<TableReference | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const normalizedSearch = search.trim().toLowerCase()
  const allDatabases = state.status === 'success' ? state.schema.databases : []
  const systemCount = allDatabases.filter(isSystemDatabase).length
  const visibleDatabases = allDatabases.filter((database) => showSystemDatabases || !isSystemDatabase(database))
  const databases = visibleDatabases.filter((database) => database.name.toLowerCase().includes(normalizedSearch) || database.tables.some((table) => table.name.toLowerCase().includes(normalizedSearch)))
  const regularDatabases = databases.filter((database) => !isSystemDatabase(database))
  const systemDatabases = databases.filter(isSystemDatabase)

  function refresh() {
    setSelectedTable(null)
    onRefresh()
  }

  return (
    <aside id="database-sidebar" className="schema-sidebar" style={{ width: sidebarWidth }} aria-label="Database explorer" aria-busy={state.status === 'loading'}>
      <div className="sidebar-resize-handle" role="separator" aria-label="Resize database sidebar" aria-orientation="vertical" aria-controls="database-sidebar" aria-valuemin={220} aria-valuemax={520} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} pixels`} tabIndex={0} title="Drag to resize. Double-click to reset."
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
          if (bounds) setSidebarWidth(Math.max(220, Math.min(520, event.clientX - bounds.left)))
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => setSidebarWidth(260)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setSidebarWidth((width) => Math.max(220, Math.min(520, width + (event.key === 'ArrowLeft' ? -20 : 20))))
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setSidebarWidth(event.key === 'Home' ? 220 : 520)
          }
        }}
      />
      <div className="schema-heading"><h2>ClickHouse SQL editor</h2><button className="schema-refresh" type="button" onClick={refresh} disabled={state.status === 'loading'} aria-label="Refresh databases" title="Refresh databases"><Icon name="refresh" size="sm" aria-hidden="true" /></button></div>
      <label className="schema-search"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input aria-label="Search databases, tables, and views" placeholder="Search databases, tables, and views…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="schema-content">
        {state.status === 'loading' && <p className="schema-message" role="status">Loading databases…</p>}
        {state.status === 'error' && <div className="schema-error" role="alert"><p>Could not load databases</p><span>{state.message}</span><button type="button" onClick={refresh}>Try again</button></div>}
        {state.status === 'success' && databases.length === 0 && <p className="schema-message">{normalizedSearch ? 'No matching databases, tables, or views.' : 'No user databases available.'}{!showSystemDatabases && systemCount > 0 && ' Enable system databases below to browse them.'}</p>}
        {state.status === 'success' && <>
          <ul className="database-list">{regularDatabases.map((database) => <DatabaseGroup key={database.name} database={database} currentDatabase={state.schema.currentDatabase} search={normalizedSearch} selectedTable={selectedTable} onSelectTable={setSelectedTable} />)}</ul>
          {systemDatabases.length > 0 && <section aria-label="System databases" className="mt-4 border-t border-[var(--click-global-color-stroke-default)] pt-3">
            <h3 className="m-0 px-3 pb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--click-global-color-text-muted)]">System databases</h3>
            <ul className="database-list">{systemDatabases.map((database) => <DatabaseGroup key={database.name} database={database} currentDatabase={state.schema.currentDatabase} search={normalizedSearch} selectedTable={selectedTable} onSelectTable={setSelectedTable} />)}</ul>
          </section>}
        </>}
      </div>
      {selectedTable && <TableDetails key={JSON.stringify([selectedTable.database, selectedTable.name])} table={selectedTable} onClose={() => setSelectedTable(null)} />}
      <footer className="schema-footer">
        {state.status === 'success' && systemCount > 0 && <label className="flex cursor-pointer items-center gap-2 pb-2 text-[11px]"><input type="checkbox" checked={showSystemDatabases} onChange={(event) => {
          setShowSystemDatabases(event.target.checked)
          if (!event.target.checked && selectedTable && ['system', 'information_schema'].includes(selectedTable.database.toLowerCase())) setSelectedTable(null)
        }} className="accent-[var(--click-global-color-accent-default)]" />Show system databases</label>}
        <span>ClickHouse · localhost:8123</span>
      </footer>
    </aside>
  )
}
