// Settings on a database the shell reached before migration 20261124000000 (no edits_spaces yet).
import { expect, test } from 'bun:test'

import { InputError } from './connectors'
import { supabaseAiTokenStore } from './mcp-tokens'
import type { Db } from './supabase'

// A client whose table has no edits_spaces column: naming it fails as PostgREST does.
function oldDatabase() {
  const rows: Record<string, unknown>[] = []
  const query = (result: () => { data: unknown; error: unknown }) => {
    const q: Record<string, unknown> = {}
    for (const name of ['order', 'eq', 'returns']) q[name] = () => q
    q.single = async () => {
      const r = result()
      return Array.isArray(r.data) ? { ...r, data: r.data[0] } : r
    }
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok)
    return q
  }
  const missing = { data: null, error: { code: '42703', message: 'column ai_tokens.edits_spaces does not exist' } }
  const client = {
    from: () => ({
      select: (cols: string) => query(() => (cols.includes('edits_spaces') ? missing : { data: rows.length === 1 && cols ? rows : rows, error: null })),
      insert: (row: Record<string, unknown>) => {
        if ('edits_spaces' in row) return { select: () => query(() => missing) }
        rows.push({ id: 't1', name: row.name, created_at: 'now', last_used_at: null })
        return { select: (cols: string) => query(() => (cols.includes('edits_spaces') ? missing : { data: rows[0], error: null })) }
      }
    })
  }
  return client as unknown as Db
}

test('the list works without the column: tokens read only, and the switch is not offered', async () => {
  const store = supabaseAiTokenStore(oldDatabase())
  expect(await store.list()).toEqual({ available: true, editsAvailable: false, tokens: [] })
})

test('a read-only token is still made; one that may change spaces is refused with the reason', async () => {
  const db = oldDatabase()
  const store = supabaseAiTokenStore(db)
  await expect(store.create('Claude', 'a'.repeat(64), true)).rejects.toThrow(InputError)
  const made = await store.create('Claude', 'b'.repeat(64), false)
  expect(made).toEqual({ id: 't1', name: 'Claude', createdAt: 'now', lastUsedAt: null, editsSpaces: false })
})
