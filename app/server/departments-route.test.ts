import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Department, MemberTier, SpaceAccessRule } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import type { DepartmentsStore } from './departments'
import { memorySpaceAccessStore } from './space-access-testing'

function appAs(tier: MemberTier, departments: Department[] = [], rules: SpaceAccessRule[] = []) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const find = (id: string) => departments.find(d => d.id === id) ?? { memberIds: [] as string[] }
  const store: DepartmentsStore = {
    list: async () => departments,
    create: async name => {
      const department = { id: `d${departments.length + 1}`, name, memberIds: [] }
      departments.push(department)
      return department
    },
    rename: async (id, name) => {
      for (const d of departments) if (d.id === id) d.name = name
    },
    remove: async id => {
      departments.splice(departments.findIndex(d => d.id === id), 1)
    },
    addMember: async (id, userId) => {
      find(id).memberIds.push(userId)
    },
    removeMember: async (id, userId) => {
      const d = find(id)
      d.memberIds = d.memberIds.filter(m => m !== userId)
    }
  }
  return createApp({
    catalog: { spaces: [], applets: [] },
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    readCallerShows: () => async () => null,
    departmentsStore: () => store,
    spaceAccessStore: () => memorySpaceAccessStore(rules)
  })
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

test('only admins and owners read or change departments', async () => {
  for (const tier of ['member', 'manager'] as const) {
    const app = appAs(tier)
    expect((await app.request('/api/departments')).status).toBe(403)
    expect((await app.request('/api/departments', json('POST', { name: 'Sales' }))).status).toBe(403)
    expect((await app.request('/api/departments/d1/members/u2', json('PUT'))).status).toBe(403)
  }
})

test('an admin adds a department, puts people in it, renames it and deletes it', async () => {
  const departments: Department[] = []
  const app = appAs('admin', departments)
  const created = await app.request('/api/departments', json('POST', { name: '  Sales ' }))
  expect(created.status).toBe(201)
  expect(await created.json()).toEqual({ id: 'd1', name: 'Sales', memberIds: [] })
  expect((await app.request('/api/departments/d1/members/u2', json('PUT'))).status).toBe(200)
  expect((await app.request('/api/departments/d1', json('PATCH', { name: 'Partnerships' }))).status).toBe(200)
  expect(await (await app.request('/api/departments')).json()).toEqual([{ id: 'd1', name: 'Partnerships', memberIds: ['u2'] }])
  expect((await app.request('/api/departments/d1/members/u2', json('DELETE'))).status).toBe(200)
  expect((await app.request('/api/departments/d1', json('DELETE'))).status).toBe(200)
  expect(departments).toEqual([])
})

test('a blank name is a 400', async () => {
  const app = appAs('owner')
  expect((await app.request('/api/departments', json('POST', { name: '   ' }))).status).toBe(400)
  expect((await app.request('/api/departments', json('POST', {}))).status).toBe(400)
})

test("only an owner changes a department that opens a space admins don't see", async () => {
  const departments = () => [{ id: 'd1', name: 'Finance', memberIds: [] as string[] }]
  const rules = [{ spaceId: 'sp-x', tiers: ['member' as const], departments: ['d1'] }]
  const admin = appAs('admin', departments(), rules)
  expect((await admin.request('/api/departments/d1/members/u1', json('PUT'))).status).toBe(403)
  expect((await admin.request('/api/departments/d1', json('DELETE'))).status).toBe(403)
  expect((await admin.request('/api/departments/d1', json('PATCH', { name: 'Money' }))).status).toBe(200)
  expect((await appAs('owner', departments(), rules).request('/api/departments/d1/members/u1', json('PUT'))).status).toBe(200)
  // With admins on the rule, it's the admins' to change.
  const open = [{ ...rules[0]!, tiers: ['admin' as const, 'member' as const] }]
  expect((await appAs('admin', departments(), open).request('/api/departments/d1/members/u1', json('PUT'))).status).toBe(200)
})
