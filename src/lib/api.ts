const configuredBase: string | undefined = import.meta.env.VITE_APP_API_BASE
const apiBase = configuredBase?.trim()

export function fetchApi(path: `/${string}`, options: RequestInit): Promise<Response> {
  if (!apiBase) throw new Error('Set VITE_APP_API_BASE to the API base URL.')
  return fetch(`${apiBase.replace(/\/+$/, '')}${path}`, options)
}
