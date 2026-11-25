import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, Member, MembersResponse } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import type { MemberRow, MembersStore } from './members'

const catalog: Catalog = { spaces: [], applets: [] }

const as = (id: string): MiddlewareHandler<AuthEnv> => async (c, next) => {
  c.set('user', { id, email: null, name: null, avatarUrl: null, tier: 'member', status: 'active', token: 'tok' })
  await next()
}

function appFor(viewerId: string, rows: MemberRow[]) {
  const written: string[] = []
  const erased: string[] = []
  const store: MembersStore = {
    readRow: async id => rows.find(r => r.user_id === id) ?? null,
    listRows: async () => rows,
    listActivity: async () => new Map([['owner', '2026-10-01T10:00:00Z']]),
    updateRow: async (id, update) => {
      const row = rows.find(r => r.user_id === id)
      if (row) Object.assign(row, update)
      return row ?? null
    },
    eraseRow: async id => {
      if (!rows.some(r => r.user_id === id)) return false
      erased.push(id)
      return true
    },
    recordActivity: async () => {
      written.push(viewerId)
    }
  }
  const app = createApp({ catalog, modules: {}, commit: null, builtAt: '', requireUser: as(viewerId), membersStore: () => store })
  return { app, written, erased }
}

const rows = (): MemberRow[] => [
  { user_id: 'owner', email: 'owner@example.com', display_name: 'Owner', tier: 'owner', status: 'active' },
  { user_id: 'admin', email: 'admin@example.com', display_name: null, tier: 'admin', status: 'active' },
  { user_id: 'newbie', email: 'newbie@example.com', display_name: null, tier: null, status: 'pending' },
  { user_id: 'plain', email: 'plain@example.com', display_name: null, tier: 'member', status: 'active' }
]

const patch = (app: ReturnType<typeof appFor>['app'], id: string, body: unknown) =>
  app.request(`/api/members/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('an owner gets the list with last activity', async () => {
  const { app } = appFor('owner', rows())
  const res = await app.request('/api/members')
  expect(res.status).toBe(200)
  const body = (await res.json()) as MembersResponse
  expect(body.members.find(m => m.id === 'owner')?.lastActiveAt).toBe('2026-10-01T10:00:00Z')
})

test('an admin gets the list and the payload carries no activity at all', async () => {
  const { app } = appFor('admin', rows())
  const res = await app.request('/api/members')
  expect(res.status).toBe(200)
  expect(await res.text()).not.toContain('lastActiveAt')
})

test('an ordinary member is refused with 403', async () => {
  const { app } = appFor('plain', rows())
  expect((await app.request('/api/members')).status).toBe(403)
  expect((await patch(app, 'newbie', { tier: 'member' })).status).toBe(403)
})

test('an admin grants a tier, which also activates a pending person', async () => {
  const { app } = appFor('admin', rows())
  const res = await patch(app, 'newbie', { tier: 'manager' })
  expect(res.status).toBe(200)
  expect(((await res.json()) as Member).status).toBe('active')
})

test('an admin cannot grant owner or edit the owner: 403', async () => {
  const { app } = appFor('admin', rows())
  expect((await patch(app, 'plain', { tier: 'owner' })).status).toBe(403)
  expect((await patch(app, 'owner', { tier: 'member' })).status).toBe(403)
})

test('a malformed change is a 400', async () => {
  const { app } = appFor('admin', rows())
  expect((await patch(app, 'plain', {})).status).toBe(400)
  expect((await patch(app, 'ghost', { tier: 'member' })).status).toBe(400)
})

test('POST /api/activity records for the caller and returns 204', async () => {
  const { app, written } = appFor('plain', rows())
  const res = await app.request('/api/activity', { method: 'POST' })
  expect(res.status).toBe(204)
  expect(written).toEqual(['plain'])
})

const remove = (app: ReturnType<typeof appFor>['app'], id: string) => app.request(`/api/members/${id}`, { method: 'DELETE' })

test('an admin deletes a member', async () => {
  const { app, erased } = appFor('admin', rows())
  const res = await remove(app, 'newbie')
  expect(res.status).toBe(200)
  expect(erased).toEqual(['newbie'])
})

test('deleting yourself, an owner as an admin, or anyone as a member is a 403', async () => {
  const { app, erased } = appFor('admin', rows())
  expect((await remove(app, 'admin')).status).toBe(403)
  expect((await remove(app, 'owner')).status).toBe(403)
  const plain = appFor('plain', rows())
  expect((await remove(plain.app, 'newbie')).status).toBe(403)
  expect([...erased, ...plain.erased]).toEqual([])
})

test('deleting someone who is not there is a 400', async () => {
  const { app } = appFor('admin', rows())
  expect((await remove(app, 'ghost')).status).toBe(400)
})
