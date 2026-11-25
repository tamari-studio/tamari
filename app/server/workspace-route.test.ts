import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Catalog, Workspace } from '../lib/types'
import { createApp, SERVER_ERROR } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'
import { MISO_VAULT_EMAIL, resetVaultClientForTest } from './supabase'

const catalog: Catalog = {
  spaces: [{ id: 'ops', slug: 'operations', folder: 'ops', previousSlugs: ['ops'], position: 0, name: 'Ops', theme: {}, minTier: 'manager' }],
  applets: []
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
let calls: { method: string; url: string; body: string; prefer: string | null }[] = []
// The ids sync_spaces reports as new rows.
let inserted: string[] = []
const MANUAL = 'space-0123456789abcdef0123456789abcdef'
let tabUpdate: Response | null = null
let subspaceDelete: Response | null = null
let editSpace: Response | null = null
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
  calls = []
  inserted = []
  tabUpdate = null
  subspaceDelete = null
  editSpace = null
  // Supabase as these routes reach it: the database still holds `gone`, a space spaces.json dropped.
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input))
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: String(init?.body ?? ''), prefer: new Headers(init?.headers).get('prefer') })
    if (url.includes('/auth/v1/admin/generate_link')) return json({ id: 'u-vault', email: MISO_VAULT_EMAIL, hashed_token: 'h', verification_type: 'magiclink' })
    if (url.includes('/auth/v1/verify')) {
      return json({ access_token: 'vault-token', refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 'u-vault' } })
    }
    if (url.includes('/rest/v1/rpc/sync_spaces')) return json(inserted)
    if (url.includes('/rest/v1/rpc/create_subspace')) {
      return json({ id: 'sub-1', slug: 'operations-hiring', name: 'Hiring', folder: null, previous_slugs: [], position: 0, theme: {}, icon: null, parent_id: 'ops' })
    }
    if (url.includes('/rest/v1/rpc/create_space')) {
      const { p_name, p_symbol } = JSON.parse(String(init?.body))
      return json({ id: MANUAL, slug: 'design', name: p_name, folder: null, previous_slugs: [], position: 1, theme: {}, icon: null, symbol: p_symbol, parent_id: null })
    }
    if (url.includes('/rest/v1/rpc/delete_subspace')) return subspaceDelete ?? json(null)
    if (url.includes('/rest/v1/rpc/edit_space')) {
      if (editSpace) return editSpace
      const { p_name, p_symbol } = JSON.parse(String(init?.body))
      return json({ id: 'ops', slug: 'operations', name: p_name ?? 'Ops', folder: 'ops', previous_slugs: [], position: 0, theme: {}, icon: null, symbol: p_symbol || null })
    }
    if (url.includes('/rest/v1/org_settings')) {
      const sent = method === 'PATCH' ? JSON.parse(String(init?.body)) : {}
      return json({ theme: sent.theme ?? { font: 'geometric' }, name: sent.name ?? null })
    }
    if (url.includes('/rest/v1/spaces')) {
      return json([
        { id: 'ops', slug: 'operations', name: 'Ops', folder: 'ops', previous_slugs: ['ops'], position: 0, theme: {}, icon: null },
        { id: 'gone', slug: 'gone', name: 'Gone', folder: 'gone', previous_slugs: [], position: 1, theme: {}, icon: null },
        { id: 'sub-1', slug: 'operations-hiring', name: 'Hiring', folder: null, previous_slugs: [], position: 0, theme: {}, icon: null, parent_id: 'ops' },
        { id: MANUAL, slug: 'design', name: 'Design', folder: null, previous_slugs: [], position: 2, theme: {}, icon: null, parent_id: null },
        { id: 'sub-2', slug: 'gone-x', name: 'X', folder: null, previous_slugs: [], position: 0, theme: {}, icon: null, parent_id: 'gone' }
      ])
    }
    if (url.includes('/rest/v1/tabs') && method === 'PATCH') return tabUpdate ?? json([])
    if (url.includes('/rest/v1/tabs')) {
      return json([
        { id: 't1', space_id: 'ops', ref: 'widgets', position: 0, params: null },
        { id: 't2', space_id: 'gone', ref: 'widgets', position: 0, params: null }
      ])
    }
    if (url.includes('/rest/v1/space_layouts')) return json([{ space_id: 'gone', widgets: [], active_tab: null }])
    return json([])
  }) as typeof fetch)
})
afterEach(() => {
  fetchSpy.mockRestore()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  resetVaultClientForTest()
})

