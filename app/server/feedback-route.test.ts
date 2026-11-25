import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, FeedbackItem, MemberStatus, MemberTier } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import type { FeedbackRow, FeedbackStore } from './feedback'

const catalog: Catalog = { spaces: [], applets: [] }

const as =
  (id: string, tier: MemberTier | null, status: MemberStatus | null = 'active'): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    c.set('user', { id, email: `${id}@example.com`, name: null, avatarUrl: null, tier, status, token: 'tok' })
    await next()
  }

// A stand-in for miso.feedback that stamps the sender the way the database does.
function appFor(id: string, tier: MemberTier | null, status: MemberStatus | null = 'active', rows: FeedbackRow[] = []) {
  const inserted: unknown[] = []
  const store: FeedbackStore = {
    insert: async input => {
      inserted.push(input)
      const row: FeedbackRow = {
        id: rows.length + 1,
        ...input,
        submitted_by: id,
        submitter_email: `${id}@example.com`,
        submitter_name: null,
        created_at: '2026-10-03T12:00:00Z',
        completed_at: null,
        completed_by_email: null
      }
      rows.push(row)
      return row
    },
    listOwn: async userId => rows.filter(r => r.submitted_by === userId),
    listAll: async () => rows,
    setCompleted: async (issue, completed) => {
      const row = rows.find(r => r.id === issue)
      if (!row) return null
      row.completed_at = completed ? '2026-10-03T13:00:00Z' : null
      row.completed_by_email = completed ? `${id}@example.com` : null
      return row
    }
  }
  const app = createApp({ catalog, modules: {}, commit: null, builtAt: '', requireUser: as(id, tier, status), feedbackStore: () => store })
  return { app, rows, inserted }
}

const row = (id: number, by: string, extra: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id,
  title: `Issue ${id}`,
  description: 'Details',
  priority: 'medium',
  page: '/health',
  submitted_by: by,
  submitter_email: `${by}@example.com`,
  submitter_name: null,
  created_at: '2026-10-01T10:00:00Z',
  completed_at: null,
  completed_by_email: null,
  ...extra
})

const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = (app: ReturnType<typeof appFor>['app'], body: unknown) => app.request('/api/feedback', { method: 'POST', ...json(body) })
const patch = (app: ReturnType<typeof appFor>['app'], id: string | number, body: unknown) =>
  app.request(`/api/feedback/${id}`, { method: 'PATCH', ...json(body) })

test('anyone signed in sends feedback, a newcomer without a tier included', async () => {
  const { app, inserted } = appFor('newbie', null, 'pending')
  const res = await post(app, { title: '  Slow tab  ', description: 'The KPIs tab takes 10s.', priority: 'urgent', page: '/kpis' })
  expect(res.status).toBe(201)
  const item = (await res.json()) as FeedbackItem
  expect(item.submitterEmail).toBe('newbie@example.com')
  expect(inserted).toEqual([{ title: 'Slow tab', description: 'The KPIs tab takes 10s.', priority: 'urgent', page: '/kpis' }])
})

test('only title, description, priority and page reach the database; identity never comes from the browser', async () => {
  const { app, inserted } = appFor('plain', 'member')
  await post(app, { title: 'x', description: 'y', priority: 'low', submitted_by: 'owner', submitterEmail: 'owner@example.com', completed_at: 'now' })
  expect(inserted).toEqual([{ title: 'x', description: 'y', priority: 'low', page: null }])
})

test('a page that is not an app path is dropped', async () => {
  const { app, inserted } = appFor('plain', 'member')
  await post(app, { title: 'x', description: 'y', priority: 'low', page: 'https://elsewhere.example/' })
  expect((inserted[0] as { page: unknown }).page).toBeNull()
})

test('title, description and a known priority are required: 400', async () => {
  const { app, inserted } = appFor('plain', 'member')
  for (const body of [
    { description: 'y', priority: 'low' },
    { title: '   ', description: 'y', priority: 'low' },
    { title: 'x', priority: 'low' },
    { title: 'x', description: '  ', priority: 'low' },
    { title: 'x', description: 'y' },
    { title: 'x', description: 'y', priority: 'critical' },
    { title: 'x'.repeat(201), description: 'y', priority: 'low' },
    null
  ]) {
    expect((await post(app, body)).status).toBe(400)
  }
  expect((await app.request('/api/feedback', { method: 'POST', body: 'not json' })).status).toBe(400)
  expect(inserted).toEqual([])
})

test('a member reads back only their own feedback, with its status', async () => {
  const { app } = appFor('plain', 'member', 'active', [row(1, 'plain', { completed_at: '2026-10-02T09:00:00Z' }), row(2, 'other')])
  const res = await app.request('/api/feedback/mine')
  expect(res.status).toBe(200)
  const items = (await res.json()) as FeedbackItem[]
  expect(items.map(i => [i.id, i.completedAt])).toEqual([[1, '2026-10-02T09:00:00Z']])
})

test('members and managers are refused the issue list and the tick: 403', async () => {
  for (const tier of ['member', 'manager'] as const) {
    const { app, rows } = appFor('someone', tier, 'active', [row(1, 'someone')])
    expect((await app.request('/api/feedback')).status).toBe(403)
    expect((await patch(app, 1, { completed: true })).status).toBe(403)
    expect(rows[0]!.completed_at).toBeNull()
  }
})

test('a suspended admin is refused too: a tier only counts while active', async () => {
  const { app } = appFor('was-admin', 'admin', 'suspended', [row(1, 'x')])
  expect((await app.request('/api/feedback')).status).toBe(403)
  expect((await patch(app, 1, { completed: true })).status).toBe(403)
})

test('admins and owners read every issue', async () => {
  for (const tier of ['admin', 'owner'] as const) {
    const { app } = appFor('boss', tier, 'active', [row(1, 'a'), row(2, 'b')])
    const res = await app.request('/api/feedback')
    expect(res.status).toBe(200)
    expect(((await res.json()) as FeedbackItem[]).map(i => i.id)).toEqual([1, 2])
  }
})

test('an admin ticks an issue completed and unticks it back', async () => {
  const { app } = appFor('admin', 'admin', 'active', [row(7, 'plain')])
  const done = (await (await patch(app, 7, { completed: true })).json()) as FeedbackItem
  expect(done.completedAt).not.toBeNull()
  expect(done.completedByEmail).toBe('admin@example.com')
  const back = (await (await patch(app, 7, { completed: false })).json()) as FeedbackItem
  expect(back.completedAt).toBeNull()
  expect(back.completedByEmail).toBeNull()
})

test('a malformed tick or an unknown issue is a 400', async () => {
  const { app } = appFor('owner', 'owner', 'active', [row(1, 'plain')])
  expect((await patch(app, 1, { completed: 'yes' })).status).toBe(400)
  expect((await patch(app, 1, {})).status).toBe(400)
  expect((await patch(app, 'abc', { completed: true })).status).toBe(400)
  expect((await patch(app, 99, { completed: true })).status).toBe(400)
})
