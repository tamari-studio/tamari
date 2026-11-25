import { afterEach, expect, spyOn, test } from 'bun:test'

import { MISO_VAULT_EMAIL, resetVaultClientForTest, vaultClient } from './supabase'

// Restore in place: replacing `process.env` would drop the per-call env proxy
// (app/server/env.ts) for every test file that runs after this one.
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  resetVaultClientForTest()
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('with the secret key and no vault password, the vault account is brokered', async () => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
  delete process.env.MISO_VAULT_EMAIL
  delete process.env.MISO_VAULT_PASSWORD

  const calls: { url: string; auth: string | null; body: string }[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    calls.push({ url, auth: headers.get('authorization'), body: String(init?.body ?? '') })
    if (url.includes('/auth/v1/admin/generate_link')) {
      return json({ id: 'u-vault', email: MISO_VAULT_EMAIL, hashed_token: 'hash-1', verification_type: 'magiclink' })
    }
    if (url.includes('/auth/v1/verify')) {
      return json({
        access_token: 'vault-token',
        refresh_token: 'r-1',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: 'u-vault', email: MISO_VAULT_EMAIL }
      })
    }
    if (url.includes('/rest/v1/rpc/connector_secrets')) return json([])
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch)

  try {
    const db = await vaultClient()
    const { error } = await db.rpc('connector_secrets')
    expect(error).toBeNull()
  } finally {
    fetchSpy.mockRestore()
  }

  const link = calls.find(c => c.url.includes('/auth/v1/admin/generate_link'))
  expect(link?.auth).toBe('Bearer sb_secret_x')
  expect(link?.body).toContain(MISO_VAULT_EMAIL)
  expect(calls.some(c => c.url.includes('/auth/v1/token?grant_type=password'))).toBe(false)
  expect(calls.find(c => c.url.includes('/rest/v1/rpc/connector_secrets'))?.auth).toBe('Bearer vault-token')
})
