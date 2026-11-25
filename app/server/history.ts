// The activity feed (GET /api/history): who changed what, when. It reads miso.change_history, which
// the database fills on every change to a shared record, a tab or a space. See
// supabase/migrations/20261123000200_change_history.sql.
//
// Row level security is the real gate: the query runs as the signed-in person, who gets only rows
// of spaces they see. The checks here repeat it for what the database can't know (a view with its
// own minTier, opened as a tab) and turn rows into something a page can show: the space's name, the
// view's title, a readable name for a collection, and the name of the person. Names come from
// miso.history_actors(): a display name for everyone, and an email only for admins and owners, who
// see emails on the Members page anyway. Nobody below admin ever gets an email from here.
import type { Hidden } from '../lib/access'
import type { Catalog } from '../lib/types'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import { userClient, type Db } from './supabase'

export type HistoryKind = 'record' | 'tab' | 'space'
export type HistoryAction = 'insert' | 'update' | 'delete'

export type HistoryRow = {
  id: number
  at: string
  actor: string | null
  source: HistoryKind
  action: HistoryAction
  space_id: string | null
  collection: string | null
  key: string
  version: number | null
  label: string | null
  // data->>from: the old name on a rename, the old space on a tab move. A record's own field
  // called `from` lands here too, and is ignored.
  moved_from: string | null
}

export type ActorRow = { user_id: string; name: string | null; email: string | null; automatic: boolean }

export type HistoryItem = {
  id: number
  at: string
  kind: HistoryKind
  action: HistoryAction
  // name null: show "Someone". automatic: the app itself, no person (a scheduled job).
  actor: { id: string | null; name: string | null; automatic: boolean }
  // Null for a record that belongs to no space. name null: the space is gone.
  space: { id: string; name: string | null } | null
  // What changed, readable: the record's own title (or its key), the view's title, the space's name.
  title: string
  // record only: the collection ('budget-lines') and a readable form of it ('Budget lines').
  collection: string | null
  collectionTitle: string | null
  key: string
  version: number | null
  // The old name on a rename; the space a tab came from on a move (when the reader sees it).
  from: string | null
}

export type HistoryPage = {
  items: HistoryItem[]
  // Pass as ?before= for the next page; null when this was the last.
  next: number | null
  // The spaces the reader sees, by name: what a page offers as a filter.
  spaces: { id: string; name: string }[]
}

export type HistoryQuery = { spaceId: string | null; before: number | null; limit: number }

// Everything the feed needs from the database, so it can be tested without one.
export type HistoryStore = {
  // Newest first, at most `limit` rows, as the caller's row level security allows.
  rows(query: HistoryQuery): Promise<HistoryRow[]>
  actors(ids: string[]): Promise<ActorRow[]>
  // The spaces the caller sees.
  spaces(): Promise<{ id: string; name: string }[]>
}

export const HISTORY_PAGE = 50
export const HISTORY_PAGE_MAX = 100

export function checkHistoryQuery(query: { space?: string; before?: string; limit?: string }): HistoryQuery {
  const space = query.space?.trim() || null
  if (space !== null && !/^[A-Za-z0-9._-]{1,200}$/.test(space)) throw new InputError('That is not a space.')
  let before: number | null = null
  if (query.before !== undefined && query.before !== '') {
    if (!/^[0-9]{1,15}$/.test(query.before)) throw new InputError('before must be a number from an earlier page.')
    before = Number(query.before)
  }
  const asked = Number.parseInt(query.limit ?? '', 10)
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), HISTORY_PAGE_MAX) : HISTORY_PAGE
  return { spaceId: space, before, limit }
}

// 'budget-lines' and 'kpi_snapshots.2027' as words: "Budget lines", "Kpi snapshots 2027".
export function readableName(technical: string): string {
  const words = technical.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : technical
}

function actorOf(row: HistoryRow, actors: Map<string, ActorRow>): HistoryItem['actor'] {
  const actor = row.actor ? actors.get(row.actor) : undefined
  if (!row.actor || !actor) return { id: row.actor, name: null, automatic: false }
  if (actor.automatic) return { id: row.actor, name: null, automatic: true }
  // The email is there only for admins and owners; the Members page names a person the same way.
  return { id: row.actor, name: actor.name?.trim() || actor.email?.split('@')[0] || null, automatic: false }
}

