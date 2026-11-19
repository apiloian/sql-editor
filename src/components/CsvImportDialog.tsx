import { useEffect, useId, useRef, useState } from 'react'
import { Upload } from 'lucide-react'

type Destination = { database: string; name: string }
type Selection = { table: Destination | null; file: File | null }
type UploadSelection = { table: Destination; file: File }
type Verified = { kind: 'verified'; importId: string; checkedRows: number; hasMore: boolean }
type ImportError = { message: string; record?: number; column?: string }
type Invalid = ImportError & { kind: 'invalid'; checkedRows: number; hasMore: boolean }
type ImportResult =
  | { kind: 'complete'; insertedRows: number }
  | (ImportError & {
      kind: 'failed'
      insertedRows: number
      unknownChunk?: { firstRecord: number; lastRecord: number }
    })

type Phase =
  | ({ kind: 'choosing' } & Selection)
  | ({ kind: 'verifying'; controller: AbortController } & UploadSelection)
  | ((Verified | Invalid) & UploadSelection)
  | ({ kind: 'verificationUnavailable'; message: string } & UploadSelection)
  | ({ kind: 'importing' | 'resultUnavailable'; importId: string } & UploadSelection)
  | (ImportResult & UploadSelection)

const initialPhase: Phase = { kind: 'choosing', table: null, file: null }

function tableKey(table: Destination) {
  return JSON.stringify([table.database, table.name])
}

