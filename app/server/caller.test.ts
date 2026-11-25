import { afterEach, expect, test } from 'bun:test'
import { CALLER_EMAIL_ENV, CALLER_ID_ENV } from './caller'
import { callerMirror, callerPackagePath, loadCaller } from './caller-testing'
import { withEnv } from './env'

const pkg = callerPackagePath()

afterEach(() => {
  delete process.env.MISO_CALLER_EMAIL
  delete process.env.MISO_CALLER_ID
})

test.skipIf(!pkg)('the spaces package reads the env names the RPC route sets', async () => {
  const real = await loadCaller()
  expect(real.CALLER_EMAIL_ENV).toBe(CALLER_EMAIL_ENV)
  expect(real.CALLER_ID_ENV).toBe(CALLER_ID_ENV)
})

test('a per-call env scope supplies the caller and is gone afterwards', async () => {
  for (const caller of [callerMirror, await loadCaller()]) {
    const seen = await withEnv({ MISO_CALLER_EMAIL: 'bo@example.com', MISO_CALLER_ID: 'u-2' }, async () => caller.requireCaller())
    expect(seen).toEqual({ email: 'bo@example.com', id: 'u-2' })
    expect(caller.callerEmail()).toBeNull()
    expect(() => caller.requireCaller()).toThrow('This action needs a signed-in member')
  }
})
