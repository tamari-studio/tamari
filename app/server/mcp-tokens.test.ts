import { expect, test } from 'bun:test'
import type { AuthedUser } from './auth'
import { InputError } from './connectors'
import {
  createAiToken,
  createTokenAuth,
  hashToken,
  isMissing,
  looksLikeToken,
  newToken,
  parseTokenName,
  TOKENS_MAX,
  type AiToken,
  type AiTokenStore,
  type TokenAuthDeps,
  type TokenOwner
} from './mcp-tokens'

const ada: AuthedUser = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatarUrl: null, tier: 'member', status: 'active', token: 'ada-session' }
const owner: TokenOwner = { userId: 'u-ada', email: 'ada@example.com' }

function memoryStore(available = true): AiTokenStore & { rows: (AiToken & { hash: string })[] } {
  let rows: (AiToken & { hash: string })[] = []
  return {
    get rows() {
      return rows
    },
    list: async () => ({ available, tokens: rows.map(({ hash: _hash, ...token }) => token) }),
    async create(name, hash, editsSpaces) {
      if (!available) return null
      const token = { id: `t-${rows.length}`, name, createdAt: '2026-11-23T00:00:00Z', lastUsedAt: null, editsSpaces }
      rows.push({ ...token, hash })
      return token
    },
    async remove(id) {
      const before = rows.length
      rows = rows.filter(r => r.id !== id)
      return rows.length < before
    }
  }
}

test('a token is long, random and only its hash is stored', async () => {
  const a = newToken()
  expect(looksLikeToken(a)).toBe(true)
  expect(newToken()).not.toBe(a)
  expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/)
  const store = memoryStore()
  const made = await createAiToken(store, { name: '  Claude Code  ' })
  expect(made?.name).toBe('Claude Code')
  expect(store.rows[0].hash).toBe(hashToken(made!.token))
  expect(JSON.stringify(await store.list())).not.toContain(made!.token)
})

test('a token needs a name, and one person has at most ten', async () => {
  for (const name of [undefined, '', '   ', 'x'.repeat(61), 'two\nlines', 7]) expect(() => parseTokenName(name)).toThrow(InputError)
  const store = memoryStore()
  for (let i = 0; i < TOKENS_MAX; i++) await createAiToken(store, { name: `t${i}` })
  expect(createAiToken(store, { name: 'one more' })).rejects.toThrow(/Delete one/)
})

test('a database without the tokens table says so instead of failing', async () => {
  expect(await createAiToken(memoryStore(false), { name: 'x' })).toBeNull()
  for (const code of ['PGRST205', 'PGRST202', '42P01', '42883']) expect(isMissing({ code })).toBe(true)
  expect(isMissing({ code: '42501' })).toBe(false)
  expect(isMissing(null)).toBe(false)
})

function auth(over: Partial<TokenAuthDeps> = {}) {
  const calls = { owner: 0, session: [] as boolean[] }
  const deps: TokenAuthDeps = {
    owner: async () => owner,
    session: async () => 'ada-session',
    verify: async () => ada,
    ...over
  }
  const memberFor = createTokenAuth({
    owner: hash => (calls.owner++, deps.owner(hash)),
    session: (o, fresh) => (calls.session.push(fresh), deps.session(o, fresh)),
    verify: deps.verify
  })
  return { memberFor, calls }
}

test('a token becomes its member, through the same check as a browser session', async () => {
  const token = newToken()
  const seen: string[] = []
  const { memberFor } = auth({ owner: async hash => (seen.push(hash), owner), verify: async session => (seen.push(session), ada) })
  expect(await memberFor(token)).toBe(ada)
  expect(seen).toEqual([hashToken(token), 'ada-session'])
})

test('anything that is not a connection token is refused before the database is asked', async () => {
  const { memberFor, calls } = auth()
  for (const value of ['', 'miso_ai_short', 'eyJhbGciOiJIUzI1NiJ9.e30.sig', `${newToken()}x`]) expect(await memberFor(value)).toBe('unauthenticated')
  expect(calls.owner).toBe(0)
})

test('a deleted token is refused, and whose it is gets asked on every request', async () => {
  let deleted = false
  const { memberFor, calls } = auth({ owner: async () => (deleted ? null : owner) })
  const token = newToken()
  expect(await memberFor(token)).toBe(ada)
  deleted = true
  expect(await memberFor(token)).toBe('unauthenticated')
  expect(calls.owner).toBe(2)
})

test('a suspended or removed member is refused', async () => {
  expect(await auth({ verify: async () => 'forbidden' }).memberFor(newToken())).toBe('forbidden')
})

test('a session that ended is opened again once', async () => {
  let live = 'old'
  const { memberFor, calls } = auth({
    session: async (_o, fresh) => (fresh ? (live = 'new') : live),
    verify: async session => (session === 'new' ? ada : 'unauthenticated')
  })
  expect(await memberFor(newToken())).toBe(ada)
  expect(calls.session).toEqual([false, true])
  expect(await auth({ verify: async () => 'unauthenticated' }).memberFor(newToken())).toBe('unavailable')
})

test("a session that isn't the token owner's is refused", async () => {
  expect(await auth({ verify: async () => ({ ...ada, id: 'u-someone-else' }) }).memberFor(newToken())).toBe('unauthenticated')
})

test('Supabase not answering, or no tokens table, is not a bad token', async () => {
  expect(await auth({ owner: async () => 'unavailable' }).memberFor(newToken())).toBe('unavailable')
  expect(await auth({ owner: async () => 'not-set-up' }).memberFor(newToken())).toBe('not-set-up')
  expect(await auth({ verify: async () => 'unavailable' }).memberFor(newToken())).toBe('unavailable')
  const failing = auth({
    session: async () => {
      throw new Error('Supabase refused the secret key')
    }
  })
  const error = console.error
  console.error = () => {}
  try {
    expect(await failing.memberFor(newToken())).toBe('unavailable')
  } finally {
    console.error = error
  }
})
