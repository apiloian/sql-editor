import './index.css'
import { ClickUIProvider } from '@clickhouse/click-ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { readTheme } from './lib/theme'

const queryClient = new QueryClient()

export function Workspace() {
  const [theme, setTheme] = useState(readTheme)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('sql-editor-theme', theme)
    } catch {
      // The theme still works when browser storage is unavailable.
    }
  }, [theme])

  return (
    <ClickUIProvider theme={theme} persistTheme={false}>
      <App theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} />
    </ClickUIProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  </StrictMode>,
)
