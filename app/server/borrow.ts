// Which space a server function call runs as. The browser names the space
// displaying the applet in `x-miso-space`; the call then gets that space's
// connector env. A space may only borrow another folder's code when it really
// shows that code: one of its tabs is a view from the folder, or its widgets
// tab is open and its grid holds one of the folder's widgets (hosted can move
// widgets between spaces). The hosted twin of local miso's `mayBorrow`
// (server/api.ts in the miso repo), which answers a refused borrow with 404.
//
// What this does and doesn't guard: it keeps a call's env consistent with
// what's on screen, and it stops space code (or anything else holding a
// member's session) from forging the header to reach another space's
// connectors or step around a connector's per-space opt-out. It is not a hard
// boundary against a member: they can write miso.tabs and miso.space_layouts
// directly, so they can make any space "show" any folder. An allowed borrow
// is also remembered for 30 seconds, so it outlives a tab closed in that time.
import type { Catalog } from '../lib/types'
import { RpcError } from './rpc'
import type { Db } from './supabase'

// Tagged so the browser can tell a refused borrow from a missing function:
// a tab opened a moment ago may not be saved yet, so the stub retries once.
export const BORROW_REFUSED_HEADER = 'x-miso-borrow'

export class BorrowRefused extends RpcError {
  constructor() {
    super('Not found', 404)
  }
}

// What the calling space shows, or null when there is no such space. A subspace names its parent.
export type CallerShows = { tabRefs: string[]; widgetRefs: string[]; parentId?: string } | null

export type ReadCallerShows = (spaceId: string) => Promise<CallerShows>

// A borrow that was allowed stays allowed this long without another read, so
// a view firing many calls costs one lookup. Refusals are never cached: a tab
// that was just opened must work on the next call.
const ALLOWED_TTL_MS = 30_000

export function createBorrowGate(catalog: Catalog, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const ownSpace = new Map(catalog.spaces.map(s => [s.folder, s.id]))
  const viewRefs = new Map<string, Set<string>>()
  const widgetRefs = new Map<string, Set<string>>()
  for (const applet of catalog.applets) {
    const byFolder = applet.kind === 'view' ? viewRefs : widgetRefs
    const refs = byFolder.get(applet.folder) ?? new Set<string>()
    refs.add(applet.kind === 'view' ? `view:${applet.ref}` : applet.ref)
    byFolder.set(applet.folder, refs)
  }
  // Per allowed borrow: until when, and the space the call runs as.
  const allowed = new Map<string, { until: number; runAs: string }>()

  function shows(caller: CallerShows, folder: string): boolean {
    if (!caller) return false
    const views = viewRefs.get(folder)
    const widgets = widgetRefs.get(folder)
    if (caller.tabRefs.some(ref => views?.has(ref) ?? false)) return true
    // Placed widgets only count while the grid itself is open as a tab.
    return (
      caller.tabRefs.includes('widgets') &&
      caller.widgetRefs.some(ref => widgets?.has(ref) ?? false)
    )
  }

  // The space id a call to `folder`'s code runs as. No header, or the folder's
  // own space: the folder's own space. Another space: that space, if it shows
  // the folder's code; otherwise a 404, as local miso does. `read` is only
  // called when a lookup is needed. A subspace that shows the code runs as its
  // parent: the parent's connectors, and the records it writes stay tagged with
  // the parent (packages/store sets space_id on every write), so everyone who
  // sees the parent still sees them.
  return async function callSpace(call: {
    header: string | undefined
    folder: string
    userId: string
    read: ReadCallerShows
  }): Promise<string> {
    const own = ownSpace.get(call.folder) ?? ''
    const caller = call.header?.trim()
    if (!caller || caller === own) return own
    // Per person too: today every member sees the same rows, but a cached
    // allowance must never carry over to someone who can't see that space.
    const key = `${call.userId}\n${caller}\n${call.folder}`
    const cached = allowed.get(key)
    if (cached !== undefined && cached.until > now()) return cached.runAs
    const shown = await call.read(caller)
    if (shows(shown, call.folder)) {
      const runAs = shown?.parentId ?? caller
      if (allowed.size > 1000) allowed.clear()
      allowed.set(key, { until: now() + ALLOWED_TTL_MS, runAs })
      return runAs
    }
    allowed.delete(key)
    throw new BorrowRefused()
  }
}

type SpaceShowsRow = {
  id: string
  parent_id?: string | null
  tabs: { ref: unknown }[] | null
  // One-to-one (space_id is the key), so PostgREST embeds an object; accept a
  // list too in case it ever infers otherwise.
  space_layouts: { widgets: unknown } | { widgets: unknown }[] | null
}

const strings = (values: unknown[]): string[] =>
  values.filter((v): v is string => typeof v === 'string')

// Widget placements are jsonb: skip anything malformed rather than failing
// every borrow for the space.
function placedRefs(widgets: unknown): string[] {
  if (!Array.isArray(widgets)) return []
  return strings(
    widgets.map(w => (w && typeof w === 'object' ? (w as { ref?: unknown }).ref : undefined))
  )
}

// One round trip, as the signed-in person: row level security decides what
// they can see, the same rows /api/workspace reads.
export function readCallerShows(client: Db): ReadCallerShows {
  return async spaceId => {
    const { data, error } = await client
      .from('spaces')
      .select('id, parent_id, tabs(ref), space_layouts(widgets)')
      .eq('id', spaceId)
      .maybeSingle<SpaceShowsRow>()
    if (error) throw new Error(`reading space ${spaceId}: ${error.message}`)
    if (!data) return null
    const layouts = Array.isArray(data.space_layouts)
      ? data.space_layouts
      : data.space_layouts
        ? [data.space_layouts]
        : []
    return {
      tabRefs: strings((data.tabs ?? []).map(t => t?.ref)),
      widgetRefs: layouts.flatMap(l => placedRefs(l?.widgets)),
      ...(data.parent_id ? { parentId: data.parent_id } : {})
    }
  }
}
