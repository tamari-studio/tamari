import { expect, test } from 'bun:test'

import type { Department, Member, MemberTier, SpaceAccessEntry } from '../../lib/types'
import { accessSummary, filterMembers, isShared, limitedAccess, NO_FILTER, sharedAccess, withDepartment } from './people'

const member = (id: string, tier: MemberTier | null, extra: Partial<Member> = {}): Member => ({
  id,
  email: `${id}@example.org`,
  name: null,
  tier,
  status: tier ? 'active' : 'pending',
  locked: null,
  ...extra
})

const members = [
  member('zoe', 'member', { lastActiveAt: '2026-11-01T10:00:00Z' }),
  member('adam', 'owner', { name: 'Adam Berg', lastActiveAt: '2026-11-09T10:00:00Z' }),
  member('new', null),
  member('max', 'manager', { status: 'suspended', lastActiveAt: null })
]
const departments: Department[] = [
  { id: 'sales', name: 'Sales', memberIds: ['zoe', 'max'] },
  { id: 'ops', name: 'Ops', memberIds: ['adam'] }
]
const ids = (filter: Partial<typeof NO_FILTER>) => filterMembers(members, departments, { ...NO_FILTER, ...filter }).map(m => m.id)

test('no filter keeps everyone in the order they joined', () => {
  expect(ids({})).toEqual(['zoe', 'adam', 'new', 'max'])
})

test('search matches a name or an email, whatever the case', () => {
  expect(ids({ query: ' BERG ' })).toEqual(['adam'])
  expect(ids({ query: 'zoe@' })).toEqual(['zoe'])
})

test('department, role and status filters', () => {
  expect(ids({ department: 'sales' })).toEqual(['zoe', 'max'])
  expect(ids({ department: 'none' })).toEqual(['new'])
  expect(ids({ department: 'gone' })).toEqual([])
  expect(ids({ role: 'none' })).toEqual(['new'])
  expect(ids({ role: 'manager' })).toEqual(['max'])
  expect(ids({ status: 'suspended' })).toEqual(['max'])
  expect(ids({ department: 'sales', status: 'active' })).toEqual(['zoe'])
})

test('sorting: by name, by seniority, by last activity', () => {
  expect(ids({ sort: 'name' })).toEqual(['adam', 'max', 'new', 'zoe'])
  expect(ids({ sort: 'role' })).toEqual(['adam', 'max', 'zoe', 'new'])
  expect(ids({ sort: 'active' }).slice(0, 2)).toEqual(['adam', 'zoe'])
})

const ALL: MemberTier[] = ['admin', 'manager', 'member']
const space = (extra: Partial<SpaceAccessEntry>): SpaceAccessEntry => ({
  id: 's',
  name: 'Space',
  tiers: ALL,
  departments: [],
  people: [],
  defaultTiers: ALL,
  custom: false,
  ...extra
})

test('a space is shared only when every role sees it', () => {
  expect(isShared(space({}), ALL)).toBe(true)
  expect(isShared(space({ tiers: ['admin', 'member'] }), ALL)).toBe(false)
})

test('sharing names every role; limiting keeps admins and whoever was named', () => {
  expect(sharedAccess(ALL)).toEqual({ tiers: ALL, departments: [], people: [] })
  expect(limitedAccess(space({ departments: ['sales'], people: ['zoe'] }))).toEqual({ tiers: ['admin'], departments: ['sales'], people: ['zoe'] })
})

test('adding or removing a department leaves the rest of the rule alone', () => {
  const limited = space({ tiers: ['admin'], departments: ['ops'], people: ['zoe'] })
  expect(withDepartment(limited, 'sales', true)).toEqual({ tiers: ['admin'], departments: ['ops', 'sales'], people: ['zoe'] })
  expect(withDepartment(limited, 'ops', true).departments).toEqual(['ops'])
  expect(withDepartment(limited, 'ops', false)).toEqual({ tiers: ['admin'], departments: [], people: ['zoe'] })
})

test('who sees a space, in words', () => {
  expect(accessSummary(space({}), ALL, departments)).toBe('Everyone')
  expect(accessSummary(space({ tiers: [] }), ALL, departments)).toBe('Owners only')
  expect(accessSummary(space({ tiers: ['admin'] }), ALL, departments)).toBe('Owners and admins')
  expect(accessSummary(space({ tiers: ['admin'], departments: ['sales', 'deleted'], people: ['a', 'b'] }), ALL, departments)).toBe(
    'Owners, admins, Sales and 2 people'
  )
})
