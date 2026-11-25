import { expect, mock, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Hono, type MiddlewareHandler } from 'hono'

import { hiddenFor } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import type { Catalog, SharedRecord, SpaceAccessRule } from '../lib/types'
import type { AuthEnv, AuthedUser } from './auth'
import * as realConnectors from './connectors'
import * as realDtoSession from './dto-session'

// A space function call would otherwise reach Supabase for connector values and the brokered token.
mock.module('./connectors', () => ({ ...realConnectors, connectorEnvForSpace: async () => ({ VAULT_REPO: 'acme/secret-vault', VAULT_TOKEN: 'ghp_secret' }) }))
mock.module('./dto-session', () => ({ ...realDtoSession, hostedDtoToken: async () => 'brokered-token' }))

const { registerMcp, MCP_PATH } = await import('./mcp')
const { InputError } = await import('./connectors')
const { newToken, NOT_SET_UP } = await import('./mcp-tokens')
const { RESULT_MAX_CHARS, bounded, boundedData, notePage, recordExcerpt, spacesFor, TOOLS } = await import('./mcp-tools')
const { callerEmail } = await (await import('./caller-testing')).loadCaller()
import type { AiToken, AiTokenStore, TokenResult } from './mcp-tokens'
import type { SpaceRow, ToolData } from './mcp-tools'
import type { McpOptions } from './mcp'
import type { ServerModules } from './rpc'

const catalog: Catalog = {
  spaces: [
    { id: 'miso', slug: 'miso', folder: 'miso', previousSlugs: [], position: 0, name: 'Tamari', theme: {} },
    { id: 'board', slug: 'board', folder: 'board', previousSlugs: [], position: 1, name: 'Board', theme: {}, minTier: 'admin' },
    { id: 'vault', slug: 'vault', folder: 'vault', previousSlugs: [], position: 2, name: 'Vault', theme: {} }
  ],
  applets: [
    { ref: 'miso/how', folder: 'miso', name: 'how', kind: 'view', file: '', title: 'How Tamari works', requiredEnv: [] },
    { ref: 'miso/owners', folder: 'miso', name: 'owners', kind: 'view', file: '', title: 'Owners only', requiredEnv: [], minTier: 'owner' },
    { ref: 'miso/clock', folder: 'miso', name: 'clock', kind: 'widget', file: '', title: 'Clock', requiredEnv: [] },
    { ref: 'board/minutes', folder: 'board', name: 'minutes', kind: 'view', file: '', title: 'Minutes', requiredEnv: [] },
    { ref: 'vault/overview', folder: 'vault', name: 'overview', kind: 'view', file: '', title: 'Vault overview', requiredEnv: [] }
  ]
}

const person = (id: string, tier: AuthedUser['tier'], status: AuthedUser['status'] = 'active'): AuthedUser => ({
  id,
  email: `${id}@example.com`,
  name: id,
  avatarUrl: null,
  tier,
  status,
  token: `${id}-session`
})
const admin = person('ada', 'admin')
const member = person('mo', 'member')

const tokens = new Map<string, TokenResult>([
  [newToken(), admin],
  [newToken(), member]
])
const [adminToken, memberToken] = [...tokens.keys()]
// Tokens made with "May change spaces" (the flag comes from the database through memberForToken).
const adminEditToken = newToken()
const memberEditToken = newToken()
tokens.set(adminEditToken, { ...admin, editsSpaces: true })
tokens.set(memberEditToken, { ...member, editsSpaces: true })

