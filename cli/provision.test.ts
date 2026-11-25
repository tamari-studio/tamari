import { describe, expect, test } from 'bun:test'
import { SERVICE_ROWS_DELETE } from '../scripts/supabase-setup'
import { DRY_REF, provision, smtpFrom, STEPS, validate, type Env, type Options } from './provision'

const REF = 'abcdefghijklmnopqrst'
const ENV: Env = { supabaseToken: 'sbp_TOKEN_SUPA', vercelToken: 'vcl_TOKEN_VERCEL' }
const SECRET_KEY = 'sb_secret_KEY_VALUE'
const hosted = (over: Partial<Options> = {}): Options =>
  validate({ target: 'hosted', slug: 'acme', title: 'Acme', ownerEmail: 'Owner@Example.com', domain: 'example.com', baseDomain: 'miso.example.dev', supabaseOrg: 'my-org', ...over })

/** A Supabase account, one project's auth and REST API, and a Vercel account, in memory. */
function world(opts: { unhealthyChecks?: number; failOnce?: string } = {}) {
  const w = {
    calls: [] as string[], // "METHOD host/path" of every request, in order
    bodies: [] as string[],
    out: [] as string[],
    sleeps: 0,
    projects: [] as { ref: string; name: string; organization_slug: string; status: string }[],
    schemas: 'public,graphql_public',
    auth: { site_url: 'http://localhost:3000', uri_allow_list: '' } as Record<string, unknown>,
    ledger: [] as { source: string; filename: string; checksum: string }[],
    sql: [] as string[],
    users: [] as { id: string; email: string; app_metadata?: unknown }[],
    members: [] as { user_id: string; role: string }[],
    rest: [] as string[],
    vercel: [] as { id: string; name: string }[],
    env: [] as { key: string; value: string }[],
    domains: [] as string[],
    healthChecks: 0,
    failOnce: opts.failOnce
  }
  const json = (value: unknown, status = 200) => Response.json(value, { status })
  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url.host}${url.pathname}`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    w.calls.push(key)
    if (typeof init?.body === 'string') w.bodies.push(init.body)
    if (w.failOnce === key) {
      w.failOnce = undefined
      return json({ error: 'boom' }, 500)
    }
    const p = url.pathname
    if (url.host === 'api.supabase.com') {
      if (key.endsWith('GET api.supabase.com/v1/projects')) return json(w.projects)
      if (key.endsWith('POST api.supabase.com/v1/projects')) {
        w.projects.push({ ref: REF, name: body.name, organization_slug: body.organization_slug, status: 'COMING_UP' })
        return json({ ref: REF }, 201)
      }
      if (p.endsWith('/health')) return json([{ name: 'db', healthy: ++w.healthChecks > (opts.unhealthyChecks ?? 0) }])
      if (p.endsWith('/api-keys')) return json([{ type: 'legacy', api_key: 'old' }, { type: 'publishable', api_key: 'sb_publishable_x' }, { type: 'secret', api_key: SECRET_KEY }])
      if (p.endsWith('/postgrest')) {
        if (method === 'PATCH') w.schemas = body.db_schema
        return json({ db_schema: w.schemas })
      }
      if (p.endsWith('/config/auth')) {
        if (method === 'PATCH') Object.assign(w.auth, body)
        return json(w.auth)
      }
      if (p.endsWith('/database/query')) {
        const sql: string = body.query
        w.sql.push(sql)
        if (sql.startsWith('select source, filename, checksum')) return json(w.ledger)
        const row = /insert into public\.miso_migrations \(source, filename, checksum\) values \('(\w+)', '([^']+)', '(\w+)'\)/.exec(sql)
        if (row) w.ledger.push({ source: row[1]!, filename: row[2]!, checksum: row[3]! })
        return json(sql.includes('to_regclass') ? [{ there: false }] : [])
      }
    }
    if (url.host === `${REF}.supabase.co`) {
      if (p === '/auth/v1/admin/users' && method === 'GET') return json({ users: w.users })
      if (p === '/auth/v1/admin/users' && method === 'POST') {
        const user = { id: `00000000-0000-4000-8000-${String(w.users.length + 1).padStart(12, '0')}`, email: body.email, app_metadata: body.app_metadata }
        w.users.push(user)
        return json(user)
      }
      if (p.startsWith('/auth/v1/admin/users/')) return json(w.users.find(u => p.endsWith(u.id)))
      if (p.startsWith('/rest/v1/')) {
        w.rest.push(`${method} ${p}`)
        if (p === '/rest/v1/members' && method === 'GET') return json(w.members.filter(m => url.searchParams.get('user_id') === `eq.${m.user_id}`))
        if (p === '/rest/v1/members') w.members.push(body)
        return json([], method === 'POST' ? 201 : 200)
      }
    }
    if (url.host === 'api.vercel.com') {
      if (method === 'GET' && p.startsWith('/v9/projects/') && !p.endsWith('/domains')) {
        const hit = w.vercel.find(v => p.endsWith(`/${v.name}`))
        return hit ? json(hit) : json({ error: { code: 'not_found' } }, 404)
      }
      if (key.endsWith('POST api.vercel.com/v11/projects')) {
        if (w.vercel.some(v => v.name === body.name)) return json({ error: { code: 'conflict' } }, 409)
        w.vercel.push({ id: 'prj_1', name: body.name })
        return json(w.vercel[0], 200)
      }
      if (p.endsWith('/env')) {
        for (const v of body) w.env = [...w.env.filter(e => e.key !== v.key), v]
        return json({ created: [], failed: [] }, 201)
      }
      if (p.endsWith('/domains') && method === 'GET') return json({ domains: w.domains.map(name => ({ name })) })
      if (p.endsWith('/domains')) {
        if (w.domains.includes(body.name)) return json({ error: { code: 'domain_already_in_use' } }, 400)
        w.domains.push(body.name)
        return json({ name: body.name, verified: false })
      }
    }
    return json({ error: `the fake has no ${key}` }, 599)
  }
  const deps = { fetch: fetchImpl as typeof fetch, log: (line: string) => void w.out.push(line), sleep: async () => void w.sleeps++ }
  const writes = () => w.calls.filter(c => !c.startsWith('GET'))
  return { w, deps, writes }
}

describe('provision input', () => {
  const ok = { slug: 'acme', ownerEmail: 'a@example.com' }
  test('normalises and fills defaults', () => {
    expect(validate({ ...ok, ownerEmail: ' Boss@Example.COM ' })).toMatchObject({ target: 'local', title: 'acme', ownerEmail: 'boss@example.com', region: 'eu-central-1', dryRun: false })
  })
  test.each([
    ['slug', { slug: 'Acme Inc' }],
    ['slug', { slug: '-acme' }],
    ['slug', { slug: 'a'.repeat(33) }],
    ['owner-email', { ownerEmail: 'not-an-email' }],
    ['owner-email', { ownerEmail: "a'b@example.com" }],
    ['owner-email', { ownerEmail: 'miso-vault@example.com' }],
    ['domain', { domain: 'https://acme.com' }],
    ['base-domain', { baseDomain: 'no_dots' }],
    ['region', { region: 'mars-1' }],
    ['title', { title: 'x\nruntime: evil' }],
    ['supabase-org', { supabaseOrg: 'My Org' }],
    ['target', { target: 'prod' }],
    ['base-domain', { target: 'hosted' }],
    ['dry-run', { dryRun: true }]
  ])('refuses a bad --%s', (name, bad) => {
    expect(() => validate({ ...ok, ...bad })).toThrow(`--${name}`)
  })
})

describe('provision --target hosted', () => {
  test('a first run does every step once, in order', async () => {
    const { w, deps, writes } = world()
    await provision(hosted(), ENV, deps)
    const firstOf = (needle: string) => w.calls.findIndex(c => c.includes(needle))
    const order = ['POST api.supabase.com/v1/projects', '/health', '/database/query', 'PATCH api.supabase.com/v1/projects/abcdefghijklmnopqrst/postgrest', '/config/auth', '/auth/v1/admin/users', 'POST api.vercel.com/v11/projects', '/env', 'POST api.vercel.com/v10/projects/prj_1/domains'].map(firstOf)
    expect(order).not.toContain(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(w.projects).toHaveLength(1)
    expect(w.schemas).toBe('public,graphql_public,miso,app')
    expect(w.auth).toEqual({ site_url: 'https://acme.miso.example.dev', uri_allow_list: 'https://acme.miso.example.dev/**', mailer_autoconfirm: false })
    // The two service accounts come before the owner, and the owner before anything is hosted on Vercel.
    expect(w.users.map(u => u.email)).toEqual(['miso-spaces@example.com', 'miso-vault@example.com', 'owner@example.com'])
    expect(w.sql.some(s => s.includes("'owner@example.com', 'owner', 'active'"))).toBe(true)
    // With a person as owner, the same transaction takes back an owner seat a service account got.
    expect(w.sql.some(s => s.includes(SERVICE_ROWS_DELETE))).toBe(true)
    expect(w.rest).toContain('POST /rest/v1/allowed_domains')
    expect(w.ledger.length).toBeGreaterThan(10)
    expect(w.env.map(e => e.key)).toEqual(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'])
    expect(w.env[2]).toMatchObject({ value: SECRET_KEY, type: 'sensitive' })
    expect(w.domains).toEqual(['acme.miso.example.dev'])
    expect(w.out.join('\n')).toContain(`supabase: ${REF}`)
    expect(writes().length).toBeGreaterThan(20)
  })

  test('a second run creates nothing again', async () => {
    const { w, deps, writes } = world()
    await provision(hosted(), ENV, deps)
    const ledger = w.ledger.length
    w.calls.length = 0
    w.rest.length = 0
    await provision(hosted(), ENV, deps)
    expect(w.projects).toHaveLength(1)
    expect(w.users).toHaveLength(3)
    expect(w.vercel).toHaveLength(1)
    expect(w.domains).toHaveLength(1)
    expect(w.ledger).toHaveLength(ledger)
    const created = writes().filter(c => /POST api\.supabase\.com\/v1\/projects$|POST \S+\/auth\/v1\/admin\/users$|\/v11\/projects$|\/domains$|PATCH api\.supabase/.test(c))
    expect(created).toEqual([])
    expect(w.rest.filter(r => !r.startsWith('GET'))).toEqual(['POST /rest/v1/allowed_domains'])
    expect(w.out.join('\n')).toContain('miso-vault@example.com (service) was already set up')
    expect(w.out.join('\n')).toContain('miso-acme is already there')
    expect(w.out.join('\n')).toContain('was already an account and is owner')
  })

  test('waits until the project is healthy', async () => {
    const { w, deps } = world({ unhealthyChecks: 3 })
    await provision(hosted(), ENV, deps)
    expect(w.sleeps).toBe(3)
    expect(w.out.join('\n')).toContain('after 4 checks')
  })

  test('a failure stops the run, and the next run continues without duplicates', async () => {
    const { w, deps } = world({ failOnce: 'POST api.vercel.com/v11/projects' })
    await expect(provision(hosted(), ENV, deps)).rejects.toThrow('step vercel-project failed')
    expect(w.vercel).toHaveLength(0)
    expect(w.calls.some(c => c.includes('/env'))).toBe(false)
    await provision(hosted(), ENV, deps)
    expect(w.projects).toHaveLength(1)
    expect(w.users).toHaveLength(3)
    expect(w.vercel).toHaveLength(1)
    expect(w.calls.filter(c => c === 'POST api.supabase.com/v1/projects')).toHaveLength(1)
  })

  test('no secret is ever printed, in output or in an error', async () => {
    const { w, deps } = world({ failOnce: 'POST api.vercel.com/v10/projects/prj_1/env' })
    const err = await provision(hosted(), ENV, deps).catch(e => String(e.message))
    await provision(hosted(), ENV, deps)
    const dbPass = JSON.parse(w.bodies.find(b => b.includes('db_pass'))!).db_pass as string
    expect(dbPass.length).toBeGreaterThanOrEqual(32)
    const printed = w.out.join('\n') + err
    for (const secret of [ENV.supabaseToken!, ENV.vercelToken!, SECRET_KEY, dbPass]) expect(printed).not.toContain(secret)
  })

  test('a dry run prints the plan and sends nothing', async () => {
    const out: string[] = []
    const never = (() => {
      throw new Error('a dry run must not use the network')
    }) as unknown as typeof fetch
    await provision(hosted({ dryRun: true }), ENV, { fetch: never, log: line => void out.push(line), sleep: async () => {} })
    const text = out.join('\n')
    for (const call of [
      'POST https://api.supabase.com/v1/projects {"name":"miso-acme","organization_slug":"my-org","db_pass":"[redacted]"',
      `GET https://api.supabase.com/v1/projects/${DRY_REF}/health?services=auth,db,rest`,
      `PATCH https://api.supabase.com/v1/projects/${DRY_REF}/postgrest {"db_schema":"public,graphql_public,miso,app"}`,
      `PATCH https://api.supabase.com/v1/projects/${DRY_REF}/config/auth {"site_url":"https://acme.miso.example.dev"`,
      `POST https://${DRY_REF}.supabase.co/auth/v1/admin/users {"email":"owner@example.com","email_confirm":true}`,
      'POST https://api.vercel.com/v11/projects {"name":"miso-acme","framework":null}',
      '{"key":"SUPABASE_SECRET_KEY","value":"[redacted]","type":"sensitive"',
      'POST https://api.vercel.com/v10/projects/prj_dry-run/domains {"name":"acme.miso.example.dev"}'
    ]) expect(text).toContain(call)
    for (const secret of [ENV.supabaseToken!, ENV.vercelToken!, 'sb_secret_dry-run']) expect(text).not.toContain(secret)
    expect(text).toContain('Nothing was sent')
  })
})

