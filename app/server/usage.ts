// Usage analytics: the events browsers report (POST /api/usage) and the report the Usage page
// reads (GET /api/usage/report). See supabase/migrations/20261023000000_usage_events.sql.
//
// Row level security is the real gate, and both run as the signed-in person: they insert only
// their own events, in spaces they see, and the database stamps who and when. Only admins and
// owners get the report, which counts only spaces they see; only owners get its member list.
// The checks here keep everything stored to ids this build knows, and drop the rest, so a stale
// browser tab can't make a whole batch fail.
import { hasAtLeast } from '../vendor/dto-core/tier'
import type { Hidden, Viewer } from '../lib/access'
import type { Catalog } from '../lib/types'
import {
  USAGE_ACTIONS,
  USAGE_BATCH_MAX,
  USAGE_PAGES,
  USAGE_TARGET,
  type UsageKind,
  type UsageReport
} from '../lib/usage'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import type { Db } from './supabase'

export type UsageRow = { session_id: string; kind: UsageKind; space_id: string | null; target: string }

// Everything the rules need from the database, so they can be tested without one.
export type UsageStore = {
  insert(rows: UsageRow[]): Promise<void>
  report(days: number, tz: string): Promise<UsageReport>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGES = new Set<string>(USAGE_PAGES.map(p => `page:${p}`))
const ACTIONS = new Set<string>(USAGE_ACTIONS)

// One event as a row, or null when it isn't something this build reports.
function checkEvent(event: unknown, spaceIds: Set<string>, viewRefs: Set<string>, hidden: Hidden): UsageRow | null {
  if (!event || typeof event !== 'object') return null
  const { kind, target, spaceId, sessionId } = event as Record<string, unknown>
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return null
  if (typeof target !== 'string' || !USAGE_TARGET.test(target)) return null
  if (spaceId != null && (typeof spaceId !== 'string' || !spaceIds.has(spaceId) || hidden.spaceIds.has(spaceId))) return null
  const space = (spaceId as string | null | undefined) ?? null
  const row = (k: UsageKind): UsageRow => ({ session_id: sessionId.toLowerCase(), kind: k, space_id: space, target })
  switch (kind) {
    case 'session':
      return target === 'start' && space === null ? row('session') : null
    case 'view':
      if (space === null) return PAGES.has(target) ? row('view') : null
      if (target === 'widgets') return row('view')
      return viewRefs.has(target) && !hidden.viewRefs.has(target) ? row('view') : null
    case 'action':
      return ACTIONS.has(target) ? row('action') : null
    default:
      return null
  }
}

export function checkEvents(body: unknown, catalog: Catalog, hidden: Hidden): UsageRow[] {
  const events = (body as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) throw new InputError('Send { events: [...] }.')
  if (events.length > USAGE_BATCH_MAX) throw new InputError(`Send at most ${USAGE_BATCH_MAX} events at a time.`)
  const spaceIds = new Set(catalog.spaces.map(s => s.id))
  const viewRefs = new Set(catalog.applets.filter(a => a.kind === 'view').map(a => `view:${a.ref}`))
  return events.map(e => checkEvent(e, spaceIds, viewRefs, hidden)).filter((r): r is UsageRow => r !== null)
}

export async function recordUsage(store: UsageStore, body: unknown, catalog: Catalog, hidden: Hidden): Promise<number> {
  const rows = checkEvents(body, catalog, hidden)
  if (rows.length) await store.insert(rows)
  return rows.length
}

function knownTimeZone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function checkReportQuery(query: { days?: string; tz?: string }): { days: number; tz: string } {
  const asked = Number.parseInt(query.days ?? '', 10)
  const days = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 90) : 30
  const tz = query.tz?.trim() || 'UTC'
  if (!knownTimeZone(tz)) throw new InputError(`Unknown time zone ${tz}.`)
  return { days, tz }
}

export async function usageReport(
  store: UsageStore,
  viewer: Viewer,
  hidden: Hidden,
  query: { days?: string; tz?: string }
): Promise<UsageReport> {
  if (!hasAtLeast(viewer.tier, viewer.status, 'admin')) throw new ForbiddenError('Only admins and owners see usage.')
  const { days, tz } = checkReportQuery(query)
  const report = await store.report(days, tz)
  // The database already left out hidden spaces; a hidden space's view opened as a tab on a
  // space the viewer does see is left out here.
  return {
    ...report,
    spaces: report.spaces.filter(s => !hidden.spaceIds.has(s.spaceId)),
    tabs: report.tabs.filter(t => !hidden.spaceIds.has(t.spaceId) && !hidden.viewRefs.has(t.target))
  }
}

const MISSING = 'Usage analytics needs migration 20261023000000_usage_events in the database.'

export function supabaseUsageStore(client: Db): UsageStore {
  return {
    async insert(rows) {
      const { error } = await client.from('usage_events').insert(rows)
      // Row level security refuses someone who can't use the app yet (a pending account):
      // nothing to count, and nothing for the browser to retry.
      if (!error || error.code === '42501') return
      if (error.code === 'PGRST205' || error.code === '42P01') throw new Error(MISSING)
      throw new Error(error.message)
    },
    async report(days, tz) {
      const { data, error } = await client.rpc('usage_report', { p_days: days, p_tz: tz })
      if (!error) return data as UsageReport
      if (error.code === '42501') throw new ForbiddenError(error.message)
      if (error.code === 'PGRST202') throw new Error(MISSING)
      throw new Error(error.message)
    }
  }
}