function app(tier: 'owner' | 'admin' | 'member' = 'owner', cat: Catalog = catalog) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const store = memorySpaceAccessStore()
  return createApp({ catalog: cat, modules: {}, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => store })
}

test('the vault account syncs spaces.json, minTier included, and dropped spaces stay out of the workspace', async () => {
  const res = await app().request('/api/workspace')
  expect(res.status).toBe(200)
  const workspace = (await res.json()) as Workspace
  // A subspace stays with its parent; one under a dropped space goes with it.
  // So does a space an admin added on Settings, which has no folder.
  expect(workspace.spaces.map(s => s.id)).toEqual(['ops', 'sub-1', MANUAL])
  expect(workspace.spaces[1].parentId).toBe('ops')
  expect(workspace.tabs.map(t => t.id)).toEqual(['t1'])
  expect(workspace.layouts).toEqual([])

  const sync = calls.find(c => c.url.includes('/rest/v1/rpc/sync_spaces'))
  expect(JSON.parse(sync!.body)).toEqual({
    p_spaces: [{ id: 'ops', slug: 'operations', name: 'Ops', folder: 'ops', previous_slugs: ['ops'], position: 0, theme: {}, icon: null, min_tier: 'manager', draft: false, created_by: null, parent_id: null }]
  })
})

test('a new space with widgets opens on a grid with exactly its own widgets, and a layout already there stays', async () => {
  const applet = (folder: string, name: string, kind: 'view' | 'widget') => ({ ref: `${folder}/${name}`, folder, name, kind, file: `${name}.tsx`, title: name, requiredEnv: [] })
  const withWidgets: Catalog = {
    spaces: catalog.spaces,
    applets: [applet('ops', 'board', 'view'), applet('ops', 'due', 'widget'), applet('other', 'elsewhere', 'widget'), applet('ops', 'week', 'widget')]
  }
  inserted = ['ops']
  expect((await app('owner', withWidgets).request('/api/workspace')).status).toBe(200)
  const layout = calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/space_layouts'))
  expect(layout).toHaveLength(1)
  expect(JSON.parse(layout[0].body)).toEqual({ space_id: 'ops', widgets: [{ ref: 'ops/due' }, { ref: 'ops/week' }] })
  // Ignore-duplicates: the database keeps a layout that is already there.
  expect(layout[0].url).toContain('on_conflict=space_id')
  expect(layout[0].prefer).toContain('resolution=ignore-duplicates')
  const tabs = calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/tabs'))
  expect(JSON.parse(tabs!.body).map((t: { ref: string }) => t.ref)).toEqual(['widgets', 'view:ops/board'])
})

test('a space that is not new, or has no widgets, gets no layout', async () => {
  const withWidgets: Catalog = { spaces: catalog.spaces, applets: [{ ref: 'ops/due', folder: 'ops', name: 'due', kind: 'widget', file: 'due.tsx', title: 'due', requiredEnv: [] }] }
  await app('owner', withWidgets).request('/api/workspace')
  inserted = ['ops']
  await app('owner', catalog).request('/api/workspace')
  expect(calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/space_layouts'))).toEqual([])
})

test('the sync runs once per instance while every space is there', async () => {
  const api = app()
  await api.request('/api/workspace')
  await api.request('/api/workspace')
  expect(calls.filter(c => c.url.includes('/rest/v1/rpc/sync_spaces'))).toHaveLength(1)
})

test('a tab reorder the database refuses is an error, not ok', async () => {
  tabUpdate = json({ code: '42501', message: 'permission denied for table tabs' }, 403)
  const res = await app().request('/api/spaces/ops/tabs/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ['new', 't1'] })
  })
  expect(res.status).toBe(500)
  // The database's own words stay in the server log.
  const body = await res.text()
  expect(body).not.toContain('permission denied')
  expect(JSON.parse(body)).toEqual({ error: SERVER_ERROR })
})

