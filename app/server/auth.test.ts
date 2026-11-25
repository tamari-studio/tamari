import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { verifyToken } from './auth'

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }

// Each test signs in a different person: verified tokens are remembered per token.
let n = 0
function tokenFor(sub: string): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'none' })}.${part({ sub, n: ++n })}.sig`
}

const FUTURE = { code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' }

type Reply = { status: number; body: unknown }
// What Supabase answers for one request kind: the nth call gets replies[n], the last one repeats.
type Script = Record<'user' | 'is_member' | 'app_user', Reply[]>

let calls: Record<keyof Script, number>
let fetchSpy: ReturnType<typeof spyOn>

function serve(sub: string, script: Partial<Script>) {
  const full: Script = {
    user: [{ status: 200, body: { id: sub, email: `${sub}@x.test`, user_metadata: {} } }],
    is_member: [{ status: 200, body: true }],
    app_user: [{ status: 200, body: [{ tier: 'admin', status: 'active' }] }],
    ...script
  }
  calls = { user: 0, is_member: 0, app_user: 0 }
  fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const kind: keyof Script = url.includes('/auth/v1/user') ? 'user' : url.includes('/rpc/is_member') ? 'is_member' : 'app_user'
    const replies = full[kind]
    const reply = replies[Math.min(calls[kind]++, replies.length - 1)]
    if (reply.body instanceof Error) throw reply.body
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch)
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  fetchSpy = spyOn(globalThis, 'fetch')
})
afterEach(() => {
  fetchSpy.mockRestore()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

// PostgREST judges a token's issue time against a clock that lags once it has been idle, so the
// first requests with a brand-new token can be refused as "issued at future" while later ones pass.
// That used to sign the person out ("not approved") or leave them with no tier for a minute.
test('a token PostgREST refuses once as issued in the future still verifies, with its tier', async () => {
  serve('sam', {
    is_member: [{ status: 401, body: FUTURE }, { status: 200, body: true }],
    app_user: [{ status: 401, body: FUTURE }, { status: 200, body: [{ tier: 'admin', status: 'active' }] }]
  })
  const user = await verifyToken(tokenFor('sam'))
  expect(user).toMatchObject({ id: 'sam', tier: 'admin', status: 'active' })
})

test('a database error while checking membership is unavailable, not "not approved"', async () => {
  serve('pat', { is_member: [{ status: 500, body: { code: 'XX000', message: 'boom' } }] })
  expect(await verifyToken(tokenFor('pat'))).toBe('unavailable')
})

test('someone who is not a member is still refused', async () => {
  serve('lee', { is_member: [{ status: 200, body: false }] })
  expect(await verifyToken(tokenFor('lee'))).toBe('forbidden')
})

test('a tier that could not be read is not remembered', async () => {
  const token = tokenFor('kim')
  serve('kim', { app_user: [{ status: 500, body: { code: 'XX000', message: 'boom' } }] })
  expect(await verifyToken(token)).toMatchObject({ id: 'kim', tier: null })

  serve('kim', {})
  expect(await verifyToken(token)).toMatchObject({ id: 'kim', tier: 'admin', status: 'active' })
  // And once read it is remembered: no second round trip.
  const before = calls.is_member
  await verifyToken(token)
  expect(calls.is_member).toBe(before)
})

// Auth is asked first. Only an answer about the token signs a person out (401 or 403, and any other
// 4xx); Auth being down says nothing about the person.
test('Auth failing with a server error is unavailable, not a sign-out', async () => {
  serve('ann', { user: [{ status: 503, body: { code: 503, error_code: 'unexpected_failure', msg: 'down' } }] })
  expect(await verifyToken(tokenFor('ann'))).toBe('unavailable')
})

test('Auth being unreachable is unavailable, not a sign-out', async () => {
  serve('bo', { user: [{ status: 0, body: new TypeError('fetch failed') }] })
  expect(await verifyToken(tokenFor('bo'))).toBe('unavailable')
})

test('Auth rate limiting is unavailable, not a sign-out', async () => {
  serve('cy', { user: [{ status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'slow down' } }] })
  expect(await verifyToken(tokenFor('cy'))).toBe('unavailable')
})

test('a token Auth rejects still signs the person out', async () => {
  serve('di', { user: [{ status: 401, body: { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' } }] })
  expect(await verifyToken(tokenFor('di'))).toBe('unauthenticated')
  serve('ed', { user: [{ status: 403, body: { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' } }] })
  expect(await verifyToken(tokenFor('ed'))).toBe('unauthenticated')
})
