/**
 * Short-lived Supabase sessions for the non-personal service user space code
 * runs as (plan 31). Nothing here needs a password.
 *
 *   - `createSessionBroker` is for whatever holds the secret key: local miso's
 *     host process (server/dto-session.ts) and the hosted app's server. It
 *     mints a session through the Auth admin API, refreshes it with its refresh
 *     token (no secret needed), and shares one attempt between concurrent
 *     callers.
 *   - `dtoAccessToken` (below) is for space code, which never sees the secret
 *     key.
 */
import { createClient } from '@supabase/supabase-js'

export const MISO_SPACES_EMAIL = process.env.MISO_SPACES_EMAIL || 'miso-spaces@example.com'
export const SECRET_KEY_ENV = 'SUPABASE_SECRET_KEY'
export const SESSION_URL_ENV = 'MISO_DTO_SESSION_URL'
export const ACCESS_TOKEN_ENV = 'MISO_DTO_ACCESS_TOKEN'

/** Refresh when fewer than this many seconds are left on the session. */
const REFRESH_MARGIN_S = 5 * 60
/** A token with less than this left is not worth handing out. */
const USABLE_MARGIN_S = 30

export type BrokerSession = { accessToken: string; refreshToken: string; expiresAt: number }
export type BrokerToken = { accessToken: string; expiresAt: number }

export type AuthOps = {
  /** A one-time magic-link hash for `email`, or null when no such user exists. */
  magicLinkHash(email: string): Promise<string | null>
  createUser(email: string): Promise<void>
  verify(tokenHash: string): Promise<BrokerSession>
  refresh(refreshToken: string): Promise<BrokerSession>
}

/** 503: not configured yet. 502: Supabase refused (e.g. a revoked key). */
export class BrokerError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
    /** Supabase Auth's error code when it gave one (for example `otp_expired`). */
    readonly code?: string
  ) {
    super(message)
    this.name = 'BrokerError'
  }
}

/**
 * Whether a failed `verify` means the magic link was replaced before it was used. Supabase Auth keeps
 * one pending link per user, so when two broker instances mint for the service user at once (a cold
 * start on several hosted server instances), the later `generateLink` replaces the earlier link and
 * the earlier `verifyOtp` is refused with "Email link is invalid or has expired". Minting again fixes it.
 */
export function isLinkReplaced(error: unknown): boolean {
  return (
    error instanceof BrokerError &&
    (error.code === 'otp_expired' || /invalid or has expired/i.test(error.message))
  )
}

type RawSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in: number
}

function toSession(raw: RawSession): BrokerSession {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_at ?? Math.floor(Date.now() / 1000) + raw.expires_in
  }
}

// Auth's error codes for a key that isn't an admin key (a 403 carries one).
const KEY_REJECTED_CODES = new Set(['not_admin', 'bad_jwt', 'no_authorization'])

// A 401, or a 403 with one of the codes above, means Supabase looked at the
// secret key and said no. Any other 403 is a before-user-created hook refusing
// the account: app.hook_restrict_signup_by_domain answers 403 to every
// non-Workspace signup, including the broker's first mint when the service
// user doesn't exist yet. Everything else (no `status` at all, `0` for a
// network failure or AuthRetryableFetchError, 429, 5xx) is Supabase Auth
// being unreachable or unwell. Pulled out as a pure function so it's
// unit-testable without a live Supabase project.
export function describeGenerateLinkError(error: {
  status?: number
  code?: string
  message: string
}): string {
  if (error.status === 401 || (error.status === 403 && KEY_REJECTED_CODES.has(error.code ?? '')))
    return `Supabase refused the secret key: ${error.message}`
  if (error.status === 403)
    return `Supabase Auth refused to create the service user (create it as an admin first): ${error.message}`
  return `Couldn't reach Supabase Auth to sign in the service user: ${error.message}`
}

