import { expect, spyOn, test } from 'bun:test'

import { api, HttpError } from './http'

test('an error that is not JSON keeps its status', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch)
  try {
    const error = await api('/api/me').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(502)
  } finally {
    fetchSpy.mockRestore()
  }
})

test('a server error is told in plain words, not with what broke', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    new Response(JSON.stringify({ error: 'duplicate key value violates unique constraint "connectors_pkey"' }), { status: 500 })) as unknown as typeof fetch)
  const logSpy = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const error = (await api('/api/connectors', { method: 'POST', body: {} }).catch((err: unknown) => err)) as HttpError
    expect(error.status).toBe(500)
    expect(error.message).not.toContain('constraint')
    expect(logSpy).toHaveBeenCalled()
  } finally {
    fetchSpy.mockRestore()
    logSpy.mockRestore()
  }
})

test("a refusal keeps the server's own words", async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    new Response(JSON.stringify({ error: 'Only admins and owners can change connectors.' }), { status: 403 })) as unknown as typeof fetch)
  try {
    const error = (await api('/api/connectors').catch((err: unknown) => err)) as HttpError
    expect(error.message).toBe('Only admins and owners can change connectors.')
  } finally {
    fetchSpy.mockRestore()
  }
})
