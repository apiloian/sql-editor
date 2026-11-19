import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SchemaState } from '../lib/schema'
import { databaseSchemaQuery, schemaQueryKey } from '../lib/schema-queries'

export function useDatabaseSchema() {
  const client = useQueryClient()
  const query = useQuery(databaseSchemaQuery)
  const [refreshing, setRefreshing] = useState(false)
  let state: SchemaState
  if (refreshing || query.isFetching || query.isPending) state = { status: 'loading' }
  else if (query.isError) state = { status: 'error', message: query.error.message }
  else state = { status: 'success', schema: query.data }

  async function refresh() {
    setRefreshing(true)
    try {
      await client.cancelQueries({ queryKey: schemaQueryKey })
      await client.invalidateQueries({ queryKey: schemaQueryKey })
    } finally {
      setRefreshing(false)
    }
  }

  return { state, refresh }
}
