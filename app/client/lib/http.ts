import { accessToken } from '../runtime/session'

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    // A proxy's HTML error page: keep its status, so a 401 still signs out.
    if (res.ok) throw err
  }
  if (!res.ok) {
    const detail = (data as { error?: string } | null)?.error
    // 4xx messages are written for the person. A 5xx carries whatever broke (a database error, a
    // proxy page): that goes to the console, and the person gets something they can act on.
    if (res.status >= 500) {
      console.error(`${init.method ?? 'GET'} ${path} failed (${res.status})`, detail ?? text.slice(0, 500))
      throw new HttpError("Something went wrong on our side. Try again in a moment, and tell us through Feedback if it keeps happening.", res.status)
    }
    throw new HttpError(detail ?? `That didn't work (error ${res.status}). Try again.`, res.status)
  }
  return data as T
}

// Static build files (the manifest): public, cached by the CDN per deploy.
export async function staticJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-cache' })
  if (!res.ok) throw new HttpError(`Couldn't load ${path} (${res.status})`, res.status)
  return (await res.json()) as T
}