const put = (body: string) =>
  app().request('/api/spaces/ops/tabs/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })

test('a tab reorder updates only the tabs of the space that move', async () => {
  // t1 is at 0; 'new' is a tab the browser hasn't saved yet.
  const res = await put(JSON.stringify({ ids: ['new', 't1'] }))
  expect(res.status).toBe(200)
  const updates = calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/tabs'))
  expect(updates).toHaveLength(1)
  expect(updates[0].url).toContain('id=eq.t1')
  expect(JSON.parse(updates[0].body)).toEqual({ position: 1 })
})

test('a malformed tab order is a 400 and reaches no database', async () => {
  for (const body of ['not json', '[]', '{"ids":"t1"}', '{"ids":[1]}', '{"ids":["t1","t1"]}', JSON.stringify({ ids: Array.from({ length: 501 }, (_, i) => `t${i}`) })]) {
    calls = []
    const res = await put(body)
    expect(res.status).toBe(400)
    expect(calls.filter(c => c.url.includes('/rest/v1/tabs'))).toHaveLength(0)
  }
})

test('other bad bodies are a 400, not a 500', async () => {
  const send = (path: string, method: string, body: string) =>
    app().request(path, { method, headers: { 'content-type': 'application/json' }, body })
  expect((await send('/api/spaces/ops', 'PATCH', '{"name":5}')).status).toBe(400)
  expect((await send('/api/spaces/ops/layout', 'PUT', '{"widgets":"x"}')).status).toBe(400)
  expect((await send('/api/tabs/t1/move', 'POST', 'null')).status).toBe(400)
  expect((await app().request('/api/rpc/ops/lib/%E0%A4%A/fn', { method: 'POST' })).status).toBe(400)
})

const subspace = (path: string, method: string, body?: string, tier: 'owner' | 'admin' = 'owner') =>
  app(tier).request(path, { method, headers: { 'content-type': 'application/json' }, body })

test('an owner makes a subspace with a trimmed name; the database picks its id and slug', async () => {
  const res = await subspace('/api/spaces/ops/subspaces', 'POST', JSON.stringify({ name: '  Hiring ' }))
  expect(res.status).toBe(200)
  expect(((await res.json()) as { parentId: string }).parentId).toBe('ops')
  const call = calls.find(c => c.url.includes('/rest/v1/rpc/create_subspace'))
  expect(JSON.parse(call!.body)).toEqual({ p_parent: 'ops', p_name: 'Hiring' })
})

test('only owners make or delete subspaces, and a bad name reaches no database', async () => {
  expect((await subspace('/api/spaces/ops/subspaces', 'POST', '{"name":"Hiring"}', 'admin')).status).toBe(403)
  expect((await subspace('/api/spaces/sub-1', 'DELETE', undefined, 'admin')).status).toBe(403)
  for (const body of ['{}', '{"name":5}', '{"name":"   "}', JSON.stringify({ name: 'x'.repeat(81) }), '{"name":"a\\nb"}']) {
    expect((await subspace('/api/spaces/ops/subspaces', 'POST', body)).status).toBe(400)
  }
  expect(calls.filter(c => c.url.includes('/rpc/create_subspace') || c.url.includes('/rpc/delete_subspace'))).toHaveLength(0)
})

test('deleting a space that is no subspace is a 400', async () => {
  expect((await subspace('/api/spaces/sub-1', 'DELETE')).status).toBe(200)
  subspaceDelete = json({ code: 'P0002', message: 'no such subspace' }, 400)
  expect((await subspace('/api/spaces/ops', 'DELETE')).status).toBe(400)
})

test('everyone reads the organisation look; only admins and owners change it, with preset names only', async () => {
  const send = (method: string, body?: string, tier: 'owner' | 'admin' | 'member' = 'admin') =>
    app(tier).request('/api/settings' + (method === 'PUT' ? '/theme' : ''), { method, headers: { 'content-type': 'application/json' }, body })
  expect(await (await send('GET', undefined, 'member')).json()).toEqual({ theme: { font: 'geometric' }, name: null })
  expect((await send('PUT', '{"font":"serif"}', 'member')).status).toBe(403)
  for (const bad of ['{"font":5}', '{"color":"Red; x"}', '{"radius":"' + 'a'.repeat(30) + '"}']) expect((await send('PUT', bad)).status).toBe(400)
  calls = []
  const res = await send('PUT', '{"font":"serif","color":"sky","radius":"square","extra":"x"}')
  expect(res.status).toBe(200)
  const write = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/org_settings'))
  expect(JSON.parse(write!.body)).toEqual({ theme: { font: 'serif', color: 'sky', radius: 'square' } })
})

test('only admins and owners set the workspace name; blank clears it', async () => {
  const send = (body: string, tier: 'owner' | 'admin' | 'member' = 'admin') =>
    app(tier).request('/api/settings/name', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
  const sent = () => JSON.parse(calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/org_settings'))!.body)
  expect((await send('{"name":"Acme"}', 'member')).status).toBe(403)
  for (const bad of ['{}', '{"name":5}', '{"name":"' + 'x'.repeat(61) + '"}', '[]']) expect((await send(bad)).status).toBe(400)
  calls = []
  const res = await send('{"name":"  Acme  "}', 'owner')
  expect(await res.json()).toEqual({ theme: { font: 'geometric' }, name: 'Acme' })
  expect(sent()).toEqual({ name: 'Acme' })
  calls = []
  expect((await send('{"name":"   "}')).status).toBe(200)
  expect(sent()).toEqual({ name: null })
})

test('only admins and owners edit a space, and only its name and symbol', async () => {
  const edit = (body: string, tier: 'owner' | 'admin' | 'member' = 'admin') =>
    app(tier).request('/api/spaces/ops', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body })
  const sent = () => JSON.parse(calls.find(c => c.url.includes('/rest/v1/rpc/edit_space'))!.body)
  expect((await edit('{"name":"Operations"}', 'member')).status).toBe(403)
  expect((await edit('{"theme":{"font":"serif"}}')).status).toBe(400)
  expect((await edit('{"symbol":"<svg>"}')).status).toBe(400)
  expect((await edit('{"name":"   "}')).status).toBe(400)
  calls = []
  const res = await edit('{"name":" Operations ","theme":{"font":"serif"}}')
  expect(((await res.json()) as { name: string }).name).toBe('Operations')
  expect(sent()).toEqual({ p_space: 'ops', p_name: 'Operations', p_symbol: null })
  expect(calls.some(c => c.method === 'PATCH' && c.url.includes('/rest/v1/spaces'))).toBe(false)
  calls = []
  const both = await edit('{"name":"Ops","symbol":"rocket"}')
  expect(((await both.json()) as { symbol: string }).symbol).toBe('rocket')
  expect(sent()).toEqual({ p_space: 'ops', p_name: 'Ops', p_symbol: 'rocket' })
  calls = []
  await edit('{"symbol":null}')
  expect(sent()).toEqual({ p_space: 'ops', p_name: null, p_symbol: '' })
  // No row back is a missing space, not a 500 from toSpace(null).
  editSpace = json(null)
  expect((await edit('{"name":"Ops"}')).status).toBe(404)
  editSpace = json({ code: 'P0002', message: 'no such space' }, 400)
  expect((await edit('{"name":"Ops"}')).status).toBe(404)
})

test('admins and owners add a space with a trimmed name and an optional symbol; a bad body reaches no database', async () => {
  const add = (body: string, tier: 'owner' | 'admin' | 'member' = 'admin') =>
    app(tier).request('/api/spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  expect((await add('{"name":"Design"}', 'member')).status).toBe(403)
  for (const body of ['{}', '[]', '{"name":5}', '{"name":"   "}', JSON.stringify({ name: 'x'.repeat(81) }), '{"name":"a\\nb"}', '{"name":"A","symbol":"<svg>"}']) {
    expect((await add(body)).status).toBe(400)
  }
  expect(calls.filter(c => c.url.includes('/rpc/create_space'))).toHaveLength(0)
  const res = await add('{"name":"  Design ","symbol":"palette"}')
  expect(res.status).toBe(200)
  expect(((await res.json()) as { id: string; parentId: string | null }).parentId).toBeNull()
  expect(JSON.parse(calls.find(c => c.url.includes('/rpc/create_space'))!.body)).toEqual({ p_name: 'Design', p_symbol: 'palette' })
  calls = []
  await add('{"name":"Design"}', 'owner')
  expect(JSON.parse(calls.find(c => c.url.includes('/rpc/create_space'))!.body)).toEqual({ p_name: 'Design', p_symbol: null })
})
