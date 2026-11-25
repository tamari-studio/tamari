// `miso provision`: set up a new org's copy of the app (a twin) in one command. See docs/org-repos.md.
//
//   miso provision --slug <s> --owner-email <e> [--title <t>] [--domain <d>]              local Supabase, for real
//   miso provision --target hosted --slug <s> --owner-email <e> --base-domain <d> --supabase-org <slug>
//                  [--region <r>] [--title <t>] [--domain <d>] [--yes]                    hosted: a dry run unless --yes
//
// An ordered list of small steps (STEPS below). No step keeps state on disk: each one looks at
// what is already there and does only what is missing, so running the command again after a
// failure continues and never makes a second project, account or domain.
//
// Every HTTP request, the Supabase client's included, goes through the `fetch` in Deps. A dry run
// swaps it for dryFetch(), which prints each call and answers as a new, empty account would, so
// the plan it prints is the path a first real run takes.
//
// Secrets (tokens, the database password, the project's keys) are collected in `secrets` and cut
// out of every line and error before it is printed.
//
// API shapes, read 2026-11-22:
//   Supabase Management API  https://api.supabase.com/api/v1-json (the OpenAPI spec of https://supabase.com/docs/reference/api)
//     POST  /v1/projects                       https://supabase.com/docs/reference/api/v1-create-a-project
//     GET   /v1/projects                       https://supabase.com/docs/reference/api/v1-list-all-projects
//     GET   /v1/projects/{ref}/health          https://supabase.com/docs/reference/api/v1-get-services-health
//     GET   /v1/projects/{ref}/api-keys        https://supabase.com/docs/reference/api/v1-get-project-api-keys
//     GET, PATCH /v1/projects/{ref}/postgrest  https://supabase.com/docs/reference/api/v1-update-postgrest-service-config
//     GET, PATCH /v1/projects/{ref}/config/auth  https://supabase.com/docs/reference/api/v1-update-auth-service-config
//     POST  /v1/projects/{ref}/database/query  (cli/migrate.ts)
//   Vercel REST API  https://vercel.com/docs/rest-api (spec: https://openapi.vercel.sh)
//     GET   /v9/projects/{idOrName}            https://vercel.com/docs/rest-api/reference/endpoints/projects/find-a-project-by-id-or-name
//     POST  /v11/projects                      https://vercel.com/docs/rest-api/reference/endpoints/projects/create-a-new-project
//     POST  /v10/projects/{idOrName}/env       https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables
//     GET   /v9/projects/{idOrName}/domains    https://vercel.com/docs/rest-api/reference/endpoints/projects/retrieve-project-domains-by-project-by-id-or-name
//     POST  /v10/projects/{idOrName}/domains   https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowDomain, findUser, SERVICE_EMAILS, SERVICE_ROWS_DELETE, serviceAccounts, setupClients, type SetupClients } from '../scripts/supabase-setup'
import { accessToken, applyPending, literal, managementQuery, plan, postgresQuery, readMigrations, type Query } from './migrate'
import { configText } from './org'

// The region codes of POST /v1/projects (region_selection.code). The spec calls the list unstable, so a new region means a new line here.
export const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-east-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'eu-central-1', 'eu-central-2', 'ca-central-1', 'ap-south-1', 'sa-east-1'
]

export type Options = {
  target: 'local' | 'hosted'
  slug: string
  title: string
  named: boolean // --title was given: it also becomes the workspace name (Settings → Organisation)
  ownerEmail: string
  domain?: string // an email domain whose people sign in as members
  baseDomain?: string // hosted: the app is served at <slug>.<baseDomain>
  supabaseOrg?: string // hosted: the Supabase organization slug that pays for the project
  region: string
  dryRun: boolean
}

export type Env = {
  supabaseToken?: string // hosted: a Supabase access token
  vercelToken?: string // hosted
  vercelTeam?: string // hosted, optional: a team id (team_…)
  supabaseUrl?: string // local: the URL and secret key `supabase start` prints
  supabaseSecret?: string
  smtp?: Smtp // hosted: the mail server that sends sign-in links
}

/** SMTP for Supabase Auth. Without it, Supabase's own mail reaches only the Supabase organization's team. */
export type Smtp = { host: string; port: number; user: string; pass: string; from: string; name: string }

