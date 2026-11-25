import { afterEach, expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { MemberTier } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'

function appAs(tier: MemberTier) {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  return createApp({ catalog: { spaces: [], applets: [] }, modules: {}, commit: null, builtAt: '', requireUser: signedIn })
}

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test("members and managers can't create, change or delete connectors", async () => {
  for (const tier of ['member', 'manager'] as const) {
    const app = appAs(tier)
    expect((await app.request('/api/connectors', json('POST', { kind: 'custom', name: 'x' }))).status).toBe(403)
    expect((await app.request('/api/connectors/c1', json('PATCH', { name: 'y' }))).status).toBe(403)
    expect((await app.request('/api/connectors/c1', { method: 'DELETE' })).status).toBe(403)
  }
})

// Restore in place: replacing `process.env` would drop the per-call env proxy (app/server/env.ts).
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

test('an admin gets past the check', async () => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  // An unknown kind is refused before anything reaches Supabase.
  expect((await appAs('admin').request('/api/connectors', json('POST', { kind: 'nope', name: 'x' }))).status).toBe(400)
})
