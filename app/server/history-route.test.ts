import { afterEach, expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, MemberTier, SpaceAccessRule } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import {
  checkHistoryQuery,
  readableName,
  useHistoryStoreForTest,
  type ActorRow,
  type HistoryPage,
  type HistoryQuery,
  type HistoryRow,
  type HistoryStore
} from './history'
import { memorySpaceAccessStore } from './space-access-testing'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-finance', slug: 'finance', folder: 'finance', previousSlugs: [], position: 0, name: 'Finance', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: [
    { ref: 'finance/board', folder: 'finance', name: 'board', kind: 'view', file: 'views/board.tsx', title: 'Budget board', requiredEnv: [] },
    { ref: 'finance/payroll', folder: 'finance', name: 'payroll', kind: 'view', file: 'views/payroll.tsx', title: 'Payroll', requiredEnv: [], minTier: 'admin' }
  ]
}

const ANNA = 'a0000000-0000-4000-8000-000000000001'
const BO = 'b0000000-0000-4000-8000-000000000002'
const JOB = 'c0000000-0000-4000-8000-000000000003'

const row = (id: number, over: Partial<HistoryRow>): HistoryRow => ({
  id,
  at: `2026-11-2${id % 10}T10:00:00Z`,
  actor: ANNA,
  source: 'record',
  action: 'update',
  space_id: 'sp-finance',
  collection: 'budget-lines',
  key: 'b1',
  version: id,
  label: null,
  moved_from: null,
  ...over
})

// What the database would hand this person: tests pass only rows their row level security allows,
// except where a test says otherwise.
function appAs(tier: MemberTier, rows: HistoryRow[], rules: SpaceAccessRule[] = []) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const asked: HistoryQuery[] = []
  const askedActors: string[][] = []
  const admin = tier === 'owner' || tier === 'admin'
  const people: ActorRow[] = [
    { user_id: ANNA, name: 'Anna', email: admin ? 'anna@example.com' : null, automatic: false },
    { user_id: BO, name: null, email: admin ? 'bo.berg@example.com' : null, automatic: false },
    { user_id: JOB, name: null, email: null, automatic: true }
  ]
  const store: HistoryStore = {
    rows: async query => {
      asked.push(query)
      return rows
        .filter(r => (query.spaceId === null || r.space_id === query.spaceId) && (query.before === null || r.id < query.before))
        .sort((a, b) => b.id - a.id)
        .slice(0, query.limit)
    },
    actors: async ids => {
      askedActors.push(ids)
      return people.filter(p => ids.includes(p.user_id))
    },
    spaces: async () => [
      { id: 'sp-finance', name: 'Finance' },
      { id: 'sp-kpis', name: 'KPIs' }
    ]
  }
  useHistoryStoreForTest(store)
  const access = memorySpaceAccessStore(rules)
  const app = createApp({ catalog, modules: {}, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => access })
  const get = async (path = '/api/history') => {
    const res = await app.request(path)
    return { status: res.status, text: await res.clone().text(), page: (res.status === 200 ? await res.json() : null) as HistoryPage }
  }
  return { get, asked, askedActors }
}

afterEach(() => useHistoryStoreForTest(null))

test('the feed says who changed what, where, in words a page can show', async () => {
  const { get } = appAs('member', [
    row(1, { action: 'insert', label: 'Budget 2027', version: 1 }),
    row(2, { actor: JOB, collection: 'kpi_snapshots', key: '2026-11-20', space_id: null, version: 4 }),
    row(3, { source: 'tab', action: 'insert', collection: null, version: null, key: 'view:finance/board' }),
    row(4, { source: 'space', action: 'update', collection: null, version: null, key: 'sp-finance', label: 'Finance', moved_from: 'Money' }),
    row(5, { actor: null, action: 'delete', label: 'Old plan' })
  ])
  const { status, page } = await get()
  expect(status).toBe(200)
  expect(page.next).toBeNull()
  expect(page.spaces).toEqual([{ id: 'sp-finance', name: 'Finance' }])
  expect(page.items.map(i => [i.kind, i.action, i.actor.name, i.actor.automatic, i.title, i.collectionTitle, i.space?.name ?? null, i.from])).toEqual([
    ['record', 'delete', null, false, 'Old plan', 'Budget lines', 'Finance', null],
    ['space', 'update', 'Anna', false, 'Finance', null, 'Finance', 'Money'],
    ['tab', 'insert', 'Anna', false, 'Budget board', null, 'Finance', null],
    ['record', 'update', null, true, '2026-11-20', 'Kpi snapshots', null, null],
    ['record', 'insert', 'Anna', false, 'Budget 2027', 'Budget lines', 'Finance', null]
  ])
  expect(page.items[4]).toMatchObject({ id: 1, collection: 'budget-lines', key: 'b1', version: 1 })
})

