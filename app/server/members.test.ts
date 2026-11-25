import { describe, expect, test } from 'bun:test'

import type { MemberStatus, MemberTier } from '../lib/types'
import {
  assignableTiers,
  changeMember,
  deleteMember,
  ForbiddenError,
  loadMembers,
  lockReason,
  planChange,
  withPosition,
  type MemberRow,
  type MembersStore
} from './members'
import { InputError } from './connectors'

const row = (id: string, tier: MemberTier | null, status: MemberStatus, extra: Partial<MemberRow> = {}): MemberRow => ({
  user_id: id,
  email: `${id}@example.com`,
  display_name: null,
  tier,
  status,
  ...extra
})

const owner = row('owner', 'owner', 'active')
const admin = row('admin', 'admin', 'active')
const manager = row('manager', 'manager', 'active')
const pending = row('pending', null, 'pending')

function fakeStore(rows: MemberRow[], activity: Record<string, string> = {}) {
  const calls = { activityReads: 0, updates: [] as { id: string; update: object }[], erased: [] as string[], recorded: 0 }
  const store: MembersStore = {
    readRow: async id => rows.find(r => r.user_id === id) ?? null,
    listRows: async () => rows,
    listActivity: async () => {
      calls.activityReads++
      return new Map(Object.entries(activity))
    },
    updateRow: async (id, update) => {
      calls.updates.push({ id, update })
      const target = rows.find(r => r.user_id === id)
      if (!target) return null
      Object.assign(target, update)
      return target
    },
    eraseRow: async id => {
      const at = rows.findIndex(r => r.user_id === id)
      if (at < 0) return false
      calls.erased.push(id)
      rows.splice(at, 1)
      return true
    },
    recordActivity: async () => {
      calls.recorded++
    }
  }
  return { store, calls }
}

describe('assignableTiers', () => {
  test('owners can hand out every tier, admins never owner', () => {
    expect(assignableTiers(owner)).toEqual(['owner', 'admin', 'manager', 'member'])
    expect(assignableTiers(admin)).toEqual(['admin', 'manager', 'member'])
  })
})

describe('lockReason', () => {
  test('ordinary people are editable', () => {
    expect(lockReason(admin, manager)).toBeNull()
    expect(lockReason(admin, pending)).toBeNull()
  })
  test('nobody edits their own tier', () => {
    expect(lockReason(owner, owner)).toMatch(/own/i)
  })
  test('a display name locks nobody: anyone can sign up as "Service account"', () => {
    expect(lockReason(owner, row('svc', 'member', 'active', { display_name: 'Service account' }))).toBeNull()
  })
  test('only an owner edits an owner', () => {
    expect(lockReason(admin, owner)).toMatch(/owner/i)
    expect(lockReason(owner, row('owner2', 'owner', 'active'))).toBeNull()
  })
})

describe('planChange', () => {
  test('a tier on a pending person also activates them', () => {
    expect(planChange(admin, pending, { tier: 'member' })).toEqual({ tier: 'member', status: 'active' })
  })
  test('a tier on an active person changes only the tier', () => {
    expect(planChange(admin, manager, { tier: 'member' })).toEqual({ tier: 'member' })
  })
  test('a tier on a suspended person reactivates them', () => {
    expect(planChange(admin, row('s', 'member', 'suspended'), { tier: 'manager' })).toEqual({ tier: 'manager', status: 'active' })
  })
  test('suspending changes only the status', () => {
    expect(planChange(admin, manager, { status: 'suspended' })).toEqual({ status: 'suspended' })
  })
  test('activating someone with no tier is refused', () => {
    expect(() => planChange(admin, pending, { status: 'active' })).toThrow(InputError)
  })
  test('an admin cannot grant owner', () => {
    expect(() => planChange(admin, manager, { tier: 'owner' })).toThrow(ForbiddenError)
    expect(planChange(owner, manager, { tier: 'owner' })).toEqual({ tier: 'owner' })
  })
  test('an empty or unknown change is refused', () => {
    expect(() => planChange(admin, manager, {})).toThrow(InputError)
    expect(() => planChange(admin, manager, { tier: 'god' as MemberTier })).toThrow(InputError)
    expect(() => planChange(admin, manager, { status: 'pending' as 'active' })).toThrow(InputError)
  })
  test('locked rows are refused', () => {
    expect(() => planChange(admin, owner, { tier: 'member' })).toThrow(ForbiddenError)
    expect(() => planChange(owner, owner, { tier: 'admin' })).toThrow(ForbiddenError)
  })
})

