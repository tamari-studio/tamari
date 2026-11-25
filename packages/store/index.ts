/**
 * Shared records: data any space can read, kept in `miso.records` on the shared
 * Supabase project instead of in files next to one space's code.
 *
 *   import { collection } from '@miso/store'
 *   const snapshots = collection<KpiSnapshot>('kpi-snapshots')
 *   await snapshots.put('2026-09-26', snapshot)
 *   const latest = await snapshots.list({ limit: 30 })
 *
 * Server-side only — call it from a `*.server.ts` file. It reads with the
 * brokered session `@miso/dto-core`'s `session.ts` hands out (plan 31): local
 * miso's loopback broker, or the hosted app's per-call token. There is no
 * password anywhere — a call with no broker configured throws.
 *
 * Collections are global: a collection written by one space is readable from
 * every other space. `space` on a record only says who wrote it.
 *
 * Every change is kept as a version (miso.change_history, written by the
 * database on each put and remove, so there is nothing to call when saving):
 *
 *   const versions = await snapshots.history('2026-09-26', { limit: 20 })
 *   await snapshots.restore('2026-09-26', versions[1].version)
 *
 * History is as global as the records are. Check who may see or restore a
 * record in your server function before you hand it to a view.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dtoAccessToken } from '@miso/dto-core/session'

export type StoredRecord<T> = {
  key: string
  data: T
  space: string | null
  createdAt: string
  updatedAt: string
}

export type ListOptions = {
  limit?: number
  /** Newest first by default. `key`/`key-desc` sort by key (ISO dates sort in time order). */
  order?: 'newest' | 'oldest' | 'key' | 'key-desc'
  /** Only keys starting with this prefix. */
  prefix?: string
}

export type RecordVersion<T> = {
  /** Counts up from 1 per key, and goes on after a remove and a new put. */
  version: number
  at: string
  /**
   * The member behind the change. `automatic`: no member, the app itself (a job).
   * Null: unknown, or their account is gone.
   */
  who: { id: string; name: string | null; automatic: boolean } | null
  /** `snapshot`: what a record held before history started. */
  action: 'insert' | 'update' | 'delete' | 'snapshot'
  /** The data after the change; for a `delete`, the data that was removed. */
  data: T
}

export type HistoryOptions = {
  /** How many versions, newest first. 50 by default, 200 at most. */
  limit?: number
}

type VersionRow = {
  version: number
  at: string
  actor: string | null
  action: RecordVersion<unknown>['action']
  data: unknown
}

type ActorRow = { user_id: string; name: string | null; automatic: boolean }

type Row = {
  key: string
  data: unknown
  space_id: string | null
  created_at: string
  updated_at: string
}

const SCHEMA = 'miso'
const COLLECTION_NAME = /^[a-z0-9][a-z0-9._-]*$/
const HISTORY_MAX = 200
// The store writes as the spaces account, so the database can't see which member is behind a
// call. The shell puts their id in the call's env (@miso/caller); sent along with a write, the
// history records them. The database takes this header only from a service account's session.
const CALLER_HEADER = 'x-miso-caller'

function asCaller<Q extends { setHeader(name: string, value: string): Q }>(query: Q): Q {
  const caller = process.env.MISO_CALLER_ID
  return caller ? query.setHeader(CALLER_HEADER, caller) : query
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

let brokered: Db | null = null

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[@miso/store] ${name} is not set. The store needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, ` +
        `and a session from miso's broker (plan 31).`
    )
  }
  return value
}

async function client(): Promise<Db> {
  const url = required('SUPABASE_URL')
  const key = required('SUPABASE_PUBLISHABLE_KEY')
  if ((await dtoAccessToken()) === null) {
    throw new Error(
      '[@miso/store] No DTO session here: run inside miso (MISO_DTO_SESSION_URL) or the hosted app (MISO_DTO_ACCESS_TOKEN).'
    )
  }
  return (brokered ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: SCHEMA },
    accessToken: async () => dtoAccessToken()
  }))
}

export function resetStoreClientForTest(): void {
  brokered = null
}

