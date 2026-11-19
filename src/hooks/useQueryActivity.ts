import { useEffect, useRef, useState } from 'react'

export const ACTIVITY_LIMIT = 200
const STORAGE_KEY = 'clickhouse.query-activity.v1'

type ActivityBase = { id: string; sql: string; startedAt: number; database: string | null }
export type QueryActivity = ActivityBase & (
  | { status: 'running' | 'unknown'; duration: null }
  | { status: 'success'; duration: number; rowCount: number }
  | { status: 'error'; duration: number; error: string }
)
type ActivityStore = { entries: QueryActivity[]; warning: string | null }

function isActivity(value: unknown): value is QueryActivity {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.sql !== 'string' || typeof item.startedAt !== 'number' || !Number.isFinite(item.startedAt) || item.startedAt < 0 || item.startedAt > 8_640_000_000_000_000 || (item.database !== null && typeof item.database !== 'string')) return false
  if (item.status === 'running' || item.status === 'unknown') return item.duration === null
  if (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 0) return false
  if (item.status === 'success') return typeof item.rowCount === 'number' && Number.isSafeInteger(item.rowCount) && item.rowCount >= 0
  return item.status === 'error' && typeof item.error === 'string'
}

function readActivity(recoverRunning = true): ActivityStore {
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
    }).sort((a, b) => b.startedAt - a.startedAt).slice(0, ACTIVITY_LIMIT).map((item): QueryActivity => recoverRunning && item.status === 'running' ? { ...item, status: 'unknown' } : item)
    return { entries, warning: null }
  } catch {
    return { entries: [], warning: 'Saved history could not be read. New queries will appear here for this session.' }
  }
}

export function useQueryActivity() {
  const [store, setStore] = useState<ActivityStore>(readActivity)
  const entriesRef = useRef(store.entries)

  useEffect(() => {
    function syncClear(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null) || event.newValue !== null) return
      entriesRef.current = []
      setStore({ entries: [], warning: null })
    }
    window.addEventListener('storage', syncClear)
    return () => window.removeEventListener('storage', syncClear)
  }, [])

  function commit(entries: QueryActivity[]) {
    const merged = new Map(readActivity(false).entries.map((item) => [item.id, item]))
    for (const entry of entries) {
      const saved = merged.get(entry.id)
      const savedIsComplete = saved?.status === 'success' || saved?.status === 'error'
      if (!savedIsComplete || entry.status === 'success' || entry.status === 'error') merged.set(entry.id, entry)
    }
    let retained = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, ACTIVITY_LIMIT)
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
    entriesRef.current = retained
    setStore({ entries: retained, warning })
  }

  function start(sql: string, database: string | null) {
    const id = crypto.randomUUID()
    const entry: QueryActivity = { id, sql, database, startedAt: Date.now(), status: 'running', duration: null }
    commit([entry, ...entriesRef.current])
    return id
  }

  function clear() {
    let warning: string | null = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      warning = 'The activity log was cleared for this session, but saved entries could not be removed and may return after reload.'
    }
    entriesRef.current = []
    setStore({ entries: [], warning })
  }

  function succeed(id: string, duration: number, rowCount: number) {
    if (!entriesRef.current.some((item) => item.id === id)) return
    commit(entriesRef.current.map((item): QueryActivity => item.id === id ? { id: item.id, sql: item.sql, database: item.database, startedAt: item.startedAt, status: 'success', duration, rowCount } : item))
  }

  function fail(id: string, duration: number, error: string) {
    if (!entriesRef.current.some((item) => item.id === id)) return
    commit(entriesRef.current.map((item): QueryActivity => item.id === id ? { id: item.id, sql: item.sql, database: item.database, startedAt: item.startedAt, status: 'error', duration, error } : item))
  }

  return { ...store, start, succeed, fail, clear }
}
