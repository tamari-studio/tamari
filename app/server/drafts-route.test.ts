// The draft gate (drafts.ts) at the route and over MCP: a draft's own server code never runs; a
// module the build found identical to the live space's runs, as the live space.
import { afterAll, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'devalue'
import type { MiddlewareHandler } from 'hono'

import type { Catalog } from '../lib/types'
import * as realConnectors from './connectors'
import * as realDtoSession from './dto-session'

mock.module('./connectors', () => ({ ...realConnectors, connectorEnvForSpace: async () => ({}) }))
mock.module('./dto-session', () => ({ ...realDtoSession, hostedDtoToken: async () => 'brokered-token' }))

const { createApp } = await import('./app')
const { toolContext } = await import('./mcp')
const { NOT_YET } = await import('./drafts')
const { markSameModules } = await import('../build/space-files')
import type { AuthEnv, AuthedUser } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const space = (id: string, folder: string, extra: Partial<Catalog['spaces'][number]> = {}) => ({ id, slug: folder, folder, previousSlugs: [], position: 0, name: folder, theme: {}, ...extra })
const catalog: Catalog = {
  spaces: [
    space('sp-sales', 'sales'),
    // A proposal's draft copy of sales: lib/same is unchanged, lib/changed and lib/new aren't.
    space('sp-sales-draft', 'sales--draft-ab12cd', { draft: true, createdBy: 'u-mo', draftOf: 'sales', sameModules: ['lib/same'] }),
    // A member's brand-new draft space: nothing to compare with.
    space('sp-mine', 'mine', { draft: true, createdBy: 'u-mo', sameModules: [] })
  ],
  applets: []
}
const ran: string[] = []
const fn = (name: string) => async () => ({ go: async () => (ran.push(name), name) })
const modules = {
  'sales/lib/same': fn('sales/lib/same'),
  'sales/lib/changed': fn('sales/lib/changed'),
  'sales--draft-ab12cd/lib/same': fn('DRAFT sales/lib/same'),
  'sales--draft-ab12cd/lib/changed': fn('DRAFT changed'),
  'sales--draft-ab12cd/lib/new': fn('DRAFT new'),
  'mine/lib/data': fn('DRAFT mine')
}
const mo: AuthedUser = { id: 'u-mo', email: 'mo@example.com', name: null, avatarUrl: null, tier: 'member', status: 'active', token: 'jwt' }
const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('user', mo)
  await next()
}
const app = createApp({ catalog, modules, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => memorySpaceAccessStore() })
const rpc = (path: string) => app.request(`/api/rpc/${path}`, { method: 'POST', body: stringify([]) })

test('the route: an unchanged module of a draft runs, as the live space', async () => {
  ran.length = 0
  const res = await rpc('sales--draft-ab12cd/lib/same/go')
  expect(res.status).toBe(200)
  expect(parse(await res.text())).toBe('sales/lib/same')
  expect(ran).toEqual(['sales/lib/same'])
})

test('the route: a changed module, a new module and a new draft space are refused, and nothing runs', async () => {
  ran.length = 0
  for (const path of ['sales--draft-ab12cd/lib/changed/go', 'sales--draft-ab12cd/lib/new/go', 'mine/lib/data/go']) {
    const res = await rpc(path)
    expect(res.status).toBe(403)
    expect(await res.text()).toBe(NOT_YET)
  }
  expect(ran).toEqual([])
})

test('over MCP (callSpace): the same gate', async () => {
  const calls: { folder: string; spaceId: string }[] = []
  const ctx = toolContext(
    {
      catalog,
      modules,
      hiddenOf: async () => ({ folders: new Set(), spaceIds: new Set(), viewRefs: new Set(), widgetRefs: new Set() }),
      requireUser: signedIn,
      toolData: () => ({}) as never,
      callServerFunction: async o => (calls.push({ folder: o.folder, spaceId: o.spaceId }), stringify('ok'))
    },
    mo
  )
  expect(await ctx.callSpace('sales--draft-ab12cd', 'lib/same', 'go', [])).toBe('ok')
  expect(calls).toEqual([{ folder: 'sales', spaceId: 'sp-sales' }])
  for (const [folder, key] of [['sales--draft-ab12cd', 'lib/changed'], ['sales--draft-ab12cd', 'lib/new'], ['mine', 'lib/data']]) {
    await expect(ctx.callSpace(folder!, key!, 'go', [])).rejects.toThrow(NOT_YET)
  }
  expect(calls).toHaveLength(1)
})

const root = mkdtempSync(join(tmpdir(), 'same-modules-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('the build decides which modules are unchanged, by their bytes', () => {
  const put = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  put('workspaces/sales/.miso/lib/same.server.ts', 'export const go = () => 1')
  put('workspaces/sales/.miso/lib/changed.server.ts', 'export const go = () => 1')
  put('workspaces/d/.miso/lib/same.server.ts', 'export const go = () => 1')
  put('workspaces/d/.miso/lib/changed.server.ts', 'export const go = () => 2')
  put('workspaces/d/.miso/lib/new.server.ts', 'export const go = () => 3')
  put('workspaces/m/.miso/lib/data.server.ts', 'export const go = () => 1')
  const built: Catalog = { spaces: [space('s', 'sales'), space('d', 'd', { draft: true, draftOf: 'sales' }), space('m', 'm', { draft: true })], applets: [] }
  markSameModules(root, built)
  expect(built.spaces[1]!.sameModules).toEqual(['lib/same'])
  expect(built.spaces[2]!.sameModules).toEqual([])
  expect(built.spaces[0]!.sameModules).toBeUndefined()
})

// A draft's views and widgets belong in the draft's own space only: placed in a shared space, they
// would run in the browser of every admin who opens it, with no DraftGate first.
const withApplets: Catalog = {
  spaces: catalog.spaces,
  applets: [
    { ref: 'mine/home', folder: 'mine', name: 'home', kind: 'view', title: 'Home' },
    { ref: 'mine/note', folder: 'mine', name: 'note', kind: 'widget', title: 'Note' }
  ] as Catalog['applets']
}
const placing = createApp({ catalog: withApplets, modules, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => memorySpaceAccessStore() })
const send = (method: string, path: string, body: unknown) =>
  placing.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test("a draft's view can't become a tab of another space, even for its author", async () => {
  const res = await send('POST', '/api/spaces/sp-sales/tabs', { ref: 'view:mine/home' })
  expect(res.status).toBe(403)
})

test("a draft's widget can't go on another space's grid, by saving it or moving it there", async () => {
  expect((await send('PUT', '/api/spaces/sp-sales/layout', { widgets: [{ ref: 'mine/note', x: 0, y: 0, w: 2, h: 2 }] })).status).toBe(403)
  expect((await send('POST', '/api/spaces/sp-mine/widgets/move', { ref: 'mine/note', spaceId: 'sp-sales' })).status).toBe(403)
})

test("an admin can't set an access rule on a draft: it is its author's until it is published", async () => {
  const admin: AuthedUser = { ...mo, id: 'u-admin', email: 'admin@example.com', tier: 'admin' }
  const asAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', admin)
    await next()
  }
  const adminApp = createApp({ catalog, modules, commit: null, builtAt: '', requireUser: asAdmin, spaceAccessStore: () => memorySpaceAccessStore() })
  const res = await adminApp.request('/api/space-access/sp-mine', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tiers: ['admin', 'member'] })
  })
  expect(res.status).toBe(403)
})
