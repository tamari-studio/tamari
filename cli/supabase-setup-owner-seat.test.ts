import { afterEach, expect, test } from 'bun:test'
import { supabaseAuthOps } from '../app/vendor/dto-core/session'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAST_OWNER, ownerSeatSql, SERVICE_ROWS_DELETE, serviceAccount, type SetupClients } from '../scripts/supabase-setup'

// A service account the app signed in before the setup ran became the first person, the owner. The
// last-owner lock refuses to drop its person row until a person is owner. The setup finishes the
// rest and says so, and a later run (once someone is owner) drops the row.

const ID = '00000000-0000-4000-8000-000000000001'

function fake(opts: { ownerSeat: boolean }) {
  const db = { person: true as boolean, member: null as string | null, flagged: false }
  const log: string[] = []
  const query = (result: () => { data: unknown; error: { message: string } | null }) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => result(), then: (ok: (v: unknown) => void) => ok(result()) }
    return q
  }
  const c = {
    admin: {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [{ id: ID, email: 'spaces@x.test', app_metadata: db.flagged ? { miso_service: true } : {} }] }, error: null }),
          updateUserById: async () => ((db.flagged = true), { error: null })
        }
      }
    },
    miso: {
      from: () => ({
        select: () => query(() => ({ data: db.member ? { role: db.member } : null, error: null })),
        upsert: async (row: { role: string }) => ((db.member = row.role), { error: null })
      })
    },
    app: {
      from: () => ({
        select: () => query(() => ({ data: db.person ? { user_id: ID } : null, error: null })),
        delete: () =>
          query(() => {
            if (opts.ownerSeat) return { data: null, error: { message: `${LAST_OWNER}: deletion of the only active owner is refused` } }
            db.person = false
            return { data: null, error: null }
          })
      })
    }
  } as unknown as SetupClients
  return { c, db, log: (line: string) => log.push(line), lines: log }
}

test('an account holding the owner seat is finished but reported, not thrown', async () => {
  const f = fake({ ownerSeat: true })
  expect(await serviceAccount(f.c, 'spaces@x.test', 'member', f.log)).toBe(false)
  expect(f.db).toEqual({ person: true, member: 'member', flagged: true })
  expect(f.lines.join('\n')).toContain('is the owner')
})

test('a later run does not call it set up while the person row is still there', async () => {
  const f = fake({ ownerSeat: true })
  await serviceAccount(f.c, 'spaces@x.test', 'member', f.log)
  expect(await serviceAccount(f.c, 'spaces@x.test', 'member', f.log)).toBe(false)
  expect(f.lines.some(l => l.includes('already set up'))).toBe(false)
})

test('with a person as owner the row goes and the account is set up', async () => {
  const f = fake({ ownerSeat: false })
  expect(await serviceAccount(f.c, 'spaces@x.test', 'member', f.log)).toBe(true)
  expect(f.db).toEqual({ person: false, member: 'member', flagged: true })
  expect(await serviceAccount(f.c, 'spaces@x.test', 'member', f.log)).toBe(true)
  expect(f.lines.at(-1)).toContain('already set up')
})

test("the recovery drops only flagged service accounts' person rows, after naming the actor", () => {
  expect(SERVICE_ROWS_DELETE).toContain('delete from app.app_user')
  expect(SERVICE_ROWS_DELETE).toContain("raw_app_meta_data ->> 'miso_service' = 'true'")
  const sql = ownerSeatSql("o'brien@x.test")
  expect(sql).toContain("where email = 'o''brien@x.test'")
  expect(sql.indexOf("set_config('app.actor_id'")).toBeLessThan(sql.indexOf('insert into app.app_user'))
  expect(sql.indexOf('insert into app.app_user')).toBeLessThan(sql.indexOf(SERVICE_ROWS_DELETE))
})

test('the refusal the setup recognises is the one the migrations raise', () => {
  const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
  const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
  expect(sql).toContain(`'${LAST_OWNER}: % of the only active owner is refused`)
})

// The broker's first mint creates the service account: flagged, so it never gets a person row.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

async function bodies(service: boolean) {
  const sent: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify({ id: ID, email: 'spaces@x.test', properties: { hashed_token: 'h' }, user: { id: ID } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const ops = supabaseAuthOps({ url: 'http://127.0.0.1:1', publishableKey: 'p', secretKey: 's', ...(service ? { service } : {}) })
  await ops.magicLinkHash('spaces@x.test')
  await ops.createUser('spaces@x.test')
  return sent
}

test('a service broker flags the account it creates', async () => {
  const [link, user] = await bodies(true)
  expect(link).toMatchObject({ type: 'magiclink', data: { miso_service: true } })
  expect(user).toMatchObject({ user_metadata: { miso_service: true }, app_metadata: { miso_service: true } })
})

test("a person's broker does not", async () => {
  const [link, user] = await bodies(false)
  expect(link?.data).toBeUndefined()
  expect(user?.user_metadata).toBeUndefined()
  expect(user?.app_metadata).toBeUndefined()
})
