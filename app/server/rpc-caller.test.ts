import { expect, mock, test } from 'bun:test'
import { parse, stringify } from 'devalue'

import { BrokerError, createSessionBroker, dtoAccessToken, type AuthOps } from '../vendor/dto-core/session'
import * as realConnectors from './connectors'
import * as realDtoSession from './dto-session'

// callServerFunction would otherwise reach Supabase for connector values and
// the brokered token. Only those two functions are replaced.
let connectorEnv: Record<string, string | undefined> = {}
mock.module('./connectors', () => ({ ...realConnectors, connectorEnvForSpace: async () => connectorEnv }))
let hostedDtoToken: () => Promise<string | null> = async () => 'brokered-token'
mock.module('./dto-session', () => ({ ...realDtoSession, hostedDtoToken: () => hostedDtoToken() }))

const { callServerFunction } = await import('./rpc')
const { callerEmail, callerId, requireCaller } = await (await import('./caller-testing')).loadCaller()

const modules = {
  'ops/who': async () => ({
    whoami: async () => ({
      email: callerEmail(),
      id: callerId(),
      env: Object.entries(process.env).filter(([key]) => key.startsWith('MISO_CALLER_')),
      values: Object.values(process.env).filter((v): v is string => typeof v === 'string')
    }),
    needMember: async () => requireCaller(),
    // Reads the caller, yields to the other calls in flight, then reads the DTO token and the caller again.
    whoAndToken: async () => {
      const before = { email: callerEmail(), id: callerId() }
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      const token = await dtoAccessToken()
      return { before, after: { email: callerEmail(), id: callerId() }, token }
    }
  })
}

const call = (fn: string, caller?: { id: string; email: string | null; token?: string }) =>
  callServerFunction({ modules, folder: 'ops', moduleKey: 'who', fn, spaceId: 'sp1', body: stringify([]), caller })

test('a server function sees the verified caller, and never their token', async () => {
  const user = { id: 'u-1', email: 'ada@example.com', token: 'secret-user-jwt' }
  const text = await call('whoami', user)
  expect(text).toContain('ada@example.com')
  expect(text).toContain('u-1')
  expect(text).not.toContain('secret-user-jwt')
  expect(process.env.MISO_CALLER_EMAIL).toBeUndefined() // scoped to the call
})

test('a connector that tries to set the caller is overridden', async () => {
  connectorEnv = { MISO_CALLER_EMAIL: 'boss@example.com', MISO_CALLER_ID: 'u-boss' }
  try {
    const signedIn = await call('whoami', { id: 'u-1', email: 'ada@example.com' })
    expect(signedIn).toContain('ada@example.com')
    expect(signedIn).not.toContain('boss@example.com')
    const anonymous = await call('whoami')
    expect(anonymous).not.toContain('boss@example.com')
    await expect(call('needMember')).rejects.toThrow('This action needs a signed-in member')
  } finally {
    connectorEnv = {}
  }
})

// Supabase Auth keeps one pending magic link per user: a newer generateLink replaces it, and verifying
// the older one fails with "Email link is invalid or has expired" (the hosted incident when several
// server instances minted for miso-spaces@ at once). Latencies and backoffs are event-loop ticks drawn
// from a seeded generator, so the interleaving is the same on every run.
function racingAuth(seed: number) {
  let s = seed >>> 0
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  let pending: string | null = null
  let serial = 0
  const issued = new Set<string>()
  const stats = { verifyFailures: 0 }
  const ops: AuthOps = {
    async magicLinkHash() {
      await ticks(1 + Math.floor(random() * 3))
      return (pending = `hash-${++serial}`)
    },
    async createUser() {},
    async verify(hash) {
      await ticks(1 + Math.floor(random() * 3))
      if (hash !== pending) {
        stats.verifyFailures += 1
        throw new BrokerError("Couldn't open a session: Email link is invalid or has expired", 502, 'otp_expired')
      }
      pending = null
      const accessToken = `spaces-tok-${++serial}`
      issued.add(accessToken)
      return { accessToken, refreshToken: `r-${serial}`, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    },
    async refresh() {
      throw new BrokerError('no refresh in this fake', 502)
    }
  }
  const instance = () =>
    createSessionBroker({ ops: async () => ops, sleep: ms => ticks(Math.ceil(ms / 50)), random })
  return { instance, issued, stats }
}

test('concurrent calls from different callers on cold instances: each sees only itself and a valid DTO session', async () => {
  for (const seed of [1, 2, 3]) {
    const auth = racingAuth(seed)
    // Four cold server instances; the calls land on them in turn.
    const instances = [1, 2, 3, 4].map(() => auth.instance())
    let next = 0
    hostedDtoToken = async () => (await instances[next++ % instances.length]!.token()).accessToken
    try {
      const callers = Array.from({ length: 24 }, (_, i) => ({ id: `u-${i}`, email: `member${i}@example.com`, token: `jwt-${i}` }))
      const settled = await Promise.allSettled(callers.map(caller => call('whoAndToken', caller)))
      expect(settled.filter(r => r.status === 'rejected')).toEqual([])
      settled.forEach((result, i) => {
        const text = (result as PromiseFulfilledResult<string>).value
        const { before, after, token } = parse(text) as {
          before: { email: string; id: string }
          after: { email: string; id: string }
          token: string
        }
        expect(before).toEqual({ email: `member${i}@example.com`, id: `u-${i}` })
        expect(after).toEqual(before)
        expect(auth.issued.has(token)).toBe(true)
        expect(text).not.toContain(`jwt-${i}`)
      })
      // One session per instance, and the race really happened.
      expect(auth.issued.size).toBe(instances.length)
      expect(auth.stats.verifyFailures).toBeGreaterThan(0)
      expect(process.env.MISO_CALLER_EMAIL).toBeUndefined()
      expect(process.env.MISO_DTO_ACCESS_TOKEN).toBeUndefined()
    } finally {
      hostedDtoToken = async () => 'brokered-token'
    }
  }
})
