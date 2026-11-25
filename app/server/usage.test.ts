import { expect, test } from 'bun:test'

import { hiddenFor } from '../lib/access'
import type { Catalog } from '../lib/types'
import type { UsageReport } from '../lib/usage'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import { checkEvents, checkReportQuery, usageReport, type UsageStore } from './usage'

const catalog: Catalog = {
  spaces: [
    { id: 'open', slug: 'open', name: 'Open', folder: 'open', previousSlugs: [], position: 0, theme: {} },
    { id: 'secret', slug: 'secret', name: 'Secret', folder: 'secret', previousSlugs: [], position: 1, theme: {}, minTier: 'owner' }
  ],
  applets: [
    { ref: 'open/board', folder: 'open', name: 'board', kind: 'view', file: 'views/board.tsx', title: 'Board', requiredEnv: [] },
    { ref: 'secret/plans', folder: 'secret', name: 'plans', kind: 'view', file: 'views/plans.tsx', title: 'Plans', requiredEnv: [] }
  ]
}
const member = { tier: 'member' as const, status: 'active' as const }
const admin = { tier: 'admin' as const, status: 'active' as const }
const owner = { tier: 'owner' as const, status: 'active' as const }
const session = '6f1c2a9e-1b2c-4d3e-8f90-a1b2c3d4e5f6'

const ev = (kind: string, target: string, spaceId: string | null = null, sessionId: string = session) => ({ kind, target, spaceId, sessionId })

test('keeps the events the app knows, in order', () => {
  const rows = checkEvents(
    {
      events: [
        ev('session', 'start'),
        ev('view', 'widgets', 'open'),
        ev('view', 'view:open/board', 'open'),
        ev('view', 'page:members'),
        ev('action', 'tab.open', 'open'),
        ev('action', 'feedback.send')
      ]
    },
    catalog,
    hiddenFor(catalog, member)
  )
  expect(rows).toEqual([
    { session_id: session, kind: 'session', space_id: null, target: 'start' },
    { session_id: session, kind: 'view', space_id: 'open', target: 'widgets' },
    { session_id: session, kind: 'view', space_id: 'open', target: 'view:open/board' },
    { session_id: session, kind: 'view', space_id: null, target: 'page:members' },
    { session_id: session, kind: 'action', space_id: 'open', target: 'tab.open' },
    { session_id: session, kind: 'action', space_id: null, target: 'feedback.send' }
  ])
})

test('drops what it does not know, rather than failing the batch', () => {
  const rows = checkEvents(
    {
      events: [
        ev('search', 'start'),
        ev('session', 'begin'),
        ev('view', 'view:open/nope', 'open'),
        ev('view', 'widgets', 'no-such-space'),
        ev('view', 'page:nowhere'),
        ev('view', 'page:members?q=x'),
        ev('view', 'widgets'),
        ev('action', 'tab.explode'),
        ev('session', 'start', null, 'not-a-uuid'),
        { kind: 'view', target: 42, spaceId: 'open', sessionId: session },
        null,
        'view'
      ]
    },
    catalog,
    hiddenFor(catalog, member)
  )
  expect(rows).toEqual([])
})

test("drops events in spaces and views the person's tier doesn't see", () => {
  const hidden = hiddenFor(catalog, member)
  const rows = checkEvents(
    { events: [ev('view', 'widgets', 'secret'), ev('view', 'view:secret/plans', 'open'), ev('action', 'tab.open', 'secret')] },
    catalog,
    hidden
  )
  expect(rows).toEqual([])
  // An owner sees the secret space, so the same events are kept.
  expect(checkEvents({ events: [ev('view', 'widgets', 'secret')] }, catalog, hiddenFor(catalog, owner))).toHaveLength(1)
})

test('refuses a body that is not a batch, or too big a batch', () => {
  expect(() => checkEvents(null, catalog, hiddenFor(catalog, member))).toThrow(InputError)
  expect(() => checkEvents({ events: 'x' }, catalog, hiddenFor(catalog, member))).toThrow(InputError)
  const many = Array.from({ length: 51 }, () => ev('session', 'start'))
  expect(() => checkEvents({ events: many }, catalog, hiddenFor(catalog, member))).toThrow(InputError)
})

test('reads the window and time zone, with safe defaults', () => {
  expect(checkReportQuery({})).toEqual({ days: 30, tz: 'UTC' })
  expect(checkReportQuery({ days: '7', tz: 'Europe/Copenhagen' })).toEqual({ days: 7, tz: 'Europe/Copenhagen' })
  expect(checkReportQuery({ days: '1000' })).toEqual({ days: 90, tz: 'UTC' })
  expect(checkReportQuery({ days: '0' })).toEqual({ days: 1, tz: 'UTC' })
  expect(checkReportQuery({ days: 'lots' })).toEqual({ days: 30, tz: 'UTC' })
  expect(() => checkReportQuery({ tz: 'Mars/Olympus' })).toThrow(InputError)
  expect(() => checkReportQuery({ tz: "UTC'; drop table x; --" })).toThrow(InputError)
})

const report = (extra: Partial<UsageReport> = {}): UsageReport => ({
  from: '2026-10-15',
  to: '2026-10-21',
  days: 7,
  active: { today: 1, week: 2, month: 2 },
  totals: { users: 2, sessions: 3, events: 9 },
  daily: [],
  weekly: [],
  spaces: [{ spaceId: 'open', name: 'Open', views: 4, users: 2 }],
  tabs: [
    { spaceId: 'open', target: 'view:open/board', views: 3, users: 2 },
    { spaceId: 'open', target: 'view:secret/plans', views: 1, users: 1 }
  ],
  pages: [],
  actions: [],
  members: null,
  ...extra
})

function storeWith(result: UsageReport) {
  const calls: { days: number; tz: string }[] = []
  const store: UsageStore = {
    insert: async () => {},
    report: async (days, tz) => {
      calls.push({ days, tz })
      return result
    }
  }
  return { store, calls }
}

test('only admins and owners read the report', async () => {
  const { store, calls } = storeWith(report())
  await expect(usageReport(store, member, hiddenFor(catalog, member), {})).rejects.toBeInstanceOf(ForbiddenError)
  await expect(usageReport(store, { tier: 'admin', status: 'suspended' }, hiddenFor(catalog, member), {})).rejects.toBeInstanceOf(
    ForbiddenError
  )
  expect(calls).toEqual([])
})

test("leaves out views the admin's tier doesn't see, even on a space they do see", async () => {
  const { store, calls } = storeWith(report())
  const result = await usageReport(store, admin, hiddenFor(catalog, admin), { days: '7', tz: 'Europe/Copenhagen' })
  expect(calls).toEqual([{ days: 7, tz: 'Europe/Copenhagen' }])
  expect(result.tabs.map(t => t.target)).toEqual(['view:open/board'])
  const forOwner = await usageReport(store, owner, hiddenFor(catalog, owner), {})
  expect(forOwner.tabs).toHaveLength(2)
})
