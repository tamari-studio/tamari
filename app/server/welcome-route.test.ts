import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { Department, MemberStatus, MemberTier, SpaceAccessRule } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import type { DepartmentsStore } from './departments'
import { memorySpaceAccessStore } from './space-access-testing'
import { needsWelcome, parseWelcome, selectableDepartments, type WelcomeStore } from './welcome'

const SALES: Department = { id: 'd-sales', name: 'Sales', memberIds: [] }
const EVENTS: Department = { id: 'd-events', name: 'Events', memberIds: ['u9'] }
// Named on a rule that leaves admins out.
const BOARD: Department = { id: 'd-board', name: 'Board', memberIds: [] }
const RULES: SpaceAccessRule[] = [
  { spaceId: 'sp-plan', tiers: ['admin'], departments: ['d-sales'] },
  { spaceId: 'sp-board', tiers: [], departments: ['d-board'] }
]

type Calls = { names: string[]; positions: string[]; made: string[]; joins: { name: string; ids: string[] }[] }

function appAs(
  who: { tier: MemberTier | null; status?: MemberStatus },
  { departments = [SALES, EVENTS, BOARD], join = true as boolean | 'missing', welcomed = false, samples = false, position = true } = {}
) {
  const calls: Calls = { names: [], positions: [], made: [], joins: [] }
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: 'Google Name', avatarUrl: null, tier: who.tier, status: who.status ?? 'active', token: 'tok' })
    await next()
  }
  // As welcome_self does: a completed call marks the account welcomed, departments or not.
  const welcome: WelcomeStore = {
    welcomed: async () => welcomed,
    saveName: async name => void calls.names.push(name),
    hasPosition: async () => position,
    savePosition: async value => void calls.positions.push(value),
    join: async (name, ids) => {
      calls.joins.push({ name, ids })
      welcomed = true
      return join
    }
  }
  const app = createApp({
    catalog: { spaces: [], applets: [] },
    modules: {},
    commit: null,
    builtAt: '',
    requireUser: signedIn,
    readCallerShows: () => async () => null,
    departmentsStore: () =>
      ({
        list: async () => departments,
        create: async (name: string) => (calls.made.push(name), { id: `d-${name.toLowerCase()}`, name, memberIds: [] })
      }) as unknown as DepartmentsStore,
    samples: { enabled: samples },
    spaceAccessStore: () => memorySpaceAccessStore(RULES),
    welcomeStore: () => welcome
  })
  return { app, calls }
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('first sign-in is an active account, of any tier, that is in no department', () => {
  const member = { id: 'u1', tier: 'member', status: 'active' } as const
  expect(needsWelcome(member, [SALES, EVENTS])).toBe(true)
  expect(needsWelcome(member, [{ ...SALES, memberIds: ['u1'] }])).toBe(false)
  expect(needsWelcome({ ...member, tier: 'manager' }, [])).toBe(true)
  expect(needsWelcome({ ...member, tier: 'admin' }, [])).toBe(true)
  expect(needsWelcome({ ...member, tier: 'owner' }, [])).toBe(true)
  expect(needsWelcome({ ...member, tier: 'owner' }, [], true)).toBe(false)
  expect(needsWelcome({ ...member, status: 'suspended' }, [])).toBe(false)
  expect(needsWelcome({ id: 'u1', tier: null, status: 'pending' }, [])).toBe(false)
  // Once in a department, always placed by an admin after: emptied later is not a first sign-in.
  expect(needsWelcome(member, [SALES], true)).toBe(false)
})

test("a department that opens a space admins don't see isn't offered", () => {
  expect(selectableDepartments([SALES, EVENTS, BOARD], RULES)).toEqual([
    { id: 'd-sales', name: 'Sales' },
    { id: 'd-events', name: 'Events' }
  ])
})

test('the name and the departments are checked', () => {
  const ok = new Set(['a', 'b'])
  expect(parseWelcome({ name: '  Ada Lovelace ', departmentIds: ['a', 'a', 'b'] }, ok)).toEqual({ name: 'Ada Lovelace', departmentIds: ['a', 'b'] })
  expect(parseWelcome({ name: 'Ada' }, ok)).toEqual({ name: 'Ada', departmentIds: [] })
  expect(parseWelcome({ name: 'Ada', position: ' CTO ', newTeam: ' Ops ' }, ok)).toEqual({ name: 'Ada', departmentIds: [], position: 'CTO', newTeam: 'Ops' })
  expect(parseWelcome({ name: 'Ada', position: '  ', newTeam: null }, ok)).toEqual({ name: 'Ada', departmentIds: [] })
  for (const body of [
    null,
    {},
    { name: '   ' },
    { name: 7 },
    { name: 'x'.repeat(81) },
    { name: 'Ada\nLovelace' },
    { name: 'Ada', departmentIds: 'a' },
    { name: 'Ada', departmentIds: [1] },
    { name: 'Ada', departmentIds: ['c'] },
    { name: 'Ada', departmentIds: Array.from({ length: 21 }, (_, i) => `d${i}`) },
    { name: 'Ada', position: 'x'.repeat(81) },
    { name: 'Ada', position: 'a\nb' },
    { name: 'Ada', position: 3 },
    { name: 'Ada', newTeam: 'x'.repeat(81) }
  ]) {
    expect(() => parseWelcome(body, ok)).toThrow()
  }
})

