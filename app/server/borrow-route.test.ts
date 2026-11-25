import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'
import type { CallerShows } from './borrow'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-ops', slug: 'ops', folder: 'ops', previousSlugs: [], position: 0, name: 'ops', theme: {} },
    { id: 'sp-mgmt', slug: 'management', folder: 'management', previousSlugs: [], position: 1, name: 'management', theme: {} }
  ],
  applets: [
    { ref: 'ops/invites', folder: 'ops', name: 'invites', kind: 'view', file: '', title: 'Invites', requiredEnv: [] }
  ]
}

const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier: 'member', status: 'active', token: 'tok' })
  await next()
}

function appWith(rows: Record<string, CallerShows>) {
  const reads: string[] = []
  const app = createApp({
    catalog,
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    spaceAccessStore: () => memorySpaceAccessStore(),
    readCallerShows: () => async id => {
      reads.push(id)
      return rows[id] ?? null
    }
  })
  const call = (space?: string) =>
    app.request('/api/rpc/ops/lib/dto/loadSnapshot', {
      method: 'POST',
      headers: space ? { 'x-miso-space': space } : {},
      body: ''
    })
  return { reads, call }
}

test('a refused borrow is a 404 tagged x-miso-borrow: refused', async () => {
  const { reads, call } = appWith({ 'sp-mgmt': { tabRefs: ['widgets'], widgetRefs: [] } })
  const res = await call('sp-mgmt')
  expect(res.status).toBe(404)
  expect(res.headers.get('x-miso-borrow')).toBe('refused')
  expect(await res.text()).toBe('Not found')
  expect(reads).toEqual(['sp-mgmt'])
})

test('an own-space call skips the lookup, and a missing module is an untagged 404', async () => {
  const { reads, call } = appWith({})
  for (const res of [await call('sp-ops'), await call()]) {
    expect(res.status).toBe(404)
    expect(res.headers.get('x-miso-borrow')).toBeNull()
    expect(await res.text()).toContain('No server module ops/lib/dto.server.ts')
  }
  expect(reads).toEqual([])
})

test('an allowed borrow passes the gate and reaches the module lookup', async () => {
  const { call } = appWith({ 'sp-mgmt': { tabRefs: ['view:ops/invites'], widgetRefs: [] } })
  const res = await call('sp-mgmt')
  expect(res.status).toBe(404)
  expect(res.headers.get('x-miso-borrow')).toBeNull()
})
