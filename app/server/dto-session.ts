// The hosted twin of local miso's server/dto-session.ts (plan 31): the secret
// key lives in Vercel env, and space calls get only the access token, masked
// the same way the vault login is (see rpc.ts).
import { createSessionBroker, SECRET_KEY_ENV, supabaseAuthOps } from '../vendor/dto-core/session'
import { publishableKey, supabaseUrl } from './supabase'

const broker = createSessionBroker({
  ops: async () =>
    supabaseAuthOps({
      url: supabaseUrl(),
      service: true,
      publishableKey: publishableKey(),
      secretKey: process.env[SECRET_KEY_ENV] ?? null
    })
})

/** Null until Vercel has SUPABASE_SECRET_KEY: spaces then keep the old login. */
export async function hostedDtoToken(): Promise<string | null> {
  if (!process.env[SECRET_KEY_ENV]) return null
  return (await broker.token()).accessToken
}
