// `apiFetch` from the `miso` module: lets a view call the hosted API's own routes (for example
// POST /api/gmail/connect) as the signed-in member. Same token handling as rpc.ts, but only for
// this app's /api/ routes, so a view can never aim the member's bearer token at another origin.
import { accessToken } from './session'

// The origin is a placeholder: all that matters is that resolving the path against it stays
// there. `//host/x`, `https://host/x`, `/api/../x` and `/api/%2e%2e/x` all end up elsewhere.
const PLACEHOLDER = 'http://same-origin.invalid'

/** The path as it will be sent, or an Error when it is not a plain `/api/...` path of this app. */
export function checkedApiPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('\\')) {
    throw new Error('apiFetch only calls this app\'s own routes: use a path that starts with /api/.')
  }
  let url: URL
  try {
    url = new URL(path, PLACEHOLDER)
  } catch {
    throw new Error('apiFetch got a path it cannot read.')
  }
  if (url.origin !== PLACEHOLDER || !url.pathname.startsWith('/api/')) {
    throw new Error('apiFetch only calls this app\'s own routes: use a path that starts with /api/.')
  }
  return url.pathname + url.search
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const target = checkedApiPath(path)
  const token = await accessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  else headers.delete('Authorization')
  return fetch(target, { ...init, headers, credentials: 'same-origin' })
}