/**
 * The real Auth API. `secretKey` null still allows refreshes, just not mints.
 *
 * `service`: the email is one of the app's service accounts (the spaces or vault account), not a
 * person. A first mint before `scripts/supabase-setup.ts` ran creates that account, and without the
 * miso_service flag app.app_user_bootstrap() gives it a person row: on an empty database it becomes
 * the owner, and the setup can't take that back (the last-owner lock). So the account is created
 * flagged. Auth stores generateLink's `data` as user_metadata when the magic link creates the user.
 */
export function supabaseAuthOps(config: {
  url: string
  publishableKey: string
  secretKey: string | null
  service?: boolean
}): AuthOps {
  const flag = config.service ? { miso_service: true } : undefined
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const publicAuth = createClient(config.url, config.publishableKey, options).auth
  const admin = () => {
    if (!config.secretKey) {
      throw new BrokerError(
        'The Supabase connector has no secret key yet. Add one in Settings → Connectors → Supabase.',
        503
      )
    }
    return createClient(config.url, config.secretKey, options).auth.admin
  }
  return {
    async magicLinkHash(email) {
      const { data, error } = await admin().generateLink({ type: 'magiclink', email, ...(flag ? { options: { data: flag } } : {}) })
      if (error) {
        // In practice GoTrue's admin generateLink for `magiclink` never 404s
        // on an unknown email — it silently creates an unconfirmed user and
        // returns a signup hash (which `verifyOtp({ type: 'email' })` below
        // accepts), so `mint()`'s "hash === null → createUser" branch never
        // fires against real Supabase. This branch is a defensive fallback
        // only, in case that behavior ever changes or a fake `AuthOps` in a
        // test reports "no such user" this way.
        if (error.status === 404 || error.code === 'user_not_found') return null
        throw new BrokerError(describeGenerateLinkError(error), 502)
      }
      return data.properties.hashed_token
    },
    async createUser(email) {
      const { error } = await admin().createUser({ email, email_confirm: true, ...(flag ? { user_metadata: flag, app_metadata: flag } : {}) })
      if (error) throw new BrokerError(`Couldn't create ${email}: ${error.message}`, 502)
    },
    async verify(tokenHash) {
      const { data, error } = await publicAuth.verifyOtp({ token_hash: tokenHash, type: 'email' })
      if (error || !data.session) {
        throw new BrokerError(
          `Couldn't open a session: ${error?.message ?? 'no session returned'}`,
          502,
          error?.code
        )
      }
      return toSession(data.session)
    },
    async refresh(refreshToken) {
      const { data, error } = await publicAuth.refreshSession({ refresh_token: refreshToken })
      if (error || !data.session) {
        throw new BrokerError(
          `Couldn't refresh the session: ${error?.message ?? 'no session returned'}`,
          502
        )
      }
      return toSession(data.session)
    }
  }
}

/** How many times a mint is tried when its link keeps being replaced by another instance's mint. */
const MINT_ATTEMPTS = 16
/** Base wait before a retry, in ms; grows with the attempt up to a cap, jittered so instances spread out. */
const MINT_BACKOFF_MS = 150
const MINT_BACKOFF_MAX_MS = 600
/** The random head start before a cold mint, at most this many ms. */
const MINT_START_JITTER_MS = 400

