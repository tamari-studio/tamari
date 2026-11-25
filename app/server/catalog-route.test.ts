import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const catalog: Catalog = {
  spaces: [
    { id: 'ops', slug: 'ops', folder: 'ops', previousSlugs: [], position: 0, name: 'Ops', theme: {} },
    { id: 'pay', slug: 'pay', folder: 'pay', previousSlugs: [], position: 1, name: 'Payroll', theme: {}, minTier: 'admin' }
  ],
  applets: [
    { ref: 'ops/board', folder: 'ops', name: 'board', kind: 'view', file: 'views/board.tsx', title: 'Board', requiredEnv: [] },
    { ref: 'pay/salaries', folder: 'pay', name: 'salaries', kind: 'view', file: 'views/salaries.tsx', title: 'Salaries', requiredEnv: [] }
  ]
}

const member: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier: 'member', status: 'active', token: 'tok' })
  await next()
}
const app = (requireUser?: MiddlewareHandler<AuthEnv>) =>
  createApp({ catalog, modules: {}, commit: null, builtAt: '', requireUser, spaceAccessStore: () => memorySpaceAccessStore() })

test('the catalog needs sign-in', async () => {
  expect((await app().request('/api/catalog')).status).toBe(401)
})

test('a member gets only the spaces and views they see, and no shared cache keeps it', async () => {
  const res = await app(member).request('/api/catalog')
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('private, no-store')
  const body = (await res.json()) as Catalog
  expect(body.spaces.map(s => s.id)).toEqual(['ops'])
  expect(body.applets.map(a => a.ref)).toEqual(['ops/board'])
})

test('a space a Space access rule closes to members is left out too, and one it opens to a department is in', async () => {
  const rules = [
    { spaceId: 'ops', tiers: ['admin' as const], departments: [], members: [] },
    { spaceId: 'pay', tiers: ['admin' as const], departments: ['d-pay'], members: ['u1'] }
  ]
  const res = await createApp({
    catalog,
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: member,
    spaceAccessStore: () => memorySpaceAccessStore(rules)
  }).request('/api/catalog')
  const body = (await res.json()) as Catalog
  // ops: closed by its rule. pay: its minTier says admin, but the rule reaches u1 (here as one of
  // the people the department rule resolves to).
  expect(body.spaces.map(s => s.id)).toEqual(['pay'])
  expect(body.applets.map(a => a.ref)).toEqual(['pay/salaries'])
})