const spaceRows: SpaceRow[] = [
  { id: 'miso', slug: 'miso', name: 'Renamed miso', folder: 'miso', parent_id: null },
  { id: 'board', slug: 'board', name: 'Board', folder: 'board', parent_id: null },
  { id: 'vault', slug: 'vault', name: 'Vault', folder: 'vault', parent_id: null },
  { id: 'space-0123456789abcdef0123456789abcdef', slug: 'design', name: 'Design', folder: null, parent_id: null },
  { id: 'gone', slug: 'gone', name: 'Removed from spaces.json', folder: 'gone', parent_id: null }
]
const records: SharedRecord[] = [
  { collection: 'notes', key: 'open', data: { text: 'for everyone' }, spaceId: 'miso', updatedAt: '2026-11-22T10:00:00Z' },
  { collection: 'notes', key: 'board-only', data: { text: 'salaries' }, spaceId: 'board', updatedAt: '2026-11-22T11:00:00Z' },
  { collection: 'notes', key: 'big', data: { text: 'x'.repeat(50_000) }, spaceId: null, updatedAt: '2026-11-22T09:00:00Z' }
]
// What row level security would do is not modelled here: the fake returns every row, so these
// tests show the tools' own filter (the app's hidden spaces) holds without it.
const toolData = (): ToolData => ({
  spaces: async () => spaceRows,
  company: async () => 'Acme',
  shows: async () => ({ tabRefs: ['widgets', 'view:miso/how', 'view:miso/owners', 'view:deleted/view'], widgetRefs: ['miso/clock', 'old/widget'] }),
  collections: async () => [{ name: 'notes', count: 3, updatedAt: '2026-11-22T11:00:00Z' }],
  records: async (collection, hiddenSpaceIds, limit) =>
    records.filter(r => r.collection === collection && (r.spaceId === null || !hiddenSpaceIds.includes(r.spaceId))).slice(0, limit),
  record: async (collection, key) => records.find(r => r.collection === collection && r.key === key) ?? null,
  searchRecords: async (query, hiddenSpaceIds, limit) =>
    records
      .filter(r => JSON.stringify(r.data).includes(query) && (r.spaceId === null || !hiddenSpaceIds.includes(r.spaceId)))
      .slice(0, limit)
})

const stored: (AiToken & { owner: string })[] = []
const tokenStore = (user: AuthedUser): AiTokenStore => ({
  list: async () => ({ available: true, tokens: stored.filter(t => t.owner === user.id).map(({ owner: _owner, ...t }) => t) }),
  async create(name, _hash, editsSpaces) {
    const token = { id: crypto.randomUUID(), name, createdAt: '2026-11-23T00:00:00Z', lastUsedAt: null, editsSpaces }
    stored.push({ ...token, owner: user.id })
    return token
  },
  async remove(id) {
    const at = stored.findIndex(t => t.id === id && t.owner === user.id)
    if (at >= 0) stored.splice(at, 1)
    return at >= 0
  }
})

// The browser's sign-in, for the token routes: a header names who is signed in.
const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const who = c.req.header('x-test-user')
  if (!who) return c.json({ error: 'Sign in.' }, 401)
  c.set('user', who === 'ada' ? admin : member)
  await next()
}

function build(options: { rules?: SpaceAccessRule[]; catalog?: Catalog; modules?: ServerModules; callServerFunction?: McpOptions['callServerFunction']; spacesVolume?: boolean } = {}) {
  const app = new Hono<AuthEnv>()
  app.onError((err, c) => (err instanceof InputError ? c.json({ error: err.message }, 400) : c.json({ error: 'failed' }, 500)))
  const used = options.catalog ?? catalog
  registerMcp(app, {
    catalog: used,
    callServerFunction: options.callServerFunction,
    modules: options.modules ?? {
      'vault/lib/vault': async () => ({
        getVault: async () => ({
          configured: true,
          repo: process.env.VAULT_REPO,
          ref: 'main',
          skills: [{ id: 'unbox', name: 'unbox', description: '' }],
          notes: ['Inbox/today.md', 'Projects/miso/plan.md', 'Projects/miso/notes.md', `by-${callerEmail()}.md`],
          truncated: false
        }),
        refuse: async () => {
          throw new Error('GitHub said 404 for the vault. Check VAULT_REPO.')
        }
      })
    },
    hiddenOf: async user => hiddenFor(used, user, options.rules ?? []),
    requireUser: signedIn,
    memberForToken: async token => tokens.get(token) ?? 'unauthenticated',
    tokenStore,
    toolData,
    spacesVolume: options.spacesVolume ?? false,
    currentTier: async user => user.tier
  })
  // What app.ts has after it: everything else on /api asks for the browser's sign-in.
  app.use('/api/*', signedIn)
  app.get('/api/me', c => c.json({ id: c.get('user').id }))
  return app
}

const app = build()

