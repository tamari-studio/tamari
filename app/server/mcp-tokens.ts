// Connection tokens: how a member's own AI tool signs in to /api/mcp (server/mcp.ts).
//
// A member makes a named token on Settings and sees it once. The database keeps only its SHA-256
// (miso.ai_tokens, migration 20261123000300). On a request the API:
//   1. hashes the token and asks whose it is (miso.ai_token_owner, as the vault account). This
//      runs on every request and is never cached, so deleting a token stops it at once;
//   2. opens that member's own Supabase session (the Auth admin API, the way the vault account's
//      session is made; cached per member in this process and refreshed without the secret key);
//   3. runs verifyToken() on that session: the same member checks as every other /api route.
// From there the request is that member: their tier, their space access, row level security.
// A token is only ever read on /api/mcp. No other route accepts one.
import { createHash, randomBytes } from 'node:crypto'
import { createSessionBroker, SECRET_KEY_ENV, supabaseAuthOps } from '../vendor/dto-core/session'
import { verifyToken, type AuthedUser } from './auth'
import { InputError } from './connectors'
import { publishableKey, requiredEnv, supabaseUrl, vaultClient, type Db } from './supabase'

export const TOKEN_PREFIX = 'miso_ai_'
// 32 random bytes, base64url: 43 characters.
const TOKEN_SHAPE = /^miso_ai_[A-Za-z0-9_-]{43}$/
export const TOKEN_NAME_MAX = 60
export const TOKENS_MAX = 10

export function newToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export function looksLikeToken(value: string): boolean {
  return TOKEN_SHAPE.test(value)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function parseTokenName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > TOKEN_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new InputError(`Give the token a name of 1 to ${TOKEN_NAME_MAX} characters, on one line.`)
  }
  return name
}

// --- The member's own list (Settings) ---------------------------------------------

// editsSpaces: the token may change spaces (the Compose install's write tools, server/mcp-space-tools.ts).
export type AiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null; editsSpaces: boolean }
// `available: false` is a database without the tokens table yet (the code can reach a twin before
// its migration does): the page says so instead of failing.
// editsAvailable: false on a database without the column yet (migration 20261124000000): every
// token there reads, and Settings doesn't offer the switch.
export type AiTokenList = { available: boolean; editsAvailable?: boolean; tokens: AiToken[] }

export type AiTokenStore = {
  list(): Promise<AiTokenList>
  // null when the table isn't there.
  create(name: string, hash: string, editsSpaces: boolean): Promise<AiToken | null>
  remove(id: string): Promise<boolean>
}

type TokenRow = { id: string; name: string; created_at: string; last_used_at: string | null; edits_spaces?: boolean }
const toToken = (r: TokenRow): AiToken => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, editsSpaces: r.edits_spaces === true })

// PostgREST and Postgres for "no such table" and "no such function".
const MISSING = new Set(['PGRST205', 'PGRST202', '42P01', '42883'])
export const isMissing = (error: { code?: string } | null): boolean => !!error?.code && MISSING.has(error.code)
// "no such column" (Postgres, and PostgREST's schema cache): a database before edits_spaces.
const NO_COLUMN = new Set(['42703', 'PGRST204'])
const noColumn = (error: { code?: string } | null): boolean => !!error?.code && NO_COLUMN.has(error.code)
export const EDITS_NOT_SET_UP = "Tokens that may change spaces aren't set up on this workspace yet. Ask whoever runs it to apply the latest database migration."

// As the signed-in member: row level security shows and deletes only their own tokens.
export function supabaseAiTokenStore(client: Db): AiTokenStore {
  const base = 'id, name, created_at, last_used_at'
  const columns = `${base}, edits_spaces`
  return {
    async list() {
      let editsAvailable = true
      const read = (cols: string) => client.from('ai_tokens').select(cols).order('created_at', { ascending: false }).returns<TokenRow[]>()
      let { data, error } = await read(columns)
      if (noColumn(error)) {
        editsAvailable = false
        ;({ data, error } = await read(base))
      }
      if (isMissing(error)) return { available: false, tokens: [] }
      if (error) throw new Error(`reading connection tokens: ${error.message}`)
      return { available: true, editsAvailable, tokens: ((data ?? []) as TokenRow[]).map(toToken) }
    },
    async create(name, hash, editsSpaces) {
      // The column only when it is asked for, so a read-only token is made on a database without it too.
      let { data, error } = await client
        .from('ai_tokens')
        .insert({ name, token_hash: hash, ...(editsSpaces ? { edits_spaces: true } : {}) })
        .select(columns)
        .single<TokenRow>()
      if (noColumn(error)) {
        if (editsSpaces) throw new InputError(EDITS_NOT_SET_UP)
        // Saved already; only reading it back named the missing column.
        ;({ data, error } = await client.from('ai_tokens').select(base).eq('token_hash', hash).single<TokenRow>())
      }
      if (isMissing(error)) return null
      if (error || !data) throw new Error(`saving a connection token: ${error?.message ?? 'no row'}`)
      return toToken(data)
    },
    async remove(id) {
      const { data, error } = await client.from('ai_tokens').delete().eq('id', id).select('id')
      if (isMissing(error)) return false
      if (error) throw new Error(`deleting a connection token: ${error.message}`)
      return (data ?? []).length > 0
    }
  }
}

export const NOT_SET_UP = "Connection tokens aren't set up on this workspace yet. Ask whoever runs it to apply the latest database migration."

