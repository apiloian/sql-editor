export type Theme = 'light' | 'dark'

export function readTheme(): Theme {
  try {
    return localStorage.getItem('sql-editor-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}
