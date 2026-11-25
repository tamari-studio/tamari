import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { retryIssuedAtFuture } from './supabase'

let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch')
})
afterEach(() => fetchSpy.mockRestore())

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ code: 'PGRST303', message }), { status, headers: { 'content-type': 'application/json' } })

test('retries a 401 that says the token was issued in the future, and returns the answer that follows', async () => {
  fetchSpy.mockImplementationOnce(async () => reply(401, 'JWT issued at future')).mockImplementationOnce(async () => reply(200, 'ok'))
  const response = await retryIssuedAtFuture([1])('https://proj.supabase.test/rest/v1/x')
  expect(response.status).toBe(200)
  expect(fetchSpy).toHaveBeenCalledTimes(2)
})

test('leaves every other 401 alone: an expired token will not get better', async () => {
  fetchSpy.mockImplementation(async () => reply(401, 'JWT expired'))
  const response = await retryIssuedAtFuture([1, 1])('https://proj.supabase.test/rest/v1/x')
  expect(response.status).toBe(401)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
})

test('gives up after its attempts and hands back the last 401', async () => {
  fetchSpy.mockImplementation(async () => reply(401, 'JWT issued at future'))
  const response = await retryIssuedAtFuture([1, 1])('https://proj.supabase.test/rest/v1/x')
  expect(response.status).toBe(401)
  expect(fetchSpy).toHaveBeenCalledTimes(3)
})

test('sends the same body on every attempt', async () => {
  const bodies: unknown[] = []
  fetchSpy.mockImplementation(async (_input: unknown, init?: RequestInit) => {
    bodies.push(init?.body)
    return bodies.length < 2 ? reply(401, 'JWT issued at future') : reply(200, 'ok')
  })
  await retryIssuedAtFuture([1])('https://proj.supabase.test/rest/v1/rpc/x', { method: 'POST', body: '{"a":1}' })
  expect(bodies).toEqual(['{"a":1}', '{"a":1}'])
})