describe('loadMembers', () => {
  test('people without manage rights are refused', async () => {
    for (const viewer of [manager, pending, row('susp', 'admin', 'suspended')]) {
      const { store } = fakeStore([viewer, owner])
      await expect(loadMembers(store, viewer.user_id)).rejects.toBeInstanceOf(ForbiddenError)
    }
    const { store } = fakeStore([owner])
    await expect(loadMembers(store, 'nobody')).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('an admin gets the list with no activity at all', async () => {
    const { store, calls } = fakeStore([owner, admin, pending], { owner: '2026-10-01T10:00:00Z' })
    const res = await loadMembers(store, 'admin')
    expect(calls.activityReads).toBe(0)
    expect(res.viewer).toEqual({ id: 'admin', tier: 'admin' })
    expect(res.assignableTiers).toEqual(['admin', 'manager', 'member'])
    expect(res.members.map(m => m.id)).toEqual(['owner', 'admin', 'pending'])
    for (const m of res.members) expect('lastActiveAt' in m).toBe(false)
    expect(res.members.find(m => m.id === 'owner')?.locked).toMatch(/owner/i)
    expect(res.members.find(m => m.id === 'admin')?.locked).toMatch(/own/i)
    expect(res.members.find(m => m.id === 'pending')?.locked).toBeNull()
  })

  test('an owner also gets last activity, null when never seen', async () => {
    const { store } = fakeStore([owner, pending], { owner: '2026-10-01T10:00:00Z' })
    const res = await loadMembers(store, 'owner')
    expect(res.assignableTiers).toEqual(['owner', 'admin', 'manager', 'member'])
    expect(res.members.find(m => m.id === 'owner')?.lastActiveAt).toBe('2026-10-01T10:00:00Z')
    expect(res.members.find(m => m.id === 'pending')?.lastActiveAt).toBeNull()
  })

  test('the name falls back to the email', async () => {
    const { store } = fakeStore([owner, row('x', 'member', 'active', { display_name: 'Xavier' })])
    const res = await loadMembers(store, 'owner')
    expect(res.members.map(m => m.name)).toEqual([null, 'Xavier'])
  })
})

describe('changeMember', () => {
  test('applies the planned update and returns the new row', async () => {
    const { store, calls } = fakeStore([admin, pending])
    const member = await changeMember(store, 'admin', 'pending', { tier: 'member' })
    expect(calls.updates).toEqual([{ id: 'pending', update: { tier: 'member', status: 'active' } }])
    expect(member).toMatchObject({ id: 'pending', tier: 'member', status: 'active', locked: null })
  })

  test('an unknown person is a clear error', async () => {
    const { store } = fakeStore([admin])
    await expect(changeMember(store, 'admin', 'ghost', { tier: 'member' })).rejects.toThrow(InputError)
  })

  test('a non-manager changes nothing', async () => {
    const { store, calls } = fakeStore([manager, pending])
    await expect(changeMember(store, 'manager', 'pending', { tier: 'member' })).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls.updates).toEqual([])
  })
})

describe('deleteMember', () => {
  test('an admin deletes a pending person, a member or a suspended one', async () => {
    const suspended = row('gone', 'member', 'suspended')
    const { store, calls } = fakeStore([admin, pending, row('m', 'member', 'active'), suspended])
    for (const id of ['pending', 'm', 'gone']) await deleteMember(store, 'admin', id)
    expect(calls.erased).toEqual(['pending', 'm', 'gone'])
  })

  test('an owner deletes another owner', async () => {
    const { store, calls } = fakeStore([owner, row('owner2', 'owner', 'active')])
    await deleteMember(store, 'owner', 'owner2')
    expect(calls.erased).toEqual(['owner2'])
  })

  test('nobody deletes themselves, and an admin no owner', async () => {
    const { store, calls } = fakeStore([owner, admin])
    await expect(deleteMember(store, 'admin', 'admin')).rejects.toThrow("You can't delete yourself.")
    await expect(deleteMember(store, 'owner', 'owner')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteMember(store, 'admin', 'owner')).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls.erased).toEqual([])
  })

  test('a manager or a suspended admin deletes nobody', async () => {
    const { store, calls } = fakeStore([manager, row('was', 'admin', 'suspended'), pending])
    await expect(deleteMember(store, 'manager', 'pending')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteMember(store, 'was', 'pending')).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls.erased).toEqual([])
  })

  test('an unknown person is a clear error', async () => {
    const { store } = fakeStore([admin])
    await expect(deleteMember(store, 'admin', 'ghost')).rejects.toThrow(InputError)
  })
})

test('members are read with their position, and without it on a database that lacks the column', async () => {
  const asked: string[] = []
  const answer = (missing: boolean) => async (columns: string) => (asked.push(columns), { error: missing && columns.includes('position') ? { code: '42703' } : null })
  expect((await withPosition(answer(false))).error).toBeNull()
  expect(asked).toEqual(['user_id, email, display_name, tier, status, position'])
  asked.length = 0
  expect((await withPosition(answer(true))).error).toBeNull()
  expect(asked).toEqual(['user_id, email, display_name, tier, status, position', 'user_id, email, display_name, tier, status'])
})
