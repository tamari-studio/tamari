// Applies the shell's migrations (supabase/migrations) and then the org's
// (.miso/migrations) to the org's database, tracked in one ledger,
// public.miso_migrations (source, filename, checksum). Ported from an earlier
// runner (scripts/db-migrate.ts) and keeps its rules:
//
// - files run in source order (shell, then org), then filename order
// - each ledger row holds the sha256 of the file's raw bytes
// - if an applied file's hash has changed, nothing runs: write a new file instead
// - each file runs in one transaction, with its ledger insert in that same transaction
// - the first file that fails stops the run; it and every later file stay pending
//
// SQL goes through the Supabase Management API as SUPABASE_ACCESS_TOKEN, else the
// Supabase CLI's own login from the macOS keychain (`supabase login`).
// shortcut: `miso migrate` is for hosted projects only; postgresQuery() below is the local one, used by `miso provision`.
import { join } from 'node:path'

export const LEDGER = 'public.miso_migrations'

export const LEDGER_DDL = `create table if not exists ${LEDGER} (
  source text not null,
  filename text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  primary key (source, filename)
);
alter table ${LEDGER} enable row level security;`

export type Source = 'shell' | 'org'

export type Query = (sql: string) => Promise<unknown>

export type MigrationFile = { source: Source; filename: string; sha256: string; sql: string }

export type LedgerRow = { source: string; filename: string; checksum: string }

export type MigrationPlan = {
  applied: MigrationFile[]
  pending: MigrationFile[]
  edited: { source: string; filename: string }[]
  missing: string[]
}

export function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

export async function readMigrations(source: Source, dir: string): Promise<MigrationFile[]> {
  const names = await Array.fromAsync(new Bun.Glob('*.sql').scan({ cwd: dir })).catch(() => [] as string[])
  names.sort()
  return Promise.all(
    names.map(async filename => {
      const bytes = await Bun.file(join(dir, filename)).bytes()
      return { source, filename, sha256: sha256(bytes), sql: new TextDecoder().decode(bytes) }
    })
  )
}

export function planMigrations(files: MigrationFile[], ledger: LedgerRow[]): MigrationPlan {
  const key = (source: string, filename: string) => `${source}/${filename}`
  const recorded = new Map(ledger.map(row => [key(row.source, row.filename), row.checksum]))
  const plan: MigrationPlan = { applied: [], pending: [], edited: [], missing: [] }
  for (const file of files) {
    const checksum = recorded.get(key(file.source, file.filename))
    if (checksum === undefined) plan.pending.push(file)
    else if (checksum === file.sha256) plan.applied.push(file)
    else plan.edited.push({ source: file.source, filename: file.filename })
  }
  const onDisk = new Set(files.map(f => key(f.source, f.filename)))
  plan.missing = [...recorded.keys()].filter(k => !onDisk.has(k)).sort()
  return plan
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function ledgerInsertSql(file: MigrationFile): string {
  return `insert into ${LEDGER} (source, filename, checksum) values (${literal(file.source)}, ${literal(file.filename)}, ${literal(file.sha256)});`
}

/** The file and its ledger row in one transaction. The lone `;` ends a file without a trailing one. */
export function applySql(file: MigrationFile): string {
  return `begin;\n${file.sql}\n;\n${ledgerInsertSql(file)}\ncommit;`
}

/** Postgres's "relation … does not exist" (SQLSTATE 42P01): a database nothing has migrated yet. */
export function isMissingLedger(err: unknown): boolean {
  return /42P01|relation \S*miso_migrations\S* does not exist/.test(err instanceof Error ? err.message : String(err))
}

export async function readLedger(query: Query): Promise<LedgerRow[]> {
  let rows: unknown
  try {
    rows = await query(`select source, filename, checksum from ${LEDGER} order by source, filename`)
  } catch (err) {
    if (isMissingLedger(err)) return []
    throw err
  }
  if (!Array.isArray(rows)) throw new Error(`Unexpected ledger result: ${JSON.stringify(rows)}`)
  return rows.map(row => {
    const { source, filename, checksum } = row as Record<string, unknown>
    if (typeof source !== 'string' || typeof filename !== 'string' || typeof checksum !== 'string') {
      throw new Error(`Unexpected ledger row: ${JSON.stringify(row)}`)
    }
    return { source, filename, checksum }
  })
}

/** The token the CLI keychain entry holds: go-keyring writes it as `go-keyring-base64:<base64>`. */
export function decodeKeychainToken(raw: string): string {
  const value = raw.trim()
  const prefix = 'go-keyring-base64:'
  return value.startsWith(prefix) ? Buffer.from(value.slice(prefix.length), 'base64').toString('utf8').trim() : value
}

export function accessToken(): string {
  const env = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (env) return env
  const r = Bun.spawnSync(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'])
  const token = r.success ? decodeKeychainToken(r.stdout.toString()) : ''
  if (!token) throw new Error('No Supabase access token: set SUPABASE_ACCESS_TOKEN, or run `supabase login`.')
  return token
}

/** Runs SQL on a local Supabase's Postgres (`supabase start`), for `miso provision --target local`. */
export function postgresQuery(url: string): { query: Query; close: () => Promise<void> } {
  // One connection: the files send their own begin/commit, which a pool would spread over several.
  const sql = new Bun.SQL(url, { max: 1 })
  return { query: text => sql.unsafe(text), close: () => sql.close() }
}

/** Runs SQL on a hosted project through the Management API. */
export function managementQuery(ref: string, token: string, fetchImpl: typeof fetch = fetch): Query {
  return async sql => {
    const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql })
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 500)}`)
    return text ? JSON.parse(text) : []
  }
}

export async function migrationFiles(shellDir: string, orgRoot: string): Promise<MigrationFile[]> {
  return [
    ...(await readMigrations('shell', join(shellDir, 'supabase', 'migrations'))),
    ...(await readMigrations('org', join(orgRoot, '.miso', 'migrations')))
  ]
}

export async function plan(query: Query, files: MigrationFile[]): Promise<MigrationPlan> {
  return planMigrations(files, await readLedger(query))
}

/** Runs every pending file in order; stops at the first failure. Returns how many ran. */
export async function applyPending(query: Query, p: MigrationPlan, log: (line: string) => void): Promise<number> {
  if (p.edited.length) {
    throw new Error(`Applied migrations were edited: ${p.edited.map(e => `${e.source}/${e.filename}`).join(', ')}. Write a new file instead.`)
  }
  if (!p.pending.length) return 0
  await query(LEDGER_DDL)
  let ran = 0
  for (const file of p.pending) {
    try {
      await query(applySql(file))
    } catch (err) {
      throw new Error(`${file.source}/${file.filename} failed, nothing after it ran: ${err instanceof Error ? err.message : err}`)
    }
    log(`✓ ${file.source}/${file.filename}`)
    ran++
  }
  return ran
}
