// What the People & access pages work out from members, departments and space
// access: which members a filter keeps, whether a space is shared with
// everyone, and the rule a one-click change writes.
import type { Department, Member, MemberTier, SpaceAccessChange, SpaceAccessEntry } from '../../lib/types'
import { TIER_ORDER } from '../../vendor/dto-core/tier'
import { TIER_LABEL } from './labels'

export function displayName(member: Member): string {
  return member.name ?? member.email.split('@')[0]
}

export type MemberSort = 'joined' | 'name' | 'role' | 'active'

export type MemberFilter = {
  query: string
  // 'all', 'none' (in no department) or a department id.
  department: string
  // 'all', 'none' (no role yet) or a role.
  role: string
  // 'all' or a status.
  status: string
  sort: MemberSort
}

export const NO_FILTER: MemberFilter = { query: '', department: 'all', role: 'all', status: 'all', sort: 'joined' }

// `members` arrive in the order people joined, which 'joined' keeps.
export function filterMembers(members: Member[], departments: Department[], filter: MemberFilter): Member[] {
  const query = filter.query.trim().toLowerCase()
  const inAny = new Set(departments.flatMap(d => d.memberIds))
  const inOne = new Set(departments.find(d => d.id === filter.department)?.memberIds)
  const kept = members.filter(member => {
    if (query && !`${member.name ?? ''} ${member.email}`.toLowerCase().includes(query)) return false
    if (filter.department === 'none' ? inAny.has(member.id) : filter.department !== 'all' && !inOne.has(member.id)) return false
    if (filter.role !== 'all' && (member.tier ?? 'none') !== filter.role) return false
    return filter.status === 'all' || member.status === filter.status
  })
  if (filter.sort === 'name') return kept.sort((a, b) => displayName(a).localeCompare(displayName(b)))
  // Most senior role first, people without one last.
  const rank = (m: Member) => (m.tier ? TIER_ORDER.indexOf(m.tier) : TIER_ORDER.length)
  if (filter.sort === 'role') return kept.sort((a, b) => rank(a) - rank(b))
  // Most recent first, never-seen last (ISO timestamps sort as text).
  if (filter.sort === 'active') return kept.sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''))
  return kept
}

// Shared: every role sees the space, so everyone with a role does. `all` is every role a space can name.
export function isShared(space: Pick<SpaceAccessEntry, 'tiers'>, all: readonly MemberTier[]): boolean {
  return all.every(tier => space.tiers.includes(tier))
}

// Departments and people are dropped: with everyone in, they would be names that do nothing.
export function sharedAccess(all: readonly MemberTier[]): SpaceAccessChange {
  return { tiers: [...all], departments: [], people: [] }
}

// The question before a space stops being shared with everyone: it applies on click, and everyone
// below admin loses the space at once.
export function limitWarning(spaceName: string): { title: string; description: string; action: string } {
  return {
    title: `Limit who sees ${spaceName}?`,
    description: `Everyone except admins and owners stops seeing ${spaceName} straight away, unless a team or person already named on it opens it to them. You can add teams and people after this.`,
    action: 'Limit access'
  }
}

// Admins keep the space (only an owner may take them off); departments and people are added from here.
export function limitedAccess(space: SpaceAccessEntry): SpaceAccessChange {
  return { tiers: ['admin'], departments: space.departments, people: space.people }
}

export function withDepartment(space: SpaceAccessEntry, departmentId: string, on: boolean): SpaceAccessChange {
  const others = space.departments.filter(id => id !== departmentId)
  return { tiers: space.tiers, departments: on ? [...others, departmentId] : others, people: space.people }
}

// "Owners, admins, Sales and 2 people": who sees a space, in words.
export function accessSummary(space: SpaceAccessEntry, all: readonly MemberTier[], departments: Department[]): string {
  if (isShared(space, all)) return 'Everyone'
  const names = [
    'Owners',
    ...space.tiers.map(tier => `${TIER_LABEL[tier].toLowerCase()}s`),
    ...departments.filter(d => space.departments.includes(d.id)).map(d => d.name)
  ]
  if (space.people.length) names.push(space.people.length === 1 ? '1 person' : `${space.people.length} people`)
  return names.length === 1 ? 'Owners only' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