describe('provision sign-in mail and workspace name', () => {
  const SMTP = { host: 'smtp.example.com', port: 587, user: 'mailer', pass: 'SMTP_PASS_VALUE', from: 'login@example.com', name: 'Acme' }

  test('sets SMTP once, and never prints its password', async () => {
    const { w, deps } = world()
    await provision(hosted(), { ...ENV, smtp: SMTP }, deps)
    expect(w.auth).toMatchObject({ smtp_host: 'smtp.example.com', smtp_port: '587', smtp_user: 'mailer', smtp_pass: 'SMTP_PASS_VALUE', smtp_admin_email: 'login@example.com', smtp_sender_name: 'Acme' })
    expect(w.auth.mailer_otp_length).toBe(6)
    expect(w.auth.mailer_templates_magic_link_content).toContain('{{ .Token }}')
    expect(w.auth.mailer_templates_magic_link_content).toContain('{{ .ConfirmationURL }}')
    expect(w.auth.mailer_templates_confirmation_content).toContain('{{ .Token }}')
    w.calls.length = 0
    await provision(hosted(), { ...ENV, smtp: SMTP }, deps)
    expect(w.calls.filter(c => c.startsWith('PATCH'))).toEqual([])
    expect(w.out.join('\n')).not.toContain(SMTP.pass)
  })

  test('--title names the workspace only while it has no name', async () => {
    const { w, deps } = world()
    await provision(hosted(), ENV, deps)
    expect(w.sql).toContain("update miso.org_settings set name = 'Acme' where name is null returning name")
    const untitled = world()
    await provision(hosted({ title: undefined }), ENV, untitled.deps)
    expect(untitled.w.sql.some(s => s.startsWith('update miso.org_settings'))).toBe(false)
    expect(untitled.w.out.join('\n')).toContain('workspace-name')
  })

  test('reads SMTP from the environment: all or nothing, and checked', () => {
    const all = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@example.com' }
    expect(smtpFrom({}, 'Acme')).toBeUndefined()
    expect(smtpFrom(all, 'Acme')).toEqual({ host: 'smtp.example.com', port: 587, user: 'u', pass: 'p', from: 'a@example.com', name: 'Acme' })
    expect(() => smtpFrom({ SMTP_HOST: 'smtp.example.com' }, 'Acme')).toThrow('SMTP_PORT')
    expect(() => smtpFrom({ ...all, SMTP_PORT: 'x' }, 'Acme')).toThrow('SMTP_PORT')
    expect(() => smtpFrom({ ...all, SMTP_HOST: 'smtp.example.com/evil' }, 'Acme')).toThrow('SMTP_HOST')
    expect(() => smtpFrom({ ...all, SMTP_FROM: 'nope' }, 'Acme')).toThrow('SMTP_FROM')
  })
})

