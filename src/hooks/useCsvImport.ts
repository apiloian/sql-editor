import { useEffect, useRef, useState } from 'react'
import { confirmCsvImport, verifyCsvImport } from '../lib/csv-import-api'
import type { CsvDestination, CsvImportResult, CsvVerification } from '../lib/csv-import-api'

type Selection = { table: CsvDestination | null; file: File | null }
type UploadSelection = { table: CsvDestination; file: File }

export type CsvImportPhase =
  | ({ kind: 'choosing' } & Selection)
  | ({ kind: 'verifying'; controller: AbortController } & UploadSelection)
  | (CsvVerification & UploadSelection)
  | ({ kind: 'verificationUnavailable'; message: string } & UploadSelection)
  | ({ kind: 'importing' | 'resultUnavailable'; importId: string } & UploadSelection)
  | (CsvImportResult & UploadSelection)

const initialPhase: CsvImportPhase = { kind: 'choosing', table: null, file: null }

export function useCsvImport() {
  const [phase, setPhase] = useState<CsvImportPhase>(initialPhase)
  const current = useRef<CsvImportPhase>(initialPhase)

  useEffect(() => () => {
    if (current.current.kind === 'verifying') current.current.controller.abort()
    current.current = initialPhase
  }, [])

  function transition(next: CsvImportPhase) {
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
    try {
      const verdict = await verifyCsvImport(table, file, controller.signal)
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
    const result = await confirmCsvImport(importId).catch(() => null)
    if (current.current === pending) {
      transition(result ? { ...result, table, file } : { kind: 'resultUnavailable', importId, table, file })
    }
  }

  function chooseTable(table: CsvDestination | null) {
    void verify({ table, file: current.current.file })
  }

  function chooseFile(file: File) {
    void verify({ table: current.current.table, file })
  }

  function retryVerification() {
    if (current.current.kind === 'verificationUnavailable') void verify(current.current)
  }

  function dismiss() {
    if (current.current.kind === 'importing') return false
    if (current.current.kind === 'verifying') current.current.controller.abort()
    current.current = initialPhase
    return true
  }

  return { phase, chooseTable, chooseFile, retryVerification, confirm, dismiss }
}
