/**
 * Mirrors `app.tier`'s Postgres enum exactly (migrations/0011_rls_everywhere.sql
 * §1): declared most-privileged-first, so "at least X" is a `<=` comparison
 * on array index here, exactly as it is `<=` on enum declaration order in
 * `app.has_at_least()`. Getting this ordering backwards would make every
 * client-side affordance check disagree with the database in the dangerous
 * direction -- hiding controls a user actually has, or showing ones RLS will
 * refuse. Add a tier here only when it is added to the Postgres enum, in the
 * same position.
 */
export const TIER_ORDER = ['owner', 'admin', 'manager', 'member'] as const

export type Tier = (typeof TIER_ORDER)[number]

export function isTier(value: string): value is Tier {
  return (TIER_ORDER as readonly string[]).includes(value)
}

/**
 * `app.has_at_least(min)`'s exact logic, reproduced client-side:
 *
 *     select coalesce(app.current_tier() <= min, false)
 *
 * where `app.current_tier()` itself is:
 *
 *     select u.tier from app.app_user u
 *      where u.user_id = auth.uid() and u.status = 'active'
 *
 * So the status gate is not a separate check bolted on afterwards -- it is
 * baked into what "current tier" even means. A suspended or pending user has
 * a tier value in their row, but it does not count: passing `tier` alone
 * without `status` here would silently disagree with the database the
 * moment someone is suspended.
 *
 * This is an affordance check only -- it decides what the UI shows, never
 * what a write is allowed to do. RLS (via `app.has_at_least()` itself) is
 * the actual enforcement; see `RequireTier`'s own doc comment.
 */
export function hasAtLeast(tier: Tier | null, status: string | null, min: Tier): boolean {
  if (tier === null || status !== 'active') return false
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(min)
}