// What POST /api/ai-tokens does. The token itself is returned once and kept nowhere.
// Any member may make a token that may change spaces: a member's changes stay in their own drafts,
// and the tools check the tier on every call (mcp-space-tools.ts).
export async function createAiToken(store: AiTokenStore, body: { name?: unknown; editsSpaces?: unknown }): Promise<(AiToken & { token: string }) | null> {
  const name = parseTokenName(body.name)
  const editsSpaces = body.editsSpaces === true
  if (body.editsSpaces !== undefined && typeof body.editsSpaces !== 'boolean') throw new InputError('editsSpaces is true or false.')
  const existing = await store.list()
  if (!existing.available) return null
  if (existing.tokens.length >= TOKENS_MAX) throw new InputError(`You have ${TOKENS_MAX} tokens, which is the most one person can have. Delete one you no longer use.`)
  const token = newToken()
  const saved = await store.create(name, hashToken(token), editsSpaces)
  return saved ? { ...saved, token } : null
}

// --- From a token to its member (POST /api/mcp) --------------------------------------

// editsSpaces: what the token itself allows. The member's tier is checked separately, on each write.
export type TokenOwner = { userId: string; email: string; editsSpaces?: boolean }

// 'unauthenticated': not a token, or one that was deleted. 'forbidden': the member is suspended or
// no longer a member. 'unavailable': Supabase couldn't answer. 'not-set-up': no tokens table yet.
export type TokenUser = AuthedUser & { editsSpaces?: boolean }
export type TokenResult = TokenUser | 'unauthenticated' | 'forbidden' | 'unavailable' | 'not-set-up'

export type TokenAuthDeps = {
  // Whose token has this hash; null when nobody's.
  owner(hash: string): Promise<TokenOwner | null | 'not-set-up' | 'unavailable'>
  // An access token of that member's own session. `fresh` drops a cached session first.
  session(owner: TokenOwner, fresh: boolean): Promise<string>
  verify(accessToken: string): Promise<AuthedUser | 'unauthenticated' | 'forbidden' | 'unavailable'>
}

export function createTokenAuth(deps: TokenAuthDeps) {
  return async function memberForToken(token: string): Promise<TokenResult> {
    if (!looksLikeToken(token)) return 'unauthenticated'
    const owner = await deps.owner(hashToken(token))
    if (owner === null) return 'unauthenticated'
    if (owner === 'not-set-up' || owner === 'unavailable') return owner
    // Twice at most: a cached session can have ended (the member signed out everywhere).
    for (const fresh of [false, true]) {
      let accessToken: string
      try {
        accessToken = await deps.session(owner, fresh)
      } catch (err) {
        console.error('opening a member session for a connection token failed:', err)
        return 'unavailable'
      }
      const user = await deps.verify(accessToken)
      if (user === 'unauthenticated') continue
      if (typeof user === 'string') return user
      // The session must be the token owner's, whatever the email resolved to.
      if (user.id !== owner.userId) return 'unauthenticated'
      return owner.editsSpaces ? { ...user, editsSpaces: true } : user
    }
    return 'unavailable'
  }
}

const SESSIONS_MAX = 200

// One session per member in this process, minted through the Auth admin API and refreshed with
// its refresh token (vendor/dto-core/session.ts).
export function memberSessions(options: { ops?: Parameters<typeof createSessionBroker>[0]['ops'] } = {}) {
  const ops =
    options.ops ?? (async () => supabaseAuthOps({ url: supabaseUrl(), publishableKey: publishableKey(), secretKey: requiredEnv(SECRET_KEY_ENV) }))
  // In insertion order, so the first entry is the oldest.
  const brokers = new Map<string, ReturnType<typeof createSessionBroker>>()
  return async function session(owner: TokenOwner, fresh: boolean): Promise<string> {
    const key = `${owner.userId}\n${owner.email}`
    let broker = brokers.get(key)
    if (broker && fresh) broker.reset()
    if (!broker) {
      while (brokers.size >= SESSIONS_MAX) brokers.delete(brokers.keys().next().value!)
      // No random head start and few retries: a person's request is waiting, unlike a cold service mint.
      broker = createSessionBroker({ email: owner.email, ops, mintAttempts: 3, random: () => 0 })
      brokers.set(key, broker)
    }
    try {
      return (await broker.token()).accessToken
    } catch (err) {
      brokers.delete(key)
      throw err
    }
  }
}

export async function supabaseTokenOwner(hash: string): Promise<TokenOwner | null | 'not-set-up' | 'unavailable'> {
  let service: Db
  try {
    service = await vaultClient()
  } catch (err) {
    console.error('connection tokens: the vault account could not sign in:', err)
    return 'unavailable'
  }
  const { data, error } = await service.rpc('ai_token_owner', { p_hash: hash })
  if (isMissing(error)) return 'not-set-up'
  if (error) {
    console.error(`connection tokens: looking up a token failed: ${error.message}`)
    return 'unavailable'
  }
  const row = ((data ?? []) as { user_id: string; email: string | null }[])[0]
  // No email, no session to open: the app's sign-in is by email.
  if (!row?.email) return null
  // A database without the column yet (an older migration) reads as read-only.
  const edits = await service.rpc('ai_token_edits_spaces', { p_hash: hash })
  if (edits.error && !isMissing(edits.error)) console.error(`connection tokens: reading edits_spaces failed: ${edits.error.message}`)
  return { userId: row.user_id, email: row.email, editsSpaces: edits.data === true }
}

export const supabaseTokenAuth = () => createTokenAuth({ owner: supabaseTokenOwner, session: memberSessions(), verify: verifyToken })
