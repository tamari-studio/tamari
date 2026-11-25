// The Proposals routes: deciding takes the role as the database has it now, not the sign-in cache's.
import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'
import type { Catalog } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv, AuthedUser } from './auth'
import type { ProposalRow } from './proposal-flow'
import { memorySpaceAccessStore } from './space-access-testing'
import type { Db } from './supabase'

const catalog: Catalog = { spaces: [{ id: 'acme-1', slug: 'acme', folder: 'acme', previousSlugs: [], position: 0, name: 'Acme', theme: {} }], applets: [] }
const row: ProposalRow = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'change',
  space_id: 'acme-1',
  draft_space_id: 'acme--draft-ab12cd',
  draft_folder: 'acme--draft-ab12cd',
  summary: 'Better home',
  visibility: null,
  author: 'u-mo',
  author_line: 'Mo Member <mo@example.com>',
  status: 'open',
  base_commit: 'a'.repeat(40),
  reviewed_commit: 'b'.repeat(40),
  decided_by: null,
  reason: null,
  created_at: '2026-11-24T10:00:00Z',
  decided_at: null
}
const list = { select: () => list, order: () => list, limit: async () => ({ data: [row], error: null }) }
const userDb = () => ({ from: () => list }) as unknown as Db

function appFor(user: AuthedUser, freshTier: string | null, enabled = true) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', user)
    await next()
  }
  const flow = async () => {
    throw new Error('the flow must not run')
  }
  return createApp({
    catalog,
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    spaceAccessStore: () => memorySpaceAccessStore(),
    proposals: { enabled, flow, currentTier: async () => freshTier, userDb }
  })
}
const admin: AuthedUser = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatarUrl: null, tier: 'admin', status: 'active', token: 'jwt' }
const mo: AuthedUser = { ...admin, id: 'u-mo', email: 'mo@example.com', name: 'Mo', tier: 'member' }
const post = (app: ReturnType<typeof appFor>, path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('deciding needs admin or owner as the database has it now', async () => {
  // Cached as admin, demoted a moment ago.
  const demoted = appFor(admin, 'member')
  for (const action of ['approve', 'reject']) {
    const res = await post(demoted, `/api/proposals/${row.id}/${action}`, { reason: 'x' })
    expect(res.status).toBe(403)
  }
  const member = appFor(mo, 'member')
  expect((await post(member, `/api/proposals/${row.id}/approve`)).status).toBe(403)
})

test('withdrawing needs an active account', async () => {
  expect((await post(appFor(mo, null), `/api/proposals/${row.id}/withdraw`)).status).toBe(403)
})

test('the list maps rows for the page, with the author by name', async () => {
  const res = await appFor(mo, 'member').request('/api/proposals')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([
    expect.objectContaining({ id: row.id, kind: 'change', spaceName: 'Acme', author: 'Mo Member', mine: true, status: 'open', summary: 'Better home' })
  ])
})

test('without a spaces volume there are no proposal routes', async () => {
  expect((await appFor(admin, 'admin', false).request('/api/proposals')).status).toBe(404)
})
