import { expect, test } from 'bun:test'

import { PING_EVERY_MS, shouldPing } from './activity'

test('the first ping always goes out', () => {
  expect(shouldPing(null, 1_000)).toBe(true)
})

test('later pings wait the full interval', () => {
  expect(shouldPing(1_000, 1_000 + PING_EVERY_MS - 1)).toBe(false)
  expect(shouldPing(1_000, 1_000 + PING_EVERY_MS)).toBe(true)
})