test('a member never gets an email; an admin gets its first part as a name of last resort', async () => {
  const rows = [row(1, { actor: BO }), row(2, {})]
  const forMember = await appAs('member', rows).get()
  expect(forMember.page.items.map(i => i.actor.name)).toEqual(['Anna', null])
  expect(forMember.text).not.toContain('@')
  expect(forMember.text).not.toContain('bo.berg')

  const forAdmin = await appAs('admin', rows).get()
  expect(forAdmin.page.items.map(i => i.actor.name)).toEqual(['Anna', 'bo.berg'])
  expect(forAdmin.text).not.toContain('@')
})

test('rows of a space or view the caller does not see are left out, even if the database sent them', async () => {
  const rows = [
    row(1, {}),
    row(2, { space_id: 'sp-kpis', label: 'Secret numbers', actor: BO }),
    row(3, { source: 'tab', action: 'insert', collection: null, version: null, key: 'view:finance/payroll' }),
    row(4, { source: 'tab', action: 'update', collection: null, version: null, key: 'view:finance/board', moved_from: 'sp-kpis' })
  ]
  const { get, askedActors } = appAs('member', rows)
  const { page, text } = await get()
  expect(page.items.map(i => i.id)).toEqual([4, 1])
  // The tab came from a space this member doesn't see: its name stays out.
  expect(page.items[0].from).toBeNull()
  expect(text).not.toContain('Secret numbers')
  expect(text).not.toContain('KPIs')
  expect(askedActors).toEqual([[ANNA]])

  const forManager = await appAs('manager', rows).get()
  expect(forManager.page.items.map(i => i.id)).toEqual([4, 2, 1])
  expect(forManager.page.items[0].from).toBe('KPIs')
})

test('one space only, and a space the caller does not see is a 403', async () => {
  const rows = [row(1, {}), row(2, { space_id: null })]
  const forMember = appAs('member', rows)
  const { page } = await forMember.get('/api/history?space=sp-finance')
  expect(page.items.map(i => i.id)).toEqual([1])
  expect(forMember.asked[0].spaceId).toBe('sp-finance')
  expect((await forMember.get('/api/history?space=sp-kpis')).status).toBe(403)
  // A rule from the Space access page counts too.
  const ruled = appAs('member', rows, [{ spaceId: 'sp-finance', tiers: ['admin'] }])
  expect((await ruled.get('/api/history?space=sp-finance')).status).toBe(403)
  expect(ruled.asked).toEqual([])
})

test('pages: next is the id to pass as before', async () => {
  const rows = [1, 2, 3, 4, 5].map(id => row(id, {}))
  const { get, asked } = appAs('member', rows)
  const first = await get('/api/history?limit=2')
  expect(first.page.items.map(i => i.id)).toEqual([5, 4])
  expect(first.page.next).toBe(4)
  const second = await get(`/api/history?limit=2&before=${first.page.next}`)
  expect(second.page.items.map(i => i.id)).toEqual([3, 2])
  const last = await get('/api/history?limit=2&before=2')
  expect(last.page.items.map(i => i.id)).toEqual([1])
  expect(last.page.next).toBeNull()
  expect(asked.map(q => [q.before, q.limit])).toEqual([
    [null, 3],
    [4, 3],
    [2, 3]
  ])
})

test('a query that makes no sense is a 400', async () => {
  const { get } = appAs('member', [])
  expect((await get('/api/history?before=abc')).status).toBe(400)
  expect((await get('/api/history?space=a%20b')).status).toBe(400)
  expect(checkHistoryQuery({ limit: '5000' }).limit).toBe(100)
  expect(checkHistoryQuery({ limit: 'many' }).limit).toBe(50)
  expect(checkHistoryQuery({})).toEqual({ spaceId: null, before: null, limit: 50 })
})

test('collection names read as words', () => {
  expect(readableName('budget-lines')).toBe('Budget lines')
  expect(readableName('kpi_snapshots.2027')).toBe('Kpi snapshots 2027')
  expect(readableName('floorplan')).toBe('Floorplan')
})
