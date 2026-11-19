import { executeQuery } from './query'

export type DatabaseTable = { name: string; engine: string }
export type TableReference = DatabaseTable & { database: string }
export type TableColumn = { name: string; type: string; defaultKind: string; defaultExpression: string; comment: string }
export type CompletionColumn = { table: string; name: string; type: string }
export type TableOverview = {
  engine: string
  sortingKey: string
  primaryKey: string
  partitionKey: string
  samplingKey: string
  createSql: string
  comment: string
  totalRows: string | null
  totalBytes: string | null
}
export type TableMetadata = { overview: TableOverview; columns: TableColumn[] }
export type DatabaseInfo = { name: string; engine: string; tables: DatabaseTable[] }
export type DatabaseSchema = { currentDatabase: string | null; databases: DatabaseInfo[] }
export type SchemaState =
  | { status: 'loading' }
  | { status: 'success'; schema: DatabaseSchema }
  | { status: 'error'; message: string }

function sqlString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function metadataCount(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  throw new Error('The server returned an invalid table statistic.')
}

export async function loadTableMetadata(table: TableReference): Promise<TableMetadata> {
  const [columns, rows] = await Promise.all([
    loadTableColumns(table),
    executeQuery(`SELECT engine, sorting_key, primary_key, partition_key, sampling_key, create_table_query, comment, total_rows, total_bytes FROM system.tables WHERE database = ${sqlString(table.database)} AND name = ${sqlString(table.name)}`),
  ])
  const row = rows[0]
  if (!row) throw new Error('This table no longer exists or is not visible to this connection.')
  if (typeof row.engine !== 'string' || typeof row.sorting_key !== 'string' || typeof row.primary_key !== 'string' || typeof row.partition_key !== 'string' || typeof row.sampling_key !== 'string' || typeof row.create_table_query !== 'string' || typeof row.comment !== 'string') {
    throw new Error('The server returned invalid table metadata.')
  }
  return {
    columns,
    overview: {
      engine: row.engine, sortingKey: row.sorting_key, primaryKey: row.primary_key,
      partitionKey: row.partition_key, samplingKey: row.sampling_key,
      createSql: row.create_table_query, comment: row.comment,
      totalRows: metadataCount(row.total_rows), totalBytes: metadataCount(row.total_bytes),
    },
  }
}

export async function loadTableColumns({ database, name }: TableReference): Promise<TableColumn[]> {
  const rows = await executeQuery(`SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = ${sqlString(database)} AND table = ${sqlString(name)} ORDER BY position`)
  return rows.map((row) => {
    if (typeof row.name !== 'string' || typeof row.type !== 'string' || typeof row.default_kind !== 'string' || typeof row.default_expression !== 'string' || typeof row.comment !== 'string') {
      throw new Error('The server returned invalid column metadata.')
    }
    return { name: row.name, type: row.type, defaultKind: row.default_kind, defaultExpression: row.default_expression, comment: row.comment }
  })
}

export async function loadCompletionColumns(database: string): Promise<CompletionColumn[]> {
  const rows = await executeQuery(`SELECT table, name, type FROM system.columns WHERE database = ${sqlString(database)} ORDER BY table, position`)
  return rows.map(({ table, name, type }) => {
    if (typeof table !== 'string' || typeof name !== 'string' || typeof type !== 'string') {
      throw new Error('The server returned invalid completion metadata.')
    }
    return { table, name, type }
  })
}

export async function loadDatabaseSchema(): Promise<DatabaseSchema> {
  const [databaseRows, tableRows] = await Promise.all([
    executeQuery('SELECT name, engine, currentDatabase() AS current_database FROM system.databases ORDER BY name'),
    executeQuery('SELECT database, name, engine FROM system.tables WHERE is_temporary = 0 ORDER BY database, name'),
  ])
  const databases = new Map<string, DatabaseInfo>()
  let currentDatabase: string | null = null

  for (const row of databaseRows) {
    if (typeof row.name !== 'string' || typeof row.engine !== 'string' || typeof row.current_database !== 'string') {
      throw new Error('The server returned invalid database metadata.')
    }
    currentDatabase = row.current_database
    databases.set(row.name, { name: row.name, engine: row.engine, tables: [] })
  }

  for (const row of tableRows) {
    if (typeof row.database !== 'string' || typeof row.name !== 'string' || typeof row.engine !== 'string') {
      throw new Error('The server returned invalid table metadata.')
    }
    databases.get(row.database)?.tables.push({ name: row.name, engine: row.engine })
  }

  return { currentDatabase, databases: [...databases.values()] }
}
