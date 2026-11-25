import { afterEach, expect, spyOn, test } from 'bun:test'

import { InputError, updateConnector } from './connectors'
import { userClient } from './supabase'

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

test('a refused secret key leaves the connector as it was', async () => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  const writes: string[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET' && !url.includes('/rpc/')) writes.push(`${method} ${url}`)
    const body = url.includes('/rpc/connector_secret_keys')
      ? []
      : { id: 'c1', kind: 'airtable', name: 'Airtable', config: {}, disabled_space_ids: [], created_at: '', updated_at: '' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch)
  try {
    const update = updateConnector(userClient('tok'), 'c1', { name: 'Renamed', secrets: { NOT_A_KEY: 'x' } })
    expect(update).rejects.toBeInstanceOf(InputError)
    await update.catch(() => {})
  } finally {
    fetchSpy.mockRestore()
  }
  expect(writes).toEqual([])
})
