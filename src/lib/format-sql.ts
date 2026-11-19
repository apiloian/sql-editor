import { clickhouse, formatDialect } from 'sql-formatter'
import { sqlTokens } from './sql'

export function formatSqlForDisplay(sql: string) {
  try {
    return formatDialect(sql, { dialect: clickhouse, tabWidth: 4, keywordCase: 'upper' })
  } catch {
    return sql
  }
}

export function formatDdlForDisplay(sql: string) {
  if (!/^\s*(?:CREATE(?:\s+OR\s+REPLACE)?|REPLACE)\s+(?:TEMPORARY\s+)?TABLE\b/i.test(sql)) {
    return formatSqlForDisplay(sql)
  }

  const tokens = sqlTokens(sql)
  const openIndex = tokens.findIndex(({ text, depth }) =>
    depth === 0 && ['(', 'AS', 'ENGINE', 'LIKE', 'CLONE'].includes(text.toUpperCase()),
  )
  const open = tokens[openIndex]
  if (open?.text !== '(') return formatSqlForDisplay(sql)

  const entries: string[] = []
  let start = open.end
  for (let index = openIndex + 1; index < tokens.length; index++) {
    const token = tokens[index]
    const closesList = token.depth === 0 && token.text === ')'
    if (!closesList && !(token.depth === 1 && token.text === ',')) continue

    const entry = sql.slice(start, token.start)
    const trailingTrivia = sql.slice(tokens[index - 1].end, token.start)
    if (entry.trim()) entries.push(`\t${trailingTrivia.trim() ? entry.trimStart() : entry.trim()}`)
    start = token.end
    if (closesList) {
      const header = sql.slice(0, open.start)
      const headerTrivia = sql.slice(tokens[openIndex - 1].end, open.start)
      const opening = headerTrivia.trim() ? `${header}(` : `${header.trim()} (`
      const tail = sql.slice(token.end).trim()
      const suffix = tail && !tail.startsWith(';') ? `\n${tail}` : tail
      if (entries.length === 0) return `${opening})${suffix}`
      return `${opening}\n${entries.join(',\n')}\n)${suffix}`
    }
  }
  return sql
}
