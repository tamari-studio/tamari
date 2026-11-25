import { expect, test } from 'bun:test'
import { SNOOZE_MS, snoozed } from './ConnectAgentBanner'

test('"Remind me later" hides the card for a week, then it comes back', () => {
  const at = 1_800_000_000_000
  expect(snoozed(null, at)).toBe(false)
  expect(snoozed(String(at), at + 1000)).toBe(true)
  expect(snoozed(String(at), at + SNOOZE_MS - 1)).toBe(true)
  expect(snoozed(String(at), at + SNOOZE_MS)).toBe(false)
  expect(snoozed('garbage', at)).toBe(false)
})
