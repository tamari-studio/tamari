import { afterEach, expect, spyOn, test } from 'bun:test'

import { ForbiddenError, LAST_OWNER, supabaseMembersStore } from './members'
import { userClient } from './supabase'

const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

async function updateAnswered(body: { code: string; message: string }) {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch)
  try {
    return await supabaseMembersStore(userClient('tok')).updateRow('owner-2', { tier: 'admin' }).catch(e => e)
  } finally {
    fetchSpy.mockRestore()
  }
}

test('the last-owner guard refusing a change is a 403 with a sentence, not a 500', async () => {
  const err = await updateAnswered({ code: 'P0001', message: 'last-owner invariant: demotion or suspension of the only active owner is refused' })
  expect(err).toBeInstanceOf(ForbiddenError)
  expect(err.message).toBe(LAST_OWNER)
})

test('another refusal raised without an error code is not reported as the last owner', async () => {
  const err = await updateAnswered({ code: 'P0001', message: 'only an owner may change an owner' })
  expect(err).not.toBeInstanceOf(ForbiddenError)
  expect(err.message).not.toBe(LAST_OWNER)
})