describe('provision --target local', () => {
  test('runs the database steps, skips the hosted ones and calls no hosted API', async () => {
    const { w, deps } = world()
    const sql: string[] = []
    const local = validate({ slug: 'acme', ownerEmail: 'owner@example.com', domain: 'example.com' })
    await provision(local, { supabaseUrl: `https://${REF}.supabase.co`, supabaseSecret: SECRET_KEY }, deps).then(
      () => expect.unreachable(),
      err => expect(String(err)).toContain('localhost')
    )
    // The fake answers on the project host, so point "localhost" at it.
    const viaLocal = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => deps.fetch(String(input).replace('http://127.0.0.1:54321', `https://${REF}.supabase.co`), init)) as typeof fetch
    await provision(local, { supabaseUrl: 'http://127.0.0.1:54321', supabaseSecret: SECRET_KEY }, {
      ...deps,
      fetch: viaLocal,
      sql: async text => (sql.push(text), text.includes('to_regclass') ? [{ there: true }] : [])
    })
    const text = w.out.join('\n')
    for (const step of STEPS.filter(s => s.hosted)) expect(text).toContain(`${step.name}: skipped, hosted only`)
    expect(text).toContain('the shell schema is already there')
    expect(sql.some(s => s.startsWith('begin;\ncreate') || s.includes('create schema'))).toBe(false)
    expect(w.users.map(u => u.email)).toContain('owner@example.com')
    expect(w.calls.some(c => c.includes('api.supabase.com') || c.includes('api.vercel.com'))).toBe(false)
    expect(text).not.toContain(SECRET_KEY)
  })
})
