// The Members screen: who is in the workspace, what tier they hold, and (for
// owners) when they last used the app. Admins and owners also delete someone's
// account outright (app.member_erase, migration 0146 in the miso repo), by the
// same rules as changing their tier.
//
// Tiers are app.tier on app.app_user, the shared-data tiers, not the hosted-app
// role in miso.members. Row level security is the real gate: admin+ read every
// row and change tier/status on any non-owner row, owners also touch owner
// rows, and only owners can read app.user_activity. The rules below repeat that
// so the screen can explain a refusal instead of showing a database error, and
// so a mistake in a policy can't silently widen what the screen offers.
import type { Member, MemberChange, MembersResponse, MemberStatus, MemberTier } from '../lib/types'
import { TIER_ORDER } from '../vendor/dto-core/tier'
import { InputError } from './connectors'
import type { Db } from './supabase'

export class ForbiddenError extends Error {}

export type MemberRow = {
  user_id: string
  email: string
  display_name: string | null
  tier: MemberTier | null
  status: MemberStatus
  // Their job title, from the welcome step (migration 20261125000000_member_position).
  position?: string | null
}

type MemberUpdate = { tier?: MemberTier; status?: MemberStatus }

// Everything the rules need from the database, so they can be tested without one.
export type MembersStore = {
  readRow(userId: string): Promise<MemberRow | null>
  listRows(): Promise<MemberRow[]>
  listActivity(): Promise<Map<string, string>>
  updateRow(userId: string, update: MemberUpdate): Promise<MemberRow | null>
  // False when there was nobody to delete.
  eraseRow(userId: string): Promise<boolean>
  recordActivity(): Promise<void>
}

export function canManage(viewer: MemberRow | null): viewer is MemberRow {
  return viewer !== null && viewer.status === 'active' && (viewer.tier === 'owner' || viewer.tier === 'admin')
}

export function assignableTiers(viewer: { tier: MemberTier | null }): MemberTier[] {
  return viewer.tier === 'owner' ? [...TIER_ORDER] : TIER_ORDER.filter(tier => tier !== 'owner')
}

export function lockReason(viewer: MemberRow, target: MemberRow): string | null {
  if (viewer.user_id === target.user_id) return "You can't change your own role."
  if (target.tier === 'owner' && viewer.tier !== 'owner') return 'Only an owner can change an owner.'
  return null
}

export function planChange(viewer: MemberRow, target: MemberRow, change: MemberChange): MemberUpdate {
  if (!canManage(viewer)) throw new ForbiddenError('Only admins and owners can change roles.')
  const locked = lockReason(viewer, target)
  if (locked) throw new ForbiddenError(locked)

  const { tier, status } = change
  if (tier === undefined && status === undefined) throw new InputError('Nothing to change.')
  if (tier !== undefined && !TIER_ORDER.includes(tier)) throw new InputError(`There's no role called ${String(tier)}.`)
  if (status !== undefined && status !== 'active' && status !== 'suspended') throw new InputError('Status can be set to active or suspended.')
  if (tier !== undefined && !assignableTiers(viewer).includes(tier)) throw new ForbiddenError('Only an owner can make someone an owner.')

  const update: MemberUpdate = {}
  if (tier !== undefined) update.tier = tier
  if (status !== undefined) update.status = status
  // A tier alone leaves a pending or suspended person locked out, so granting
  // one also activates them unless the caller said otherwise.
  if (tier !== undefined && status === undefined && target.status !== 'active') update.status = 'active'
  if (update.status === 'active' && !(update.tier ?? target.tier)) throw new InputError('Pick a role before activating someone.')
  return update
}

function toMember(viewer: MemberRow, row: MemberRow, activity?: Map<string, string>): Member {
  const member: Member = {
    id: row.user_id,
    email: row.email,
    name: row.display_name,
    tier: row.tier,
    status: row.status,
    locked: lockReason(viewer, row),
    ...(row.position ? { position: row.position } : {})
  }
  // Owners only, and the key stays out of the payload for everyone else.
  if (activity) member.lastActiveAt = activity.get(row.user_id) ?? null
  return member
}

