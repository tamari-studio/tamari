import { afterEach, expect, test } from 'bun:test'

import { callerEmail, callerId, requireCaller } from './index'

afterEach(() => {
  delete process.env.MISO_CALLER_EMAIL
  delete process.env.MISO_CALLER_ID
})

test('no caller: null, and requireCaller throws a clear error', () => {
  expect(callerEmail()).toBeNull()
  expect(callerId()).toBeNull()
  expect(() => requireCaller()).toThrow('This action needs a signed-in member')
})

test('reads the caller from the environment', () => {
  process.env.MISO_CALLER_EMAIL = 'ada@example.com'
  process.env.MISO_CALLER_ID = 'u-1'
  expect(callerEmail()).toBe('ada@example.com')
  expect(callerId()).toBe('u-1')
  expect(requireCaller()).toEqual({ email: 'ada@example.com', id: 'u-1' })
})

test('an email without an id is not a caller', () => {
  process.env.MISO_CALLER_EMAIL = 'ada@example.com'
  expect(() => requireCaller()).toThrow('signed-in member')
})

// The per-call env scope (withEnv) is the hosted app's, and its own tests cover it.
