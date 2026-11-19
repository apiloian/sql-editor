const configuredBase: string | undefined = import.meta.env.VITE_APP_API_BASE
const apiBase = configuredBase?.trim()

export function apiUrl(path: `/${string}`): string | undefined {
  return apiBase ? `${apiBase.replace(/\/+$/, '')}${path}` : undefined
}

export function fetchApi(path: `/${string}`, options: RequestInit): Promise<Response> {
  const url = apiUrl(path)
  if (!url) throw new Error('Set VITE_APP_API_BASE to the API base URL.')
  return fetch(url, options)
}
