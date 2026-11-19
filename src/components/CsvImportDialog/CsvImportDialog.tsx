import { useId, useRef, useState } from 'react'
import { Button, Dialog, Icon } from '@clickhouse/click-ui'

import { useCsvImport } from '../../hooks/useCsvImport'
import type { CsvImportPhase } from '../../hooks/useCsvImport'
import type { CsvDestination, CsvImportError } from '../../lib/csv-import-api'
import './csv-import.css'

function tableKey(table: CsvDestination) {
  return JSON.stringify([table.database, table.name])
}

function quoteIdentifier(identifier: string) {
  return /^[a-z_][a-z_0-9]*$/i.test(identifier)
    ? identifier
    : '`' + identifier.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`'
}

function qualifiedName(table: CsvDestination) {
  return [table.database, table.name].map(quoteIdentifier).join('.')
}

function rows(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`
}

function ErrorDetails({ error }: { error: CsvImportError }) {
  return (
    <p>
      {error.record && <>Data row {error.record.toLocaleString()}{error.column ? ', ' : '. '}</>}
      {error.column && <>{error.record ? 'column' : 'Column'} <code>{error.column}</code>. </>}
      {error.message}
    </p>
  )
}

function ImportStatus({ phase }: { phase: CsvImportPhase }) {
  switch (phase.kind) {
    case 'choosing':
      return null
    case 'verifying':
      return <p>Uploading and verifying the CSV for <code>{qualifiedName(phase.table)}</code>…</p>
    case 'verified':
      return (
        <p>
          {phase.hasMore ? 'The first' : 'All'} {rows(phase.checkedRows)} passed validation for <code>{qualifiedName(phase.table)}</code>.
          {phase.hasMore ? ' Remaining rows will be checked during import.' : ' Ready to import.'}
        </p>
      )
    case 'invalid':
      return (
        <>
          <p>Verification failed for <code>{qualifiedName(phase.table)}</code>. Checked {rows(phase.checkedRows)}.</p>
          <ErrorDetails error={phase} />
          <p>Correct the CSV or choose a different destination.</p>
        </>
      )
    case 'verificationUnavailable':
      return <p>{phase.message} Retry verification or choose another file.</p>
    case 'importing':
      return <p>Importing into <code>{qualifiedName(phase.table)}</code>…</p>
    case 'resultUnavailable':
      return <p>The import result is unavailable. Check the result of this import again.</p>
    case 'complete':
      return <p>Imported {rows(phase.insertedRows)} into <code>{qualifiedName(phase.table)}</code>.</p>
    case 'failed':
      return (
        <>
          <p>Import stopped for <code>{qualifiedName(phase.table)}</code>. ClickHouse confirmed {rows(phase.insertedRows)} inserted.</p>
          <ErrorDetails error={phase} />
          {phase.unknownChunk && (
            <p>
              ClickHouse did not acknowledge data rows {phase.unknownChunk.firstRecord.toLocaleString()}–{phase.unknownChunk.lastRecord.toLocaleString()}.
              Their outcome is unknown. Check the destination before importing these rows again.
            </p>
          )}
        </>
      )
  }
}

export function CsvImportDialog({ tables, onClose }: { tables: CsvDestination[]; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement>(null)
  const { phase, chooseTable, chooseFile, retryVerification, confirm, dismiss } = useCsvImport()
  const [dragging, setDragging] = useState(false)
  const destinationId = useId()

  function close() {
    if (dismiss()) onClose()
  }

  const resultUnavailable = phase.kind === 'resultUnavailable'
  const importing = phase.kind === 'importing'
  const finished = phase.kind === 'complete' || phase.kind === 'failed'
  const locked = importing || finished || resultUnavailable
  const canImport = phase.kind === 'verified'
  const error = phase.kind === 'invalid' || phase.kind === 'verificationUnavailable'
    || phase.kind === 'failed' || resultUnavailable

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <Dialog.Content
        className="csv-import"
        title="Insert data from a file"
        reducePadding
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => {
          const active = document.activeElement
          previousFocus.current = active instanceof HTMLElement ? active : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          previousFocus.current?.focus()
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = locked ? 'none' : 'copy'
          if (!locked) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files.item(0)
          if (!locked && file) chooseFile(file)
        }}
      >
        <div className="csv-import-destination">
          <label htmlFor={destinationId}>Destination table</label>
          <select
            id={destinationId}
            value={phase.table ? tableKey(phase.table) : ''}
            disabled={locked || tables.length === 0}
            onChange={(event) => {
              const key = event.target.value
              const table = tables.find((candidate) => tableKey(candidate) === key) ?? null
              chooseTable(table)
            }}
          >
            <option value="" disabled>{tables.length ? 'Select a table' : 'No tables available'}</option>
            {tables.map((table) => <option key={tableKey(table)} value={tableKey(table)}>{qualifiedName(table)}</option>)}
          </select>
        </div>
        <section className="csv-import-dropzone" data-dragging={dragging && !locked} aria-label="CSV upload">
          <Icon name="upload" size="md" aria-hidden="true" />
          <p className="csv-import-filename">{phase.file ? phase.file.name : 'Drop a CSV file here'}</p>
          <input
            ref={fileInput}
            type="file"
            aria-label="CSV file"
            accept=".csv,text/csv"
            hidden
            disabled={locked}
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0)
              event.currentTarget.value = ''
              if (file) chooseFile(file)
            }}
          />
          <Button htmlType="button" type="empty" label="Choose CSV file" disabled={locked} onClick={() => fileInput.current?.click()} />
        </section>
        <div className="csv-import-footer">
          <div className="csv-import-status" data-tone={error ? 'error' : canImport || phase.kind === 'complete' ? 'success' : undefined}>
            <div role="status">{!error && <ImportStatus phase={phase} />}</div>
            <div role="alert">{error && <ImportStatus phase={phase} />}</div>
          </div>
          <div className="csv-import-actions">
            <Button htmlType="button" type="empty" label={finished || resultUnavailable ? 'Close' : 'Cancel'} disabled={importing} onClick={close} />
            {phase.kind === 'verificationUnavailable' && (
              <Button htmlType="button" type="empty" label="Retry verification" onClick={retryVerification} />
            )}
            {resultUnavailable ? (
              <Button htmlType="button" type="primary" label="Check import result" onClick={() => void confirm()} />
            ) : !finished && (
              <Button htmlType="button" type="primary" label="Import" disabled={!canImport} onClick={() => void confirm()} />
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
