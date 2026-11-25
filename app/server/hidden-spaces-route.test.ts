import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, MemberTier, SpaceAccessRule } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-data', slug: 'data', folder: 'dto', previousSlugs: [], position: 0, name: 'Data', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: []
}

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
// PostgREST, as far as these routes reach it: every tab is on sp-kpis.
let requests: { method: string; url: string }[] = []
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  requests = []
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input))
    const method = init?.method ?? 'GET'
    requests.push({ method, url })
    const row = { id: 't1', space_id: 'sp-kpis', ref: 'widgets', position: 0, params: null }
    const body = url.includes('/rest/v1/records') ? [] : url.includes('/rest/v1/rpc/move_tab') ? row : method === 'DELETE' ? null : [row]
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch)
})
afterEach(() => {
  fetchSpy.mockRestore()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

function appAs(tier: MemberTier, rules: SpaceAccessRule[] = []) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const store = memorySpaceAccessStore(rules)
  return createApp({ catalog, modules: {}, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => store })
}

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const writes = () => requests.filter(r => r.method !== 'GET')

test("a member can't change, close or move a tab on a space they don't see", async () => {
  const app = appAs('member')
  expect((await app.request('/api/tabs/t1', json('PATCH', { params: { q: 1 } }))).status).toBe(403)
  expect((await app.request('/api/tabs/t1', { method: 'DELETE' })).status).toBe(403)
  expect((await app.request('/api/tabs/t1/move', json('POST', { spaceId: 'sp-data' }))).status).toBe(403)
  expect(writes()).toEqual([])
})

test('a manager changes, closes and moves that tab', async () => {
  const app = appAs('manager')
  expect((await app.request('/api/tabs/t1', json('PATCH', { params: { q: 1 } }))).status).toBe(200)
  expect((await app.request('/api/tabs/t1', { method: 'DELETE' })).status).toBe(200)
  expect((await app.request('/api/tabs/t1/move', json('POST', { spaceId: 'sp-data' }))).status).toBe(200)
})

test("shared records of a space the caller doesn't see are left out", async () => {
  expect((await appAs('member').request('/api/records/notes')).status).toBe(200)
  const read = requests.find(r => r.url.includes('/rest/v1/records'))
  expect(read?.url).toContain('or=(space_id.is.null,space_id.not.in.("sp-kpis"))')

  requests = []
  await appAs('manager').request('/api/records/notes')
  expect(requests.find(r => r.url.includes('/rest/v1/records'))?.url).not.toContain('or=')
})

test('a record search is full-text over the records the caller sees, and checks its input', async () => {
  const app = appAs('member')
  const res = await app.request('/api/search/records?q=team%20salaries')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([])
  const read = requests.find(r => r.url.includes('/rest/v1/records'))
  expect(read?.url).toContain('search=wfts(simple).team+salaries')
  expect(read?.url).toContain('or=(space_id.is.null,space_id.not.in.("sp-kpis"))')
  expect(read?.url).toContain('limit=20')
  for (const query of ['', '?q=%20', `?q=${'a'.repeat(201)}`, '?q=x&limit=0', '?q=x&limit=51', '?q=x&limit=2.5']) {
    expect((await app.request(`/api/search/records${query}`)).status).toBe(400)
  }
})

test("an admin can't change the rule of a space admins don't see", async () => {
  const rules = [{ spaceId: 'sp-data', tiers: ['member' as const] }]
  expect((await appAs('admin', rules).request('/api/space-access/sp-data', json('PUT', { tiers: ['admin', 'member'] }))).status).toBe(403)
  expect((await appAs('admin', rules).request('/api/space-access/sp-data', json('PUT', { tiers: null }))).status).toBe(403)
  expect((await appAs('owner', rules).request('/api/space-access/sp-data', json('PUT', { tiers: ['admin', 'member'] }))).status).toBe(200)
})

test("an admin can't take admins off a space", async () => {
  expect((await appAs('admin').request('/api/space-access/sp-kpis', json('PUT', { tiers: ['manager'] }))).status).toBe(403)
  expect((await appAs('owner').request('/api/space-access/sp-kpis', json('PUT', { tiers: ['manager'] }))).status).toBe(200)
})
