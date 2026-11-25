import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, MemberTier, SpaceAccessResponse, SpaceAccessRule } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-data', slug: 'data', folder: 'dto', previousSlugs: [], position: 0, name: 'Data', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' },
    { id: 'sp-board', slug: 'board', folder: 'board', previousSlugs: [], position: 2, name: 'Board', theme: {}, minTier: 'owner' }
  ],
  applets: [
    { ref: 'management/kpi-flow', folder: 'management', name: 'kpi-flow', kind: 'view', file: '', title: 'KPI flow', requiredEnv: [] }
  ]
}

function appAs(tier: MemberTier, rules: SpaceAccessRule[] = [], status: 'active' | 'suspended' = 'active') {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status, token: 'tok' })
    await next()
  }
  const store = memorySpaceAccessStore(rules)
  return createApp({
    catalog,
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    readCallerShows: () => async () => null,
    spaceAccessStore: () => store
  })
}

const rpc = (app: ReturnType<typeof appAs>, folder: string, space?: string) =>
  app.request(`/api/rpc/${folder}/views/kpi-flow.server/load`, {
    method: 'POST',
    headers: space ? { 'x-miso-space': space } : {},
    body: '[]'
  })

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test("a member can't run a manager space's server functions", async () => {
  const res = await rpc(appAs('member'), 'management')
  expect(res.status).toBe(403)
})

test("a member can't borrow a manager space's connectors", async () => {
  const res = await rpc(appAs('member'), 'dto', 'sp-kpis')
  expect(res.status).toBe(403)
})

test('a manager gets past the tier check', async () => {
  // No such module in this test build: past the gate, the call is a 404.
  const res = await rpc(appAs('manager'), 'management')
  expect(res.status).toBe(404)
})

test("a member can't change a manager space or open its views elsewhere", async () => {
  const app = appAs('member')
  expect((await app.request('/api/spaces/sp-kpis', json('PATCH', { name: 'x' }))).status).toBe(403)
  expect((await app.request('/api/spaces/sp-kpis/layout', json('PUT', { widgets: [] }))).status).toBe(403)
  expect((await app.request('/api/spaces/sp-data/tabs', json('POST', { ref: 'view:management/kpi-flow' }))).status).toBe(403)
})

// --- Rules from the Space access page ---------------------------------------------

test('a rule hides a space spaces.json shows to everyone', async () => {
  const rules = [{ spaceId: 'sp-data', tiers: ['admin' as const] }]
  expect((await rpc(appAs('member', rules), 'dto')).status).toBe(403)
  expect((await rpc(appAs('manager', rules), 'dto')).status).toBe(403)
  expect((await rpc(appAs('admin', rules), 'dto')).status).toBe(404)
})

test('a rule opens a manager space to members', async () => {
  const res = await rpc(appAs('member', [{ spaceId: 'sp-kpis', tiers: ['member'] }]), 'management')
  expect(res.status).toBe(404)
})

test('owners see every space, even one a rule gives to nobody', async () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: [] }]
  expect((await rpc(appAs('owner', rules), 'management')).status).toBe(404)
  expect((await rpc(appAs('admin', rules), 'management')).status).toBe(403)
})

test('a suspended person matches no rule', async () => {
  expect((await rpc(appAs('manager', [{ spaceId: 'sp-kpis', tiers: ['manager'] }], 'suspended'), 'management')).status).toBe(403)
})

test('everyone reads the rules', async () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: ['member' as const] }]
  const res = await appAs('member', rules).request('/api/space-access')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(rules)
})

test('only admins and owners get the Space access page or change it', async () => {
  for (const tier of ['member', 'manager'] as const) {
    const app = appAs(tier)
    expect((await app.request('/api/space-access/spaces')).status).toBe(403)
    expect((await app.request('/api/space-access/sp-kpis', json('PUT', { tiers: ['member'] }))).status).toBe(403)
  }
  expect((await appAs('admin', [], 'suspended').request('/api/space-access/sp-kpis', json('PUT', { tiers: [] }))).status).toBe(403)
})

test('an admin sets a rule, which applies at once, and resets it', async () => {
  const rules: SpaceAccessRule[] = []
  const admin = appAs('admin', rules)
  const set = await admin.request('/api/space-access/sp-kpis', json('PUT', { tiers: ['member', 'owner', 'admin'] }))
  expect(set.status).toBe(200)
  expect(rules).toEqual([{ spaceId: 'sp-kpis', tiers: ['admin', 'member'], departments: [], people: [], members: [] }])
  expect((await admin.request('/api/space-access/sp-kpis', json('PUT', { tiers: null }))).status).toBe(200)
  expect(rules).toEqual([])
})

test('a rule naming someone lets them in, whatever their tier', async () => {
  // appAs signs in as u1.
  const rules = [{ spaceId: 'sp-kpis', tiers: [], members: ['u1'] }]
  expect((await rpc(appAs('member', rules), 'management')).status).toBe(404)
  expect((await rpc(appAs('member', [{ spaceId: 'sp-kpis', tiers: [], members: ['u2'] }]), 'management')).status).toBe(403)
  expect((await rpc(appAs('member', rules, 'suspended'), 'management')).status).toBe(403)
})

test('an owner sets departments and people on a rule', async () => {
  const rules: SpaceAccessRule[] = []
  const person = '22222222-2222-4222-8222-222222222222'
  const body = { tiers: [], departments: ['11111111-1111-4111-8111-111111111111'], people: [person] }
  expect((await appAs('owner', rules).request('/api/space-access/sp-kpis', json('PUT', body))).status).toBe(200)
  expect(rules).toEqual([{ spaceId: 'sp-kpis', ...body, members: [person] }])
})

test('an unknown tier or a missing list is a 400', async () => {
  const admin = appAs('admin')
  expect((await admin.request('/api/space-access/sp-kpis', json('PUT', { tiers: ['boss'] }))).status).toBe(400)
  expect((await admin.request('/api/space-access/sp-kpis', json('PUT', {}))).status).toBe(400)
  expect((await admin.request('/api/space-access/sp-kpis', json('PUT', { tiers: 'member' }))).status).toBe(400)
})

test("an admin can't open an owners-only space; an owner can", async () => {
  expect((await appAs('admin').request('/api/space-access/sp-board', json('PUT', { tiers: ['admin'] }))).status).toBe(403)
  expect((await appAs('owner').request('/api/space-access/sp-board', json('PUT', { tiers: ['admin'] }))).status).toBe(200)
})
