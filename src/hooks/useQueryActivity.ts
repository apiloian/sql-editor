import { useEffect, useRef, useState } from 'react'

export const ACTIVITY_LIMIT = 200
const STORAGE_KEY = 'sql-editor-ui.query-activity.v1'

type ActivityBase = { id: string; sql: string; startedAt: number; database: string | null }
type ActivityOutcome =
  | { status: 'success'; duration: number; rowCount: number }
  | { status: 'success'; duration: number; message: string }
  | { status: 'error'; duration: number; error: string }
  | { status: 'unknown'; duration: number; message: string }
export type QueryActivity = ActivityBase & (
  ActivityOutcome | { status: 'running' | 'unknown'; duration: null }
)
type ActivityStore = { entries: QueryActivity[]; warning: string | null }

function isActivity(value: unknown): value is QueryActivity {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.sql !== 'string' || typeof item.startedAt !== 'number' || !Number.isFinite(item.startedAt) || item.startedAt < 0 || item.startedAt > 8_640_000_000_000_000 || (item.database !== null && typeof item.database !== 'string')) return false
  if (item.status === 'running' || (item.status === 'unknown' && item.duration === null)) return item.duration === null
  if (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 0) return false
  if (item.status === 'success') return typeof item.message === 'string'
    || (typeof item.rowCount === 'number' && Number.isSafeInteger(item.rowCount) && item.rowCount >= 0)
  if (item.status === 'unknown') return typeof item.message === 'string'
  return item.status === 'error' && typeof item.error === 'string'
}

function readActivity(): ActivityStore {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { entries: [], warning: null }
    const data: unknown = JSON.parse(stored)
    if (!Array.isArray(data) || !data.every(isActivity)) throw new Error('Invalid query history')
    const seen = new Set<string>()
    const entries = data.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    }).sort((a, b) => b.startedAt - a.startedAt).slice(0, ACTIVITY_LIMIT)
    return { entries, warning: null }
  } catch {
    return { entries: [], warning: 'Saved history could not be read. New queries will appear here for this session.' }
  }
}

function displayActivity(store: ActivityStore, pending?: ReadonlySet<string>): ActivityStore {
  return {
    ...store,
    entries: store.entries.map((item) => item.status === 'running' && !pending?.has(item.id)
      ? { ...item, status: 'unknown' }
      : item),
  }
}

export function useQueryActivity() {
  const [store, setStore] = useState(() => displayActivity(readActivity()))
  const pending = useRef(new Set<string>())
  const unsaved = useRef<QueryActivity[] | null>(null)

  useEffect(() => {
    function syncActivity(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return
      const saved = readActivity()
      if (event.newValue === null) {
        const savedIds = new Set(saved.entries.map((entry) => entry.id))
        for (const id of pending.current) {
          if (!savedIds.has(id)) pending.current.delete(id)
        }
        unsaved.current = null
      }
      if (!unsaved.current) setStore(displayActivity(saved, pending.current))
    }
    window.addEventListener('storage', syncActivity)
    return () => window.removeEventListener('storage', syncActivity)
  }, [])

  function commit(update: (entries: QueryActivity[]) => QueryActivity | undefined) {
    const entries = unsaved.current ?? readActivity().entries
    const entry = update(entries)
    if (!entry) return
    let retained = [entry, ...entries.filter((item) => item.id !== entry.id)]
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, ACTIVITY_LIMIT)
    let warning: string | null = null
    let candidate = retained
    for (;;) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate))
        retained = candidate
        break
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError' && candidate.length > 1) {
          candidate = candidate.slice(0, -1)
          continue
        }
        warning = 'History could not be saved to this browser. Queries are still available for this session.'
        break
      }
    }
    unsaved.current = warning ? retained : null
    setStore(displayActivity({ entries: retained, warning }, pending.current))
  }

  function start(sql: string, database: string | null) {
    const id = crypto.randomUUID()
    pending.current.add(id)
    commit(() => ({ id, sql, database, startedAt: Date.now(), status: 'running', duration: null }))
    return id
  }

  function clear() {
    let warning: string | null = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      warning = 'The activity log was cleared for this session, but saved entries could not be removed and may return after reload.'
    }
    pending.current.clear()
    unsaved.current = null
    setStore({ entries: [], warning })
  }

  function complete(id: string, outcome: ActivityOutcome) {
    if (!pending.current.delete(id)) return
    commit((entries) => {
      const entry = entries.find((item) => item.id === id)
      return entry && { ...entry, ...outcome }
    })
  }

  function succeed(id: string, duration: number, details: number | string) {
    complete(id, typeof details === 'number'
      ? { status: 'success', duration, rowCount: details }
      : { status: 'success', duration, message: details })
  }

  function fail(id: string, duration: number, error: string) {
    complete(id, { status: 'error', duration, error })
  }

  function unknown(id: string, duration: number, message: string) {
    complete(id, { status: 'unknown', duration, message })
  }

  return { ...store, start, succeed, fail, unknown, clear }
}