export function createSessionBroker(options: {
  ops: () => Promise<AuthOps>
  email?: string
  now?: () => number
  mintAttempts?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}) {
  const email = options.email ?? MISO_SPACES_EMAIL
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const attempts = options.mintAttempts ?? MINT_ATTEMPTS
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random
  let session: BrokerSession | null = null
  let inflight: Promise<BrokerSession> | null = null

  // One attempt: a fresh magic link, verified. Another instance's mint can replace this link in between.
  async function mintOnce(): Promise<BrokerSession> {
    const ops = await options.ops()
    let hash = await ops.magicLinkHash(email)
    if (hash === null) {
      // Defensive fallback: real Supabase never reports "no such user" this
      // way (see the comment in `magicLinkHash` above) — the first mint
      // against a project instead creates the service user via
      // `generateLink`'s own signup path. This only runs if `magicLinkHash`
      // ever does report null, e.g. a fake `AuthOps` in a test.
      await ops.createUser(email)
      hash = await ops.magicLinkHash(email)
      if (hash === null)
        throw new BrokerError(`${email} still doesn't exist after creating it.`, 502)
    }
    return ops.verify(hash)
  }

  async function mint(): Promise<BrokerSession> {
    // Cold instances that start together would all take a link at the same moment; a small random head
    // start spreads them out so most mints never collide at all (only a cold mint pays it).
    const lead = Math.round(random() * MINT_START_JITTER_MS)
    if (lead > 0) await sleep(lead)
    for (let attempt = 1; ; attempt++) {
      try {
        return await mintOnce()
      } catch (error) {
        if (!isLinkReplaced(error) || attempt >= attempts) throw error
        // Someone else's mint replaced our link, and their session is now open: wait a jittered, growing
        // moment so the instances stop colliding, then take a fresh link.
        await sleep(
          Math.round(Math.min(MINT_BACKOFF_MS * attempt, MINT_BACKOFF_MAX_MS) * (0.5 + random()))
        )
      }
    }
  }

  async function renew(current: BrokerSession | null): Promise<BrokerSession> {
    try {
      if (current) {
        try {
          return await (await options.ops()).refresh(current.refreshToken)
        } catch {
          // A dead refresh token is normal after a long sleep; mint instead.
        }
      }
      return await mint()
    } catch (error) {
      // Renewal failed (e.g. the key was revoked) but the current token still
      // works: keep serving it rather than failing every request early.
      if (current && current.expiresAt - now() > USABLE_MARGIN_S) return current
      throw error
    }
  }

  async function token(): Promise<BrokerToken> {
    const current = session
    if (current && current.expiresAt - now() > REFRESH_MARGIN_S) {
      return { accessToken: current.accessToken, expiresAt: current.expiresAt }
    }
    if (!inflight) {
      inflight = renew(current)
        .then(next => (session = next))
        .finally(() => (inflight = null))
    }
    const next = await inflight
    return { accessToken: next.accessToken, expiresAt: next.expiresAt }
  }

  return {
    token,
    reset() {
      session = null
    }
  }
}

// ---------------------------------------------------------------------------
// Space side: the token space code sends, without ever seeing the secret key.
// ---------------------------------------------------------------------------

/** Reuse a fetched token until this many seconds before it expires. */
const CLIENT_MARGIN_S = 60

/** `status` is the broker's HTTP status, or 0 when it couldn't be reached. */
export class BrokerUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'BrokerUnavailableError'
  }
}

let cachedToken: BrokerToken | null = null
let fetching: Promise<BrokerToken> | null = null

async function fetchBrokerToken(url: string, fetchImpl: typeof fetch): Promise<BrokerToken> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BrokerUnavailableError(
      `[miso/dto-core] Couldn't reach miso's session broker at ${url} — is miso running? (${reason})`,
      0
    )
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_at?: number
    error?: string
  }
  if (!response.ok || !body.access_token || !body.expires_at) {
    throw new BrokerUnavailableError(
      `[miso/dto-core] miso's session broker answered ${response.status}: ${body.error ?? 'no token in the reply'}`,
      response.status
    )
  }
  return { accessToken: body.access_token, expiresAt: body.expires_at }
}

/**
 * The access token for this call, or null when this environment has no broker
 * (the caller decides whether a fallback exists).
 *   1. `MISO_DTO_ACCESS_TOKEN`: the hosted app sets one per call. Never cached.
 *   2. `MISO_DTO_SESSION_URL`: local miso's loopback broker. Cached, one fetch at a time.
 */
export async function dtoAccessToken(
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const direct = process.env[ACCESS_TOKEN_ENV]
  if (direct) return direct
  const url = process.env[SESSION_URL_ENV]
  if (!url) return null
  if (cachedToken && cachedToken.expiresAt - now() > CLIENT_MARGIN_S) return cachedToken.accessToken
  if (!fetching) {
    fetching = fetchBrokerToken(url, fetchImpl)
      .then(token => (cachedToken = token))
      .finally(() => (fetching = null))
  }
  return (await fetching).accessToken
}

export function resetDtoAccessTokenForTest(): void {
  cachedToken = null
  fetching = null
}
