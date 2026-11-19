import { queryOptions } from '@tanstack/react-query'
import { loadCompletionColumns, loadDatabaseSchema, loadTableMetadata } from './schema'
import type { CompletionColumn, TableReference } from './schema'

export const schemaQueryKey = ['schema'] as const
const metadataOptions = { staleTime: Infinity, retry: false }

export const databaseSchemaQuery = queryOptions({
  ...metadataOptions,
  queryKey: [...schemaQueryKey, 'databases'],
  queryFn: ({ signal }) => loadDatabaseSchema(signal),
})

export function tableMetadataQuery(table: TableReference) {
  return queryOptions({
    ...metadataOptions,
    queryKey: [...schemaQueryKey, 'table', table.database, table.name],
    queryFn: ({ signal }) => loadTableMetadata(table, signal),
  })
}

export function completionColumnsQuery(database: string) {
  return queryOptions({
    ...metadataOptions,
    queryKey: [...schemaQueryKey, 'completion-columns', database],
    queryFn: async ({ signal }) => {
      const groups = new Map<string, CompletionColumn[]>()
      for (const column of await loadCompletionColumns(database, signal)) {
        const group = groups.get(column.table)
        if (group) group.push(column)
        else groups.set(column.table, [column])
      }
      return groups
    },
  })
}