function toRecord<T>(row: Row): StoredRecord<T> {
  return {
    key: row.key,
    data: row.data as T,
    space: row.space_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// The hosted app runs each server call with MISO_SPACE_ID set to the calling
// space; local miso doesn't, so a record written locally has no space.
function currentSpace(explicit?: string): string | null {
  return explicit ?? process.env.MISO_SPACE_ID ?? null
}

export function collection<T = unknown>(name: string, options: { space?: string } = {}) {
  if (!COLLECTION_NAME.test(name)) {
    throw new Error(
      `[@miso/store] "${name}" is not a valid collection name (lowercase letters, digits, . _ -).`
    )
  }

  async function put(key: string, value: T): Promise<StoredRecord<T>> {
    const supabase = await client()
    const { data, error } = await asCaller(
      supabase
        .from('records')
        .upsert(
          { collection: name, key, data: value, space_id: currentSpace(options.space) },
          { onConflict: 'collection,key' }
        )
        .select('key, data, space_id, created_at, updated_at')
        .single<Row>()
    )
    if (error) throw new Error(`[@miso/store] put ${name}/${key}: ${error.message}`)
    return toRecord<T>(data)
  }

  return {
    name,

    async get(key: string): Promise<StoredRecord<T> | null> {
      const supabase = await client()
      const { data, error } = await supabase
        .from('records')
        .select('key, data, space_id, created_at, updated_at')
        .eq('collection', name)
        .eq('key', key)
        .maybeSingle<Row>()
      if (error) throw new Error(`[@miso/store] get ${name}/${key}: ${error.message}`)
      return data ? toRecord<T>(data) : null
    },

    async list(list: ListOptions = {}): Promise<StoredRecord<T>[]> {
      const supabase = await client()
      let query = supabase
        .from('records')
        .select('key, data, space_id, created_at, updated_at')
        .eq('collection', name)
      if (list.prefix) query = query.like('key', `${list.prefix.replace(/[%_]/g, '\\$&')}%`)
      const order = list.order ?? 'newest'
      query =
        order === 'key' || order === 'key-desc'
          ? query.order('key', { ascending: order === 'key' })
          : query.order('updated_at', { ascending: order === 'oldest' })
      const { data, error } = await query.limit(list.limit ?? 1000)
      if (error) throw new Error(`[@miso/store] list ${name}: ${error.message}`)
      return ((data ?? []) as Row[]).map(row => toRecord<T>(row))
    },

    put,

    async putMany(entries: { key: string; data: T }[]): Promise<number> {
      if (entries.length === 0) return 0
      const supabase = await client()
      const space = currentSpace(options.space)
      const { error, count } = await asCaller(
        supabase.from('records').upsert(
          entries.map(e => ({ collection: name, key: e.key, data: e.data, space_id: space })),
          { onConflict: 'collection,key', count: 'exact' }
        )
      )
      if (error) throw new Error(`[@miso/store] putMany ${name}: ${error.message}`)
      return count ?? entries.length
    },

    async remove(key: string): Promise<void> {
      const supabase = await client()
      const { error } = await asCaller(
        supabase.from('records').delete().eq('collection', name).eq('key', key)
      )
      if (error) throw new Error(`[@miso/store] remove ${name}/${key}: ${error.message}`)
    },

    /** One record's versions, newest first. Empty when it hasn't changed since history started. */
    async history(key: string, history: HistoryOptions = {}): Promise<RecordVersion<T>[]> {
      const supabase = await client()
      const limit = Math.min(Math.max(Math.trunc(history.limit ?? 50) || 50, 1), HISTORY_MAX)
      const { data, error } = await supabase
        .from('change_history')
        .select('version, at, actor, action, data')
        .eq('source', 'record')
        .eq('collection', name)
        .eq('key', key)
        .order('version', { ascending: false })
        .limit(limit)
      if (error) throw new Error(`[@miso/store] history ${name}/${key}: ${error.message}`)
      const rows = (data ?? []) as VersionRow[]
      const ids = [...new Set(rows.flatMap(r => (r.actor ? [r.actor] : [])))]
      const actors = new Map<string, ActorRow>()
      if (ids.length) {
        const names = await supabase.rpc('history_actors', { p_ids: ids })
        if (names.error) throw new Error(`[@miso/store] history ${name}/${key}: ${names.error.message}`)
        for (const a of (names.data ?? []) as ActorRow[]) actors.set(a.user_id, a)
      }
      return rows.map(r => {
        const actor = r.actor ? actors.get(r.actor) : undefined
        return {
          version: r.version,
          at: r.at,
          who: r.actor
            ? { id: r.actor, name: actor?.name ?? null, automatic: actor?.automatic ?? false }
            : null,
          action: r.action,
          data: r.data as T
        }
      })
    },

    /**
     * Writes a version's data back as the newest version. Nothing is lost, so a restore can be
     * undone the same way. Restoring a `delete` version brings the removed record back.
     */
    async restore(key: string, version: number): Promise<StoredRecord<T>> {
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(
          `[@miso/store] restore ${name}/${key}: ${String(version)} is not a version number.`
        )
      }
      const supabase = await client()
      const { data, error } = await supabase
        .from('change_history')
        .select('data')
        .eq('source', 'record')
        .eq('collection', name)
        .eq('key', key)
        .eq('version', version)
        .maybeSingle<{ data: unknown }>()
      if (error) throw new Error(`[@miso/store] restore ${name}/${key}: ${error.message}`)
      if (!data) throw new Error(`[@miso/store] restore ${name}/${key}: there is no version ${version}.`)
      return put(key, data.data as T)
    }
  }
}
