// Two ways the API reaches Supabase:
//   • userClient(token) — as the signed-in person, so miso's row level
//     security decides what they can read and write.
//   • vaultClient()     — as the miso vault account (MISO_VAULT_EMAIL),
//     for the few things a person must never touch directly: connector
//     secrets. Its session is minted through the Auth admin API the way space
//     sessions are (plan 31), so it needs no password and no mailbox; the
//     token never leaves this process.
// Both use the publishable key; the secret key only ever mints sessions.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { createSessionBroker, SECRET_KEY_ENV, supabaseAuthOps } from '../vendor/dto-core/session'

// A client pinned to the `miso` schema. Untyped rows: the API maps them itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>

export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set on the server`)
  return value
}

export function supabaseUrl(): string {
  return requiredEnv('SUPABASE_URL')
}

// The address the browser reaches Supabase at. The Compose install (selfhost/) serves Supabase under
// the app's own address, which the server can't reach from inside its container, so it sets both.
export function publicSupabaseUrl(): string {
  return process.env.SUPABASE_PUBLIC_URL || supabaseUrl()
}

export function publishableKey(): string {
  return requiredEnv('SUPABASE_PUBLISHABLE_KEY')
}

// PostgREST checks a token's issue time against a clock that lags once it has been idle, so a token
// minted a moment ago (a sign-in, a refresh, the vault's session) can be refused with PGRST303 "JWT
// issued at future" on the first requests while the next ones pass. The token is fine: try again.
const ISSUED_AT_FUTURE = 'JWT issued at future'

export function retryIssuedAtFuture(delaysMs: number[] = [150, 400, 900]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // A Request's body can be read once, so every attempt sends its own copy.
    const send = () => globalThis.fetch(input instanceof Request ? input.clone() : input, init)
    for (let attempt = 0; ; attempt++) {
      const response = await send()
      if (response.status !== 401 || attempt >= delaysMs.length) return response
      if (!(await response.clone().text()).includes(ISSUED_AT_FUTURE)) return response
      await new Promise(resolve => setTimeout(resolve, delaysMs[attempt]))
    }
  }) as typeof fetch
}

export function userClient(token: string): Db {
  return createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'miso' },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: retryIssuedAtFuture() }
  })
}

export const VAULT_ENV_KEYS = ['MISO_VAULT_EMAIL', 'MISO_VAULT_PASSWORD'] as const

export const MISO_VAULT_EMAIL = process.env.MISO_VAULT_EMAIL || 'miso-vault@example.com'

let vaultBroker = newVaultBroker()
let brokeredVault: Db | null = null

function newVaultBroker() {
  return createSessionBroker({
    email: MISO_VAULT_EMAIL,
    ops: async () =>
      supabaseAuthOps({
        url: supabaseUrl(),
        service: true,
        publishableKey: publishableKey(),
        secretKey: requiredEnv(SECRET_KEY_ENV)
      })
  })
}

export function resetVaultClientForTest(): void {
  vaultBroker = newVaultBroker()
  brokeredVault = null
}

export async function vaultClient(): Promise<Db> {
  // Mint (or reuse) the session up front so a refused key fails here, not
  // halfway through a query.
  await vaultBroker.token()
  return (brokeredVault ??= createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'miso' },
    global: { fetch: retryIssuedAtFuture() },
    accessToken: async () => (await vaultBroker.token()).accessToken
  }))
}
