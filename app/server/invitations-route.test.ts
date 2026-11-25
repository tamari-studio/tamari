import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { MemberTier } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
const ROW = { id: '3f2c1a9e-1b2c-4d5e-8f90-0123456789ab', email: 'jane@elsewhere.com', tier: 'manager', created_at: '2026-11-23T10:00:00Z', expires_at: '2026-12-07T10:00:00Z' }
// PostgREST, as far as these routes reach it. An app_user read finds an account for taken@acme.com only.
let requests: { method: string; url: string; body: string | null }[] = []
let revoked: unknown[] = []
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  requests = []
  revoked = [{ id: ROW.id }]
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input))
    const method = init?.method ?? 'GET'
    requests.push({ method, url, body: typeof init?.body === 'string' ? init.body : null })
    let body: unknown = [ROW]
    if (url.includes('/app_user')) body = url.includes('taken@acme.com') ? [{ user_id: 'u9' }] : []
    else if (method === 'PATCH') body = revoked
    else if (method === 'POST') body = ROW
    return new Response(JSON.stringify(body), { status: method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } })
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

test("members and managers can't list, invite or revoke", async () => {
  for (const tier of ['member', 'manager'] as const) {
    const app = appAs(tier)
    expect((await app.request('/api/invitations')).status).toBe(403)
    expect((await app.request('/api/invitations', json('POST', { email: 'a@b.com', tier: 'member' }))).status).toBe(403)
    expect((await app.request(`/api/invitations/${ROW.id}`, { method: 'DELETE' })).status).toBe(403)
  }
  expect(requests).toEqual([])
})

test('an admin lists the open invites only', async () => {
  const res = await appAs('admin').request('/api/invitations')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([{ id: ROW.id, email: ROW.email, tier: 'manager', createdAt: ROW.created_at, expiresAt: ROW.expires_at }])
  const url = requests[0]?.url ?? ''
  expect(url).toContain('accepted_at=is.null')
  expect(url).toContain('revoked_at=is.null')
  expect(url).toContain('expires_at=gt.')
})

test('an admin invites: the old invite for the address is revoked, then a new one made', async () => {
  const res = await appAs('admin').request('/api/invitations', json('POST', { email: ' Jane@Elsewhere.com ', tier: 'manager' }))
  expect(res.status).toBe(201)
  expect((await res.json()).email).toBe('jane@elsewhere.com')
  const [revoke, insert] = writes()
  expect(revoke?.method).toBe('PATCH')
  expect(revoke?.url).toContain('email=eq.jane@elsewhere.com')
  expect(Object.keys(JSON.parse(revoke?.body ?? '{}'))).toEqual(['revoked_at'])
  expect(insert?.method).toBe('POST')
  expect(JSON.parse(insert?.body ?? 'null')).toEqual({ email: 'jane@elsewhere.com', tier: 'manager' })
})

test('the account check matches an underscore literally', async () => {
  await appAs('admin').request('/api/invitations', json('POST', { email: 'jane_doe@acme.com', tier: 'member' }))
  expect(requests[0]?.url).toContain('email=ilike.jane\\_doe@acme.com')
})

test('an address that already has an account is refused before anything is written', async () => {
  const res = await appAs('owner').request('/api/invitations', json('POST', { email: 'taken@acme.com', tier: 'member' }))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toContain('already has an account')
  expect(writes()).toEqual([])
})

test('an admin cannot invite an owner; an owner can', async () => {
  const refused = await appAs('admin').request('/api/invitations', json('POST', { email: 'boss@acme.com', tier: 'owner' }))
  expect(refused.status).toBe(400)
  expect(requests).toEqual([])
  expect((await appAs('owner').request('/api/invitations', json('POST', { email: 'boss@acme.com', tier: 'owner' }))).status).toBe(201)
})

test('an admin revokes an open invite; a used or revoked one is a 404', async () => {
  const app = appAs('admin')
  expect((await app.request(`/api/invitations/${ROW.id}`, { method: 'DELETE' })).status).toBe(200)
  expect(writes()[0]?.url).toContain(`id=eq.${ROW.id}`)
  revoked = []
  expect((await app.request(`/api/invitations/${ROW.id}`, { method: 'DELETE' })).status).toBe(404)
  expect((await app.request('/api/invitations/nope', { method: 'DELETE' })).status).toBe(400)
})
