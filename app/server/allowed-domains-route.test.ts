import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { MemberTier } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
// PostgREST, as far as these routes reach it.
let requests: { method: string; url: string; body: string | null }[] = []
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  requests = []
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input))
    const method = init?.method ?? 'GET'
    requests.push({ method, url, body: typeof init?.body === 'string' ? init.body : null })
    const body = method === 'POST' ? null : [{ domain: 'acme.com' }]
    return new Response(body === null ? null : JSON.stringify(body), { status: method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch)
})
afterEach(() => {
  fetchSpy.mockRestore()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

function appAs(tier: MemberTier) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  return createApp({ catalog: { spaces: [], applets: [] }, modules: {}, commit: null, builtAt: '', requireUser: signedIn })
}

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const writes = () => requests.filter(r => r.method !== 'GET')

test("members and managers can't add or remove a domain", async () => {
  for (const tier of ['member', 'manager'] as const) {
    const app = appAs(tier)
    expect((await app.request('/api/allowed-domains', json('POST', { domain: 'acme.com' }))).status).toBe(403)
    expect((await app.request('/api/allowed-domains/acme.com', { method: 'DELETE' })).status).toBe(403)
  }
  expect(writes()).toEqual([])
})

test('everyone reads the list', async () => {
  const res = await appAs('member').request('/api/allowed-domains')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(['acme.com'])
})

test('an admin adds a domain, as typed but tidied', async () => {
  const res = await appAs('admin').request('/api/allowed-domains', json('POST', { domain: ' @Acme.COM ' }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ domain: 'acme.com' })
  const [write] = writes()
  expect(write?.url).toContain('/rest/v1/allowed_domains')
  expect(JSON.parse(write?.body ?? 'null')).toEqual({ domain: 'acme.com' })
})

test('a public mail provider is refused before anything reaches Supabase', async () => {
  const res = await appAs('owner').request('/api/allowed-domains', json('POST', { domain: 'gmail.com' }))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toContain('would let anyone in')
  expect(requests).toEqual([])
})

test('an owner removes a domain, a public one listed earlier too', async () => {
  const app = appAs('owner')
  expect((await app.request('/api/allowed-domains/acme.com', { method: 'DELETE' })).status).toBe(200)
  expect((await app.request('/api/allowed-domains/gmail.com', { method: 'DELETE' })).status).toBe(200)
  expect(writes().map(r => r.method)).toEqual(['DELETE', 'DELETE'])
  expect(writes()[1]?.url).toContain('domain=eq.gmail.com')
  expect((await app.request('/api/allowed-domains/nope', { method: 'DELETE' })).status).toBe(400)
})
