// The Space access page: owners and admins pick, per space, which tiers,
// departments and people see it (miso.space_access, and the departments migration
// 20261110000000_departments). app/lib/access.ts
// applies the rules on top of spaces.json's minTier; this file reads and
// writes them.
//
// Row level security lets everyone who can use the hosted app read every rule,
// admins write the rules of spaces admins see (keeping admins in them), and
// owners write any. The checks below repeat that so the page can
// explain a refusal instead of showing a database error. Rules are read through
// miso.space_access_rules(), which refuses anyone else instead of answering
// with no rows: the cache below is shared, and "no rules" would unhide spaces.
import { defaultTiers, ruleMap, RULE_TIERS, seesSpace } from '../lib/access'
import type { Catalog, MemberTier, SpaceAccessChange, SpaceAccessEntry, SpaceAccessResponse, SpaceAccessRule } from '../lib/types'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import type { Db } from './supabase'

export type SpaceAccessStore = {
  list(): Promise<SpaceAccessRule[]>
  set(spaceId: string, change: SpaceAccessChange): Promise<void>
  reset(spaceId: string): Promise<void>
}

// The rules, briefly: every space guard and server function call needs them.
// Every caller who gets an answer reads the same rows (anyone else gets an
// error, which is never cached), so one copy serves everyone. A change made
// through this instance shows at once; one made through another instance
// within the TTL.
const TTL_MS = 15_000

export type RuleCache = {
  get(load: () => Promise<SpaceAccessRule[]>): Promise<SpaceAccessRule[]>
  forget(): void
}

export function createRuleCache(ttlMs = TTL_MS, now = () => Date.now()): RuleCache {
  let cached: { rules: SpaceAccessRule[]; until: number } | null = null
  // Bumped by forget(), so a load that started before a change doesn't get cached after it.
  let generation = 0
  return {
    async get(load) {
      if (cached && cached.until > now()) return cached.rules
      const started = generation
      const rules = await load()
      if (started === generation) cached = { rules, until: now() + ttlMs }
      return rules
    },
    forget() {
      cached = null
      generation++
    }
  }
}

// A request body's `tiers`: a list of tiers (owner may be left out, it always
// sees the space), or null to go back to the default.
export function parseTiers(body: unknown): MemberTier[] | null {
  if (typeof body !== 'object' || body === null || !('tiers' in body)) throw new InputError('Send the tiers that see this space.')
  const { tiers } = body as { tiers: unknown }
  if (tiers === null) return null
  if (!Array.isArray(tiers)) throw new InputError('Tiers is a list of tiers, or null for the default.')
  for (const tier of tiers) {
    if (tier !== 'owner' && !RULE_TIERS.includes(tier as MemberTier)) throw new InputError(`There's no tier called ${String(tier)}.`)
  }
  return RULE_TIERS.filter(tier => tiers.includes(tier))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseIds(value: unknown, what: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && UUID.test(id))) throw new InputError(`${what} is a list of ids.`)
  return [...new Set(value as string[])]
}

// A request body: `tiers` as above, plus the `departments` and `people` (ids)
// that see the space too; left out, none. Null for the default.
export function parseAccess(body: unknown): SpaceAccessChange | null {
  const tiers = parseTiers(body)
  if (tiers === null) return null
  const { departments, people } = body as { departments?: unknown; people?: unknown }
  return { tiers, departments: parseIds(departments, 'Departments'), people: parseIds(people, 'People') }
}

// Whether admins see a space now: by its rule, or without one by spaces.json's
// minTier. Only an owner may change the rule of a space admins don't see, or an
// admin could open an owners-only space to admins.
export function adminsSee(catalog: Catalog, rules: SpaceAccessRule[], spaceId: string): boolean {
  const space = catalog.spaces.find(s => s.id === spaceId) ?? { id: spaceId }
  return seesSpace({ tier: 'admin', status: 'active' }, space, ruleMap(rules))
}

// One row per space, in sidebar order. `spaces` is every space the database
// holds, not only the ones the viewer sees.
export function spaceAccessEntries(spaces: { id: string; name: string }[], catalog: Catalog, rules: SpaceAccessRule[]): SpaceAccessResponse {
  const minTiers = new Map(catalog.spaces.map(s => [s.id, s.minTier]))
  const byId = ruleMap(rules)
  const entries: SpaceAccessEntry[] = spaces.map(space => {
    const fallback = defaultTiers(minTiers.get(space.id))
    const rule = byId.get(space.id)
    return {
      id: space.id,
      name: space.name,
      tiers: rule ? RULE_TIERS.filter(tier => rule.tiers.includes(tier)) : fallback,
      departments: rule?.departments ?? [],
      people: rule?.people ?? [],
      defaultTiers: fallback,
      custom: rule !== undefined
    }
  })
  return { tiers: [...RULE_TIERS], spaces: entries }
}

type Failure = { code?: string; message: string }

function refuse(error: Failure): never {
  if (error.code === '23503') throw new InputError("There's no such space.")
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204') throw new Error('Space access needs migration 20261110000000_departments in the database.')
  if (error.code === '42501') throw new ForbiddenError('Only admins and owners can change who sees a space.')
  throw new Error(error.message)
}

export function supabaseSpaceAccessStore(client: Db): SpaceAccessStore {
  return {
    async list() {
      const { data, error } = await client.rpc('space_access_rules')
      if (error) throw new Error(error.message)
      type Row = { space_id: string; tiers: MemberTier[]; departments: string[]; people: string[]; members: string[] }
      return ((data ?? []) as Row[]).map(r => ({
        spaceId: r.space_id,
        tiers: r.tiers,
        departments: r.departments,
        people: r.people,
        members: r.members
      }))
    },
    async set(spaceId, { tiers, departments, people }) {
      const { error } = await client
        .from('space_access')
        .upsert({ space_id: spaceId, tiers, departments, people }, { onConflict: 'space_id' })
      if (error) refuse(error)
    },
    async reset(spaceId) {
      const { error } = await client.from('space_access').delete().eq('space_id', spaceId)
      if (error) refuse(error)
    }
  }
}
