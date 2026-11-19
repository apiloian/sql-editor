import * as monaco from 'monaco-editor/editor/editor.api'
import type { CompletionColumn, DatabaseInfo, DatabaseSchema } from './schema'
import { sqlTokens } from './sql'

const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'HAVING', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'AS', 'DISTINCT', 'WITH', 'UNION ALL', 'INSERT INTO', 'VALUES', 'CREATE TABLE', 'SHOW TABLES', 'SHOW DATABASES', 'DESCRIBE TABLE', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END']
const functions = ['count', 'sum', 'avg', 'min', 'max', 'uniq', 'uniqExact', 'toDate', 'toDateTime', 'toString', 'toStartOfDay', 'toStartOfMonth', 'now', 'today', 'concat', 'ifNull', 'coalesce', 'numbers', 'abs']
const keywordWords = new Set(keywords.flatMap(keyword => keyword.split(' ')))
const plainIdentifier = /^[a-z_][a-z_0-9]*$/i
const systemDatabase = /^(system|information_schema)$/i
const kind = monaco.languages.CompletionItemKind

function quoteMark(text: string): '"' | '`' | undefined {
  return text[0] === '"' || text[0] === '`' ? text[0] : undefined
}

function readIdentifier(text: string) {
  const quote = quoteMark(text)
  if (quote) {
    const content = text.endsWith(quote) && text.length > 1 ? text.slice(1, -1) : text.slice(1)
    return content.replace(/\\(.)/g, '$1').replaceAll(quote + quote, quote)
  }
  return plainIdentifier.test(text) ? text : undefined
}

function insertIdentifier(name: string, quote?: '`' | '"') {
  if (!quote && plainIdentifier.test(name) && !keywordWords.has(name.toUpperCase())) return name
  const delimiter = quote ?? '`'
  return delimiter + name.replaceAll('\\', '\\\\').replaceAll(delimiter, '\\' + delimiter) + delimiter
}

function completionContext(line: string, position: monaco.Position) {
  const prefix = line.slice(0, position.column - 1)
  const tokens = sqlTokens(prefix)
  let index = tokens.length - 1
  const last = tokens[index]
  const active = last?.end === prefix.length && readIdentifier(last.text) !== undefined ? last : undefined
  if (active) index--
  const qualifiers: string[] = []
  while (tokens[index]?.text === '.') {
    const name = tokens[index - 1] && readIdentifier(tokens[index - 1].text)
    if (name === undefined) break
    qualifiers.unshift(name)
    index -= 2
  }
  const start = active?.start ?? prefix.length
  const end = sqlTokens(line).find(token => token.start === start && readIdentifier(token.text) !== undefined)?.end ?? prefix.length
  return {
    qualifiers,
    prefix: active ? readIdentifier(active.text) ?? '' : '',
    quote: active && quoteMark(active.text),
    range: new monaco.Range(position.lineNumber, start + 1, position.lineNumber, end + 1),
  }
}

export function createCompletionCatalog(schema: DatabaseSchema, loadColumns: (database: string) => Promise<Map<string, CompletionColumn[]>>) {
  const databases = new Map(schema.databases.filter(database => !systemDatabase.test(database.name))
    .map(database => [database.name, database]))
  async function columnsFor(database: DatabaseInfo) {
    return loadColumns(database.name).catch(() => new Map<string, CompletionColumn[]>())
  }
  return { databases, current: schema.currentDatabase ? databases.get(schema.currentDatabase) : undefined, columnsFor }
}

type Catalog = ReturnType<typeof createCompletionCatalog>

export async function sqlCompletions(model: monaco.editor.ITextModel, position: monaco.Position, catalog: Catalog | null) {
  const context = completionContext(model.getLineContent(position.lineNumber), position)
  const { qualifiers, range, quote } = context
  const suggestions: monaco.languages.CompletionItem[] = []

  if (!qualifiers.length && !quote) {
    for (const label of keywords) suggestions.push({ label, kind: kind.Keyword, insertText: label, range })
    for (const label of functions) suggestions.push({
      label, kind: kind.Function, insertText: label + '(${1})',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range,
    })
  }
  if (!catalog || qualifiers.length > 2) return { suggestions }

  const prefix = context.prefix.toLowerCase()
  let count = 0
  function add(name: string, category: monaco.languages.CompletionItemKind, detail: string) {
    if (count >= 200 || !name.toLowerCase().startsWith(prefix)) return
    suggestions.push({
      label: { label: name, description: detail }, kind: category, range, insertText: insertIdentifier(name, quote),
      filterText: (quote ?? '') + name,
    })
    count++
  }

  if (!qualifiers.length) {
    for (const database of catalog.databases.values()) add(database.name, kind.Module, 'Database')
  }
  const database = qualifiers.length ? catalog.databases.get(qualifiers[0]) : catalog.current
  const tableOwner = qualifiers.length === 1 ? catalog.current : database
  const selectedTable = qualifiers.at(-1)
  const hasTable = !!selectedTable && !!tableOwner?.tables.some(table => table.name === selectedTable)

  if (database && qualifiers.length < 2 && database.tables.length) {
    const columns = await catalog.columnsFor(database)
    for (const table of database.tables) {
      const count = columns.get(table.name)?.length
      add(table.name, kind.Struct, count === undefined ? 'Table' : `${count} ${count === 1 ? 'column' : 'columns'}`)
    }
    if (!qualifiers.length) {
      for (const table of database.tables) {
        for (const column of columns.get(table.name) ?? []) add(column.name, kind.Field, `${table.name} · ${column.type}`)
      }
    }
  }
  if (tableOwner && selectedTable && hasTable) {
    const columns = await catalog.columnsFor(tableOwner)
    for (const column of columns.get(selectedTable) ?? []) add(column.name, kind.Field, `${selectedTable} · ${column.type}`)
  }
  return { suggestions }
}
