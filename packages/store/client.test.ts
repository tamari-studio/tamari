import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { resetDtoAccessTokenForTest } from '@miso/dto-core/session'
import { collection, resetStoreClientForTest } from './index'

const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'MISO_DTO_ACCESS_TOKEN',
  'MISO_DTO_SESSION_URL',
  'SUPABASE_SERVICE_EMAIL',
  'SUPABASE_SERVICE_PASSWORD'
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) ((saved[k] = process.env[k]), delete process.env[k])
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
})
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  resetStoreClientForTest()
  resetDtoAccessTokenForTest()
})

test('store requests carry the brokered token', async () => {
  process.env.MISO_DTO_ACCESS_TOKEN = 'tok-hosted'
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    (async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as unknown as typeof fetch
  )
  try {
    await collection('kpi-snapshots').list({ limit: 1 })
    const call = spy.mock.calls.find(c =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes('/rest/v1/')
    )
    const [input, init] = call as [RequestInfo | URL, RequestInit | undefined]
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    expect(headers.get('Authorization')).toBe('Bearer tok-hosted')
  } finally {
    spy.mockRestore()
  }
})
