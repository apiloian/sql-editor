import { useRef, useState } from 'react'
import type { QueryState, StatementOutcome } from '../lib/query'
import { executeStatement } from '../lib/query-api'
import type { useQueryActivity } from './useQueryActivity'

type ActivityRecorder = Pick<ReturnType<typeof useQueryActivity>, 'start' | 'finish'>

export function useScriptExecution(activity: ActivityRecorder, database: string | null) {
  const [result, setResult] = useState<QueryState>({ status: 'idle' })
  const running = useRef(false)
  const lastRunId = useRef(0)

  async function runQuery(statements: string[]) {
    if (running.current || !statements.length) return

    running.current = true
    const runId = ++lastRunId.current
    const outcomes: StatementOutcome[] = []

    try {
      for (const [index, sql] of statements.entries()) {
        setResult({ status: 'running', statementNumber: index + 1, statementCount: statements.length })
        const activityId = activity.start(sql, database)
        const outcome = await executeStatement(sql)
        outcomes.push({ sql, result: outcome })
        activity.finish(activityId, outcome)
        if (outcome.kind !== 'rows' && outcome.kind !== 'command') break
      }

      const lastAttemptedIndex = outcomes.length - 1
      for (const sql of statements.slice(outcomes.length)) outcomes.push({ sql, result: { kind: 'skipped' } })
      const completed = { status: 'complete', runId, statements: outcomes, lastAttemptedIndex } as const
      setResult(completed)
      return completed
    } finally {
      running.current = false
    }
  }

  return { result, runQuery }
}
