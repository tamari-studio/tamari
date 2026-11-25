// One-time setup of a Supabase project for miso, after the migration has run
// (`supabase db push`). Safe to run again.
//
//   bun run supabase:setup                     the two service accounts
//   bun run supabase:setup --domain acme.com   also let anyone @acme.com in as a member
//
// Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment (.env). It
// creates the account space code runs as (a plain member) and the vault
// account (role 'service', the only one that reads secrets), both flagged
// miso_service so neither becomes the owner: the first person to sign in does.
// app_metadata.miso_service is also what lets them past miso.sees_space(): only
// this admin API sets it, so a person can't give it to themselves.
//
// `miso provision` (cli/provision.ts) calls the functions below with its own fetch.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MISO_VAULT_EMAIL } from '../app/server/supabase'
import { MISO_SPACES_EMAIL } from '../app/vendor/dto-core/session'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>
export type SetupClients = { admin: Client; miso: Client; app: Client }
type Log = (line: string) => void

export const SERVICE_EMAILS = [MISO_SPACES_EMAIL, MISO_VAULT_EMAIL]

/** The secret-key clients the setup needs. `fetchImpl` lets a caller route or fake the network. */
export function setupClients(url: string, secret: string, fetchImpl?: typeof fetch): SetupClients {
  const client = (schema?: string) =>
    createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, ...(schema ? { db: { schema } } : {}), ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}) })
  return { admin: client(), miso: client('miso'), app: client('app') }
}

async function findAccount(c: SetupClients, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await c.admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listing users: ${error.message}`)
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 1000) return null
  }
}

export async function findUser(c: SetupClients, email: string): Promise<string | null> {
  return (await findAccount(c, email))?.id ?? null
}

/** How app.app_user_guard_last_owner() refuses to remove the only active owner. */
export const LAST_OWNER = 'last-owner invariant'

/** Drops the service accounts' person rows (flagged miso_service). makeOwner in cli/provision.ts runs it once a person is owner; supabase/checks/setup-repair.sql checks it. */
export const SERVICE_ROWS_DELETE = `delete from app.app_user a using auth.users u where u.id = a.user_id and u.raw_app_meta_data ->> 'miso_service' = 'true';`

/** The same recovery as SQL, for a project without the owner command: `email` becomes the owner (they have signed in once), then the service rows go. */
export function ownerSeatSql(email: string): string {
  const e = `'${email.replace(/'/g, "''")}'`
  return [
    'begin;',
    `select set_config('app.actor_id', id::text, true) from auth.users where email = ${e};`,
    `insert into app.app_user (user_id, email, tier, status) select id, email, 'owner', 'active' from auth.users where email = ${e}`,
    "  on conflict (user_id) do update set tier = 'owner', status = 'active';",
    SERVICE_ROWS_DELETE,
    'commit;'
  ].join('\n')
}

/**
 * Sets up one service account. False when it is set up except for one thing: it holds the owner
 * seat. An app older than this fix signed it in before this setup ran, so app.app_user_bootstrap()
 * made it the first person, the owner, and the last-owner lock keeps that row until a person is
 * owner (makeOwner in cli/provision.ts makes one and removes the row; so does a later run).
 */
export async function serviceAccount(c: SetupClients, email: string, role: 'member' | 'service', log: Log = console.log): Promise<boolean> {
  const account = await findAccount(c, email)
  let id = account?.id
  let ownerSeat = false
  if (!id) {
    const { data, error } = await c.admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { miso_service: true }, app_metadata: { miso_service: true } })
    if (error) throw new Error(`creating ${email}: ${error.message}`)
    id = data.user.id
  } else {
    // Set up by an earlier run: nothing to do. (The repair below reaches app.app_user with the secret key: migration 20261124000300 grants it.)
    const { data: member } = await c.miso.from('members').select('role').eq('user_id', id).maybeSingle()
    // A person row left over (the owner seat case below) means not done yet.
    const { data: person, error: personError } = await c.app.from('app_user').select('user_id').eq('user_id', id).maybeSingle()
    if (personError) throw new Error(`app.app_user for ${email}: ${personError.message}. Is app in the exposed schemas?`)
    if (account?.app_metadata?.miso_service === true && member?.role === role && !person) return (log(`✓ ${email} (${role}) was already set up`), true)
    // An account the broker created before this ran: mark it, and drop the person row it got.
    const { error } = await c.admin.auth.admin.updateUserById(id, { app_metadata: { miso_service: true }, email_confirm: true })
    if (error) throw new Error(`updating ${email}: ${error.message}`)
    const { error: rowError } = await c.app.from('app_user').delete().eq('user_id', id)
    ownerSeat = Boolean(rowError?.message.includes(LAST_OWNER))
    if (rowError && !ownerSeat) throw new Error(`app.app_user for ${email}: ${rowError.message}. Is app in the exposed schemas?`)
  }
  const { error } = await c.miso.from('members').upsert({ user_id: id, role }, { onConflict: 'user_id' })
  if (error) throw new Error(`miso.members for ${email}: ${error.message}. Did the migration run, and are miso and app in the exposed schemas?`)
  if (ownerSeat) {
    log(`⚠ ${email} (${role}) is the owner: the app signed it in before this setup ran, so it became the first person, and people who sign in now wait for approval. Make the real owner with \`bun cli/selfhost.ts owner <email>\` (or the owner step of \`miso provision\`), which also takes the seat back.`)
    return false
  }
  log(`✓ ${email} (${role})`)
  return true
}

/** The account space code runs as, and the vault account. False while one of them holds the owner seat. */
export async function serviceAccounts(c: SetupClients, log: Log = console.log): Promise<boolean> {
  const spaces = await serviceAccount(c, MISO_SPACES_EMAIL, 'member', log)
  const vault = await serviceAccount(c, MISO_VAULT_EMAIL, 'service', log)
  return spaces && vault
}

export async function allowDomain(c: SetupClients, domain: string, log: Log = console.log): Promise<void> {
  const { error } = await c.miso.from('allowed_domains').upsert({ domain }, { onConflict: 'domain' })
  if (error) throw new Error(`allowed domain ${domain}: ${error.message}`)
  log(`✓ anyone @${domain} can sign in as a member`)
}

if (import.meta.main) {
  const url = process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (in .env), then run this again.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const domains = args.flatMap((arg, i) => (arg === '--domain' && args[i + 1] ? [args[i + 1]!.trim().toLowerCase()] : []))
  const clients = setupClients(url, secret)
  const clear = await serviceAccounts(clients)
  for (const domain of domains) await allowDomain(clients, domain)
  if (!clear) {
    console.error(`Not done: a service account holds the owner seat (see above). Without the owner command: sign in once as the real owner, run this SQL with your email (Supabase's SQL editor, or psql on the database), then run this again:\n\n${ownerSeatSql('you@example.com')}\n`)
    process.exit(1)
  }
  console.log('Done. The first person to sign in becomes the owner.')
}
