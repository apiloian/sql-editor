import assert from 'node:assert/strict'
import { test } from '@playwright/test'
import { splitStatements, statementsForRun } from '../src/lib/sql.ts'

function at(sql: string, offset: number) {
  return statementsForRun(sql, { start: offset, end: offset })
}

test('Run uses the complete statement at the caret across blank lines', () => {
  const middle = 'SELECT number\r\n\r\nFROM numbers(2)'
  const sql = `SELECT 'a;b';\r\n${middle};\r\nSELECT 3`

  assert.deepEqual(at(sql, sql.indexOf('FROM')), [middle])
  assert.deepEqual(at(sql, sql.indexOf('\r\n\r\n') + 2), [middle])
  assert.deepEqual(at(sql, sql.length), ['SELECT 3'])
})

test('Run sends the exact selected text for one statement or fragment', () => {
  const terminated = '  SELECT 2; \r\n'
  const incomplete = ' FROM numbers(2)'
  const sql = `SELECT 1;${terminated}SELECT number${incomplete}; SELECT 3`

  for (const selected of [terminated, incomplete]) {
    const start = sql.indexOf(selected)
    assert.deepEqual(statementsForRun(sql, { start, end: start + selected.length }), [selected])
  }

  const fragment = " 'unterminated;quoted text"
  const partial = `SELECT 1;${fragment}'; SELECT 3`
  const start = partial.indexOf(fragment)
  assert.deepEqual(statementsForRun(partial, { start, end: start + fragment.length }), [fragment])
})

test('Run preserves the selected statements and their delimiters in source order', () => {
  const selected = "\nSELECT 'first;part';\n/* ; */ SELECT 3  "
  const sql = `SELECT 1;${selected}; SELECT 4`
  const start = sql.indexOf(selected)

  assert.deepEqual(statementsForRun(sql, { start, end: start + selected.length }), [
    "\nSELECT 'first;part';",
    '\n/* ; */ SELECT 3  ',
  ])
  assert.deepEqual(splitStatements(sql), ['SELECT 1', "SELECT 'first;part'", '/* ; */ SELECT 3', 'SELECT 4'])
})

test('Run ignores semicolons in quoted text, identifiers, heredocs, and comments', () => {
  const statement = [
    '/* outer; /* inner; */ comment; */',
    "SELECT 'it\\'s;', 'doubled'';', `a\\`;`, `b``;`, \"c\"\";\", $tag$text;more$tag$",
    '-- line; comment',
    '// another; comment',
    '#! third; comment',
    'FROM system.one',
  ].join('\n')
  const sql = `SELECT 1;\n${statement};\nSELECT 3`

  for (const text of ["s;'", '`;`', 'text;more', 'inner;', 'line;', 'another;', 'third;', 'FROM']) {
    const offset = sql.indexOf(text)
    assert.ok(offset >= 0, text)
    assert.deepEqual(at(sql, offset), [statement])
  }
  assert.deepEqual(splitStatements(sql), ['SELECT 1', statement, 'SELECT 3'])
})

test('Run chooses the next statement after a delimiter and the last statement in trailing whitespace', () => {
  const sql = '  SELECT 1; \n\nSELECT 2;  \n'
  const delimiter = sql.indexOf(';')

  assert.deepEqual(at(sql, 0), ['SELECT 1'])
  assert.deepEqual(at(sql, delimiter), ['SELECT 1'])
  assert.deepEqual(at(sql, delimiter + 1), ['SELECT 2'])
  assert.deepEqual(at(sql, delimiter + 3), ['SELECT 2'])
  assert.deepEqual(at(sql, sql.length), ['SELECT 2'])
})

test('Run ignores whitespace but submits an explicitly selected invalid fragment', () => {
  const sql = ' \n; -- comment;\n/* comment; */ '

  assert.deepEqual(at(sql, sql.indexOf('--')), [])
  assert.deepEqual(statementsForRun(sql, { start: 0, end: sql.length }), [sql])
  assert.deepEqual(splitStatements(sql), [])
  assert.deepEqual(statementsForRun('SELECT 1;  ', { start: 9, end: 11 }), [])
})

test('Run preserves inline INSERT data, including semicolons and the final newline', () => {
  const insert = 'INSERT INTO sample FORMAT CSV\n"one;two"\nlast  \n'
  const sql = `SELECT 1;\n${insert}`

  assert.deepEqual(at(sql, sql.indexOf('one;two')), [insert])
  assert.deepEqual(statementsForRun(sql, { start: sql.indexOf(insert), end: sql.length }), [insert])
  assert.deepEqual(splitStatements(sql), ['SELECT 1', insert])
})