/** SMTP from SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and SMTP_SENDER_NAME; undefined when none is set. */
export function smtpFrom(vars: Record<string, string | undefined>, title: string): Smtp | undefined {
  const v = (k: string) => vars[k]?.trim() ?? ''
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']
  if (keys.every(k => !v(k))) return undefined
  const missing = keys.filter(k => !v(k))
  if (missing.length) throw new Error(`Set ${missing.join(', ')} too: SMTP needs all of ${keys.join(', ')}.`)
  const port = Number(v('SMTP_PORT'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a port number such as 587')
  if (!/^[a-z0-9.-]+$/i.test(v('SMTP_HOST'))) throw new Error('SMTP_HOST must be a host name such as smtp.example.com')
  if (!/^[^\s@,;<>"']+@[^\s@]+$/.test(v('SMTP_FROM'))) throw new Error('SMTP_FROM must be an email address')
  return { host: v('SMTP_HOST'), port, user: v('SMTP_USER'), pass: v('SMTP_PASS'), from: v('SMTP_FROM'), name: v('SMTP_SENDER_NAME') || title }
}

export type Deps = {
  fetch: typeof fetch
  log: (line: string) => void
  sleep: (ms: number) => Promise<void>
  sql?: Query // local: SQL on the local Postgres
  shellDir?: string
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DRY_REF = 'x'.repeat(20)

/** The owner's address, lowercased. Also used by the Compose install (cli/selfhost.ts). */
export function checkOwnerEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@,;<>"']+@[^\s@]+$/.test(email) || !DOMAIN.test(email.split('@')[1] ?? '')) throw new Error('--owner-email must be an email address')
  if (SERVICE_EMAILS.includes(email)) throw new Error('--owner-email is one of the service accounts')
  return email
}

/** Checks and normalises every input. Throws with the flag's name. */
export function validate(raw: { [K in keyof Omit<Options, 'named'>]?: unknown }): Options {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const target = text(raw.target) || 'local'
  if (target !== 'local' && target !== 'hosted') throw new Error('--target must be local or hosted')
  const slug = text(raw.slug)
  // A DNS label (<slug>.<base-domain>) and the `name` of miso.yaml.
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(slug)) throw new Error('--slug must be 1 to 32 lowercase letters, digits and dashes, and not start or end with a dash')
  const named = Boolean(text(raw.title))
  const title = text(raw.title) || slug
  if (!/^[\p{L}\p{N} .&'-]{1,60}$/u.test(title)) throw new Error("--title must be 1 to 60 letters, digits, spaces and . & ' -")
  const ownerEmail = checkOwnerEmail(text(raw.ownerEmail))
  const domain = text(raw.domain).toLowerCase() || undefined
  if (domain && !DOMAIN.test(domain)) throw new Error('--domain must be an email domain such as acme.com')
  const baseDomain = text(raw.baseDomain).toLowerCase() || undefined
  if (baseDomain && !DOMAIN.test(baseDomain)) throw new Error('--base-domain must be a domain such as miso.example.com')
  const supabaseOrg = text(raw.supabaseOrg) || undefined
  if (supabaseOrg && !/^[a-z0-9-]{1,64}$/.test(supabaseOrg)) throw new Error('--supabase-org must be an organization slug (lowercase letters, digits and dashes)')
  const region = text(raw.region) || 'eu-central-1'
  if (!REGIONS.includes(region)) throw new Error(`--region must be one of ${REGIONS.join(', ')}`)
  if (target === 'hosted' && (!baseDomain || !supabaseOrg)) throw new Error('--target hosted needs --base-domain and --supabase-org')
  if (target === 'local' && raw.dryRun) throw new Error('--dry-run is for --target hosted; a local run changes only the local Supabase')
  return { target, slug, title, named, ownerEmail, domain, baseDomain, supabaseOrg, region, dryRun: Boolean(raw.dryRun) }
}

/** JSON for a printed plan: long strings (a migration's SQL) are cut short. */
function preview(body: unknown): string {
  if (typeof body !== 'string' || !body) return ''
  try {
    return ' ' + JSON.stringify(JSON.parse(body), (_k, v) => (typeof v === 'string' && v.length > 100 ? `${v.slice(0, 60).replace(/\s+/g, ' ')}… (${v.length} characters)` : v))
  } catch {
    return ` (${body.length} bytes)`
  }
}

/** The fetch of a dry run: prints the call, sends nothing, and answers as a new and empty account would. */
export function dryFetch(print: (line: string) => void): typeof fetch {
  const json = (value: unknown, status = 200) => Response.json(value, { status })
  const fake = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    print(`${method} ${url.href}${preview(init?.body)}`)
    const path = url.pathname
    if (method === 'GET') {
      if (path === '/v1/projects') return json([])
      if (path.endsWith('/health')) return json([{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' }])
      if (path.endsWith('/api-keys')) return json([{ type: 'publishable', api_key: 'sb_publishable_dry-run' }, { type: 'secret', api_key: 'sb_secret_dry-run' }])
      if (path.endsWith('/postgrest')) return json({ db_schema: 'public,graphql_public' })
      if (path.endsWith('/config/auth')) return json({ site_url: 'http://localhost:3000', uri_allow_list: '' })
      if (path.startsWith('/auth/v1/admin/users')) return json({ users: [] })
      if (path.endsWith('/domains')) return json({ domains: [] })
      return json({ error: { code: 'not_found' } }, 404)
    }
    if (path === '/v1/projects') return json({ ref: DRY_REF }, 201)
    if (path.endsWith('/database/query')) return json([])
    if (path.startsWith('/auth/v1/admin/users')) return json({ id: '00000000-0000-0000-0000-000000000000' })
    if (path.endsWith('/domains')) return json({ verified: false })
    return json({ id: 'prj_dry-run', failed: [] }, 201)
  }
  return fake as typeof fetch
}

type Ctx = {
  o: Options
  env: Env
  deps: Deps
  secrets: Set<string>
  ref?: string
  keys?: { url: string; publishable: string; secret: string }
  vercelId?: string
}

const SUPABASE = 'https://api.supabase.com'
const VERCEL = 'https://api.vercel.com'
const projectName = (c: Ctx) => `miso-${c.o.slug}`
const appUrl = (c: Ctx) => `https://${c.o.slug}.${c.o.baseDomain}`

/** One JSON call. Returns the status and the parsed body; `expect` lists the statuses that are not an error. */
async function call(c: Ctx, base: string, method: string, path: string, body?: unknown, expect: number[] = []): Promise<{ status: number; data: any }> {
  const token = base === SUPABASE ? c.env.supabaseToken : c.env.vercelToken
  const team = base === VERCEL && c.env.vercelTeam ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(c.env.vercelTeam)}` : ''
  const res = await c.deps.fetch(`${base}${path}${team}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  if (!res.ok && !expect.includes(res.status)) throw new Error(`${method} ${base}${path} answered ${res.status}: ${text.slice(0, 300)}`)
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // not JSON: the status is the answer
  }
  return { status: res.status, data }
}

function query(c: Ctx): Query {
  if (c.o.target === 'local') return c.deps.sql!
  return managementQuery(c.ref!, c.env.supabaseToken!, c.deps.fetch)
}

/** The project's URL and keys. Hosted: read from the Management API once; the secret key is never printed. */
async function keys(c: Ctx): Promise<NonNullable<Ctx['keys']>> {
  if (c.keys) return c.keys
  if (c.o.target === 'local') return (c.keys = { url: c.env.supabaseUrl!, publishable: '', secret: c.env.supabaseSecret! })
  const { data } = await call(c, SUPABASE, 'GET', `/v1/projects/${c.ref}/api-keys?reveal=true`)
  const of = (type: string): string | undefined => (Array.isArray(data) ? data.find(k => k?.type === type)?.api_key : undefined)
  const publishable = of('publishable')
  const secret = of('secret')
  if (!publishable || !secret) throw new Error(`Project ${c.ref} has no publishable and secret key yet. Create them in the dashboard (Settings → API Keys), then run this again.`)
  c.secrets.add(secret)
  return (c.keys = { url: `https://${c.ref}.supabase.co`, publishable, secret })
}

async function clients(c: Ctx): Promise<SetupClients> {
  const k = await keys(c)
  return setupClients(k.url, k.secret, c.deps.fetch)
}

type Step = { name: string; hosted?: true; run: (c: Ctx) => Promise<string> }

/** In this order. A step returns the line that says what it found or did. */
export const STEPS: Step[] = [
  {
    name: 'supabase-project',
    hosted: true,
    async run(c) {
      const { data: all } = await call(c, SUPABASE, 'GET', '/v1/projects')
      const mine = (Array.isArray(all) ? all : []).find(p => p?.name === projectName(c) && p?.organization_slug === c.o.supabaseOrg && p?.status !== 'REMOVED')
      if (mine) {
        c.ref = String(mine.ref)
        return `${projectName(c)} is already there (${c.ref})`
      }
      // Nobody needs this password: SQL goes through the Management API. Reset it in the dashboard if a direct connection is ever wanted.
      const dbPass = randomBytes(24).toString('base64url')
      c.secrets.add(dbPass)
      const { data } = await call(c, SUPABASE, 'POST', '/v1/projects', {
        name: projectName(c),
        organization_slug: c.o.supabaseOrg,
        db_pass: dbPass,
        region_selection: { type: 'specific', code: c.o.region }
      })
      if (!/^[a-z]{20}$/.test(String(data?.ref))) throw new Error('POST /v1/projects did not return a project ref')
      c.ref = String(data.ref)
      return `created ${projectName(c)} (${c.ref}) in ${c.o.region}`
    }
  },
  {
    name: 'supabase-healthy',
    hosted: true,
    async run(c) {
      // A new project takes a few minutes. 60 tries, 5 seconds apart.
      for (let attempt = 1; attempt <= 60; attempt++) {
        const { status, data } = await call(c, SUPABASE, 'GET', `/v1/projects/${c.ref}/health?services=auth,db,rest`, undefined, [400, 404, 500, 502, 503, 504])
        if (status === 200 && Array.isArray(data) && data.length && data.every(s => s?.healthy === true)) return `auth, db and rest are healthy${attempt > 1 ? ` (after ${attempt} checks)` : ''}`
        await c.deps.sleep(5000)
      }
      throw new Error(`Project ${c.ref} was not healthy after 5 minutes. Run this again to keep waiting.`)
    }
  },
  {
    name: 'migrations',
    async run(c) {
      const q = query(c)
      const p = await plan(q, await readMigrations('shell', join(c.deps.shellDir ?? join(import.meta.dir, '..'), 'supabase', 'migrations')))
      if (p.pending.length && !p.applied.length) {
        // The schema is there but this ledger never saw it (`supabase start`, `supabase db push`, another tool):
        // running the files again would fail or overwrite. docs/org-repos.md, "A database that already has the shell's objects".
        const rows = await q(`select to_regclass('miso.members') is not null as there`)
        if (Array.isArray(rows) && rows[0]?.there === true) return 'the shell schema is already there, put there by another tool: left as it is'
      }
      const ran = await applyPending(q, p, line => c.deps.log(`    ${line}`))
      if (ran) await q(`notify pgrst, 'reload schema'`)
      return `${ran} applied, ${p.applied.length} were already`
    }
  },
  {
    name: 'api-and-auth-config',
    hosted: true,
    async run(c) {
      const done: string[] = []
      const rest = (await call(c, SUPABASE, 'GET', `/v1/projects/${c.ref}/postgrest`)).data
      const schemas = String(rest?.db_schema ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const missing = ['miso', 'app'].filter(s => !schemas.includes(s))
      if (missing.length) {
        await call(c, SUPABASE, 'PATCH', `/v1/projects/${c.ref}/postgrest`, { db_schema: [...schemas, ...missing].join(',') })
        done.push(`exposed ${missing.join(' and ')}`)
      }
      const auth = (await call(c, SUPABASE, 'GET', `/v1/projects/${c.ref}/config/auth`)).data
      const redirects = String(auth?.uri_allow_list ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const redirect = `${appUrl(c)}/**`
      // mailer_autoconfirm off is "Confirm email" on: owner and allowed-domain both trust a proven address (README).
      if (auth?.site_url !== appUrl(c) || !redirects.includes(redirect) || auth?.mailer_autoconfirm === true) {
        await call(c, SUPABASE, 'PATCH', `/v1/projects/${c.ref}/config/auth`, {
          site_url: appUrl(c),
          uri_allow_list: [...new Set([...redirects, redirect])].join(','),
          mailer_autoconfirm: false
        })
        done.push(`site URL ${appUrl(c)}, redirect ${redirect}`)
      }
      // The owner signs in with a mailed link, and Supabase's own mail reaches only the Supabase organization's team.
      const m = c.env.smtp
      if (m && (auth?.smtp_host !== m.host || String(auth?.smtp_port) !== String(m.port) || auth?.smtp_user !== m.user || auth?.smtp_admin_email !== m.from || auth?.smtp_sender_name !== m.name)) {
        // The password can't be read back, so it is sent again whenever anything else differs.
        await call(c, SUPABASE, 'PATCH', `/v1/projects/${c.ref}/config/auth`, {
          smtp_host: m.host,
          smtp_port: String(m.port),
          smtp_user: m.user,
          smtp_pass: m.pass,
          smtp_admin_email: m.from,
          smtp_sender_name: m.name
        })
        done.push(`sign-in mail from ${m.from} through ${m.host}`)
      }
      // Mail with a code as well as the link (LoginScreen has a code field). Supabase's free tier
      // refuses template changes without custom SMTP, so only with it.
      if (m && (!String(auth?.mailer_templates_magic_link_content ?? '').includes('{{ .Token }}') || auth?.mailer_otp_length !== 6)) {
        const template = (name: string) => readFileSync(join(c.deps.shellDir ?? join(import.meta.dir, '..'), 'supabase', 'templates', name), 'utf8')
        await call(c, SUPABASE, 'PATCH', `/v1/projects/${c.ref}/config/auth`, {
          mailer_otp_length: 6,
          mailer_subjects_magic_link: 'Your sign-in code',
          mailer_subjects_confirmation: 'Your sign-in code',
          mailer_templates_magic_link_content: template('magic_link.html'),
          mailer_templates_confirmation_content: template('confirmation.html')
        })
        done.push('sign-in mail with a code')
      }
      return done.length ? done.join('; ') : 'schemas and auth URLs were already set'
    }
  },
  {
    name: 'service-accounts',
    async run(c) {
      const clear = await serviceAccounts(await clients(c), line => c.deps.log(`    ${line}`))
      return `the spaces and vault accounts are there${clear ? '' : '; the owner step takes the owner seat back'}`
    }
  },
  {
    name: 'owner',
    async run(c) {
      return makeOwner(await clients(c), query(c), c.o.ownerEmail)
    }
  },
  {
    name: 'workspace-name',
    async run(c) {
      if (!c.o.named) return 'skipped: no --title'
      // Only while unset: a rerun never undoes a name the team chose on Settings → Organisation.
      const rows = await query(c)(`update miso.org_settings set name = ${literal(c.o.title)} where name is null returning name`)
      return Array.isArray(rows) && rows.length ? `the sidebar says ${c.o.title}` : 'the workspace already has a name'
    }
  },
  {
    name: 'allowed-domain',
    async run(c) {
      if (!c.o.domain) return 'skipped: no --domain'
      await allowDomain(await clients(c), c.o.domain, line => c.deps.log(`    ${line}`))
      return `@${c.o.domain} signs in as member`
    }
  },
  {
    name: 'vercel-project',
    hosted: true,
    async run(c) {
      const found = await call(c, VERCEL, 'GET', `/v9/projects/${projectName(c)}`, undefined, [404])
      if (found.status === 200 && found.data?.id) {
        c.vercelId = String(found.data.id)
        return `${projectName(c)} is already there`
      }
      // No framework preset and no Git connection: CI deploys the folder `miso vercel prepare` makes.
      const { data } = await call(c, VERCEL, 'POST', '/v11/projects', { name: projectName(c), framework: null })
      if (!data?.id) throw new Error('POST /v11/projects did not return a project id')
      c.vercelId = String(data.id)
      return `created ${projectName(c)}`
    }
  },
  {
    name: 'vercel-env',
    hosted: true,
    async run(c) {
      const k = await keys(c)
      const target = ['production', 'preview']
      // upsert=true: a second run overwrites the three values, it does not add a second set.
      const { data } = await call(c, VERCEL, 'POST', `/v10/projects/${c.vercelId}/env?upsert=true`, [
        { key: 'SUPABASE_URL', value: k.url, type: 'plain', target },
        { key: 'SUPABASE_PUBLISHABLE_KEY', value: k.publishable, type: 'plain', target },
        { key: 'SUPABASE_SECRET_KEY', value: k.secret, type: 'sensitive', target }
      ])
      if (Array.isArray(data?.failed) && data.failed.length) throw new Error(`Vercel refused ${data.failed.length} variable(s): ${data.failed.map((f: any) => f?.error?.message).join('; ')}`)
      return 'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY set for production and preview'
    }
  },
  {
    name: 'vercel-domain',
    hosted: true,
    async run(c) {
      const host = `${c.o.slug}.${c.o.baseDomain}`
      const { data: list } = await call(c, VERCEL, 'GET', `/v9/projects/${c.vercelId}/domains`)
      if (Array.isArray(list?.domains) && list.domains.some((d: any) => d?.name === host)) return `${host} is already attached`
      const { data } = await call(c, VERCEL, 'POST', `/v10/projects/${c.vercelId}/domains`, { name: host })
      return `attached ${host}${data?.verified === false ? ' (not verified yet: point its DNS at Vercel, see the project\'s Domains page)' : ''}`
    }
  },
  {
    name: 'miso-yaml',
    async run(c) {
      const hosted = c.o.target === 'hosted'
      const yaml = configText({ name: c.o.slug, title: c.o.title, shell: 'tamari-studio/tamari', version: 'none', port: 13400, supabase: hosted ? c.ref! : '', runtime: hosted ? 'vercel' : 'local' })
      c.deps.log("    The twin's .miso/miso.yaml (`miso init` in the twin's repo writes it with the same values):")
      for (const line of yaml.trimEnd().split('\n')) c.deps.log(`      ${line}`)
      return hosted ? 'printed. Still by hand: docs/org-repos.md, "What miso provision leaves to you"' : 'printed'
    }
  }
]

/** The owner account, email confirmed and tier owner. Safe to run again. Also used by the Compose install (cli/selfhost.ts). */
export async function makeOwner(cl: SetupClients, q: Query, email: string): Promise<string> {
  // Before any URL is shared: on a database with no people, the first sign-in becomes owner (app.app_user_bootstrap()).
  let id = await findUser(cl, email)
  const existed = Boolean(id)
  if (!id) {
    const { data, error } = await cl.admin.auth.admin.createUser({ email, email_confirm: true })
    if (error) throw new Error(`creating ${email}: ${error.message}`)
    id = data.user.id
  }
  if (!UUID.test(id)) throw new Error('The auth API returned a user id that is not a uuid')
  // The trigger made a first person owner already. This also covers a database that had people: app.actor_id names who changed the tier.
  // Then, with a person as owner, the last-owner lock lets go of a service account that holds the seat
  // (an app that signed it in before the setup ran; see serviceAccount in scripts/supabase-setup.ts).
  await q(
    `begin;\nset local app.actor_id = ${literal(id)};\n` +
      `insert into app.app_user (user_id, email, tier, status) values (${literal(id)}, ${literal(email)}, 'owner', 'active')\n` +
      `on conflict (user_id) do update set tier = 'owner', status = 'active' where app_user.tier is distinct from 'owner' or app_user.status <> 'active';\n` +
      `${SERVICE_ROWS_DELETE}\ncommit;`
  )
  const others = await q(`select email from app.app_user where tier = 'owner' and status = 'active' and user_id <> ${literal(id)}`)
  const warn = Array.isArray(others) && others.length ? `. WARNING: ${others.length} other owner(s) already here: ${others.map(r => r?.email).join(', ')}` : ''
  return `${email} ${existed ? 'was already an account and' : 'created and'} is owner${warn}`
}

/** Runs the steps in order. Throws at the first that fails; run again to continue. */
export async function provision(o: Options, env: Env, deps: Deps): Promise<void> {
  const secrets = new Set<string>([env.supabaseToken, env.vercelToken, env.supabaseSecret, env.smtp?.pass].filter((s): s is string => Boolean(s)))
  const redact = (text: string) => [...secrets].reduce((t, s) => t.split(s).join('[redacted]'), text)
  const log = (line: string) => deps.log(redact(line))
  const c: Ctx = { o, env, secrets, deps: { ...deps, log, fetch: o.dryRun ? dryFetch(line => log(`    ${line}`)) : deps.fetch } }
  if (o.target === 'local') {
    if (!env.supabaseUrl || !env.supabaseSecret) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase (`supabase start` prints them), then run this again.')
    if (!LOCAL_HOST.test(new URL(env.supabaseUrl).hostname)) throw new Error('--target local only runs against a Supabase on localhost. SUPABASE_URL points somewhere else.')
    if (!deps.sql) throw new Error('--target local needs a connection to the local Postgres')
  }
  log(`miso provision: ${o.slug}, ${o.target}${o.dryRun ? ' (dry run: nothing is sent, created or changed)' : ''}`)
  if (o.dryRun) log(`${DRY_REF} stands for the ref the new Supabase project gets. To run it for real: add --yes, with SUPABASE_ACCESS_TOKEN and VERCEL_TOKEN set.`)
  for (const [i, step] of STEPS.entries()) {
    const head = `${i + 1}/${STEPS.length} ${step.name}`
    if (step.hosted && o.target === 'local') {
      log(`${head}: skipped, hosted only`)
      continue
    }
    log(head)
    try {
      log(`    ✓ ${await step.run(c)}`)
    } catch (err) {
      throw new Error(redact(`step ${step.name} failed: ${err instanceof Error ? err.message : err}. Fix it and run the same command again: finished steps are not repeated.`))
    }
  }
  log(o.dryRun ? 'Dry run finished. Nothing was sent.' : `✓ ${o.title} is provisioned (${o.target}).`)
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

export const USAGE =
  'miso provision --slug <s> --owner-email <e> [--target local|hosted] [--title <t>] [--domain <email domain>]\n' +
  '                      hosted: --base-domain <d> --supabase-org <slug> [--region <r>] [--yes] [--without-smtp]\n' +
  '                      (hosted is a dry run without --yes; a real one needs SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)'

/** The command line. `--target hosted` is a dry run unless `--yes` is there. */
export async function main(args: string[], log: (line: string) => void = console.log): Promise<void> {
  const target = flag(args, '--target') ?? 'local'
  const o = validate({
    target,
    slug: flag(args, '--slug'),
    title: flag(args, '--title'),
    ownerEmail: flag(args, '--owner-email'),
    domain: flag(args, '--domain'),
    baseDomain: flag(args, '--base-domain'),
    supabaseOrg: flag(args, '--supabase-org'),
    region: flag(args, '--region'),
    dryRun: args.includes('--dry-run') || (target === 'hosted' && !args.includes('--yes'))
  })
  const deps = { fetch, log, sleep: (ms: number) => Bun.sleep(ms) }
  if (o.target === 'hosted') {
    const smtp = smtpFrom(process.env, o.title)
    const noSmtp = !smtp && !args.includes('--without-smtp')
    const smtpHelp = 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM: Supabase\'s own mail reaches only your Supabase organization\'s team, so the owner would get no sign-in link. Or pass --without-smtp if the owner signs in another way.'
    if (o.dryRun) {
      if (noSmtp) log(`Note for the real run: ${smtpHelp}`)
      return provision(o, { supabaseToken: 'dry-run-token', vercelToken: 'dry-run-token', smtp: smtp && { ...smtp, pass: 'dry-run-smtp' } }, deps)
    }
    if (noSmtp) throw new Error(smtpHelp)
    const vercelToken = process.env.VERCEL_TOKEN?.trim()
    if (!vercelToken) throw new Error('Set VERCEL_TOKEN for a real hosted run.')
    const team = process.env.VERCEL_ORG_ID?.trim()
    return provision(o, { supabaseToken: accessToken(), vercelToken, vercelTeam: team?.startsWith('team_') ? team : undefined, smtp }, deps)
  }
  // The CLI's fixed local database address; SUPABASE_DB_URL for a second local stack on other ports.
  const dbUrl = process.env.SUPABASE_DB_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!LOCAL_HOST.test(new URL(dbUrl).hostname)) throw new Error('--target local only runs against a Postgres on localhost. SUPABASE_DB_URL points somewhere else.')
  const pg = postgresQuery(dbUrl)
  try {
    await provision(o, { supabaseUrl: process.env.SUPABASE_URL?.trim(), supabaseSecret: process.env.SUPABASE_SECRET_KEY?.trim() }, { ...deps, sql: pg.query })
  } finally {
    await pg.close()
  }
}
