import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, MemberTier, SpaceAccessRule } from '../lib/types'
import type { UsageReport } from '../lib/usage'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'
import type { UsageRow, UsageStore } from './usage'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-open', slug: 'open', folder: 'open', previousSlugs: [], position: 0, name: 'Open', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: [{ ref: 'open/board', folder: 'open', name: 'board', kind: 'view', file: 'views/board.tsx', title: 'Board', requiredEnv: [] }]
}
const session = '6f1c2a9e-1b2c-4d3e-8f90-a1b2c3d4e5f6'

const emptyReport: UsageReport = {
  from: '2026-09-22',
  to: '2026-10-21',
  days: 30,
  active: { today: 0, week: 0, month: 0 },
  totals: { users: 0, sessions: 0, events: 0 },
  daily: [],
  weekly: [],
  spaces: [],
  tabs: [],
  pages: [],
  actions: [],
  members: null
}

function appAs(tier: MemberTier, rules: SpaceAccessRule[] = []) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const inserted: UsageRow[][] = []
  const reports: { days: number; tz: string }[] = []
  const usage: UsageStore = {
    insert: async rows => void inserted.push(rows),
    report: async (days, tz) => {
      reports.push({ days, tz })
      return emptyReport
    }
  }
  const access = memorySpaceAccessStore(rules)
  const app = createApp({
    catalog,
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    spaceAccessStore: () => access,
    usageStore: () => usage
  })
  return { app, inserted, reports }
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('stores the events it knows and drops the rest', async () => {
  const { app, inserted } = appAs('member')
  const res = await app.request(
    '/api/usage',
    post({
      events: [
        { kind: 'view', target: 'view:open/board', spaceId: 'sp-open', sessionId: session },
        { kind: 'view', target: 'widgets', spaceId: 'sp-kpis', sessionId: session },
        { kind: 'view', target: 'page:who-knows', spaceId: null, sessionId: session }
      ]
    })
  )
  expect(res.status).toBe(204)
  expect(inserted).toEqual([[{ session_id: session, kind: 'view', space_id: 'sp-open', target: 'view:open/board' }]])
})

test('a space rule from the Space access page counts too', async () => {
  const { app, inserted } = appAs('member', [{ spaceId: 'sp-open', tiers: ['admin'] }])
  const res = await app.request('/api/usage', post({ events: [{ kind: 'view', target: 'widgets', spaceId: 'sp-open', sessionId: session }] }))
  expect(res.status).toBe(204)
  expect(inserted).toEqual([])
})

test('a body that is not a batch is a 400', async () => {
  const { app } = appAs('member')
  expect((await app.request('/api/usage', post({ nope: true }))).status).toBe(400)
  expect((await app.request('/api/usage', { method: 'POST', body: 'not json' })).status).toBe(400)
})

test('members get a 403 for the report; admins get it for their time zone', async () => {
  const forMember = appAs('member')
  expect((await forMember.app.request('/api/usage/report')).status).toBe(403)
  expect(forMember.reports).toEqual([])

  const forAdmin = appAs('admin')
  const res = await forAdmin.app.request('/api/usage/report?days=7&tz=Europe/Copenhagen')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(emptyReport)
  expect(forAdmin.reports).toEqual([{ days: 7, tz: 'Europe/Copenhagen' }])
  expect((await forAdmin.app.request('/api/usage/report?tz=Nowhere/Land')).status).toBe(400)
})