function quoteIdentifier(identifier: string) {
  return /^[a-z_][a-z_0-9]*$/i.test(identifier)
    ? identifier
    : '`' + identifier.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`'
}

function qualifiedName(table: Destination) {
  return [table.database, table.name].map(quoteIdentifier).join('.')
}

function rows(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseError(data: unknown): ImportError | null {
  if (!isObject(data) || typeof data.message !== 'string') return null
  return {
    message: data.message,
    record: isCount(data.record) && data.record > 0 ? data.record : undefined,
    column: typeof data.column === 'string' ? data.column : undefined,
  }
}

function parseVerification(data: unknown, ok: boolean): Verified | Invalid {
  if (isObject(data) && isCount(data.checkedRows) && typeof data.hasMore === 'boolean') {
    const sample = { checkedRows: data.checkedRows, hasMore: data.hasMore }
    if (ok && data.kind === 'verified' && typeof data.importId === 'string' && data.importId) {
      return { ...sample, kind: 'verified', importId: data.importId }
    }
    const error = parseError(data)
    if (data.kind === 'invalid' && error) return { ...sample, ...error, kind: 'invalid' }
  }
  throw new Error(parseError(data)?.message ?? 'The server could not verify the file.')
}

function parseImportResult(data: unknown, ok: boolean): ImportResult | null {
  if (!isObject(data) || !isCount(data.insertedRows)) return null
  if (data.kind === 'complete' && ok) return { kind: 'complete', insertedRows: data.insertedRows }
  const error = parseError(data)
  if (data.kind !== 'failed' || !error) return null
  const chunk = data.unknownChunk
  if (chunk === undefined) return { ...error, kind: 'failed', insertedRows: data.insertedRows }

  if (!isObject(chunk) || !isCount(chunk.firstRecord) || !isCount(chunk.lastRecord)
    || chunk.firstRecord < 1 || chunk.lastRecord < chunk.firstRecord) return null

  return {
    ...error,
    kind: 'failed',
    insertedRows: data.insertedRows,
    unknownChunk: { firstRecord: chunk.firstRecord, lastRecord: chunk.lastRecord },
  }
}

function ErrorDetails({ error }: { error: ImportError }) {
  return (
    <p>
      {error.record && <>Data row {error.record.toLocaleString()}{error.column ? ', ' : '. '}</>}
      {error.column && <>{error.record ? 'column' : 'Column'} <code>{error.column}</code>. </>}
      {error.message}
    </p>
  )
}

function ImportStatus({ phase }: { phase: Phase }) {
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

export function CsvImportDialog({ tables, onClose }: { tables: Destination[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const current = useRef<Phase>(initialPhase)
  const [dragging, setDragging] = useState(false)
  const titleId = useId()
  const destinationId = useId()

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      if (current.current.kind === 'verifying') current.current.controller.abort()
      current.current = initialPhase
      element?.close()
    }
  }, [])

  function transition(next: Phase) {
    current.current = next
    setPhase(next)
  }

  async function verify({ table, file }: Selection) {
    const previous = current.current
    if (previous.kind === 'importing' || previous.kind === 'resultUnavailable'
      || previous.kind === 'complete' || previous.kind === 'failed') return
    if (previous.kind === 'verifying') previous.controller.abort()
    if (!table || !file) {
      transition({ kind: 'choosing', table, file })
      return
    }

    const controller = new AbortController()
    const pending = { kind: 'verifying' as const, table, file, controller }
    transition(pending)
    const target = new URLSearchParams({ database: table.database, table: table.name })
    try {
      const response = await fetch(`/csv-import/verify?${target}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'text/csv' },
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => null)
      const verdict = parseVerification(payload, response.ok)
      if (current.current === pending) transition({ ...verdict, table, file })
    } catch (error) {
      if (current.current !== pending) return
      const message = error instanceof Error && error.name === 'Error'
        ? error.message
        : 'Could not upload the CSV.'
      transition({ kind: 'verificationUnavailable', message, table, file })
    }
  }

  async function confirm() {
    const selected = current.current
    if (selected.kind !== 'verified' && selected.kind !== 'resultUnavailable') return

    const { importId, table, file } = selected
    const pending = { kind: 'importing' as const, importId, table, file }
    transition(pending)
    try {
      const response = await fetch(`/csv-import/${encodeURIComponent(importId)}/confirm`, { method: 'POST' })
      const payload: unknown = await response.json().catch(() => null)
      const result = parseImportResult(payload, response.ok)
      if (current.current === pending) {
        transition(result ? { ...result, table, file } : { kind: 'resultUnavailable', importId, table, file })
      }
    } catch {
      if (current.current === pending) transition({ kind: 'resultUnavailable', importId, table, file })
    }
  }

  function close() {
    if (current.current.kind === 'importing') return
    if (current.current.kind === 'verifying') current.current.controller.abort()
    current.current = initialPhase
    dialog.current?.close()
    onClose()
  }

  const resultUnavailable = phase.kind === 'resultUnavailable'
  const importing = phase.kind === 'importing'
  const finished = phase.kind === 'complete' || phase.kind === 'failed'
  const locked = importing || finished || resultUnavailable
  const canImport = phase.kind === 'verified'
  const error = phase.kind === 'invalid' || phase.kind === 'verificationUnavailable'
    || phase.kind === 'failed' || resultUnavailable

  return (
    <dialog
      ref={dialog}
      className="csv-import"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
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
        if (!locked && file) void verify({ table: current.current.table, file })
      }}
    >
      <h2 id={titleId}>Insert data from a file</h2>
      <div className="csv-import-destination">
        <label htmlFor={destinationId}>Destination table</label>
        <select
          id={destinationId}
          value={phase.table ? tableKey(phase.table) : ''}
          disabled={locked || tables.length === 0}
          onChange={(event) => {
            const key = event.target.value
            const table = tables.find((candidate) => tableKey(candidate) === key) ?? null
            void verify({ table, file: current.current.file })
          }}
        >
          <option value="" disabled>{tables.length ? 'Select a table' : 'No tables available'}</option>
          {tables.map((table) => <option key={tableKey(table)} value={tableKey(table)}>{qualifiedName(table)}</option>)}
        </select>
      </div>
      <section className="csv-import-dropzone" data-dragging={dragging && !locked} aria-label="CSV upload">
        <Upload size={20} aria-hidden="true" />
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
            if (file) void verify({ table: current.current.table, file })
          }}
        />
        <button type="button" className="csv-import-button" disabled={locked} onClick={() => fileInput.current?.click()}>
          Choose CSV file
        </button>
      </section>
      <div className="csv-import-footer">
        <div className="csv-import-status" data-tone={error ? 'error' : canImport || phase.kind === 'complete' ? 'success' : undefined}>
          <div role="status"><ImportStatus phase={error ? initialPhase : phase} /></div>
          <div role="alert"><ImportStatus phase={error ? phase : initialPhase} /></div>
        </div>
        <div className="csv-import-actions">
          <button type="button" className="csv-import-button" disabled={importing} onClick={close}>
            {finished || resultUnavailable ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'verificationUnavailable' && (
            <button type="button" className="csv-import-button" onClick={() => void verify(phase)}>
              Retry verification
            </button>
          )}
          {resultUnavailable ? (
            <button type="button" className="csv-import-button csv-import-primary" onClick={() => void confirm()}>
              Check import result
            </button>
          ) : !finished && (
            <button type="button" className="csv-import-button csv-import-primary" disabled={!canImport} onClick={() => void confirm()}>
              Import
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