export async function historyFeed(
  store: HistoryStore,
  catalog: Catalog,
  hidden: Hidden,
  query: { space?: string; before?: string; limit?: string }
): Promise<HistoryPage> {
  const checked = checkHistoryQuery(query)
  if (checked.spaceId !== null && hidden.spaceIds.has(checked.spaceId)) {
    throw new ForbiddenError("You don't have access to that space.")
  }
  // One more than asked, to know whether there is a next page.
  const [fetched, spaces] = await Promise.all([store.rows({ ...checked, limit: checked.limit + 1 }), store.spaces()])
  const page = fetched.slice(0, checked.limit)
  const next = fetched.length > checked.limit ? page[page.length - 1].id : null

  const shown = page.filter(
    row =>
      !(row.space_id !== null && hidden.spaceIds.has(row.space_id)) && !(row.source === 'tab' && hidden.viewRefs.has(row.key))
  )
  const ids = [...new Set(shown.flatMap(row => (row.actor ? [row.actor] : [])))]
  const actors = new Map((ids.length ? await store.actors(ids) : []).map(a => [a.user_id, a]))
  const spaceNames = new Map(spaces.filter(s => !hidden.spaceIds.has(s.id)).map(s => [s.id, s.name]))
  const viewTitles = new Map(catalog.applets.filter(a => a.kind === 'view').map(a => [`view:${a.ref}`, a.title]))

  const items = shown.map((row): HistoryItem => {
    const record = row.source === 'record'
    let title = row.label?.trim() || row.key
    if (row.source === 'tab') title = viewTitles.get(row.key) ?? readableName(row.key.slice(row.key.lastIndexOf('/') + 1))
    let from: string | null = null
    if (row.action === 'update' && row.moved_from) {
      if (row.source === 'space') from = row.moved_from
      if (row.source === 'tab') from = spaceNames.get(row.moved_from) ?? null
    }
    return {
      id: row.id,
      at: row.at,
      kind: row.source,
      action: row.action,
      actor: actorOf(row, actors),
      space: row.space_id === null ? null : { id: row.space_id, name: spaceNames.get(row.space_id) ?? null },
      title,
      collection: record ? row.collection : null,
      collectionTitle: record && row.collection ? readableName(row.collection) : null,
      key: row.key,
      version: record ? row.version : null,
      from
    }
  })
  const filter = [...spaceNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  return { items, next, spaces: filter }
}

const MISSING = 'The activity feed needs migration 20261123000200_change_history in the database.'
const COLUMNS = 'id, at, actor, source, action, space_id, collection, key, version, label, moved_from:data->>from'

export function supabaseHistoryStore(client: Db): HistoryStore {
  const check = (error: { code?: string; message: string } | null) => {
    if (!error) return
    if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202') throw new Error(MISSING)
    throw new Error(error.message)
  }
  return {
    async rows({ spaceId, before, limit }) {
      // Snapshots are what a record held before history started, not something anyone did.
      let query = client.from('change_history').select(COLUMNS).neq('action', 'snapshot')
      if (spaceId !== null) query = query.eq('space_id', spaceId)
      if (before !== null) query = query.lt('id', before)
      const { data, error } = await query.order('id', { ascending: false }).limit(limit)
      check(error)
      return (data ?? []) as unknown as HistoryRow[]
    },
    async actors(ids) {
      const { data, error } = await client.rpc('history_actors', { p_ids: ids })
      check(error)
      return (data ?? []) as ActorRow[]
    },
    async spaces() {
      const { data, error } = await client.from('spaces').select('id, name')
      check(error)
      return (data ?? []) as { id: string; name: string }[]
    }
  }
}

// The route's store: the database as the signed-in person. Tests put their own in.
let storeForTest: HistoryStore | null = null

export function useHistoryStoreForTest(store: HistoryStore | null): void {
  storeForTest = store
}

export function historyStoreFor(user: { token: string }): HistoryStore {
  return storeForTest ?? supabaseHistoryStore(userClient(user.token))
}
