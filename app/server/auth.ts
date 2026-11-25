// Every /api route except /api/config needs a signed-in member.
// The browser signs in with Supabase Auth and sends its access token as a
// Bearer header; `<img>`-style requests that can't set headers use the
// `miso_token` cookie the client mirrors the same token into.
import { createClient, isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Me, MemberStatus, MemberTier } from '../lib/types'
import { publishableKey, supabaseUrl, userClient } from './supabase'
import { APP_NAME } from '../lib/brand'

export type AuthedUser = Me & { token: string }

export type AuthEnv = { Variables: { user: AuthedUser } }

// Verified tokens, briefly: every request would otherwise cost Supabase round
// trips (getUser, then is_member and their tier). Short enough that a revoked
// member, or a tier change, takes effect within a minute.
const TTL_MS = 60_000
const MAX_VERIFIED = 500
// In insertion order, so the first entry is the oldest.
const verified = new Map<string, { user: AuthedUser; until: number }>()

function remember(token: string, user: AuthedUser): void {
  const now = Date.now()
  if (verified.size >= MAX_VERIFIED) {
    for (const [key, entry] of verified) if (entry.until <= now) verified.delete(key)
  }
  while (verified.size >= MAX_VERIFIED) verified.delete(verified.keys().next().value!)
  verified.set(token, { user, until: now + TTL_MS })
}

// After a change to what /api/me returns (the welcome step's name), so it isn't a minute late.
export function forgetVerified(token: string): void {
  verified.delete(token)
}

// One client for verifying tokens: it keeps no session, so it can serve every request.
let anonClient: { url: string; key: string; client: ReturnType<typeof createClient> } | null = null
function anon() {
  const url = supabaseUrl()
  const key = publishableKey()
  if (anonClient?.url !== url || anonClient.key !== key) {
    anonClient = { url, key, client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) }
  }
  return anonClient.client
}

// The token's own `sub` claim, unverified: only used to look up the caller's row while getUser
// verifies the token, and checked against the verified user before it counts.
function claimedUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export const TOKEN_COOKIE = 'miso_token'

function tokenFrom(header: string | undefined, cookie: string | undefined): string | null {
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return bearer || cookie || null
}

// Auth that couldn't answer (unreachable, a server error, rate limited), as opposed to Auth saying
// the token is no good (401, 403, other 4xx).
function authIsDown(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.status === 429
}

// 'unavailable' is a database that couldn't answer, which says nothing about the person: unlike
// 'forbidden' it must not sign them out.
export async function verifyToken(token: string): Promise<AuthedUser | 'unauthenticated' | 'forbidden' | 'unavailable'> {
  const cached = verified.get(token)
  if (cached && cached.until > Date.now()) return cached.user

  // All three at once. is_member and the row run as the token, so a bad token gets nothing there.
  const client = userClient(token)
  const claimed = claimedUserId(token)
  const [{ data, error }, { data: member, error: memberError }, rowResult] = await Promise.all([
    anon().auth.getUser(token),
    client.rpc('is_member'),
    // Everyone may read their own row (app_user_select_own). Unreadable counts
    // as no tier, which only hides spaces that ask for one.
    claimed
      ? client
          .schema('app')
          .from('app_user')
          .select('tier, status')
          .eq('user_id', claimed)
          .maybeSingle<{ tier: MemberTier | null; status: MemberStatus }>()
      : Promise.resolve({ data: null })
  ])
  if (error && authIsDown(error)) return 'unavailable'
  if (error || !data.user) return 'unauthenticated'
  if (memberError) return 'unavailable'
  if (member !== true) return 'forbidden'
  const row = claimed === data.user.id ? rowResult.data : null
  const rowFailed = 'error' in rowResult && rowResult.error != null

  const meta = data.user.user_metadata ?? {}
  const user: AuthedUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    // display_name is the one they entered in the welcome step (server/welcome.ts).
    name: (meta.display_name as string | undefined) ?? (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
    avatarUrl: (meta.avatar_url as string | undefined) ?? null,
    tier: row?.tier ?? null,
    status: row?.status ?? null,
    token
  }
  // A tier that couldn't be read (as opposed to one that isn't there) is asked again next time,
  // not served as "no tier" for a minute.
  if (!rowFailed) remember(token, user)
  return user
}

export const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = tokenFrom(c.req.header('authorization'), getCookie(c, TOKEN_COOKIE))
  if (!token) return c.json({ error: `Sign in to use ${APP_NAME}.` }, 401)
  const result = await verifyToken(token)
  if (result === 'unauthenticated') return c.json({ error: 'Your session expired. Sign in again.' }, 401)
  if (result === 'forbidden') {
    return c.json({ error: 'This account is not a member of this workspace.' }, 403)
  }
  if (result === 'unavailable') return c.json({ error: "Couldn't check your account. Try again in a moment." }, 503)
  c.set('user', result)
  await next()
}
