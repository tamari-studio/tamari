import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { resetDtoAccessTokenForTest } from '@miso/dto-core/session'
import { collection, resetStoreClientForTest } from './index'

const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'MISO_DTO_ACCESS_TOKEN',
  'MISO_DTO_SESSION_URL',
  'MISO_CALLER_ID',
  'MISO_SPACE_ID'
]
const saved: Record<string, string | undefined> = {}
const ANNA = '22222222-2222-4222-8222-222222222222'
const JOB = '4709ccce-fd4b-4779-aa52-cde9f9b78dd4'

type Call = { method: string; url: URL; headers: Headers; body: unknown }

// Answers PostgREST by path, and keeps what was asked.
function fakeRest(answers: Record<string, unknown>) {
  const calls: Call[] = []
  const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const text = await request.text()
    calls.push({ method: request.method, url, headers: request.headers, body: text ? JSON.parse(text) : null })
    const name = url.pathname.replace('/rest/v1/', '')
    return new Response(JSON.stringify(answers[`${request.method} ${name}`] ?? []), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch)
  return { calls, restore: () => spy.mockRestore() }
}

beforeEach(() => {
  for (const k of KEYS) ((saved[k] = process.env[k]), delete process.env[k])
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
  process.env.MISO_DTO_ACCESS_TOKEN = 'tok-hosted'
})
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  resetStoreClientForTest()
  resetDtoAccessTokenForTest()
})

const stored = { key: 'b1', data: { n: 1 }, space_id: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z' }

test('a write names the member behind the call, so the history can', async () => {
  process.env.MISO_CALLER_ID = ANNA
  const rest = fakeRest({ 'POST records': stored })
  try {
    const budget = collection('budget-lines')
    await budget.put('b1', { n: 1 })
    await budget.putMany([{ key: 'b2', data: { n: 2 } }])
    await budget.remove('b1')
    expect(rest.calls.map(c => c.method)).toEqual(['POST', 'POST', 'DELETE'])
    for (const call of rest.calls) expect(call.headers.get('x-miso-caller')).toBe(ANNA)
  } finally {
    rest.restore()
  }
})

test('with nobody signed in, a write names nobody, and reads never do', async () => {
  const rest = fakeRest({ 'POST records': stored })
  try {
    await collection('budget-lines').put('b1', { n: 1 })
    process.env.MISO_CALLER_ID = ANNA
    await collection('budget-lines').list()
    for (const call of rest.calls) expect(call.headers.has('x-miso-caller')).toBe(false)
  } finally {
    rest.restore()
  }
})

test('history lists one record, newest first, with who changed it', async () => {
  const rest = fakeRest({
    'GET change_history': [
      { version: 3, at: '2026-11-03T10:00:00Z', actor: null, action: 'delete', data: { n: 2 } },
      { version: 2, at: '2026-11-02T10:00:00Z', actor: JOB, action: 'update', data: { n: 2 } },
      { version: 1, at: '2026-11-01T10:00:00Z', actor: ANNA, action: 'insert', data: { n: 1 } }
    ],
    'POST rpc/history_actors': [
      { user_id: ANNA, name: 'Anna', email: null, automatic: false },
      { user_id: JOB, name: null, email: null, automatic: true }
    ]
  })
  try {
    const versions = await collection<{ n: number }>('budget-lines').history('b1', { limit: 5000 })
    expect(versions).toEqual([
      { version: 3, at: '2026-11-03T10:00:00Z', who: null, action: 'delete', data: { n: 2 } },
      { version: 2, at: '2026-11-02T10:00:00Z', who: { id: JOB, name: null, automatic: true }, action: 'update', data: { n: 2 } },
      { version: 1, at: '2026-11-01T10:00:00Z', who: { id: ANNA, name: 'Anna', automatic: false }, action: 'insert', data: { n: 1 } }
    ])
    const query = rest.calls[0].url.searchParams
    expect(query.get('source')).toBe('eq.record')
    expect(query.get('collection')).toBe('eq.budget-lines')
    expect(query.get('key')).toBe('eq.b1')
    expect(query.get('order')).toBe('version.desc')
    expect(query.get('limit')).toBe('200')
    expect(rest.calls[1].body).toEqual({ p_ids: [JOB, ANNA] })
  } finally {
    rest.restore()
  }
})

test('history of a record nobody changed asks for no names', async () => {
  const rest = fakeRest({})
  try {
    expect(await collection('budget-lines').history('nope')).toEqual([])
    expect(rest.calls).toHaveLength(1)
    expect(rest.calls[0].url.searchParams.get('limit')).toBe('50')
  } finally {
    rest.restore()
  }
})

test('restore writes the old data back as a new version', async () => {
  process.env.MISO_CALLER_ID = ANNA
  process.env.MISO_SPACE_ID = 'finance'
  const rest = fakeRest({ 'GET change_history': { data: { n: 1 } }, 'POST records': stored })
  try {
    const record = await collection<{ n: number }>('budget-lines').restore('b1', 1)
    expect(record.data).toEqual({ n: 1 })
    const [read, write] = rest.calls
    expect(read.url.searchParams.get('version')).toBe('eq.1')
    expect(write.method).toBe('POST')
    expect(write.body).toEqual({ collection: 'budget-lines', key: 'b1', data: { n: 1 }, space_id: 'finance' })
    expect(write.headers.get('x-miso-caller')).toBe(ANNA)
  } finally {
    rest.restore()
  }
})

test('restore refuses a version that is not there, and writes nothing', async () => {
  const rest = fakeRest({ 'GET change_history': null })
  try {
    const budget = collection('budget-lines')
    await expect(budget.restore('b1', 9)).rejects.toThrow('there is no version 9')
    await expect(budget.restore('b1', 1.5)).rejects.toThrow('not a version number')
    expect(rest.calls.every(c => c.method === 'GET')).toBe(true)
  } finally {
    rest.restore()
  }
})
