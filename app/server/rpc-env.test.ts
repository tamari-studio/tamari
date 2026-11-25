import { expect, test } from 'bun:test'

import { isReservedEnvKey } from '../lib/connectors'
import { spaceCallEnv } from './rpc'

test('space calls get the brokered token and never the secret key or vault login', () => {
  const env = spaceCallEnv({
    connectorEnv: {
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_leak'
    },
    spaceId: 'sp1',
    folder: 'ops',
    dtoToken: 'tok-1'
  })
  expect(env.MISO_DTO_ACCESS_TOKEN).toBe('tok-1')
  expect(env.SUPABASE_URL).toBe('https://proj.supabase.co')
  expect('SUPABASE_SECRET_KEY' in env && env.SUPABASE_SECRET_KEY === undefined).toBe(true) // masked, not just absent
  expect(env.MISO_VAULT_PASSWORD).toBeUndefined()
  expect(env.MISO_SPACE_ID).toBe('sp1')
})

test('no token yet: the key is absent so dto-core uses its fallback', () => {
  const env = spaceCallEnv({ connectorEnv: {}, spaceId: 'sp1', folder: 'ops', dtoToken: null })
  expect('MISO_DTO_ACCESS_TOKEN' in env).toBe(false)
})

test('the verified caller is in the env: id and email, never the access token', () => {
  const env = spaceCallEnv({
    connectorEnv: {},
    spaceId: 'sp1',
    folder: 'ops',
    dtoToken: 'tok-1',
    caller: { id: 'u-1', email: 'ada@example.com', token: 'user-access-token' } as { id: string; email: string }
  })
  expect(env.MISO_CALLER_ID).toBe('u-1')
  expect(env.MISO_CALLER_EMAIL).toBe('ada@example.com')
  expect(Object.values(env)).not.toContain('user-access-token')
})

test('a connector cannot set the caller: the key is reserved and the app value wins', () => {
  expect(isReservedEnvKey('MISO_CALLER_EMAIL')).toBe(true)
  expect(isReservedEnvKey('MISO_CALLER_ID')).toBe(true)
  const spoof = { MISO_CALLER_EMAIL: 'boss@example.com', MISO_CALLER_ID: 'u-boss' }
  const signedIn = spaceCallEnv({ connectorEnv: spoof, spaceId: 'sp1', folder: 'ops', dtoToken: null, caller: { id: 'u-1', email: 'ada@example.com' } })
  expect(signedIn.MISO_CALLER_EMAIL).toBe('ada@example.com')
  expect(signedIn.MISO_CALLER_ID).toBe('u-1')
  // Nobody signed in: masked, so the spoofed value is gone rather than inherited.
  const anonymous = spaceCallEnv({ connectorEnv: spoof, spaceId: 'sp1', folder: 'ops', dtoToken: null })
  expect(anonymous.MISO_CALLER_EMAIL).toBeUndefined()
  expect(anonymous.MISO_CALLER_ID).toBeUndefined()
})
