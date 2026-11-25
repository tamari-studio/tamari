import { expect, test } from 'bun:test'

import { healthy } from './shell'

// A fake app: what it answers per path.
const app = (answers: Record<string, number>) =>
  (async (input: RequestInfo | URL) => new Response(null, { status: answers[new URL(String(input)).pathname] ?? 404 })) as unknown as typeof fetch

test('healthy needs /api/health to answer 200, not just the static page', async () => {
  expect(await healthy(1, 1, app({ '/api/health': 200, '/': 200 }))).toBe(true)
  // Missing schema or wrong keys: the static page alone no longer passes.
  expect(await healthy(1, 1, app({ '/api/health': 503, '/': 200 }))).toBe(false)
})

test('a shell from before /api/health still counts as up when it serves the page', async () => {
  expect(await healthy(1, 1, app({ '/api/health': 401, '/': 200 }))).toBe(true)
  expect(await healthy(1, 1, app({ '/': 200 }))).toBe(true)
  expect(await healthy(1, 1, app({ '/api/health': 401, '/': 500 }))).toBe(false)
})
