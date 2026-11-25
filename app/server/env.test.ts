import { expect, test } from 'bun:test'
import { withEnv } from './env'

test('each call sees its own env, and undefined masks a key', async () => {
  process.env.MISO_ENV_TEST_BASE = 'base'
  const seen: Record<string, unknown> = {}
  await Promise.all([
    withEnv({ TOKEN: 'a' }, async () => {
      await Bun.sleep(10)
      seen.a = process.env.TOKEN
    }),
    withEnv({ TOKEN: 'b' }, async () => {
      await Bun.sleep(1)
      seen.b = process.env.TOKEN
    }),
    withEnv({ MISO_ENV_TEST_BASE: undefined }, async () => {
      seen.masked = process.env.MISO_ENV_TEST_BASE
      seen.maskedIn = 'MISO_ENV_TEST_BASE' in process.env
    })
  ])
  expect(seen).toEqual({ a: 'a', b: 'b', masked: undefined, maskedIn: false })
  expect(process.env.TOKEN).toBeUndefined()
  expect(process.env.MISO_ENV_TEST_BASE).toBe('base')
})

test('still isolates calls after process.env was replaced wholesale', async () => {
  await withEnv({}, async () => {}) // the proxy is in place
  const original = process.env
  process.env = { ...original }
  try {
    const seen: Record<string, unknown> = {}
    await Promise.all([
      withEnv({ TOKEN: 'a' }, async () => {
        await Bun.sleep(5)
        seen.a = process.env.TOKEN
      }),
      withEnv({ TOKEN: 'b' }, async () => {
        seen.b = process.env.TOKEN
      })
    ])
    expect(seen).toEqual({ a: 'a', b: 'b' })
  } finally {
    process.env = original
  }
})

// Space server code runs inside a scope; only the shell's allowlist of
// deployment values reads through, so a deployment secret can't reach it.
test('inside a scope, only allowlisted keys read through from the real env', async () => {
  const saved = { ...process.env }
  process.env.SOME_SECRET = 'deploy-secret'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NODE_ENV = 'production'
  process.env.MISO_CALLER_TIER = 'admin'
  try {
    const seen = await withEnv({}, async () => ({
      secret: process.env.SOME_SECRET,
      secretIn: 'SOME_SECRET' in process.env,
      secretListed: Object.keys(process.env).includes('SOME_SECRET'),
      secretDescribed: Object.getOwnPropertyDescriptor(process.env, 'SOME_SECRET'),
      spread: { ...process.env }.SOME_SECRET,
      url: process.env.SUPABASE_URL,
      urlIn: 'SUPABASE_URL' in process.env,
      urlListed: Object.keys(process.env).includes('SUPABASE_URL'),
      nodeEnv: process.env.NODE_ENV,
      tier: process.env.MISO_CALLER_TIER
    }))
    expect(seen).toEqual({
      secret: undefined,
      secretIn: false,
      secretListed: false,
      secretDescribed: undefined,
      spread: undefined,
      url: 'https://proj.supabase.co',
      urlIn: true,
      urlListed: true,
      nodeEnv: 'production',
      tier: undefined
    })
    // A scope value still wins, and a masked allowlisted key stays masked.
    expect(await withEnv({ SOME_SECRET: 'scoped', SUPABASE_URL: undefined }, async () => [process.env.SOME_SECRET, process.env.SUPABASE_URL])).toEqual(['scoped', undefined])
    expect(await withEnv({ MISO_CALLER_TIER: undefined }, async () => process.env.MISO_CALLER_TIER)).toBeUndefined()
    // Outside a scope, everything reads through as before.
    expect(process.env.SOME_SECRET).toBe('deploy-secret')
    expect(process.env.MISO_CALLER_TIER).toBe('admin')
    expect('SOME_SECRET' in process.env).toBe(true)
  } finally {
    for (const key of ['SOME_SECRET', 'SUPABASE_URL', 'NODE_ENV', 'MISO_CALLER_TIER']) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})
