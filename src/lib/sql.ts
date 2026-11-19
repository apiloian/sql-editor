export type SqlToken = { text: string; start: number; end: number; depth: number }

const lexeme = /\s+|--[^\r\n]*|\/\/[^\r\n]*|#[! \t][^\r\n]*|\/\*|\$(?:[A-Za-z_][A-Za-z_\d]*)?\$|'(?:\\[\s\S]|''|[^'\\])*(?:'|$)|"(?:\\[\s\S]|""|[^"\\])*(?:"|$)|`(?:\\[\s\S]|``|[^`\\])*(?:`|$)|[A-Za-z_][A-Za-z_\d]*|\d+|[^]/gy

export function sqlTokens(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  let depth = 0
  let end = 0
  while (end < sql.length) {
    lexeme.lastIndex = end
    const match = lexeme.exec(sql)
    if (!match) break
    const start = match.index
    const [text] = match
    end = lexeme.lastIndex
    if (/^\s|^(?:--|\/\/|#[! \t])/.test(text)) continue
    if (text === '/*') {
      let nesting = 1
      while (end < sql.length && nesting > 0) {
        if (sql.startsWith('/*', end)) { nesting++; end += 2 }
        else if (sql.startsWith('*/', end)) { nesting--; end += 2 }
        else end++
      }
      continue
    }
    if (text.startsWith('$') && text.length > 1) {
      const close = sql.indexOf(text, end)
      end = close < 0 ? sql.length : close + text.length
    }
    if (')]}'.includes(text)) depth = Math.max(0, depth - 1)
    tokens.push({ text: sql.slice(start, end), start, end, depth })
    if ('([{'.includes(text)) depth++
  }
  return tokens
}

type StatementRange = { start: number; end: number; hasInlineData: boolean }

function statementRanges(sql: string): StatementRange[] {
  const statements: StatementRange[] = []
  let start = 0
  let first = ''
  let previous = ''
  let hasSelect = false
  for (const token of sqlTokens(sql)) {
    if (token.depth !== 0) continue
    const word = token.text.toUpperCase()
    if (word === ';') {
      if (first) statements.push({ start, end: token.start, hasInlineData: false })
      start = token.end
      first = ''
      previous = ''
      hasSelect = false
      continue
    }
    first ||= word
    if (word === 'SELECT') hasSelect = true
    if (previous === 'FORMAT' && /^\w+$/.test(word) && first === 'INSERT' && !hasSelect) {
      statements.push({ start, end: sql.length, hasInlineData: true })
      return statements
    }
    previous = word
  }
  if (first) statements.push({ start, end: sql.length, hasInlineData: false })
  return statements
}

function statementText(sql: string, { start, end, hasInlineData }: StatementRange): string {
  const text = sql.slice(start, end)
  return hasInlineData ? text.trimStart() : text.trim()
}

export function splitStatements(sql: string): string[] {
  return statementRanges(sql).map(range => statementText(sql, range))
}

export function statementsForRun(sql: string, selection: { start: number; end: number }): string[] {
  if (selection.start !== selection.end) {
    const text = sql.substring(selection.start, selection.end)
    if (!text.trim()) return []
    const ranges = statementRanges(text)
    if (ranges.length <= 1) return [text]
    return ranges.map(({ start, end }, index) => text.slice(start, index === ranges.length - 1 ? text.length : end + 1))
  }

  const ranges = statementRanges(sql)
  // At a semicolon, use the statement it ends. After it, use the next statement if there is one.
  const current = ranges.find(range => selection.start <= range.end) ?? ranges.at(-1)
  return current ? [statementText(sql, current)] : []
}

export function statementVerb(tokens: SqlToken[]): string {
  const first = tokens.find(token => token.text !== '(')
  if (!first) return ''
  const verb = first.text.toUpperCase()
  if (verb !== 'WITH') return verb
  return tokens.find(token => token.start > first.start && token.depth === first.depth && /^(SELECT|INSERT)$/i.test(token.text))?.text.toUpperCase() ?? verb
}

export function isReadVerb(verb: string): boolean {
  return ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'EXISTS', 'CHECK'].includes(verb)
}