export async function loadMembers(store: MembersStore, userId: string): Promise<MembersResponse> {
  // The list loads alongside the viewer's own row; row level security limits what it holds, and
  // nothing of it is returned unless the viewer may manage members.
  const [viewer, rows] = await Promise.all([store.readRow(userId), store.listRows()])
  if (!canManage(viewer)) throw new ForbiddenError('Only admins and owners can see members.')
  const activity = viewer.tier === 'owner' ? await store.listActivity() : undefined
  return {
    viewer: { id: viewer.user_id, tier: viewer.tier as MemberTier },
    assignableTiers: assignableTiers(viewer),
    members: rows.map(row => toMember(viewer, row, activity))
  }
}

export async function changeMember(store: MembersStore, userId: string, targetId: string, change: MemberChange): Promise<Member> {
  const [viewer, target] = await Promise.all([store.readRow(userId), store.readRow(targetId)])
  if (!canManage(viewer)) throw new ForbiddenError('Only admins and owners can change roles.')
  if (!target) throw new InputError('There is no such person.')
  const updated = await store.updateRow(targetId, planChange(viewer, target, change))
  // Row level security answers a refused update with zero rows, not an error.
  if (!updated) throw new ForbiddenError('The database refused that change.')
  return toMember(viewer, updated)
}

// Deletes the account: their sign-in, tier and activity. They can sign in
// again later, as a new pending account with no tier.
export async function deleteMember(store: MembersStore, userId: string, targetId: string): Promise<void> {
  const viewer = await store.readRow(userId)
  if (!canManage(viewer)) throw new ForbiddenError('Only admins and owners can delete members.')
  if (viewer.user_id === targetId) throw new ForbiddenError("You can't delete yourself.")
  const target = await store.readRow(targetId)
  if (!target) throw new InputError('There is no such person.')
  const locked = lockReason(viewer, target)
  if (locked) throw new ForbiddenError(locked)
  if (!(await store.eraseRow(targetId))) throw new InputError('There is no such person.')
}

const COLUMNS = 'user_id, email, display_name, tier, status'
// Without migration 20261125000000_member_position the column isn't there (42703): read without it.
// A failed statement changed nothing, so asking again is safe for an update too.
export async function withPosition<R extends { error: { code?: string } | null }>(run: (columns: string) => PromiseLike<R>): Promise<R> {
  const first = await run(`${COLUMNS}, position`)
  return first.error?.code === '42703' ? run(COLUMNS) : first
}
export const LAST_OWNER = 'That would leave the workspace without an active owner. Make someone else owner first.'

export function supabaseMembersStore(client: Db): MembersStore {
  const app = () => client.schema('app')
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    async readRow(userId) {
      const { data, error } = await withPosition(columns => app().from('app_user').select(columns).eq('user_id', userId).maybeSingle<MemberRow>())
      check(error)
      return data
    },
    async listRows() {
      const { data, error } = await withPosition(columns => app().from('app_user').select(columns).order('created_at').returns<MemberRow[]>())
      check(error)
      return (data ?? []) as MemberRow[]
    },
    async listActivity() {
      const { data, error } = await app().from('user_activity').select('user_id, last_active_at')
      check(error)
      return new Map(((data ?? []) as { user_id: string; last_active_at: string }[]).map(r => [r.user_id, r.last_active_at]))
    },
    async updateRow(userId, update) {
      const { data, error } = await withPosition(columns => app().from('app_user').update(update).eq('user_id', userId).select(columns).maybeSingle<MemberRow>())
      // The last-owner guard (app.app_user_guard_last_owner), e.g. two owners demoting each other at once.
      if (error?.code === 'P0001' && error.message.startsWith('last-owner invariant')) throw new ForbiddenError(LAST_OWNER)
      check(error)
      return data
    },
    async eraseRow(userId) {
      const { data, error } = await app().rpc('member_erase', { p_user: userId })
      if (error) {
        // The function's own refusals (who may delete whom) and the last-owner guard.
        if (error.code === '42501' || error.code === 'P0001') throw new ForbiddenError(error.message)
        if (error.code === 'PGRST202') throw new Error('Deleting members needs migration 0146 in the database.')
        throw new Error(error.message)
      }
      return data === true
    },
    async recordActivity() {
      const { error } = await app().rpc('record_activity')
      check(error)
    }
  }
}