async function connect(token: string, target = app): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://miso.test${MCP_PATH}`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => target.request(input as string | URL, init as RequestInit)
    })
  )
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] }
  const text = result.content[0].text
  return { isError: result.isError === true, text, json: result.isError ? null : (JSON.parse(text) as any) }
}

const rpc = (headers: Record<string, string>, method = 'POST') =>
  app.request(MCP_PATH, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) : undefined
  })

test('without a connection token there is no way in', async () => {
  const none = await rpc({})
  expect(none.status).toBe(401)
  expect(none.headers.get('www-authenticate')).toContain('Bearer')
  expect((await none.json()).error.message).toContain('connection token')
  expect((await rpc({ Authorization: `Bearer ${newToken()}` })).status).toBe(401)
  // A browser session is not a connection token here, and neither is the session cookie.
  expect((await rpc({ Authorization: 'Bearer ada-session' })).status).toBe(401)
  expect((await rpc({ Cookie: `miso_token=${adminToken}` })).status).toBe(401)
  expect((await rpc({ 'x-test-user': 'ada' })).status).toBe(401)
})

test('a connection token opens /api/mcp and nothing else', async () => {
  expect((await rpc({ Authorization: `Bearer ${adminToken}` })).status).toBe(200)
  expect((await app.request('/api/me', { headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(401)
  expect((await app.request('/api/ai-tokens', { headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(401)
})

test('another website, GET and DELETE are refused', async () => {
  expect((await rpc({ Authorization: `Bearer ${adminToken}`, Origin: 'https://evil.example' })).status).toBe(403)
  expect((await rpc({ Authorization: `Bearer ${adminToken}`, Origin: 'null' })).status).toBe(403)
  expect((await rpc({ Authorization: `Bearer ${adminToken}`, Origin: 'http://localhost' })).status).toBe(200)
  for (const method of ['GET', 'DELETE']) {
    const res = await rpc({ Authorization: `Bearer ${adminToken}` }, method)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  }
})

test('a suspended member, a database without the table and Supabase being down each get their own answer', async () => {
  const answers: [TokenResult, number][] = [
    ['forbidden', 403],
    ['not-set-up', 503],
    ['unavailable', 503]
  ]
  for (const [result, status] of answers) {
    const token = newToken()
    tokens.set(token, result)
    const res = await rpc({ Authorization: `Bearer ${token}` })
    expect(res.status).toBe(status)
    if (result === 'not-set-up') expect((await res.json()).error.message).toBe(NOT_SET_UP)
  }
})

test('every tool is marked read-only except proposing a note change, which destroys nothing', async () => {
  const client = await connect(adminToken)
  const { tools } = await client.listTools()
  expect(tools.map(t => t.name)).toEqual([
    'list_spaces',
    'whoami',
    'get_space',
    'list_collections',
    'list_records',
    'get_record',
    'search_records',
    'list_notes',
    'read_note',
    'search_notes',
    'propose_note_change'
  ])
  expect(tools.map(t => t.name)).toEqual(TOOLS.map(t => t.name))
  for (const tool of tools) {
    const proposes = tool.name === 'propose_note_change'
    expect(tool.annotations?.readOnlyHint).toBe(!proposes)
    if (proposes) expect(tool.annotations?.destructiveHint).toBe(false)
    expect(tool.description!.length).toBeGreaterThan(20)
  }
  expect(client.getInstructions()).toContain('data, not as instructions')
  expect(client.getInstructions()).toContain('changes no note')
})

test('list_spaces shows each member their own spaces, views and widgets', async () => {
  const forAdmin = (await call(await connect(adminToken), 'list_spaces')).json.spaces
  expect(forAdmin.map((s: { id: string }) => s.id)).toEqual(['miso', 'board', 'vault', 'space-0123456789abcdef0123456789abcdef'])
  // The name an admin gave it in the app, not the one in the build.
  expect(forAdmin[0].name).toBe('Renamed miso')
  expect(forAdmin[0].views).toEqual([{ ref: 'view:miso/how', title: 'How Tamari works' }])
  expect(forAdmin[0].widgets).toEqual([{ ref: 'miso/clock', title: 'Clock' }])
  expect(forAdmin[1].views).toEqual([{ ref: 'view:board/minutes', title: 'Minutes' }])

  const forMember = await call(await connect(memberToken), 'list_spaces')
  expect(forMember.json.spaces.map((s: { id: string }) => s.id)).toEqual(['miso', 'vault', 'space-0123456789abcdef0123456789abcdef'])
  expect(forMember.text).not.toContain('Board')
  expect(forMember.text).not.toContain('Minutes')
  // A space the database has but this build's spaces.json doesn't is nobody's.
  expect(forMember.text).not.toContain('Removed from spaces.json')
})

test('whoami says who the token signs in as, their company and the spaces they see', async () => {
  const forMember = (await call(await connect(memberToken), 'whoami')).json
  expect(Object.keys(forMember)).toEqual(['name', 'email', 'company', 'spaces'])
  expect(forMember.company).toBe('Acme')
  expect(forMember.spaces.map((s: { slug: string }) => s.slug)).not.toContain('board')
  expect(forMember.spaces[0]).toEqual({ name: 'Renamed miso', slug: expect.any(String) })
  const forAdmin = (await call(await connect(adminToken), 'whoami')).json
  expect(forAdmin.spaces.map((s: { slug: string }) => s.slug)).toContain('board')
  expect(forAdmin.email).not.toBe(forMember.email)
})

test('a space access rule and a subspace of a hidden space are honoured', () => {
  const rules: SpaceAccessRule[] = [{ spaceId: 'miso', tiers: ['admin'], departments: [], people: [], members: [] }]
  const rows: SpaceRow[] = [...spaceRows, { id: 'sub', slug: 'miso-sub', name: 'Sub', folder: null, parent_id: 'miso' }]
  expect(spacesFor(catalog, hiddenFor(catalog, member, rules), rows).map(s => s.id)).toEqual(['vault', 'space-0123456789abcdef0123456789abcdef'])
  expect(spacesFor(catalog, hiddenFor(catalog, admin, rules), rows).map(s => s.id)).toContain('sub')
  // A database that has no rows yet still lists the build's spaces.
  expect(spacesFor(catalog, hiddenFor(catalog, member), []).map(s => s.id)).toEqual(['miso', 'vault'])
})

test('get_space answers for a space the member sees and refuses one they do not', async () => {
  const client = await connect(memberToken)
  const miso = (await call(client, 'get_space', { space: 'miso' })).json
  expect(miso.openTabs).toEqual([
    { ref: 'widgets', title: 'Widgets' },
    { ref: 'view:miso/how', title: 'How Tamari works' }
  ])
  expect(miso.dashboardWidgets).toEqual([{ ref: 'miso/clock', title: 'Clock' }])
  const refused = await call(client, 'get_space', { space: 'board' })
  expect(refused.isError).toBe(true)
  expect(refused.text).toContain('no space "board"')
  expect((await call(await connect(adminToken), 'get_space', { space: 'board' })).json.name).toBe('Board')
})

test('records of a space the member does not see stay out, and large data is cut', async () => {
  const client = await connect(memberToken)
  expect((await call(client, 'list_collections')).json.collections).toEqual([{ name: 'notes', count: 3, updatedAt: '2026-11-22T11:00:00Z' }])
  const listed = await call(client, 'list_records', { collection: 'notes' })
  expect(listed.json.records.map((r: { key: string }) => r.key)).toEqual(['open', 'big'])
  expect(listed.text).not.toContain('salaries')
  expect(listed.json.records[1].dataCutOff).toBe(true)
  expect(listed.text.length).toBeLessThan(5_000)
  const hiddenRecord = await call(client, 'get_record', { collection: 'notes', key: 'board-only' })
  expect(hiddenRecord.isError).toBe(true)
  expect(hiddenRecord.text).not.toContain('salaries')
  expect((await call(client, 'get_record', { collection: 'notes', key: 'big' })).text.length).toBeLessThan(RESULT_MAX_CHARS)
  expect((await call(await connect(adminToken), 'get_record', { collection: 'notes', key: 'board-only' })).json.data).toEqual({ text: 'salaries' })
  // Arguments are checked before anything is read.
  expect((await call(client, 'list_records', { collection: '../etc', limit: 20 })).isError).toBe(true)
  expect((await call(client, 'list_records', { collection: 'notes', limit: 5000 })).isError).toBe(true)
})

test('search_records leaves out records of a space the member does not see, and checks its arguments', async () => {
  const member = await connect(memberToken)
  expect((await call(member, 'search_records', { query: 'salaries' })).json.records).toEqual([])
  const found = await call(member, 'search_records', { query: 'everyone' })
  expect(found.json.records).toEqual([{ collection: 'notes', key: 'open', spaceId: 'miso', updatedAt: '2026-11-22T10:00:00Z', excerpt: '{"text":"for everyone"}' }])
  const admin = await call(await connect(adminToken), 'search_records', { query: 'salaries' })
  expect(admin.json.records.map((r: { key: string }) => r.key)).toEqual(['board-only'])
  // A large record comes back as a short excerpt, not its data.
  expect((await call(member, 'search_records', { query: 'xxx' })).text.length).toBeLessThan(1_000)
  for (const args of [{ query: '' }, { query: '   ' }, { query: 'a'.repeat(201) }, { query: 'x', limit: 0 }, { query: 'x', limit: 51 }, {}]) {
    expect((await call(member, 'search_records', args)).isError).toBe(true)
  }
})

test('an excerpt starts near the first word it holds and is short', () => {
  const data = { title: 'Plan', body: `${'filler '.repeat(100)}the budget for 2027 ${'more '.repeat(100)}` }
  const excerpt = recordExcerpt(data, '"Budget 2027"')
  expect(excerpt).toContain('budget for 2027')
  expect(excerpt.startsWith('…')).toBe(true)
  expect(excerpt.length).toBeLessThanOrEqual(202)
  expect(recordExcerpt({ a: 1 }, 'nothing')).toBe('{"a":1}')
  // Neither `or` nor a left-out word moves the excerpt ("or" is in "Report", "plan" in "Plan").
  const report = { title: 'Report', body: `${'filler '.repeat(100)}salaries` }
  expect(recordExcerpt(report, '-report salaries or wages')).toContain('salaries')
})

test('list_notes reads the vault through its server function, as the member, and returns paths only', async () => {
  const client = await connect(memberToken)
  const all = await call(client, 'list_notes')
  expect(all.json).toEqual({ total: 4, offset: 0, notes: ['Inbox/today.md', 'Projects/miso/plan.md', 'Projects/miso/notes.md', 'by-mo@example.com.md'], more: false })
  // Neither the connector's values nor anything else getVault() knows.
  for (const secret of ['secret-vault', 'ghp_secret', 'unbox', 'main']) expect(all.text).not.toContain(secret)
  const page = (await call(client, 'list_notes', { folder: 'Projects/', limit: 1 })).json
  expect(page).toEqual({ total: 2, offset: 0, notes: ['Projects/miso/plan.md'], more: true })
  expect((await call(client, 'list_notes', { folder: 'Projects/', limit: 1, offset: 1 })).json.notes).toEqual(['Projects/miso/notes.md'])
})

test('the vault is refused when this build has none, or the member does not see it', async () => {
  const without: Catalog = { spaces: catalog.spaces.filter(s => s.folder !== 'vault'), applets: catalog.applets.filter(a => a.folder !== 'vault') }
  const off = await call(await connect(memberToken, build({ catalog: without })), 'list_notes')
  expect(off.isError).toBe(true)
  expect(off.text).toContain("isn't available to you")
  const rules: SpaceAccessRule[] = [{ spaceId: 'vault', tiers: ['admin'], departments: [], people: [], members: [] }]
  const hiddenVault = build({ rules })
  expect((await call(await connect(memberToken, hiddenVault), 'list_notes')).text).toBe(off.text)
  expect((await call(await connect(adminToken, hiddenVault), 'list_notes')).json.total).toBe(4)
})

// The Vault space once it has lib/notes.server.ts (branch feat/vault-notes): the same shapes, with
// the extras a tool must not pass on (the repo, a GitHub address, the proposer's email).
const LONG_NOTE = `# Plan\n${'line "quoted"\n'.repeat(4000)}THE END`
const proposed: unknown[] = []
const notesModule = async () => ({
  listNotes: async () => ({
    configured: true,
    repo: process.env.VAULT_REPO,
    notes: [
      { path: 'Inbox/today.md', title: 'today' },
      { path: 'Projects/miso/plan.md', title: 'plan' }
    ],
    truncated: true
  }),
  readNote: async (path: string) => {
    if (path !== 'Projects/miso/plan.md') throw new Error('There is no note at this path.')
    return { path, title: 'plan', content: LONG_NOTE, sha: 'a'.repeat(40), url: `https://github.com/${process.env.VAULT_REPO}/blob/main/${path}` }
  },
  searchNotes: async (query: string) => ({
    query,
    searchedText: true,
    matches: [
      { path: 'Projects/miso/plan.md', title: 'plan', match: 'name' },
      { path: 'Inbox/today.md', title: 'today', match: 'text', snippet: `…${'s'.repeat(1000)}` },
      ...Array.from({ length: 80 }, (_, i) => ({ path: `Many/${i}.md`, title: String(i), match: 'text' }))
    ]
  }),
  proposeChange: async (input: { path: string; reason: string; baseSha: string | null }) => {
    proposed.push(input)
    return {
      id: 'mabc123-0a1b2c3d',
      repo: process.env.VAULT_REPO,
      branch: 'main',
      path: input.path,
      kind: input.baseSha ? 'edit' : 'new',
      reason: input.reason,
      status: 'open',
      proposer: { id: 'someone', email: callerEmail() },
      createdAt: '2026-11-23T09:00:00.000Z',
      number: 7,
      url: `https://github.com/${process.env.VAULT_REPO}/pull/7`
    }
  }
})
const withNotes = build({ modules: { 'vault/lib/notes': notesModule } })

test('list_notes prefers the vault\'s listNotes and takes either shape of note', async () => {
  const listed = await call(await connect(memberToken, withNotes), 'list_notes')
  expect(listed.json).toEqual({ total: 2, offset: 0, notes: ['Inbox/today.md', 'Projects/miso/plan.md'], more: false, incomplete: true })
  expect(listed.text).not.toContain('secret-vault')
})

test('read_note returns a long note in pages that join back into the whole note, with its version first', async () => {
  const client = await connect(memberToken, withNotes)
  const first = await call(client, 'read_note', { path: 'Projects/miso/plan.md' })
  expect(first.text.length).toBeLessThan(RESULT_MAX_CHARS)
  expect(Object.keys(first.json)).toEqual(['path', 'title', 'sha', 'length', 'offset', 'more', 'nextOffset', 'content'])
  expect(first.json).toMatchObject({ path: 'Projects/miso/plan.md', sha: 'a'.repeat(40), length: LONG_NOTE.length, offset: 0, more: true })
  // Neither the repo nor its address on GitHub.
  expect(first.text).not.toContain('secret-vault')
  let text = first.json.content as string
  let page = first.json
  for (let i = 0; page.more && i < 20; i++) {
    const next = await call(client, 'read_note', { path: 'Projects/miso/plan.md', offset: page.nextOffset })
    expect(next.text.length).toBeLessThan(RESULT_MAX_CHARS)
    page = next.json
    text += page.content
  }
  expect(page.more).toBe(false)
  expect(text).toBe(LONG_NOTE)
  // The space's own words for a note that isn't there.
  const none = await call(client, 'read_note', { path: 'Nope.md' })
  expect(none).toMatchObject({ isError: true, text: 'There is no note at this path.' })
})

test('a page of a note never ends in half a character, and shrinks when escapes would overflow', () => {
  expect(notePage('short', 0)).toBe('short')
  expect(notePage('short', 3)).toBe('rt')
  const emoji = '😀'.repeat(20_000)
  const page = notePage(emoji, 1)
  expect(page.charCodeAt(page.length - 1)).toBeGreaterThanOrEqual(0xdc00)
  const escapes = notePage('\u0001'.repeat(40_000), 0)
  expect(JSON.stringify(escapes).length).toBeLessThanOrEqual(50_000)
  expect(escapes.length).toBeGreaterThan(0)
})

test('search_notes returns bounded matches', async () => {
  const found = await call(await connect(memberToken, withNotes), 'search_notes', { query: 'plan' })
  expect(found.json.query).toBe('plan')
  expect(found.json.searchedText).toBe(true)
  expect(found.json.matches).toHaveLength(50)
  expect(found.json.matches[0]).toEqual({ path: 'Projects/miso/plan.md', match: 'name' })
  expect(found.json.matches[1].snippet).toHaveLength(300)
  expect((await call(await connect(memberToken, withNotes), 'search_notes', { query: 'x' })).isError).toBe(true)
})

test('propose_note_change hands the vault a proposal in the member\'s name and says nothing changed', async () => {
  const client = await connect(memberToken, withNotes)
  const made = await call(client, 'propose_note_change', { path: 'Projects/miso/plan.md', content: '# Plan\nnew', reason: 'Dates moved', baseSha: 'a'.repeat(40) })
  expect(made.json.proposal).toEqual({ id: 'mabc123-0a1b2c3d', path: 'Projects/miso/plan.md', kind: 'edit', status: 'open', reason: 'Dates moved', createdAt: '2026-11-23T09:00:00.000Z', pullRequest: 7 })
  expect(made.json.next).toContain('Nothing changed in the vault')
  // The vault ran it as this member (its requireCaller()), and its extras stay behind.
  expect(made.text).not.toContain('mo@example.com')
  expect(made.text).not.toContain('secret-vault')
  expect(made.text).not.toContain('github.com')
  expect(proposed.at(-1)).toEqual({ path: 'Projects/miso/plan.md', content: '# Plan\nnew', reason: 'Dates moved', baseSha: 'a'.repeat(40) })
  // A new note: no version to send.
  expect((await call(client, 'propose_note_change', { path: 'New.md', content: 'hello', reason: 'Add it' })).json.proposal.kind).toBe('new')
  expect(proposed.at(-1)).toMatchObject({ baseSha: null })
  // Checked before the vault is asked.
  const before = proposed.length
  for (const bad of [
    { path: 'a.md', content: '', reason: 'r' },
    { path: 'a.md', content: 'x', reason: 'r', baseSha: 'not-a-sha' },
    { path: 'a.md', content: 'x', reason: 'r'.repeat(201) },
    { path: 'a.md', content: 'x'.repeat(200_001), reason: 'r' }
  ]) {
    expect((await call(client, 'propose_note_change', bad)).isError).toBe(true)
  }
  expect(proposed).toHaveLength(before)
})

test('a Vault space from before the note functions says so, and list_notes still works', async () => {
  // `app` has only vault/lib/vault with getVault(): today's main.
  const client = await connect(memberToken)
  const unsupported = `The Vault space on this ${APP_NAME} does not support this yet.`
  expect(await call(client, 'read_note', { path: 'a.md' })).toMatchObject({ isError: true, text: unsupported })
  expect(await call(client, 'search_notes', { query: 'plan' })).toMatchObject({ isError: true, text: unsupported })
  expect(await call(client, 'propose_note_change', { path: 'a.md', content: 'x', reason: 'r' })).toMatchObject({ isError: true, text: unsupported })
  expect((await call(client, 'list_notes')).json.total).toBe(4)
  // The module is there but one function isn't: the same answer.
  const partial = build({ modules: { 'vault/lib/notes': async () => ({ readNote: async () => ({ path: 'a.md', title: 'a', content: 'text', sha: 'b'.repeat(40) }) }) } })
  expect((await call(await connect(memberToken, partial), 'read_note', { path: 'a.md' })).json.content).toBe('text')
  expect(await call(await connect(memberToken, partial), 'search_notes', { query: 'plan' })).toMatchObject({ isError: true, text: unsupported })
  // No listNotes and no getVault either.
  expect(await call(await connect(memberToken, partial), 'list_notes')).toMatchObject({ isError: true, text: unsupported })
})

test('a vault tool calls the space through the rpc path by name, with the whole member as the caller', async () => {
  const { stringify, parse } = await import('devalue')
  const calls: { folder: string; moduleKey: string; fn: string; spaceId: string; args: unknown; caller: unknown }[] = []
  const mocked = build({
    callServerFunction: async o => {
      calls.push({ folder: o.folder, moduleKey: o.moduleKey, fn: o.fn, spaceId: o.spaceId, args: parse(o.body), caller: o.caller })
      return stringify({ query: 'plan', matches: [], searchedText: false })
    }
  })
  await call(await connect(memberToken, mocked), 'search_notes', { query: 'plan' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ folder: 'vault', moduleKey: 'lib/notes', fn: 'searchNotes', spaceId: 'vault', args: ['plan'] })
  // What rpc.ts needs to tell the space who is calling, tier included (as POST /api/rpc passes it).
  expect(calls[0].caller).toMatchObject({ id: 'mo', email: 'mo@example.com', tier: 'member', status: 'active' })
})

test('a result is bounded whatever a tool returns', () => {
  expect(bounded('short')).toBe('short')
  const cut = bounded('x'.repeat(RESULT_MAX_CHARS + 10))
  expect(cut.length).toBeLessThan(RESULT_MAX_CHARS + 100)
  expect(cut).toContain('10 more characters')
  expect(boundedData({ a: 1 }, 100)).toEqual({ data: { a: 1 } })
  expect(boundedData({ a: 'y'.repeat(200) }, 100)).toEqual({ dataCutOff: true, dataStart: `{"a":"${'y'.repeat(94)}` })
})

test('a member makes, lists and deletes only their own tokens, signed in with the browser', async () => {
  const as = (who: string) => ({ 'x-test-user': who, 'Content-Type': 'application/json' })
  expect((await app.request('/api/ai-tokens')).status).toBe(401)
  expect((await app.request('/api/ai-tokens', { method: 'POST', body: '{"name":"x"}' })).status).toBe(401)
  expect((await app.request('/api/ai-tokens', { method: 'POST', headers: as('ada'), body: '{"name":""}' })).status).toBe(400)
  expect((await app.request('/api/ai-tokens', { method: 'POST', headers: as('ada'), body: '[]' })).status).toBe(400)

  const made = await app.request('/api/ai-tokens', { method: 'POST', headers: as('ada'), body: '{"name":"Claude Code"}' })
  expect(made.status).toBe(201)
  const token = (await made.json()) as AiToken & { token: string }
  expect(token.token).toMatch(/^miso_ai_/)

  const listed = await app.request('/api/ai-tokens', { headers: as('ada') })
  const text = await listed.text()
  expect(JSON.parse(text)).toEqual({ available: true, tokens: [{ id: token.id, name: 'Claude Code', createdAt: token.createdAt, lastUsedAt: null, editsSpaces: false }] })
  expect(text).not.toContain(token.token)
  expect(((await (await app.request('/api/ai-tokens', { headers: as('mo') })).json()) as { tokens: unknown[] }).tokens).toEqual([])

  expect((await app.request(`/api/ai-tokens/${token.id}`, { method: 'DELETE', headers: as('mo') })).status).toBe(404)
  expect((await app.request('/api/ai-tokens/not-an-id', { method: 'DELETE', headers: as('ada') })).status).toBe(404)
  expect((await app.request(`/api/ai-tokens/${token.id}`, { method: 'DELETE', headers: as('ada') })).status).toBe(200)
  expect(stored).toEqual([])
})

test('the space tools through /api/mcp: the token flag and the tier decide, and they exist only with the volume', async () => {
  const volume = build({ spacesVolume: true })
  const change = { space: 'no-such-space', summary: 'Try', write: [{ path: 'views/x.tsx', content: 'x' }] }
  for (const name of ['change_space_files', 'edit_tabs', 'edit_layout']) {
    const args = name === 'change_space_files' ? change : name === 'edit_tabs' ? { space: 'x', tabs: [] } : { space: 'x', widgets: [] }
    // A read-only token, even an admin's.
    expect((await call(await connect(adminToken, volume), name, args)).text).toContain('can only read')
    // A member's editing token: only their own drafts, and there is none here.
    expect((await call(await connect(memberEditToken, volume), name, args)).isError).toBe(true)
  }
  // An admin's editing token gets past both: the next refusal is about the space itself.
  const allowed = await call(await connect(adminEditToken, volume), 'change_space_files', change)
  expect(allowed.isError).toBe(true)
  expect(allowed.text).toContain('no space "no-such-space"')
  // Without the volume (not the Compose install) the tools aren't there at all.
  const names = (await (await connect(adminEditToken)).listTools()).tools.map(t => t.name)
  expect(names).not.toContain('change_space_files')
})