test('GET tells a new member to do the welcome step, and placed members not to', async () => {
  const fresh = await (await appAs({ tier: 'member' }).app.request('/api/welcome')).json()
  expect(fresh).toEqual({ needed: true, name: 'Google Name', departments: [{ id: 'd-sales', name: 'Sales' }, { id: 'd-events', name: 'Events' }], newTeam: false, samples: false, position: true })
  expect(await (await appAs({ tier: 'admin' }).app.request('/api/welcome')).json()).toMatchObject({ needed: true, newTeam: true, samples: false })
  const placed = appAs({ tier: 'member' }, { departments: [{ ...SALES, memberIds: ['u1'] }] })
  expect((await (await placed.app.request('/api/welcome')).json()).needed).toBe(false)
})

test('POST saves the name and joins the departments', async () => {
  const { app, calls } = appAs({ tier: 'member' })
  const res = await app.request('/api/welcome', post({ name: ' Ada ', departmentIds: ['d-sales'] }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ name: 'Ada', joined: true })
  expect(calls).toEqual({ names: ['Ada'], positions: [], made: [], joins: [{ name: 'Ada', ids: ['d-sales'] }] })
})

test('the position is saved with the name', async () => {
  const { app, calls } = appAs({ tier: 'member' })
  expect((await app.request('/api/welcome', post({ name: 'Ada', position: ' Head of sales ' }))).status).toBe(200)
  expect(calls.positions).toEqual(['Head of sales'])
})

test('without the position column the step asks for no position, and saves none', async () => {
  const { app, calls } = appAs({ tier: 'member' }, { position: false })
  expect((await (await app.request('/api/welcome')).json()).position).toBe(false)
  expect((await app.request('/api/welcome', post({ name: 'Ada', position: 'CTO' }))).status).toBe(200)
  expect(calls).toMatchObject({ names: ['Ada'], positions: [] })
})

test('only the first owner, on an install that can add spaces, gets the sample-space step', async () => {
  const step = async (tier: MemberTier, opts: { samples?: boolean; welcomed?: boolean } = {}) =>
    (await (await appAs({ tier }, opts).app.request('/api/welcome')).json()).samples
  expect(await step('owner', { samples: true })).toBe(true)
  expect(await step('owner')).toBe(false)
  expect(await step('admin', { samples: true })).toBe(false)
  expect(await step('owner', { samples: true, welcomed: true })).toBe(false)
})

test('an admin or owner types a new team: it is made and joined, or joined when the name is taken', async () => {
  const { app, calls } = appAs({ tier: 'owner' }, { departments: [] })
  expect(await (await app.request('/api/welcome', post({ name: 'Ada', newTeam: 'Ops' }))).json()).toEqual({ name: 'Ada', joined: true })
  expect(calls.made).toEqual(['Ops'])
  expect(calls.joins).toEqual([{ name: 'Ada', ids: ['d-ops'] }])
  const taken = appAs({ tier: 'admin' })
  expect((await taken.app.request('/api/welcome', post({ name: 'Ada', newTeam: 'sales' }))).status).toBe(200)
  expect(taken.calls).toMatchObject({ made: [], joins: [{ name: 'Ada', ids: ['d-sales'] }] })
})

test('a member can\'t make a team', async () => {
  const { app, calls } = appAs({ tier: 'member' })
  expect((await app.request('/api/welcome', post({ name: 'Ada', newTeam: 'Ops' }))).status).toBe(403)
  expect(calls).toEqual({ names: [], positions: [], made: [], joins: [] })
})

test('without migration 0184 the name is still saved and nothing fails', async () => {
  const { app, calls } = appAs({ tier: 'member' }, { join: 'missing' })
  const res = await app.request('/api/welcome', post({ name: 'Ada', departmentIds: ['d-sales'] }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ name: 'Ada', joined: false })
  expect(calls.names).toEqual(['Ada'])
})

test('a bad name, an unknown department or a closed one is a 400 and saves nothing', async () => {
  const { app, calls } = appAs({ tier: 'member' })
  for (const body of [{ name: '' }, { name: 'Ada', departmentIds: ['nope'] }, { name: 'Ada', departmentIds: ['d-board'] }, 'not json']) {
    expect((await app.request('/api/welcome', post(body))).status).toBe(400)
  }
  expect(calls).toEqual({ names: [], positions: [], made: [], joins: [] })
})

test("an account that isn't active can't do it", async () => {
  for (const who of [{ tier: 'member', status: 'suspended' }, { tier: null, status: 'pending' }] as const) {
    const { app, calls } = appAs(who)
    expect((await app.request('/api/welcome', post({ name: 'Ada', departmentIds: [] }))).status).toBe(403)
    expect(calls.names).toEqual([])
  }
})

test('an account that was ever in a department gets no welcome step and joins nothing itself', async () => {
  const { app, calls } = appAs({ tier: 'member' }, { welcomed: true })
  expect((await (await app.request('/api/welcome')).json()).needed).toBe(false)
  expect((await app.request('/api/welcome', post({ name: 'Ada', departmentIds: ['d-sales'] }))).status).toBe(403)
  expect(calls).toEqual({ names: [], positions: [], made: [], joins: [] })
})

test('a name-only welcome uses up the self-join: departments sent later are refused', async () => {
  const { app, calls } = appAs({ tier: 'member' })
  expect((await app.request('/api/welcome', post({ name: 'Ada' }))).status).toBe(200)
  expect((await (await app.request('/api/welcome')).json()).needed).toBe(false)
  expect((await app.request('/api/welcome', post({ name: 'Ada', departmentIds: ['d-sales'] }))).status).toBe(403)
  expect(calls.joins).toEqual([{ name: 'Ada', ids: [] }])
})
