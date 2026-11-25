import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { apiFetch, checkedApiPath } from './api-fetch'
import { setSupabase } from './session'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

const signedIn = (token: string | null) =>
  setSupabase({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } } as unknown as SupabaseClient)

beforeEach(() => {
  sent = []
  signedIn('member-token')
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response('{"ok":true}')
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test('calls the API with the member token, like server function calls do', async () => {
  const res = await apiFetch('/api/gmail/status?x=1', { method: 'POST', body: 'b', headers: { 'Content-Type': 'application/json' } })
  expect(await res.json()).toEqual({ ok: true })
  expect(sent).toHaveLength(1)
  expect(sent[0]!.url).toBe('/api/gmail/status?x=1')
  const headers = new Headers(sent[0]!.init.headers)
  expect(headers.get('authorization')).toBe('Bearer member-token')
  expect(headers.get('content-type')).toBe('application/json')
  expect(sent[0]!.init.method).toBe('POST')
  expect(sent[0]!.init.body).toBe('b')
})

test('a caller-supplied Authorization header never replaces the member token', async () => {
  await apiFetch('/api/me', { headers: { Authorization: 'Bearer someone-else' } })
  expect(new Headers(sent[0]!.init.headers).get('authorization')).toBe('Bearer member-token')
})

test('signed out: no Authorization header is sent at all', async () => {
  signedIn(null)
  await apiFetch('/api/config', { headers: { Authorization: 'Bearer stale' } })
  expect(new Headers(sent[0]!.init.headers).has('authorization')).toBe(false)
})

test('refuses anything that is not a path under /api/ of this origin, and never calls fetch', async () => {
  const bad = [
    'https://evil.example/api/x',
    '//evil.example/api/x',
    '/\\evil.example/api/x',
    'api/me',
    '/me',
    '/apix/me',
    '/api',
    '/api/../secret',
    '/api/%2e%2e/secret',
    '/api/%2E%2E/secret',
    'http://localhost/api/me',
    '',
    undefined,
    42
  ]
  for (const path of bad) {
    await expect(apiFetch(path as string)).rejects.toThrow(/apiFetch/)
  }
  expect(sent).toHaveLength(0)
})

test('checkedApiPath keeps encoded segments and the query', () => {
  expect(checkedApiPath('/api/files/ops/a%20b.png?x=1&y=2')).toBe('/api/files/ops/a%20b.png?x=1&y=2')
})

test('control characters, unicode tricks and odd separators never leave this origin', async () => {
  const bad = [
    '/api/\t/../x',
    '/api/..\t/x',
    '/api/.\n./x',
    '/api/%2e%2e/%2e%2e/x',
    '/api/.%2e/x',
    '/api/%2e./x',
    '/api/‥/x', // two-dot leader: not a dot segment, but must not be treated as one either way
    '\t//evil.example/api/x',
    '\n/api/x',
    ' /api/x',
    '/API/x',
    '/api\\..\\x',
    '/api/x\\..\\..\\y'
  ]
  const accepted: string[] = []
  for (const path of bad) {
    try {
      accepted.push(checkedApiPath(path))
    } catch {
      /* refused */
    }
  }
  // Whatever is accepted must still be a plain path under /api/ (never another origin or a path outside /api/).
  for (const target of accepted) {
    expect(target.startsWith('/api/')).toBe(true)
    expect(target.startsWith('//')).toBe(false)
  }
  for (const path of ['/api/..\t/x', '/api/.\n./x', '/api/%2e%2e/%2e%2e/x', '/api/.%2e/x', '/api/%2e./x', '\t//evil.example/api/x', '\n/api/x', ' /api/x', '/API/x', '/api\\..\\x', '/api/x\\..\\..\\y']) {
    await expect(apiFetch(path)).rejects.toThrow(/apiFetch/)
  }
  expect(sent).toHaveLength(0)
  // A tab is dropped by the URL parser before dot segments resolve, so this one stays inside /api/.
  expect(checkedApiPath('/api/\t/../x')).toBe('/api/x')
})

test('a redirect-capable init cannot smuggle the token elsewhere: the target is always the checked path', async () => {
  await apiFetch('/api/me', { headers: { Host: 'evil.example', Origin: 'https://evil.example' }, referrer: 'https://evil.example/' })
  expect(sent[0]!.url).toBe('/api/me')
  expect(sent[0]!.init.credentials).toBe('same-origin')
})
